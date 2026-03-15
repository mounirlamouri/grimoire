use crate::addon::manifest::{scan_installed_addons, InstalledAddon};
use crate::config::{paths, settings};
use crate::esoui::api::EsoUiClient;
use crate::esoui::models::{AddonListItem, AddonUpdate};
use std::collections::HashMap;
use std::path::PathBuf;

#[tauri::command]
pub async fn check_for_updates(app_handle: tauri::AppHandle) -> Result<Vec<AddonUpdate>, String> {
    let addon_path = settings::load_settings(&app_handle)
        .addon_path
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| paths::detect_addon_path())
        .ok_or("ESO addon path not configured. Go to Settings to set it.")?;

    let installed = scan_installed_addons(&addon_path).map_err(|e| e.to_string())?;
    if installed.is_empty() {
        return Ok(vec![]);
    }

    // Fetch the full catalog from MMOUI
    let mut client = EsoUiClient::new();
    client.init().await?;
    let catalog = client.fetch_file_list().await?;

    // Build a lookup: directory name -> catalog entry
    // UIDir can contain multiple comma-separated directory names
    let mut dir_to_catalog: HashMap<String, &AddonListItem> = HashMap::new();
    for item in &catalog {
        if let Some(ref dirs) = item.ui_dir {
            for dir in dirs {
                let dir = dir.trim();
                if !dir.is_empty() {
                    dir_to_catalog.insert(dir.to_string(), item);
                }
            }
        }
    }

    // Compare installed vs catalog
    let mut updates = Vec::new();
    for addon in &installed {
        if let Some(catalog_entry) = dir_to_catalog.get(&addon.dir_name) {
            if has_update(addon, catalog_entry) {
                updates.push(AddonUpdate {
                    dir_name: addon.dir_name.clone(),
                    title: addon.title.clone(),
                    installed_version: addon.version.clone(),
                    latest_version: catalog_entry
                        .ui_version
                        .clone()
                        .unwrap_or_default(),
                    uid: catalog_entry.uid.clone(),
                    download_url: catalog_entry.ui_download.clone(),
                });
            }
        }
    }

    updates.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(updates)
}

/// Determine if a catalog entry is newer than the installed addon.
/// Compares version strings — if they differ, assume an update is available.
fn has_update(installed: &InstalledAddon, catalog: &AddonListItem) -> bool {
    let latest = match &catalog.ui_version {
        Some(v) if !v.is_empty() => v,
        _ => return false,
    };

    // If installed version string is empty, we can't compare
    if installed.version.is_empty() {
        return false;
    }

    // If versions are identical strings, no update
    if installed.version == *latest {
        return false;
    }

    // Try semantic comparison: parse as dot-separated integers
    if let (Some(installed_parts), Some(latest_parts)) =
        (parse_version(&installed.version), parse_version(latest))
    {
        return latest_parts > installed_parts;
    }

    // Fallback: strings differ, assume update available
    true
}

/// Parse a version string like "1.2.3" into a comparable Vec<u32>.
fn parse_version(version: &str) -> Option<Vec<u32>> {
    let parts: Vec<u32> = version
        .split('.')
        .filter_map(|p| p.trim().parse().ok())
        .collect();

    if parts.is_empty() {
        None
    } else {
        Some(parts)
    }
}
