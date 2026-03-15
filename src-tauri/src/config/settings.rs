use serde::{Deserialize, Serialize};
use std::fs;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
pub struct AppSettings {
    pub addon_path: Option<String>,
    /// How often to auto-sync the catalog, in hours. Default: 2.
    #[serde(default = "default_sync_interval")]
    pub sync_interval_hours: f64,
}

fn default_sync_interval() -> f64 {
    2.0
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            addon_path: None,
            sync_interval_hours: default_sync_interval(),
        }
    }
}

fn settings_path(app_handle: &tauri::AppHandle) -> std::path::PathBuf {
    let dir = app_handle
        .path()
        .app_config_dir()
        .expect("failed to resolve app config dir");
    fs::create_dir_all(&dir).ok();
    dir.join("settings.json")
}

pub fn load_settings(app_handle: &tauri::AppHandle) -> AppSettings {
    let path = settings_path(app_handle);
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_settings(app_handle: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app_handle);
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("Failed to save settings: {}", e))
}
