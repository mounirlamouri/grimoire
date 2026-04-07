use crate::addon::manifest::{scan_installed_addons, InstalledAddon};
use crate::config::{paths, settings};
use crate::db;
use crate::esoui::models::AddonUpdate;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Progress event payload sent to the frontend during bootstrap.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BootstrapProgress {
    pub current: usize,
    pub total: usize,
}

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

/// Bootstrap addon dates for installed addons that have no stored catalog_date.
/// Records the current catalog date for each untracked addon, emitting progress events.
/// Returns the number of addons bootstrapped.
#[tauri::command]
pub fn bootstrap_addon_dates(app_handle: tauri::AppHandle) -> Result<usize, String> {
    let addon_path = settings::load_settings(&app_handle)
        .addon_path
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| paths::detect_addon_path())
        .ok_or("ESO addon path not configured. Go to Settings to set it.")?;

    let installed = scan_installed_addons(&addon_path).map_err(|e| e.to_string())?;
    if installed.is_empty() {
        return Ok(0);
    }

    let db_state = app_handle.state::<Mutex<Connection>>();
    let conn = db_state
        .lock()
        .map_err(|e| format!("DB lock error: {}", e))?;

    bootstrap_untracked(&conn, &installed, |current, total| {
        let _ = app_handle.emit(
            "bootstrap-progress",
            BootstrapProgress { current, total },
        );
    })
}

/// Find and bootstrap all installed addons that have no stored catalog_date.
/// Calls `on_progress(current, total)` for each addon processed.
pub fn bootstrap_untracked(
    conn: &Connection,
    installed: &[InstalledAddon],
    mut on_progress: impl FnMut(usize, usize),
) -> Result<usize, String> {
    // Collect addons that need bootstrapping
    let untracked: Vec<_> = installed
        .iter()
        .filter(|addon| {
            matches!(
                db::get_installed_catalog_date(conn, &addon.dir_name),
                Ok(None)
            )
        })
        .collect();

    if untracked.is_empty() {
        return Ok(0);
    }

    let total = untracked.len();
    on_progress(0, total);

    for (i, addon) in untracked.iter().enumerate() {
        if let Some((catalog_version, uid, _, catalog_date)) =
            db::lookup_by_dir_name(conn, &addon.dir_name)?
        {
            if let Some(date) = catalog_date {
                let cv = catalog_version.as_deref().unwrap_or("");
                let _ = db::record_installed_version(conn, &addon.dir_name, &uid, cv, Some(date));
            }
        }
        on_progress(i + 1, total);
    }

    Ok(total)
}

