use crate::addon::manifest::scan_installed_addons;
use crate::commands::updates::{bootstrap_untracked, compute_updates};
use crate::config::{paths, settings};
use crate::db::{self, CatalogAddon};
use crate::esoui::api::EsoUiClient;
use crate::esoui::models::AddonDetails;
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

        uids_to_fetch = filter_stale_uids(&uids, &cached, &catalog_dates);
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
            let s = serialize_details_for_db(details);

            db::upsert_metadata(
                &conn,
                &details.uid,
                details.ui_description.as_deref(),
                s.compatibility.as_deref(),
                s.donation_link.as_deref(),
                s.img_thumbs.as_deref(),
                s.imgs.as_deref(),
                s.siblings.as_deref(),
                s.ui_date,
                now,
            )?;

            result.insert(
                details.uid.clone(),
                db::AddonMetadata {
                    uid: details.uid.clone(),
                    description: details.ui_description.clone(),
                    compatibility: s.compatibility,
                    donation_link: s.donation_link,
                    img_thumbs: s.img_thumbs,
                    imgs: s.imgs,
                    siblings: s.siblings,
                    ui_date: s.ui_date,
                    fetched_at: now,
                },
            );
        }
    }

    Ok(result)
}

/// Columns derived from an `AddonDetails` ready for SQLite storage.
/// Array/object fields are JSON-serialized; `donation_link` prefers the raw
/// string form when the API returns it that way, falling back to JSON for
/// non-string values.
pub(crate) struct SerializedMetadata {
    pub ui_date: Option<i64>,
    pub compatibility: Option<String>,
    pub donation_link: Option<String>,
    pub img_thumbs: Option<String>,
    pub imgs: Option<String>,
    pub siblings: Option<String>,
}

pub(crate) fn serialize_details_for_db(details: &AddonDetails) -> SerializedMetadata {
    let json_string = |v: &serde_json::Value| serde_json::to_string(v).unwrap_or_default();
    SerializedMetadata {
        ui_date: details.ui_date.as_ref().and_then(|v| v.as_i64()),
        compatibility: details.ui_compatibility.as_ref().map(json_string),
        donation_link: details
            .ui_donation_link
            .as_ref()
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .or_else(|| details.ui_donation_link.as_ref().map(json_string)),
        img_thumbs: details.ui_img_thumbs.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
        imgs: details.ui_imgs.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
        siblings: details.ui_siblings.as_ref().map(json_string),
    }
}

