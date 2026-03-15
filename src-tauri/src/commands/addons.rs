use crate::addon::manifest::InstalledAddon;
use crate::config::{paths, settings};
use std::path::PathBuf;

#[tauri::command]
pub fn get_installed_addons(app_handle: tauri::AppHandle) -> Result<Vec<InstalledAddon>, String> {
    let addon_path = settings::load_settings(&app_handle)
        .addon_path
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| paths::detect_addon_path())
        .ok_or("ESO addon path not configured. Go to Settings to set it.")?;

    crate::addon::manifest::scan_installed_addons(&addon_path).map_err(|e| e.to_string())
}
