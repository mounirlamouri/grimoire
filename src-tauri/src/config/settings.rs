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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_settings() {
        let settings = AppSettings::default();
        assert_eq!(settings.addon_path, None);
        assert_eq!(settings.sync_interval_hours, 2.0);
    }

    #[test]
    fn test_deserialize_full_settings() {
        let json = r#"{"addon_path": "/home/user/AddOns", "sync_interval_hours": 4.0}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.addon_path, Some("/home/user/AddOns".to_string()));
        assert_eq!(settings.sync_interval_hours, 4.0);
    }

    #[test]
    fn test_deserialize_missing_sync_interval_uses_default() {
        let json = r#"{"addon_path": null}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.addon_path, None);
        assert_eq!(settings.sync_interval_hours, 2.0);
    }

    #[test]
    fn test_deserialize_empty_json_uses_defaults() {
        let json = r#"{}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.addon_path, None);
        assert_eq!(settings.sync_interval_hours, 2.0);
    }

    #[test]
    fn test_serialize_roundtrip() {
        let settings = AppSettings {
            addon_path: Some("/path/to/addons".to_string()),
            sync_interval_hours: 6.0,
        };
        let json = serde_json::to_string(&settings).unwrap();
        let deserialized: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.addon_path, settings.addon_path);
        assert_eq!(deserialized.sync_interval_hours, settings.sync_interval_hours);
    }

    #[test]
    fn test_deserialize_invalid_json_fails() {
        let result: Result<AppSettings, _> = serde_json::from_str("not json");
        assert!(result.is_err());
    }
}
