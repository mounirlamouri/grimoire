//! Integration tests that exercise multiple modules working together.

use grimoire_lib::addon::{installer, manifest};
use grimoire_lib::commands::updates::{bootstrap_untracked, compute_updates};
use grimoire_lib::db;
use grimoire_lib::resolver::find_missing_dependencies;
use rusqlite::Connection;
use std::collections::HashSet;
use std::fs;
use std::io::Write;

/// Build a ZIP archive in memory from a list of (path, contents) entries.
fn create_test_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut buf = Vec::new();
    {
        let mut writer = zip::write::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);

        for (path, contents) in entries {
            if path.ends_with('/') {
                writer.add_directory(*path, options).unwrap();
            } else {
                writer.start_file(*path, options).unwrap();
                writer.write_all(contents).unwrap();
            }
        }
        writer.finish().unwrap();
    }
    buf
}

/// Create an in-memory database with schema applied.
fn test_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS catalog_addons (
            uid             TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            version         TEXT,
            date            INTEGER,
            downloads       INTEGER DEFAULT 0,
            favorites       INTEGER DEFAULT 0,
            downloads_monthly INTEGER DEFAULT 0,
            directories     TEXT,
            category_id     TEXT,
            author          TEXT,
            download_url    TEXT,
            file_info_url   TEXT
        );
        CREATE TABLE IF NOT EXISTS catalog_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS installed_versions (
            dir_name        TEXT PRIMARY KEY,
            uid             TEXT NOT NULL,
            catalog_version TEXT NOT NULL,
            catalog_date    INTEGER
        );",
    )
    .unwrap();
    conn
}

fn catalog_row(
    uid: &str,
    name: &str,
    version: Option<&str>,
    date: i64,
    downloads: i64,
    directories: Option<&str>,
    author: Option<&str>,
    download_url: Option<&str>,
) -> (
    String,
    String,
    Option<String>,
    Option<i64>,
    i64,
    i64,
    i64,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    (
        uid.to_string(),
        name.to_string(),
        version.map(|s| s.to_string()),
        Some(date),
        downloads,
        0,
        0,
        directories.map(|s| s.to_string()),
        None, // category_id
        author.map(|s| s.to_string()),
        download_url.map(|s| s.to_string()),
        None, // file_info_url
    )
}

// ── Test 1: Install → Scan round-trip ──────────────────────────────

#[test]
fn test_install_then_scan() {
    let dir = tempfile::tempdir().unwrap();

    let zip = create_test_zip(&[
        ("CoolAddon/", b""),
        (
            "CoolAddon/CoolAddon.txt",
            b"## Title: Cool Addon\n## Author: Alice\n## Version: 1.0\n## IsLibrary: false\n## DependsOn: LibStub\n",
        ),
        ("CoolAddon/init.lua", b"-- main file\n"),
    ]);

    // Install the addon from ZIP
    let top_dirs = installer::install_from_zip(&zip, dir.path()).unwrap();
    assert_eq!(top_dirs, vec!["CoolAddon"]);

    // Scan should find it
    let addons = manifest::scan_installed_addons(dir.path()).unwrap();
    assert_eq!(addons.len(), 1);
    assert_eq!(addons[0].dir_name, "CoolAddon");
    assert_eq!(addons[0].title, "Cool Addon");
    assert_eq!(addons[0].author, "Alice");
    assert_eq!(addons[0].version, "1.0");
    assert!(!addons[0].is_library);
    assert_eq!(addons[0].depends_on.len(), 1);
    assert_eq!(addons[0].depends_on[0].name, "LibStub");
}

// ── Test 2: Catalog sync → Update check (date-based) ───────────────