/// Compute updates by comparing installed addons against the SQLite catalog.
/// Uses UIDate (timestamp) comparison. Skips addons with no stored date
/// (those need bootstrapping via `bootstrap_addon_dates` first).
pub fn compute_updates(
    conn: &Connection,
    installed: &[InstalledAddon],
) -> Result<Vec<AddonUpdate>, String> {
    let mut updates = Vec::new();

    for addon in installed {
        if let Some((catalog_version, uid, download_url, catalog_date)) =
            db::lookup_by_dir_name(conn, &addon.dir_name)?
        {
            let stored_date = db::get_installed_catalog_date(conn, &addon.dir_name)?;

            let is_update = match (stored_date, catalog_date) {
                (Some(stored), Some(current)) => current > stored,
                // No stored date = needs bootstrap, skip
                _ => false,
            };

            if is_update {
                let installed_version = db::get_installed_catalog_version(conn, &addon.dir_name)?
                    .unwrap_or_default();
                updates.push(AddonUpdate {
                    dir_name: addon.dir_name.clone(),
                    title: addon.title.clone(),
                    installed_version,
                    latest_version: catalog_version.unwrap_or_default(),
                    uid,
                    download_url,
                });
            }
        }
    }

    updates.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(updates)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS catalog_addons (
                uid TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT, date INTEGER,
                downloads INTEGER DEFAULT 0, favorites INTEGER DEFAULT 0,
                downloads_monthly INTEGER DEFAULT 0, directories TEXT,
                category_id TEXT, author TEXT, download_url TEXT, file_info_url TEXT
            );
            CREATE TABLE IF NOT EXISTS catalog_meta (
                key TEXT PRIMARY KEY, value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS installed_versions (
                dir_name TEXT PRIMARY KEY, uid TEXT NOT NULL,
                catalog_version TEXT NOT NULL, catalog_date INTEGER
            );",
        )
        .unwrap();
        conn
    }

    fn insert_catalog(conn: &Connection, uid: &str, name: &str, version: &str, date: i64, dir: &str) {
        conn.execute(
            "INSERT INTO catalog_addons (uid, name, version, date, directories) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![uid, name, version, date, dir],
        )
        .unwrap();
    }

    fn make_addon(dir_name: &str, title: &str, version: &str) -> InstalledAddon {
        InstalledAddon {
            dir_name: dir_name.to_string(),
            title: title.to_string(),
            author: String::new(),
            version: version.to_string(),
            addon_version: None,
            api_versions: vec![],
            depends_on: vec![],
            optional_depends_on: vec![],
            is_library: false,
            description: String::new(),
        }
    }

    #[test]
    fn test_update_when_catalog_date_newer() {
        let conn = test_db();
        insert_catalog(&conn, "1", "Addon", "2.0", 2000, "MyAddon");
        db::record_installed_version(&conn, "MyAddon", "1", "1.0", Some(1000)).unwrap();

        let installed = vec![make_addon("MyAddon", "Addon", "1.0")];
        let updates = compute_updates(&conn, &installed).unwrap();

        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].dir_name, "MyAddon");
        assert_eq!(updates[0].latest_version, "2.0");
    }

    #[test]
    fn test_no_update_when_dates_equal() {
        let conn = test_db();
        insert_catalog(&conn, "1", "Addon", "2.0", 1000, "MyAddon");
        db::record_installed_version(&conn, "MyAddon", "1", "2.0", Some(1000)).unwrap();

        let installed = vec![make_addon("MyAddon", "Addon", "2.0")];
        let updates = compute_updates(&conn, &installed).unwrap();

        assert!(updates.is_empty());
    }

    #[test]
    fn test_no_update_when_catalog_date_older() {
        let conn = test_db();
        insert_catalog(&conn, "1", "Addon", "1.0", 500, "MyAddon");
        db::record_installed_version(&conn, "MyAddon", "1", "2.0", Some(1000)).unwrap();

        let installed = vec![make_addon("MyAddon", "Addon", "2.0")];
        let updates = compute_updates(&conn, &installed).unwrap();

        assert!(updates.is_empty());
    }

    #[test]
    fn test_untracked_addon_skipped() {
        let conn = test_db();
        insert_catalog(&conn, "1", "Addon", "2.0", 2000, "MyAddon");
        // No record_installed_version — untracked addon

        let installed = vec![make_addon("MyAddon", "Addon", "1.0")];
        let updates = compute_updates(&conn, &installed).unwrap();

        // Untracked addons are NOT shown as updates — they need bootstrap
        assert!(updates.is_empty());
    }

    #[test]
    fn test_no_update_when_no_catalog_date() {
        let conn = test_db();
        conn.execute(
            "INSERT INTO catalog_addons (uid, name, version, date, directories) VALUES (?1, ?2, ?3, NULL, ?4)",
            rusqlite::params!["1", "Addon", "2.0", "MyAddon"],
        )
        .unwrap();

        let installed = vec![make_addon("MyAddon", "Addon", "1.0")];
        let updates = compute_updates(&conn, &installed).unwrap();

        assert!(updates.is_empty());
    }

    #[test]
    fn test_addon_not_in_catalog() {
        let conn = test_db();

        let installed = vec![make_addon("PrivateAddon", "Private", "1.0")];
        let updates = compute_updates(&conn, &installed).unwrap();

        assert!(updates.is_empty());
    }

    #[test]
    fn test_installed_version_shows_stored_catalog_version() {
        let conn = test_db();
        insert_catalog(&conn, "1", "Addon", "3.0", 3000, "MyAddon");
        db::record_installed_version(&conn, "MyAddon", "1", "2.0", Some(2000)).unwrap();

        let installed = vec![make_addon("MyAddon", "Addon", "2.0")];
        let updates = compute_updates(&conn, &installed).unwrap();

        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].installed_version, "2.0");
        assert_eq!(updates[0].latest_version, "3.0");
    }

    // ── bootstrap_untracked tests ──────────────────────────────────

    #[test]
    fn test_bootstrap_records_dates() {
        let conn = test_db();
        insert_catalog(&conn, "1", "Addon A", "1.0", 1000, "AddonA");
        insert_catalog(&conn, "2", "Addon B", "2.0", 2000, "AddonB");

        let installed = vec![
            make_addon("AddonA", "Addon A", "1.0"),
            make_addon("AddonB", "Addon B", "2.0"),
        ];

        let mut progress_calls = Vec::new();
        let count = bootstrap_untracked(&conn, &installed, |cur, total| {
            progress_calls.push((cur, total));
        })
        .unwrap();

        assert_eq!(count, 2);
        assert_eq!(db::get_installed_catalog_date(&conn, "AddonA").unwrap(), Some(1000));
        assert_eq!(db::get_installed_catalog_date(&conn, "AddonB").unwrap(), Some(2000));
        // Progress: 0/2, 1/2, 2/2
        assert_eq!(progress_calls, vec![(0, 2), (1, 2), (2, 2)]);
    }

    #[test]
    fn test_bootstrap_skips_already_tracked() {
        let conn = test_db();
        insert_catalog(&conn, "1", "Addon", "1.0", 1000, "MyAddon");
        db::record_installed_version(&conn, "MyAddon", "1", "1.0", Some(1000)).unwrap();

        let installed = vec![make_addon("MyAddon", "Addon", "1.0")];
        let count = bootstrap_untracked(&conn, &installed, |_, _| {}).unwrap();

        assert_eq!(count, 0);
    }

    #[test]
    fn test_bootstrap_skips_not_in_catalog() {
        let conn = test_db();
        // No catalog entry for this addon

        let installed = vec![make_addon("PrivateAddon", "Private", "1.0")];

        let count = bootstrap_untracked(&conn, &installed, |_, _| {}).unwrap();

        // Still counts as untracked (processed), but no date recorded
        assert_eq!(count, 1);
        assert_eq!(db::get_installed_catalog_date(&conn, "PrivateAddon").unwrap(), None);
    }
}
