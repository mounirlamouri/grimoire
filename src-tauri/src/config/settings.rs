use serde::{Deserialize, Serialize};
use std::fs;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
pub struct AppSettings {
    pub addon_path: Option<String>,
    /// How often to auto-sync the catalog, in hours. Default: 2.
    #[serde(default = "default_sync_interval")]
    pub sync_interval_hours: f64,
    /// Days since last ESOUI update before a WARNING is shown. Default: 180 (6 months).
    #[serde(default = "default_staleness_warning_days")]
    pub staleness_warning_days: u32,
    /// Days since last ESOUI update before an ERROR is shown. Default: 365 (1 year).
    #[serde(default = "default_staleness_error_days")]
    pub staleness_error_days: u32,
    /// Hide staleness warnings/errors on addon cards. Default: false.
    #[serde(default)]
    pub hide_staleness_warnings: bool,
}

fn default_sync_interval() -> f64 {
    2.0
}

fn default_staleness_warning_days() -> u32 {
    180
}

fn default_staleness_error_days() -> u32 {
    365
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            addon_path: None,
            sync_interval_hours: default_sync_interval(),
            staleness_warning_days: default_staleness_warning_days(),
            staleness_error_days: default_staleness_error_days(),
            hide_staleness_warnings: false,
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
        assert_eq!(settings.staleness_warning_days, 180);
        assert_eq!(settings.staleness_error_days, 365);
        assert!(!settings.hide_staleness_warnings);
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
        assert_eq!(settings.staleness_warning_days, 180);
        assert_eq!(settings.staleness_error_days, 365);
        assert!(!settings.hide_staleness_warnings);
    }

    #[test]
    fn test_deserialize_staleness_fields() {
        let json = r#"{
            "staleness_warning_days": 90,
            "staleness_error_days": 180,
            "hide_staleness_warnings": true
        }"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.staleness_warning_days, 90);
        assert_eq!(settings.staleness_error_days, 180);
        assert!(settings.hide_staleness_warnings);
    }

    #[test]
    fn test_deserialize_missing_staleness_fields_use_defaults() {
        // Simulates an old settings.json without the new fields
        let json = r#"{"addon_path": "/some/path", "sync_interval_hours": 2.0}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.staleness_warning_days, 180);
        assert_eq!(settings.staleness_error_days, 365);
        assert!(!settings.hide_staleness_warnings);
    }

    #[test]
    fn test_serialize_roundtrip() {
        let settings = AppSettings {
            addon_path: Some("/path/to/addons".to_string()),
            sync_interval_hours: 6.0,
            staleness_warning_days: 90,
            staleness_error_days: 180,
            hide_staleness_warnings: true,
        };
        let json = serde_json::to_string(&settings).unwrap();
        let deserialized: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.addon_path, settings.addon_path);
        assert_eq!(deserialized.sync_interval_hours, settings.sync_interval_hours);
        assert_eq!(deserialized.staleness_warning_days, settings.staleness_warning_days);
        assert_eq!(deserialized.staleness_error_days, settings.staleness_error_days);
        assert_eq!(deserialized.hide_staleness_warnings, settings.hide_staleness_warnings);
    }

    #[test]
    fn test_deserialize_invalid_json_fails() {
        let result: Result<AppSettings, _> = serde_json::from_str("not json");
        assert!(result.is_err());
    }
}
