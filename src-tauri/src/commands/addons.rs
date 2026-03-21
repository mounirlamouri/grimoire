use crate::addon::manifest::InstalledAddon;
use crate::config::{paths, settings};
use crate::db;
use rusqlite::Connection;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

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

/// Find installed libraries that no other installed addon depends on.
#[tauri::command]
pub fn find_orphaned_libraries(app_handle: tauri::AppHandle) -> Result<Vec<InstalledAddon>, String> {
    let addon_path = settings::load_settings(&app_handle)
        .addon_path
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| paths::detect_addon_path())
        .ok_or("ESO addon path not configured. Go to Settings to set it.")?;

    let addons = crate::addon::manifest::scan_installed_addons(&addon_path)
        .map_err(|e| e.to_string())?;

    // Collect all dependency names (dir_name references) from all addons
    let mut needed: HashSet<String> = HashSet::new();
    for addon in &addons {
        for dep in &addon.depends_on {
            needed.insert(dep.name.clone());
        }
        for dep in &addon.optional_depends_on {
            needed.insert(dep.name.clone());
        }
    }

    // A library is orphaned if no addon (including other libraries) depends on it
    let orphaned: Vec<InstalledAddon> = addons
        .into_iter()
        .filter(|a| a.is_library && !needed.contains(&a.dir_name))
        .collect();

    Ok(orphaned)
}

/// Check which dir_names from a list are available in the ESOUI catalog.
/// Returns only the dir_names that were found.
#[tauri::command]
pub fn check_catalog_availability(
    app_handle: tauri::AppHandle,
    dir_names: Vec<String>,
) -> Result<Vec<String>, String> {
    let db_state = app_handle.state::<Mutex<Connection>>();
    let conn = db_state.lock().map_err(|e| format!("DB lock error: {}", e))?;

    let mut available = Vec::new();
    for name in &dir_names {
        if let Ok(Some(_)) = db::lookup_by_dir_name(&conn, name) {
            available.push(name.clone());
        }
    }
    Ok(available)
}