#[test]
fn test_catalog_update_check() {
    let dir = tempfile::tempdir().unwrap();
    let conn = test_db();

    // Create installed addon on disk with version 1.0
    let addon_dir = dir.path().join("MyAddon");
    fs::create_dir(&addon_dir).unwrap();
    fs::write(
        addon_dir.join("MyAddon.txt"),
        "## Title: My Addon\n## Version: 1.0\n",
    )
    .unwrap();

    // Create another addon that's up-to-date
    let lib_dir = dir.path().join("LibStub");
    fs::create_dir(&lib_dir).unwrap();
    fs::write(
        lib_dir.join("LibStub.txt"),
        "## Title: LibStub\n## Version: 2.5\n## IsLibrary: true\n",
    )
    .unwrap();

    // Populate catalog: MyAddon at date 2000, LibStub at date 1000
    let rows = vec![
        catalog_row("100", "My Addon", Some("2.0"), 2000, 500, Some("MyAddon"), Some("Author"), Some("https://dl/myaddon.zip")),
        catalog_row("200", "LibStub", Some("2.5"), 1000, 1000, Some("LibStub"), Some("Lib Author"), Some("https://dl/libstub.zip")),
    ];
    db::upsert_catalog(&conn, &rows).unwrap();

    // Record that MyAddon was installed at date 1000 (older than catalog)
    db::record_installed_version(&conn, "MyAddon", "100", "1.0", Some(1000)).unwrap();
    // Record LibStub at same date as catalog (current)
    db::record_installed_version(&conn, "LibStub", "200", "2.5", Some(1000)).unwrap();

    // Scan installed addons
    let installed = manifest::scan_installed_addons(dir.path()).unwrap();
    assert_eq!(installed.len(), 2);

    // Check for updates
    let updates = compute_updates(&conn, &installed).unwrap();

    // Only MyAddon should have an update (date 1000 < 2000)
    assert_eq!(updates.len(), 1);
    assert_eq!(updates[0].dir_name, "MyAddon");
    assert_eq!(updates[0].installed_version, "1.0");
    assert_eq!(updates[0].latest_version, "2.0");
}

// ── Test 3: No update when dates match (even if version strings differ) ─

#[test]
fn test_no_update_when_dates_match() {
    let dir = tempfile::tempdir().unwrap();
    let conn = test_db();

    // Installed addon with manifest version "104"
    let addon_dir = dir.path().join("LoreBooks");
    fs::create_dir(&addon_dir).unwrap();
    fs::write(
        addon_dir.join("LoreBooks.txt"),
        "## Title: LoreBooks\n## Version: 104\n",
    )
    .unwrap();

    // Catalog says version "105" — different string, but same date
    let rows = vec![catalog_row(
        "300",
        "LoreBooks",
        Some("105"),
        2000,
        2000,
        Some("LoreBooks"),
        None,
        None,
    )];
    db::upsert_catalog(&conn, &rows).unwrap();

    // Record that Grimoire installed at date 2000 (same as catalog)
    db::record_installed_version(&conn, "LoreBooks", "300", "105", Some(2000)).unwrap();

    let installed = manifest::scan_installed_addons(dir.path()).unwrap();
    let updates = compute_updates(&conn, &installed).unwrap();

    // No update — dates match, regardless of version string difference
    assert!(updates.is_empty());
}

// ── Test 4: Install → Uninstall → Scan lifecycle ───────────────────

#[test]
fn test_install_uninstall_lifecycle() {
    let dir = tempfile::tempdir().unwrap();

    // Install two addons
    let zip = create_test_zip(&[
        ("AddonA/AddonA.txt", b"## Title: Addon A\n"),
        ("AddonA/main.lua", b"-- A\n"),
        ("AddonB/AddonB.txt", b"## Title: Addon B\n"),
        ("AddonB/main.lua", b"-- B\n"),
    ]);
    installer::install_from_zip(&zip, dir.path()).unwrap();

    // Both should appear
    let addons = manifest::scan_installed_addons(dir.path()).unwrap();
    assert_eq!(addons.len(), 2);

    // Uninstall AddonA
    installer::uninstall_addon(dir.path(), "AddonA").unwrap();

    // Only AddonB should remain
    let addons = manifest::scan_installed_addons(dir.path()).unwrap();
    assert_eq!(addons.len(), 1);
    assert_eq!(addons[0].dir_name, "AddonB");

    // AddonA directory should be gone
    assert!(!dir.path().join("AddonA").exists());
}

// ── Test 5: Catalog lookup → Dependency resolution ─────────────────