/// Returns which UIDs from `uids` need to be fetched (not cached, or stale).
/// A cached entry is stale when the catalog date differs from the stored ui_date.
pub(crate) fn filter_stale_uids(
    uids: &[String],
    cached: &std::collections::HashMap<String, db::AddonMetadata>,
    catalog_dates: &std::collections::HashMap<String, i64>,
) -> Vec<String> {
    uids.iter()
        .filter(|uid| match cached.get(*uid) {
            Some(meta) => match (meta.ui_date, catalog_dates.get(*uid)) {
                (Some(cached_date), Some(&current_date)) => cached_date != current_date,
                (None, Some(_)) => true,
                _ => false,
            },
            None => true,
        })
        .cloned()
        .collect()
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn make_meta(ui_date: Option<i64>) -> db::AddonMetadata {
        db::AddonMetadata {
            uid: "test".to_string(),
            description: None,
            compatibility: None,
            donation_link: None,
            img_thumbs: None,
            imgs: None,
            siblings: None,
            ui_date,
            fetched_at: 0,
        }
    }

    #[test]
    fn not_cached_always_needs_fetch() {
        let uids = vec!["A".to_string()];
        let cached = HashMap::new();
        let catalog_dates = HashMap::new();
        assert_eq!(filter_stale_uids(&uids, &cached, &catalog_dates), vec!["A"]);
    }

    #[test]
    fn cached_with_matching_date_is_fresh() {
        let uids = vec!["A".to_string()];
        let cached = HashMap::from([("A".to_string(), make_meta(Some(1000)))]);
        let catalog_dates = HashMap::from([("A".to_string(), 1000i64)]);
        assert!(filter_stale_uids(&uids, &cached, &catalog_dates).is_empty());
    }

    #[test]
    fn cached_with_different_date_is_stale() {
        let uids = vec!["A".to_string()];
        let cached = HashMap::from([("A".to_string(), make_meta(Some(1000)))]);
        let catalog_dates = HashMap::from([("A".to_string(), 2000i64)]);
        assert_eq!(filter_stale_uids(&uids, &cached, &catalog_dates), vec!["A"]);
    }

    #[test]
    fn cached_without_date_but_catalog_has_date_is_stale() {
        let uids = vec!["A".to_string()];
        let cached = HashMap::from([("A".to_string(), make_meta(None))]);
        let catalog_dates = HashMap::from([("A".to_string(), 1000i64)]);
        assert_eq!(filter_stale_uids(&uids, &cached, &catalog_dates), vec!["A"]);
    }

    #[test]
    fn cached_without_date_and_no_catalog_date_is_fresh() {
        let uids = vec!["A".to_string()];
        let cached = HashMap::from([("A".to_string(), make_meta(None))]);
        let catalog_dates = HashMap::new();
        assert!(filter_stale_uids(&uids, &cached, &catalog_dates).is_empty());
    }

    #[test]
    fn cached_with_date_but_no_catalog_date_is_fresh() {
        let uids = vec!["A".to_string()];
        let cached = HashMap::from([("A".to_string(), make_meta(Some(1000)))]);
        let catalog_dates = HashMap::new();
        assert!(filter_stale_uids(&uids, &cached, &catalog_dates).is_empty());
    }

    #[test]
    fn empty_uids_returns_empty() {
        let cached = HashMap::from([("A".to_string(), make_meta(Some(1000)))]);
        let catalog_dates = HashMap::from([("A".to_string(), 1000i64)]);
        assert!(filter_stale_uids(&[], &cached, &catalog_dates).is_empty());
    }

    #[test]
    fn mixed_batch_returns_only_stale_and_missing() {
        let uids = vec!["fresh".to_string(), "stale".to_string(), "missing".to_string()];
        let cached = HashMap::from([
            ("fresh".to_string(), make_meta(Some(100))),
            ("stale".to_string(), make_meta(Some(100))),
        ]);
        let catalog_dates = HashMap::from([
            ("fresh".to_string(), 100i64),
            ("stale".to_string(), 200i64),
        ]);
        let mut result = filter_stale_uids(&uids, &cached, &catalog_dates);
        result.sort();
        assert_eq!(result, vec!["missing", "stale"]);
    }

    // ---- serialize_details_for_db ----

    fn details_from_json(json: &str) -> AddonDetails {
        serde_json::from_str(json).expect("valid AddonDetails JSON")
    }

    fn empty_details_json() -> &'static str {
        r#"{
            "UID": "1", "UIName": "X",
            "UIVersion": null, "UIAuthorName": null, "UIDescription": null,
            "UIDownload": null, "UIDir": null, "UIDownloadTotal": null,
            "UIDate": null, "UICompatibility": null, "UIDonationLink": null,
            "UIIMG_Thumbs": null, "UIIMGs": null, "UISiblings": null
        }"#
    }

    #[test]
    fn serialize_extracts_ui_date_as_i64() {
        let json = r#"{
            "UID": "1", "UIName": "X",
            "UIVersion": null, "UIAuthorName": null, "UIDescription": null,
            "UIDownload": null, "UIDir": null, "UIDownloadTotal": null,
            "UIDate": 1700000000000,
            "UICompatibility": null, "UIDonationLink": null,
            "UIIMG_Thumbs": null, "UIIMGs": null, "UISiblings": null
        }"#;
        let s = serialize_details_for_db(&details_from_json(json));
        assert_eq!(s.ui_date, Some(1700000000000));
    }

    #[test]
    fn serialize_all_none_when_details_are_null() {
        let s = serialize_details_for_db(&details_from_json(empty_details_json()));
        assert!(s.ui_date.is_none());
        assert!(s.compatibility.is_none());
        assert!(s.donation_link.is_none());
        assert!(s.img_thumbs.is_none());
        assert!(s.imgs.is_none());
        assert!(s.siblings.is_none());
    }

    #[test]
    fn serialize_donation_link_preserves_bare_string() {
        // When the API returns UIDonationLink as a bare JSON string, we want
        // the raw URL stored — not a JSON-quoted version of it.
        let json = r#"{
            "UID": "1", "UIName": "X",
            "UIVersion": null, "UIAuthorName": null, "UIDescription": null,
            "UIDownload": null, "UIDir": null, "UIDownloadTotal": null,
            "UIDate": null, "UICompatibility": null,
            "UIDonationLink": "https://donate.example.com/author",
            "UIIMG_Thumbs": null, "UIIMGs": null, "UISiblings": null
        }"#;
        let s = serialize_details_for_db(&details_from_json(json));
        assert_eq!(s.donation_link.as_deref(), Some("https://donate.example.com/author"));
    }

    #[test]
    fn serialize_donation_link_falls_back_to_json_for_non_string_values() {
        // Defensive path: if the API ever returns UIDonationLink as a non-string
        // (object/number), we fall back to a JSON string rather than losing the data.
        let json = r#"{
            "UID": "1", "UIName": "X",
            "UIVersion": null, "UIAuthorName": null, "UIDescription": null,
            "UIDownload": null, "UIDir": null, "UIDownloadTotal": null,
            "UIDate": null, "UICompatibility": null,
            "UIDonationLink": { "url": "https://x.com", "kind": "paypal" },
            "UIIMG_Thumbs": null, "UIIMGs": null, "UISiblings": null
        }"#;
        let s = serialize_details_for_db(&details_from_json(json));
        let got = s.donation_link.expect("fallback should produce JSON");
        assert!(got.contains("\"url\""));
        assert!(got.contains("paypal"));
    }

    #[test]
    fn serialize_compatibility_encodes_array_as_json() {
        let json = r#"{
            "UID": "1", "UIName": "X",
            "UIVersion": null, "UIAuthorName": null, "UIDescription": null,
            "UIDownload": null, "UIDir": null, "UIDownloadTotal": null,
            "UIDate": null,
            "UICompatibility": [
                { "version": "101047", "name": "U43" }
            ],
            "UIDonationLink": null,
            "UIIMG_Thumbs": null, "UIIMGs": null, "UISiblings": null
        }"#;
        let s = serialize_details_for_db(&details_from_json(json));
        let compat = s.compatibility.expect("compatibility serialized");
        // Round-trip: the stored string parses back to the original array shape.
        let parsed: serde_json::Value = serde_json::from_str(&compat).unwrap();
        assert!(parsed.is_array());
        assert_eq!(parsed[0]["version"], "101047");
    }

    #[test]
    fn serialize_img_arrays_encode_as_json_strings() {
        let json = r#"{
            "UID": "1", "UIName": "X",
            "UIVersion": null, "UIAuthorName": null, "UIDescription": null,
            "UIDownload": null, "UIDir": null, "UIDownloadTotal": null,
            "UIDate": null, "UICompatibility": null, "UIDonationLink": null,
            "UIIMG_Thumbs": ["https://cdn/a.png", "https://cdn/b.png"],
            "UIIMGs": ["https://cdn/full.png"],
            "UISiblings": null
        }"#;
        let s = serialize_details_for_db(&details_from_json(json));
        let thumbs: Vec<String> = serde_json::from_str(s.img_thumbs.as_deref().unwrap()).unwrap();
        assert_eq!(thumbs.len(), 2);
        let imgs: Vec<String> = serde_json::from_str(s.imgs.as_deref().unwrap()).unwrap();
        assert_eq!(imgs, vec!["https://cdn/full.png".to_string()]);
    }
}
