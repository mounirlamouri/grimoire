use crate::addon::manifest::scan_installed_addons;
use crate::commands::updates::{bootstrap_untracked, compute_updates};
use crate::config::{paths, settings};
use crate::db::{self, CatalogAddon};
use crate::esoui::api::EsoUiClient;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Progress event payload sent to the frontend during sync.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SyncProgress {
    pub stage: String,
    pub detail: String,
    /// 0.0 to 1.0, or -1.0 for indeterminate
    pub progress: f64,
}

/// Status returned by get_catalog_status.
#[derive(Debug, serde::Serialize)]
pub struct CatalogStatus {
    pub addon_count: i64,
    pub last_sync: Option<String>,
}

#[tauri::command]
pub async fn sync_catalog(app_handle: tauri::AppHandle) -> Result<i64, String> {
    let emit = |stage: &str, detail: &str, progress: f64| {
        let _ = app_handle.emit(
            "catalog-sync-progress",
            SyncProgress {
                stage: stage.to_string(),
                detail: detail.to_string(),
                progress,
            },
        );
    };

    emit("init", "Connecting to ESOUI API...", 0.0);

    let mut client = EsoUiClient::new();
    client.init().await?;

    emit("fetch", "Downloading addon catalog...", 0.2);

    let catalog = client.fetch_file_list().await?;
    let total = catalog.len();

    emit(
        "save",
        &format!("Saving {} addons to database...", total),
        0.6,
    );

    // Convert catalog items into DB rows
    let rows: Vec<_> = catalog
        .iter()
        .map(|item| {
            let dirs = item
                .ui_dir
                .as_ref()
                .map(|d| d.join(","))
                .unwrap_or_default();
            let date = item.ui_date.as_ref().and_then(|v| v.as_i64());
            let downloads = item
                .ui_download_total
                .as_ref()
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(0);
            let favorites = item
                .ui_favorite_total
                .as_ref()
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(0);
            let monthly = item
                .ui_download_monthly
                .as_ref()
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(0);

            (
                item.uid.clone(),
                item.ui_name.clone(),
                item.ui_version.clone(),
                date,
                downloads,
                favorites,
                monthly,
                if dirs.is_empty() { None } else { Some(dirs) },
                item.ui_cat_id.clone(),
                item.ui_author_name.clone(),
                item.ui_download.clone(),
                item.ui_file_info_url.clone(),
            )
        })
        .collect();

    // Get DB connection from state
    let db_state = app_handle.state::<Mutex<Connection>>();
    let conn = db_state
        .lock()
        .map_err(|e| format!("DB lock error: {}", e))?;

    db::upsert_catalog(&conn, &rows)?;

    let count = db::catalog_count(&conn)?;

    emit(
        "done",
        &format!("Synced {} addons", count),
        1.0,
    );

    // After sync, bootstrap untracked addons and check for updates
    let addon_path = settings::load_settings(&app_handle)
        .addon_path
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| paths::detect_addon_path());

    if let Some(path) = addon_path {
        if let Ok(installed) = scan_installed_addons(&path) {
            // Bootstrap untracked addons (records catalog dates), emitting progress events
            let _ = bootstrap_untracked(&conn, &installed, |current, total| {
                let _ = app_handle.emit(
                    "bootstrap-progress",
                    crate::commands::updates::BootstrapProgress { current, total },
                );
            });

            if let Ok(updates) = compute_updates(&conn, &installed) {
                let _ = app_handle.emit("updates-available", &updates);
            }
        }
    }

    Ok(count)
}

#[tauri::command]
pub fn get_catalog_status(app_handle: tauri::AppHandle) -> Result<CatalogStatus, String> {
    let db_state = app_handle.state::<Mutex<Connection>>();
    let conn = db_state
        .lock()
        .map_err(|e| format!("DB lock error: {}", e))?;

    Ok(CatalogStatus {
        addon_count: db::catalog_count(&conn)?,
        last_sync: db::last_sync_time(&conn)?,
    })
}

#[tauri::command]
pub fn search_addons(
    app_handle: tauri::AppHandle,
    query: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<CatalogAddon>, String> {
    let db_state = app_handle.state::<Mutex<Connection>>();
    let conn = db_state
        .lock()
        .map_err(|e| format!("DB lock error: {}", e))?;

    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);

    if query.is_empty() {
        db::browse_catalog(&conn, limit, offset)
    } else {
        db::search_catalog(&conn, &query, limit, offset)
    }
}