#[test]
fn test_catalog_dependency_resolution() {
    let dir = tempfile::tempdir().unwrap();
    let conn = test_db();

    // Install an addon that depends on two libraries
    let zip = create_test_zip(&[(
        "CraftHelper/CraftHelper.txt",
        b"## Title: CraftHelper\n## DependsOn: LibAddonMenu-2.0>=32 LibStub\n",
    )]);
    installer::install_from_zip(&zip, dir.path()).unwrap();

    // Also install LibStub (already present)
    let lib_zip = create_test_zip(&[(
        "LibStub/LibStub.txt",
        b"## Title: LibStub\n## IsLibrary: true\n",
    )]);
    installer::install_from_zip(&lib_zip, dir.path()).unwrap();

    // Scan installed addons
    let addons = manifest::scan_installed_addons(dir.path()).unwrap();
    let installed_dirs: HashSet<String> = addons.iter().map(|a| a.dir_name.clone()).collect();

    // Find CraftHelper's missing deps
    let craft_helper = addons.iter().find(|a| a.dir_name == "CraftHelper").unwrap();
    let missing = find_missing_dependencies(&craft_helper.depends_on, &installed_dirs);

    // LibStub is installed, LibAddonMenu-2.0 is not
    assert_eq!(missing.len(), 1);
    assert_eq!(missing[0].name, "LibAddonMenu-2.0");
    assert_eq!(missing[0].min_version, Some(32));

    // Populate catalog with LibAddonMenu-2.0
    let rows = vec![catalog_row(
        "500",
        "LibAddonMenu-2.0",
        Some("33"),
        1000,
        50000,
        Some("LibAddonMenu-2.0"),
        Some("sirinsidiator"),
        Some("https://dl/lam.zip"),
    )];
    db::upsert_catalog(&conn, &rows).unwrap();

    // Verify we can look it up in the catalog for installation
    let result = db::lookup_by_dir_name(&conn, "LibAddonMenu-2.0").unwrap();
    assert!(result.is_some());
    let (version, uid, download_url, date) = result.unwrap();
    assert_eq!(uid, "500");
    assert_eq!(version, Some("33".to_string()));
    assert_eq!(download_url, Some("https://dl/lam.zip".to_string()));
    assert_eq!(date, Some(1000));
}

// ── Test 6: No updates when everything is current ──────────────────

#[test]
fn test_no_updates_when_current() {
    let dir = tempfile::tempdir().unwrap();
    let conn = test_db();

    // Install addon with version 3.0
    let zip = create_test_zip(&[(
        "UpToDate/UpToDate.txt",
        b"## Title: Up To Date\n## Version: 3.0\n",
    )]);
    installer::install_from_zip(&zip, dir.path()).unwrap();

    // Catalog also says 3.0 at date 1000
    let rows = vec![catalog_row(
        "400",
        "Up To Date",
        Some("3.0"),
        1000,
        100,
        Some("UpToDate"),
        None,
        None,
    )];
    db::upsert_catalog(&conn, &rows).unwrap();

    // Record installed at same date
    db::record_installed_version(&conn, "UpToDate", "400", "3.0", Some(1000)).unwrap();

    let installed = manifest::scan_installed_addons(dir.path()).unwrap();
    let updates = compute_updates(&conn, &installed).unwrap();

    assert!(updates.is_empty(), "No updates should be found when dates match");
}

// ── Test 7: Orphaned library detection ─────────────────────────────

#[test]
fn test_orphaned_library_detection() {
    let dir = tempfile::tempdir().unwrap();

    // Install a regular addon that depends on LibA
    let addon_zip = create_test_zip(&[(
        "MyAddon/MyAddon.txt",
        b"## Title: My Addon\n## DependsOn: LibA\n",
    )]);
    installer::install_from_zip(&addon_zip, dir.path()).unwrap();

    // Install LibA (depended upon) and LibB (orphaned — nobody depends on it)
    let lib_a_zip = create_test_zip(&[(
        "LibA/LibA.txt",
        b"## Title: Library A\n## IsLibrary: true\n",
    )]);
    installer::install_from_zip(&lib_a_zip, dir.path()).unwrap();

    let lib_b_zip = create_test_zip(&[(
        "LibB/LibB.txt",
        b"## Title: Library B\n## IsLibrary: true\n",
    )]);
    installer::install_from_zip(&lib_b_zip, dir.path()).unwrap();

    // Scan all addons
    let addons = manifest::scan_installed_addons(dir.path()).unwrap();
    assert_eq!(addons.len(), 3);

    // Replicate the orphaned library algorithm from commands/addons.rs
    let mut needed: HashSet<String> = HashSet::new();
    for addon in &addons {
        for dep in &addon.depends_on {
            needed.insert(dep.name.clone());
        }
        for dep in &addon.optional_depends_on {
            needed.insert(dep.name.clone());
        }
    }

    let orphaned: Vec<_> = addons
        .iter()
        .filter(|a| a.is_library && !needed.contains(&a.dir_name))
        .collect();

    // LibB is orphaned (no addon depends on it), LibA is not (MyAddon depends on it)
    assert_eq!(orphaned.len(), 1);
    assert_eq!(orphaned[0].dir_name, "LibB");
}

