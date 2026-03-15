use crate::config::paths;
use crate::config::settings::{load_settings, save_settings};
use std::path::PathBuf;

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