/// Fetch metadata for a batch of addon UIDs. Uses cached data when fresh,
/// fetches from the ESOUI per-addon API when stale or missing.
#[tauri::command]
pub async fn fetch_addon_metadata(
    app_handle: tauri::AppHandle,
    uids: Vec<String>,
) -> Result<std::collections::HashMap<String, db::AddonMetadata>, String> {
    if uids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    // Step 1: Check cache and determine which UIDs need fetching
    let uids_to_fetch: Vec<String>;
    let mut result: std::collections::HashMap<String, db::AddonMetadata>;
    {
        let db_state = app_handle.state::<Mutex<Connection>>();
        let conn = db_state
            .lock()
            .map_err(|e| format!("DB lock error: {}", e))?;

        let cached = db::get_cached_metadata_batch(&conn, &uids)?;
        let catalog_dates = db::get_catalog_dates_by_uids(&conn, &uids)?;

        uids_to_fetch = uids
            .iter()
            .filter(|uid| {
                match cached.get(*uid) {
                    Some(meta) => {
                        // Stale if catalog date differs from cached ui_date
                        let catalog_date = catalog_dates.get(*uid);
                        match (meta.ui_date, catalog_date) {
                            (Some(cached_date), Some(&current_date)) => cached_date != current_date,
                            (None, Some(_)) => true, // cached without date, but catalog has one
                            _ => false,              // no catalog date = can't determine staleness
                        }
                    }
                    None => true, // not cached at all
                }
            })
            .cloned()
            .collect();

        result = cached;
    }

    // Step 2: Fetch stale/missing UIDs from API
    if !uids_to_fetch.is_empty() {
        let mut client = EsoUiClient::new();
        client.init().await?;

        // Fetch sequentially with a small batch to be polite to the API
        let mut fetched = Vec::new();
        for uid in &uids_to_fetch {
            match client.fetch_addon_details(uid).await {
                Ok(details) if !details.is_empty() => {
                    fetched.push(details.into_iter().next().unwrap());
                }
                Ok(_) => {} // empty response, skip
                Err(e) => {
                    log::warn!("Failed to fetch metadata for UID {}: {}", uid, e);
                }
            }
        }

        // Step 3: Store fetched metadata in DB
        let db_state = app_handle.state::<Mutex<Connection>>();
        let conn = db_state
            .lock()
            .map_err(|e| format!("DB lock error: {}", e))?;

        let now = chrono::Utc::now().timestamp();

        for details in &fetched {
            let ui_date = details.ui_date.as_ref().and_then(|v| v.as_i64());
            let compatibility = details
                .ui_compatibility
                .as_ref()
                .map(|v| serde_json::to_string(v).unwrap_or_default());
            let donation_link = details
                .ui_donation_link
                .as_ref()
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .or_else(|| {
                    details
                        .ui_donation_link
                        .as_ref()
                        .map(|v| serde_json::to_string(v).unwrap_or_default())
                });
            let img_thumbs = details
                .ui_img_thumbs
                .as_ref()
                .map(|v| serde_json::to_string(v).unwrap_or_default());
            let imgs = details
                .ui_imgs
                .as_ref()
                .map(|v| serde_json::to_string(v).unwrap_or_default());
            let siblings = details
                .ui_siblings
                .as_ref()
                .map(|v| serde_json::to_string(v).unwrap_or_default());

            db::upsert_metadata(
                &conn,
                &details.uid,
                details.ui_description.as_deref(),
                compatibility.as_deref(),
                donation_link.as_deref(),
                img_thumbs.as_deref(),
                imgs.as_deref(),
                siblings.as_deref(),
                ui_date,
                now,
            )?;

            result.insert(
                details.uid.clone(),
                db::AddonMetadata {
                    uid: details.uid.clone(),
                    description: details.ui_description.clone(),
                    compatibility,
                    donation_link,
                    img_thumbs,
                    imgs,
                    siblings,
                    ui_date,
                    fetched_at: now,
                },
            );
        }
    }

    Ok(result)
}

/// Resolve directory names to UIDs (for installed addons that need metadata).
#[tauri::command]
pub fn resolve_uids(
    app_handle: tauri::AppHandle,
    dir_names: Vec<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let db_state = app_handle.state::<Mutex<Connection>>();
    let conn = db_state
        .lock()
        .map_err(|e| format!("DB lock error: {}", e))?;

    db::lookup_uids_by_dir_names(&conn, &dir_names)
}