// ── Test 8: Orphaned detection with transitive deps ────────────────

#[test]
fn test_orphaned_library_with_transitive_deps() {
    let dir = tempfile::tempdir().unwrap();

    // MyAddon depends on LibA, LibA depends on LibC
    let addon_zip = create_test_zip(&[(
        "MyAddon/MyAddon.txt",
        b"## Title: My Addon\n## DependsOn: LibA\n",
    )]);
    installer::install_from_zip(&addon_zip, dir.path()).unwrap();

    let lib_a_zip = create_test_zip(&[(
        "LibA/LibA.txt",
        b"## Title: Library A\n## IsLibrary: true\n## DependsOn: LibC\n",
    )]);
    installer::install_from_zip(&lib_a_zip, dir.path()).unwrap();

    let lib_c_zip = create_test_zip(&[(
        "LibC/LibC.txt",
        b"## Title: Library C\n## IsLibrary: true\n",
    )]);
    installer::install_from_zip(&lib_c_zip, dir.path()).unwrap();

    // LibOrphan is not depended on by anyone
    let lib_orphan_zip = create_test_zip(&[(
        "LibOrphan/LibOrphan.txt",
        b"## Title: Orphan Lib\n## IsLibrary: true\n",
    )]);
    installer::install_from_zip(&lib_orphan_zip, dir.path()).unwrap();

    let addons = manifest::scan_installed_addons(dir.path()).unwrap();
    assert_eq!(addons.len(), 4);

    let mut needed: HashSet<String> = HashSet::new();
    for addon in &addons {
        for dep in &addon.depends_on {
            needed.insert(dep.name.clone());
        }
        for dep in &addon.optional_depends_on {
            needed.insert(dep.name.clone());
        }
    }

    let orphaned: Vec<_> = addons
        .iter()
        .filter(|a| a.is_library && !needed.contains(&a.dir_name))
        .collect();

    // Only LibOrphan is orphaned; LibA is needed by MyAddon, LibC is needed by LibA
    assert_eq!(orphaned.len(), 1);
    assert_eq!(orphaned[0].dir_name, "LibOrphan");
}

// ── Test 9: Multiple addons with updates at different states ───────

#[test]
fn test_mixed_update_states() {
    let dir = tempfile::tempdir().unwrap();
    let conn = test_db();

    // AddonA: has update (date 1000 < 2000)
    let a_zip = create_test_zip(&[(
        "AddonA/AddonA.txt",
        b"## Title: Addon A\n## Version: 1.0\n",
    )]);
    installer::install_from_zip(&a_zip, dir.path()).unwrap();

    // AddonB: up to date (date 1000 = 1000)
    let b_zip = create_test_zip(&[(
        "AddonB/AddonB.txt",
        b"## Title: Addon B\n## Version: 3.0\n",
    )]);
    installer::install_from_zip(&b_zip, dir.path()).unwrap();

    // AddonC: not in catalog (no update info)
    let c_zip = create_test_zip(&[(
        "AddonC/AddonC.txt",
        b"## Title: Addon C\n## Version: 1.0\n",
    )]);
    installer::install_from_zip(&c_zip, dir.path()).unwrap();

    let rows = vec![
        catalog_row("1", "Addon A", Some("2.0"), 2000, 100, Some("AddonA"), None, None),
        catalog_row("2", "Addon B", Some("3.0"), 1000, 200, Some("AddonB"), None, None),
        // No AddonC in catalog
    ];
    db::upsert_catalog(&conn, &rows).unwrap();

    // Record installed dates
    db::record_installed_version(&conn, "AddonA", "1", "1.0", Some(1000)).unwrap();
    db::record_installed_version(&conn, "AddonB", "2", "3.0", Some(1000)).unwrap();

    let installed = manifest::scan_installed_addons(dir.path()).unwrap();
    assert_eq!(installed.len(), 3);

    let updates = compute_updates(&conn, &installed).unwrap();

    // Only AddonA should have an update
    assert_eq!(updates.len(), 1);
    assert_eq!(updates[0].dir_name, "AddonA");
    assert_eq!(updates[0].installed_version, "1.0");
    assert_eq!(updates[0].latest_version, "2.0");
}

