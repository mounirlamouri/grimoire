use crate::config::api_version;
use crate::config::autostart::{self, AutostartEntry, AutostartStatus};
use crate::config::dirs::grimoire_data_dir;
use crate::config::paths;
use crate::config::settings::{load_settings, save_settings};
use crate::db;
use crate::logging;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn get_addon_path(app_handle: tauri::AppHandle) -> Option<String> {
    // First check saved settings
    let settings = load_settings(&app_handle);
    if let Some(ref path) = settings.addon_path {
        let p = PathBuf::from(path);
        if p.is_dir() {
            return Some(path.clone());
        }
    }

    // Fall back to auto-detection
    paths::detect_addon_path().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn set_addon_path(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.is_dir() {
        let mut settings = load_settings(&app_handle);
        settings.addon_path = Some(path);
        save_settings(&app_handle, &settings)
    } else {
        Err(format!("Directory not found: {}", path))
    }
}

#[tauri::command]
pub fn get_sync_interval(app_handle: tauri::AppHandle) -> f64 {
    load_settings(&app_handle).sync_interval_hours
}

#[tauri::command]
pub fn set_sync_interval(app_handle: tauri::AppHandle, hours: f64) -> Result<(), String> {
    if hours < 0.1 {
        return Err("Sync interval must be at least 0.1 hours (6 minutes)".to_string());
    }
    let mut settings = load_settings(&app_handle);
    settings.sync_interval_hours = hours;
    save_settings(&app_handle, &settings)
}

#[tauri::command]
pub fn get_staleness_warning_days(app_handle: tauri::AppHandle) -> u32 {
    load_settings(&app_handle).staleness_warning_days
}

#[tauri::command]
pub fn set_staleness_warning_days(app_handle: tauri::AppHandle, days: u32) -> Result<(), String> {
    let mut settings = load_settings(&app_handle);
    settings.staleness_warning_days = days;
    save_settings(&app_handle, &settings)
}

#[tauri::command]
pub fn get_staleness_error_days(app_handle: tauri::AppHandle) -> u32 {
    load_settings(&app_handle).staleness_error_days
}

#[tauri::command]
pub fn set_staleness_error_days(app_handle: tauri::AppHandle, days: u32) -> Result<(), String> {
    let mut settings = load_settings(&app_handle);
    settings.staleness_error_days = days;
    save_settings(&app_handle, &settings)
}

#[tauri::command]
pub fn get_hide_staleness_warnings(app_handle: tauri::AppHandle) -> bool {
    load_settings(&app_handle).hide_staleness_warnings
}

#[tauri::command]
pub fn set_hide_staleness_warnings(app_handle: tauri::AppHandle, hide: bool) -> Result<(), String> {
    let mut settings = load_settings(&app_handle);
    settings.hide_staleness_warnings = hide;
    save_settings(&app_handle, &settings)
}

/// Returns whether Grimoire is registered to launch at login. The OS entry is
/// the source of truth, so this reflects changes made in Task Manager or the
/// desktop's autostart settings.
#[tauri::command]
pub fn get_autostart_status() -> Result<AutostartStatus, String> {
    autostart::status(&autostart::entry_name())
}

#[tauri::command]
pub fn set_autostart_enabled(enabled: bool) -> Result<(), String> {
    if enabled {
        autostart::enable(&AutostartEntry::for_current_exe()?)
    } else {
        autostart::disable(&autostart::entry_name())
    }
}

#[tauri::command]
pub fn get_start_minimized_on_autostart(app_handle: tauri::AppHandle) -> bool {
    load_settings(&app_handle).start_minimized_on_autostart
}

#[tauri::command]
pub fn set_start_minimized_on_autostart(
    app_handle: tauri::AppHandle,
    minimized: bool,
) -> Result<(), String> {
    let mut settings = load_settings(&app_handle);
    settings.start_minimized_on_autostart = minimized;
    save_settings(&app_handle, &settings)
}

/// Reads the live game APIVersion from ESO's AddOnSettings.txt (sibling of AddOns/).
/// Returns None if the addon path is not configured, the file is missing, or
/// no #Version directive is present.
#[tauri::command]
pub fn get_current_api_version(app_handle: tauri::AppHandle) -> Option<u32> {
    let addons_path_str = get_addon_path(app_handle)?;
    api_version::read_current_api_version(&PathBuf::from(addons_path_str))
}

/// Returns the ESOUI last-update timestamp (milliseconds since epoch) for each
/// dir_name that is found in the catalog. Dir names not in the catalog are omitted.
#[tauri::command]
pub fn get_catalog_dates(
    app_handle: tauri::AppHandle,
    dir_names: Vec<String>,
) -> Result<std::collections::HashMap<String, i64>, String> {
    let db_state = app_handle.state::<Mutex<Connection>>();
    let conn = db_state.lock().map_err(|e| format!("DB lock error: {}", e))?;
    db::lookup_dates_by_dir_names(&conn, &dir_names)
}

/// Returns the ESOUI page URL for each dir_name found in the catalog.
/// Dir names not in the catalog are omitted.
#[tauri::command]
pub fn get_file_info_urls(
    app_handle: tauri::AppHandle,
    dir_names: Vec<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let db_state = app_handle.state::<Mutex<Connection>>();
    let conn = db_state.lock().map_err(|e| format!("DB lock error: {}", e))?;
    db::lookup_file_info_urls_by_dir_names(&conn, &dir_names)
}

/// Opens Grimoire's logs folder in the system file manager. Opening from Rust
/// avoids granting the webview a scope for `opener:allow-open-path`.
#[tauri::command]
pub fn open_logs_folder(app_handle: tauri::AppHandle) -> Result<(), String> {
    let dir = logging::ensure_log_dir(&grimoire_data_dir(&app_handle))?;
    app_handle
        .opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("Failed to open logs folder {}: {}", dir.display(), e))
}
