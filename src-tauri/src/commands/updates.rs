use crate::addon::manifest::{scan_installed_addons, InstalledAddon};
use crate::config::{paths, settings};
use crate::db;
use crate::esoui::models::AddonUpdate;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

/// Check for addon updates using the local SQLite catalog.
/// Returns updates found based on the last synced catalog data.
#[tauri::command]
pub fn check_for_updates(app_handle: tauri::AppHandle) -> Result<Vec<AddonUpdate>, String> {
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

    let db_state = app_handle.state::<Mutex<Connection>>();
    let conn = db_state
        .lock()
        .map_err(|e| format!("DB lock error: {}", e))?;

    compute_updates(&conn, &installed)
}

/// Compute updates by comparing installed addons against the SQLite catalog.
/// This is also called internally after catalog sync.
pub fn compute_updates(
    conn: &Connection,
    installed: &[InstalledAddon],
) -> Result<Vec<AddonUpdate>, String> {
    let mut updates = Vec::new();

    for addon in installed {
        if let Some((catalog_version, uid, download_url)) =
            db::lookup_by_dir_name(conn, &addon.dir_name)?
        {
            // Check if we already installed this catalog version via Grimoire
            let already_installed = if let Some(ref cv) = catalog_version {
                matches!(
                    db::get_installed_catalog_version(conn, &addon.dir_name),
                    Ok(Some(ref installed_cv)) if installed_cv == cv
                )
            } else {
                false
            };

            if already_installed {
                // We installed the latest, but manifest version still differs
                // from catalog version — this is an addon author numbering mismatch
                if has_update(&addon.version, &catalog_version) {
                    updates.push(AddonUpdate {
                        dir_name: addon.dir_name.clone(),
                        title: addon.title.clone(),
                        installed_version: addon.version.clone(),
                        latest_version: catalog_version.unwrap_or_default(),
                        uid,
                        download_url,
                        version_mismatch: true,
                    });
                }
            } else if has_update(&addon.version, &catalog_version) {
                updates.push(AddonUpdate {
                    dir_name: addon.dir_name.clone(),
                    title: addon.title.clone(),
                    installed_version: addon.version.clone(),
                    latest_version: catalog_version.unwrap_or_default(),
                    uid,
                    download_url,
                    version_mismatch: false,
                });
            }
        }
    }

    updates.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(updates)
}

/// Determine if a catalog version is newer than the installed version.
fn has_update(installed_version: &str, catalog_version: &Option<String>) -> bool {
    let latest = match catalog_version {
        Some(v) if !v.is_empty() => v,
        _ => return false,
    };

    if installed_version.is_empty() {
        return false;
    }

    if installed_version == latest {
        return false;
    }

    // Try semantic comparison: parse as dot-separated integers
    if let (Some(installed_parts), Some(latest_parts)) =
        (parse_version(installed_version), parse_version(latest))
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

#[cfg(test)]
mod tests {
    use super::*;

    // ── parse_version ──────────────────────────────────────────────

    #[test]
    fn test_parse_version_semver() {
        assert_eq!(parse_version("1.2.3"), Some(vec![1, 2, 3]));
    }

    #[test]
    fn test_parse_version_single() {
        assert_eq!(parse_version("42"), Some(vec![42]));
    }

    #[test]
    fn test_parse_version_non_numeric_parts() {
        // "2.0 r41" splits on '.', "0 r41" fails parse, so only [2]
        assert_eq!(parse_version("2.0 r41"), Some(vec![2]));
    }

    #[test]
    fn test_parse_version_empty() {
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn test_parse_version_no_numbers() {
        assert_eq!(parse_version("beta"), None);
    }

    #[test]
    fn test_parse_version_four_parts() {
        assert_eq!(parse_version("3.8.3.1"), Some(vec![3, 8, 3, 1]));
    }

    // ── has_update ─────────────────────────────────────────────────

    #[test]
    fn test_has_update_same_version() {
        assert!(!has_update("1.2.3", &Some("1.2.3".into())));
    }

    #[test]
    fn test_has_update_newer_catalog() {
        assert!(has_update("1.2.3", &Some("1.2.4".into())));
    }

    #[test]
    fn test_has_update_older_catalog() {
        assert!(!has_update("1.2.4", &Some("1.2.3".into())));
    }

    #[test]
    fn test_has_update_none_catalog() {
        assert!(!has_update("1.0", &None));
    }

    #[test]
    fn test_has_update_empty_catalog() {
        assert!(!has_update("1.0", &Some("".into())));
    }

    #[test]
    fn test_has_update_empty_installed() {
        assert!(!has_update("", &Some("1.0".into())));
    }

    #[test]
    fn test_has_update_non_semver_differ() {
        // Both fail numeric parse → fallback to string inequality → true
        assert!(has_update("alpha", &Some("beta".into())));
    }

    #[test]
    fn test_has_update_major_bump() {
        assert!(has_update("1.0.0", &Some("2.0.0".into())));
    }

    #[test]
    fn test_has_update_catalog_shorter_version() {
        // installed "1.2.3" vs catalog "1.2" — [1,2] < [1,2,3] → no update
        assert!(!has_update("1.2.3", &Some("1.2".into())));
    }
}