// ── Test 10: Bootstrap records dates for untracked addons ───────────

#[test]
fn test_bootstrap_records_dates() {
    let dir = tempfile::tempdir().unwrap();
    let conn = test_db();

    // Two pre-existing addons on disk
    let addon_dir = dir.path().join("MyAddon");
    fs::create_dir(&addon_dir).unwrap();
    fs::write(
        addon_dir.join("MyAddon.txt"),
        "## Title: My Addon\n## Version: 2.0\n",
    )
    .unwrap();

    let lib_dir = dir.path().join("LibStub");
    fs::create_dir(&lib_dir).unwrap();
    fs::write(
        lib_dir.join("LibStub.txt"),
        "## Title: LibStub\n## Version: 1.0\n## IsLibrary: true\n",
    )
    .unwrap();

    let rows = vec![
        catalog_row("100", "My Addon", Some("2.0"), 5000, 500, Some("MyAddon"), None, None),
        catalog_row("200", "LibStub", Some("1.0"), 3000, 1000, Some("LibStub"), None, None),
    ];
    db::upsert_catalog(&conn, &rows).unwrap();
    // No record_installed_version — simulates pre-existing addons

    let installed = manifest::scan_installed_addons(dir.path()).unwrap();

    // Before bootstrap: compute_updates skips untracked addons
    let updates = compute_updates(&conn, &installed).unwrap();
    assert!(updates.is_empty());

    // Bootstrap records dates
    let count = bootstrap_untracked(&conn, &installed, |_, _| {}).unwrap();
    assert_eq!(count, 2);
    assert_eq!(db::get_installed_catalog_date(&conn, "MyAddon").unwrap(), Some(5000));
    assert_eq!(db::get_installed_catalog_date(&conn, "LibStub").unwrap(), Some(3000));

    // After bootstrap: still no updates (dates are current)
    let updates = compute_updates(&conn, &installed).unwrap();
    assert!(updates.is_empty());
}

// ── Test 11: Bootstrap then real update detected ────────────────────

#[test]
fn test_bootstrap_then_update() {
    let dir = tempfile::tempdir().unwrap();
    let conn = test_db();

    // Pre-existing addon
    let addon_dir = dir.path().join("MyAddon");
    fs::create_dir(&addon_dir).unwrap();
    fs::write(
        addon_dir.join("MyAddon.txt"),
        "## Title: My Addon\n## Version: 1.0\n",
    )
    .unwrap();

    // Catalog has date 5000
    let rows = vec![catalog_row(
        "100", "My Addon", Some("2.0"), 5000, 500, Some("MyAddon"), None, None,
    )];
    db::upsert_catalog(&conn, &rows).unwrap();

    let installed = manifest::scan_installed_addons(dir.path()).unwrap();

    // Bootstrap records date 5000
    bootstrap_untracked(&conn, &installed, |_, _| {}).unwrap();
    assert_eq!(db::get_installed_catalog_date(&conn, "MyAddon").unwrap(), Some(5000));

    // Simulate catalog update: new date 6000
    conn.execute(
        "UPDATE catalog_addons SET version = '3.0', date = 6000 WHERE uid = '100'",
        [],
    )
    .unwrap();

    // Now compute_updates should detect the real update
    let updates = compute_updates(&conn, &installed).unwrap();
    assert_eq!(updates.len(), 1);
    assert_eq!(updates[0].dir_name, "MyAddon");
    assert_eq!(updates[0].latest_version, "3.0");
}
