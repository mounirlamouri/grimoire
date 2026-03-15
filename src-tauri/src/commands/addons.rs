use crate::addon::manifest::InstalledAddon;
use crate::config::paths;

#[tauri::command]
pub fn get_installed_addons() -> Result<Vec<InstalledAddon>, String> {
    let addon_path = paths::detect_addon_path().ok_or("ESO addon path not found")?;
    crate::addon::manifest::scan_installed_addons(&addon_path).map_err(|e| e.to_string())
}
