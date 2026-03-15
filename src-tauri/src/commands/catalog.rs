use crate::db::{self, CatalogAddon};
use crate::esoui::api::EsoUiClient;
use rusqlite::Connection;
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
