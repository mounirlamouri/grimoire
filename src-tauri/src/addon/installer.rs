use super::manifest;
use std::fs;
use std::io;
use std::path::{Component, Path};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use zip::ZipArchive;

/// Names starting with this prefix are reserved for Grimoire's temporary
/// directories inside AddOns. They are never valid addon names.
const RESERVED_PREFIX: &str = ".grimoire-";
/// A fresh extraction of a ZIP that has not been moved into place yet.
const STAGING_PREFIX: &str = ".grimoire-staging-";
/// Previously installed dirs moved aside while their replacement moves in.
const BACKUP_PREFIX: &str = ".grimoire-backup-";

const RENAME_ATTEMPTS: u32 = 5;

/// Serializes installs so that crash recovery at the start of one install
/// can never touch the staging or backup dirs of another one in flight.
static INSTALL_LOCK: Mutex<()> = Mutex::new(());

/// Install an addon from a ZIP byte buffer into the AddOns directory.
///
/// ESO addon ZIPs typically contain one or more top-level directories
/// (e.g., `MyAddon/`, `MyAddonLib/`) with the addon files inside. These
/// become subdirectories of `addons_path`.
///
/// Installs and updates are atomic: the whole archive is extracted into a
/// staging dir inside `addons_path` first, then each top-level dir replaces
/// its live counterpart by rename. Replaced dirs are kept as backups until
/// every dir is in place, and restored on failure, so AddOns either gets the
/// complete new version (without files the new version dropped) or is left
/// as it was.
///
/// An installed addon is never replaced by a download that lacks its
/// manifest (see `refuse_partial_replacements`), and files that external
/// tools keep fresh inside an addon's folder are carried over into the new
/// version (see `PRESERVED_FILES`).
///
/// Loose files at the ZIP root (e.g. a README next to the addon folder) are
/// skipped and not part of the returned list: ESO only loads addons from
/// directories, and writing them would litter AddOns or overwrite another
/// addon's loose files.
///
/// Returns the list of top-level directories that were installed.
pub fn install_from_zip(zip_bytes: &[u8], addons_path: &Path) -> Result<Vec<String>, String> {
    let _guard = INSTALL_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    recover_leftovers(addons_path);

    let cursor = io::Cursor::new(zip_bytes);
    let mut archive =
        ZipArchive::new(cursor).map_err(|e| format!("Failed to read ZIP archive: {}", e))?;

    let token = unique_token();
    let staging = addons_path.join(format!("{}{}", STAGING_PREFIX, token));
    let backup = addons_path.join(format!("{}{}", BACKUP_PREFIX, token));

    fs::create_dir(&staging).map_err(|e| {
        format!("Failed to create staging directory {}: {}", staging.display(), e)
    })?;

    let result = extract_archive(&mut archive, &staging).and_then(|top_dirs| {
        refuse_partial_replacements(addons_path, &staging, &top_dirs)?;
        carry_over_preserved_files(addons_path, &staging, &top_dirs)?;
        swap_into_place(addons_path, &staging, &backup, &top_dirs)?;
        Ok(top_dirs)
    });

    // Empty after a successful swap; holds the partial extraction or the
    // rolled-back new dirs after a failure.
    remove_dir_best_effort(&staging);

    result
}

/// Extract every entry of `archive` into `staging`, rejecting unsafe paths.
/// Returns the top-level directories in archive order.
fn extract_archive(
    archive: &mut ZipArchive<io::Cursor<&[u8]>>,
    staging: &Path,
) -> Result<Vec<String>, String> {
    let mut top_dirs: Vec<String> = Vec::new();

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry {}: {}", i, e))?;

        let raw_name = file
            .enclosed_name()
            .ok_or_else(|| format!("Invalid file path in ZIP entry {}", i))?;

        // Security: reject paths that escape the target directory. Only plain
        // components are kept, so `./MyAddon/a.lua` becomes `MyAddon/a.lua`.
        let mut parts = Vec::new();
        for component in raw_name.components() {
            match component {
                Component::Normal(part) => parts.push(part),
                Component::CurDir => {}
                _ => {
                    return Err(format!(
                        "ZIP contains path traversal: {}",
                        raw_name.display()
                    ))
                }
            }
        }

        let Some(first) = parts.first() else {
            continue;
        };
        // Loose file at the ZIP root: skipped (see install_from_zip)
        if parts.len() == 1 && !file.is_dir() {
            continue;
        }

        // Track top-level directories
        let dir_name = first.to_string_lossy().to_string();
        if dir_name.starts_with(RESERVED_PREFIX) {
            return Err(format!("ZIP contains a reserved directory name: {}", dir_name));
        }
        if !top_dirs.contains(&dir_name) {
            top_dirs.push(dir_name);
        }

        let mut out_path = staging.to_path_buf();
        out_path.extend(&parts);

        if file.is_dir() {
            fs::create_dir_all(&out_path)
                .map_err(|e| format!("Failed to create directory {}: {}", out_path.display(), e))?;
        } else {
            // Ensure parent directory exists
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    format!("Failed to create directory {}: {}", parent.display(), e)
                })?;
            }

            let mut outfile = fs::File::create(&out_path)
                .map_err(|e| format!("Failed to create file {}: {}", out_path.display(), e))?;

            io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to write file {}: {}", out_path.display(), e))?;
        }
    }

    Ok(top_dirs)
}

/// Refuse to replace an installed addon with a download that isn't a full
/// copy of it. Some ESOUI entries (e.g. translation patches) ship a single
/// file inside another addon's folder under the same directory name; swapping
/// that folder in would delete the addon. A real update always contains the
/// addon's manifest.
fn refuse_partial_replacements(
    addons_path: &Path,
    staging: &Path,
    dirs: &[String],
) -> Result<(), String> {
    for name in dirs {
        let installed_is_addon = manifest::parse_single_manifest(addons_path, name).is_some();
        if installed_is_addon && manifest::parse_single_manifest(staging, name).is_none() {
            return Err(format!(
                "Not replacing {name}: the download has no {name}.txt or {name}.addon manifest, so it isn't a full copy of the addon (it may be a patch for it)"
            ));
        }
    }
    Ok(())
}

/// A file that a tool outside Grimoire writes at the root of an addon's
/// folder, matched by name prefix and suffix.
struct PreservedFile {
    dir: &'static str,
    prefix: &'static str,
    suffix: &'static str,
}

/// Files that updates carry over from the installed folder instead of
/// deleting them with it. Only list files that a tool keeps fresh on its own
/// and the addon needs; everything else the new version doesn't ship is
/// removed.
///
/// Tamriel Trade Centre's client (`TamrielTradeCentre/Client/Client.exe`)
/// downloads the price tables and item lookup tables the addon loads into
/// its folder. The ESOUI ZIP doesn't ship them, so without this an update
/// would leave TTC without prices until the client runs again.
const PRESERVED_FILES: &[PreservedFile] = &[
    PreservedFile { dir: "TamrielTradeCentre", prefix: "PriceTable", suffix: ".lua" },
    PreservedFile { dir: "TamrielTradeCentre", prefix: "ItemLookUpTable_", suffix: ".lua" },
];

/// Copy the `PRESERVED_FILES` of each installed dir in `dirs` into its staged
/// replacement. The installed copy wins over one shipped in the ZIP, since the
/// tool that writes it keeps it more current. Copying rather than moving
/// leaves the installed dir intact if the install fails later.
fn carry_over_preserved_files(
    addons_path: &Path,
    staging: &Path,
    dirs: &[String],
) -> Result<(), String> {
    for name in dirs {
        let rules: Vec<_> = PRESERVED_FILES
            .iter()
            .filter(|r| r.dir == name.as_str())
            .collect();
        if rules.is_empty() {
            continue;
        }
        let Ok(entries) = fs::read_dir(addons_path.join(name)) else {
            continue;
        };
        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().to_string();
            let is_file = entry.file_type().map(|t| t.is_file()).unwrap_or(false);
            let preserved = rules
                .iter()
                .any(|r| file_name.starts_with(r.prefix) && file_name.ends_with(r.suffix));
            if !is_file || !preserved {
                continue;
            }
            fs::copy(entry.path(), staging.join(name).join(&file_name)).map_err(|e| {
                format!("Failed to keep {}/{} across the update: {}", name, file_name, e)
            })?;
        }
    }
    Ok(())
}

/// Move each staged dir in `dirs` from `staging` into `addons_path`, first
/// moving any existing dir of the same name into `backup`. If every dir is
/// swapped the backups are deleted; otherwise the swapped dirs are moved back
/// into `staging` and the backups restored.
fn swap_into_place(
    addons_path: &Path,
    staging: &Path,
    backup: &Path,
    dirs: &[String],
) -> Result<(), String> {
    // (dir name, previous version moved to backup, new version moved in)
    let mut swapped: Vec<(&str, bool, bool)> = Vec::new();
    let mut failure = None;

    for name in dirs {
        let live = addons_path.join(name);
        let has_previous = path_exists(&live);
        if has_previous {
            let moved = fs::create_dir_all(backup)
                .and_then(|()| rename_with_retry(&live, &backup.join(name)));
            if let Err(e) = moved {
                failure = Some(format!("Failed to move existing {} aside: {}", name, e));
                break;
            }
        }
        if let Err(e) = rename_with_retry(&staging.join(name), &live) {
            swapped.push((name, has_previous, false));
            failure = Some(format!("Failed to move {} into place: {}", name, e));
            break;
        }
        swapped.push((name, has_previous, true));
    }

    let Some(failure) = failure else {
        remove_dir_best_effort(backup);
        return Ok(());
    };

    for &(name, has_previous, moved_in) in swapped.iter().rev() {
        let live = addons_path.join(name);
        if moved_in {
            if let Err(e) = rename_with_retry(&live, &staging.join(name)) {
                // The new version stays live and complete; its backup is
                // cleaned up by the next install's recovery.
                log::warn!("Failed to roll back {}: {}", live.display(), e);
                continue;
            }
        }
        if has_previous {
            if let Err(e) = rename_with_retry(&backup.join(name), &live) {
                log::warn!("Failed to restore {}: {}", live.display(), e);
            }
        }
    }
    // Only succeeds once every backup was restored; anything left behind is
    // restored by the next install's recovery.
    let _ = fs::remove_dir(backup);

    Err(failure)
}

/// Clean up after an install that was interrupted (crash, power loss) before
/// it could finish or roll back. Called at app startup and at the start of
/// every install; safe to call while another install may start.
pub fn recover_interrupted_installs(addons_path: &Path) {
    let _guard = INSTALL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    recover_leftovers(addons_path);
}

/// Recovery rules (caller must hold `INSTALL_LOCK`):
/// - Staging dirs only hold extracted copies of a ZIP, so they are deleted.
/// - A backup entry whose live dir is missing was moved aside and never
///   replaced (or already moved back out during a rollback): restore it.
/// - A backup entry whose live dir exists has been superseded: delete it.
///
/// Failures are logged and retried on the next startup or install.
fn recover_leftovers(addons_path: &Path) {
    let Ok(entries) = fs::read_dir(addons_path) else {
        return;
    };
    let entries: Vec<_> = entries.flatten().collect();

    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(STAGING_PREFIX) {
            remove_dir_best_effort(&entry.path());
        } else if name.starts_with(BACKUP_PREFIX) {
            restore_backup_dir(addons_path, &entry.path());
        }
    }
}

fn restore_backup_dir(addons_path: &Path, backup: &Path) {
    let Ok(entries) = fs::read_dir(backup) else {
        return;
    };
    let entries: Vec<_> = entries.flatten().collect();

    let mut all_restored = true;
    for entry in entries {
        let live = addons_path.join(entry.file_name());
        if path_exists(&live) {
            continue;
        }
        if let Err(e) = rename_with_retry(&entry.path(), &live) {
            log::warn!("Failed to restore {} from backup: {}", live.display(), e);
            all_restored = false;
        }
    }

    if all_restored {
        remove_dir_best_effort(backup);
    }
}

/// Rename with a short bounded retry. On Windows, antivirus scanners and the
/// search indexer can briefly hold handles on freshly written files, making
/// directory renames fail transiently.
fn rename_with_retry(from: &Path, to: &Path) -> io::Result<()> {
    let mut attempt = 1;
    loop {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == io::ErrorKind::NotFound || attempt >= RENAME_ATTEMPTS => {
                return Err(e)
            }
            Err(_) => {
                thread::sleep(Duration::from_millis(50 * attempt as u64));
                attempt += 1;
            }
        }
    }
}

/// Like `Path::exists`, but also true for a dangling symlink, which would
/// still block a rename onto that path.
fn path_exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

fn remove_dir_best_effort(path: &Path) {
    if let Err(e) = fs::remove_dir_all(path) {
        if e.kind() != io::ErrorKind::NotFound {
            log::warn!("Failed to remove {}: {}", path.display(), e);
        }
    }
}

/// Suffix for this install's staging and backup dir names.
fn unique_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{}-{}", std::process::id(), nanos)
}

/// Remove an addon directory from the AddOns folder.
pub fn uninstall_addon(addons_path: &Path, dir_name: &str) -> Result<(), String> {
    let addon_dir = addons_path.join(dir_name);

    // Security: ensure we're not deleting outside addons_path
    let canonical_addons = addons_path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve addons path: {}", e))?;
    let canonical_target = addon_dir
        .canonicalize()
        .map_err(|_| format!("Addon directory not found: {}", dir_name))?;

    if !canonical_target.starts_with(&canonical_addons) {
        return Err("Path traversal detected".to_string());
    }

    fs::remove_dir_all(&addon_dir)
        .map_err(|e| format!("Failed to remove {}: {}", dir_name, e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::io::Write;
    use std::path::PathBuf;

    /// Build a ZIP archive in memory from a list of (path, contents) entries.
    fn create_test_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut writer = zip::write::ZipWriter::new(io::Cursor::new(&mut buf));
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

    /// Flip the first byte of `marker` inside a Stored ZIP, so the entry
    /// containing it fails its CRC check when extracted.
    fn corrupt_stored_entry(zip: &mut [u8], marker: &[u8]) {
        let pos = zip
            .windows(marker.len())
            .position(|w| w == marker)
            .expect("marker not found in ZIP");
        zip[pos] ^= 0xFF;
    }

    /// Recursively read `root` into relative path -> file contents.
    /// Directories map to `None` so added or removed empty dirs are caught.
    fn snapshot(root: &Path) -> BTreeMap<PathBuf, Option<Vec<u8>>> {
        let mut out = BTreeMap::new();
        let mut pending = vec![root.to_path_buf()];
        while let Some(dir) = pending.pop() {
            for entry in fs::read_dir(&dir).unwrap() {
                let path = entry.unwrap().path();
                let rel = path.strip_prefix(root).unwrap().to_path_buf();
                if path.is_dir() {
                    out.insert(rel, None);
                    pending.push(path);
                } else {
                    out.insert(rel, Some(fs::read(&path).unwrap()));
                }
            }
        }
        out
    }

    /// Sorted names of the entries directly inside `dir`.
    fn entry_names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn test_install_basic_addon() {
        let dir = tempfile::tempdir().unwrap();
        let zip = create_test_zip(&[
            ("MyAddon/", b""),
            ("MyAddon/MyAddon.txt", b"## Title: My Addon\n"),
            ("MyAddon/init.lua", b"-- hello\n"),
        ]);

        let top_dirs = install_from_zip(&zip, dir.path()).unwrap();
        assert_eq!(top_dirs, vec!["MyAddon"]);
        assert!(dir.path().join("MyAddon/MyAddon.txt").exists());
        assert!(dir.path().join("MyAddon/init.lua").exists());
    }

    #[test]
    fn test_install_multiple_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let zip = create_test_zip(&[
            ("AddonA/file.lua", b"a"),
            ("AddonB/file.lua", b"b"),
        ]);

        let top_dirs = install_from_zip(&zip, dir.path()).unwrap();
        assert_eq!(top_dirs.len(), 2);
        assert!(top_dirs.contains(&"AddonA".to_string()));
        assert!(top_dirs.contains(&"AddonB".to_string()));
        assert_eq!(fs::read_to_string(dir.path().join("AddonA/file.lua")).unwrap(), "a");
        assert_eq!(fs::read_to_string(dir.path().join("AddonB/file.lua")).unwrap(), "b");
        assert_eq!(entry_names(dir.path()), vec!["AddonA", "AddonB"]);
    }

    #[test]
    fn test_update_multiple_dirs_replaces_each() {
        let dir = tempfile::tempdir().unwrap();
        // AddonA is already installed with a file the new ZIP no longer has;
        // AddonB is new.
        fs::create_dir(dir.path().join("AddonA")).unwrap();
        fs::write(dir.path().join("AddonA/stale.lua"), "stale").unwrap();

        let zip = create_test_zip(&[
            ("AddonA/file.lua", b"a2"),
            ("AddonB/file.lua", b"b2"),
        ]);

        let top_dirs = install_from_zip(&zip, dir.path()).unwrap();
        assert_eq!(top_dirs, vec!["AddonA", "AddonB"]);
        assert!(!dir.path().join("AddonA/stale.lua").exists());
        assert_eq!(fs::read_to_string(dir.path().join("AddonA/file.lua")).unwrap(), "a2");
        assert_eq!(fs::read_to_string(dir.path().join("AddonB/file.lua")).unwrap(), "b2");
        assert_eq!(entry_names(dir.path()), vec!["AddonA", "AddonB"]);
    }

    #[test]
    fn test_update_removes_stale_files() {
        let dir = tempfile::tempdir().unwrap();
        let v1 = create_test_zip(&[
            ("MyAddon/MyAddon.txt", b"## Version: 1.0\n"),
            ("MyAddon/old.lua", b"-- dropped in v2\n"),
            ("MyAddon/OldLib/lib.lua", b"-- dropped in v2\n"),
        ]);
        install_from_zip(&v1, dir.path()).unwrap();

        let v2 = create_test_zip(&[
            ("MyAddon/MyAddon.txt", b"## Version: 2.0\n"),
            ("MyAddon/new.lua", b"-- added in v2\n"),
        ]);
        install_from_zip(&v2, dir.path()).unwrap();

        let mut expected = BTreeMap::new();
        expected.insert(PathBuf::from("MyAddon"), None);
        expected.insert(
            PathBuf::from("MyAddon").join("MyAddon.txt"),
            Some(b"## Version: 2.0\n".to_vec()),
        );
        expected.insert(
            PathBuf::from("MyAddon").join("new.lua"),
            Some(b"-- added in v2\n".to_vec()),
        );
        assert_eq!(snapshot(dir.path()), expected);
    }

    #[test]
    fn test_update_refuses_download_without_manifest() {
        // Some ESOUI patches ship a single file inside the addon's folder.
        // "Updating" the installed addon with one must not replace the addon.
        let dir = tempfile::tempdir().unwrap();
        let v1 = create_test_zip(&[
            ("MyAddon/MyAddon.txt", b"## Version: 1.0\n"),
            ("MyAddon/main.lua", b"-- addon\n"),
        ]);
        install_from_zip(&v1, dir.path()).unwrap();
        let before = snapshot(dir.path());

        let patch = create_test_zip(&[
            ("NewLib/NewLib.txt", b"## Version: 1.0\n"),
            ("MyAddon/strings/pl.lua", b"-- pl\n"),
        ]);

        let err = install_from_zip(&patch, dir.path()).unwrap_err();
        assert!(err.contains("Not replacing MyAddon"), "unexpected error: {}", err);
        // Nothing changed, not even the other dir from the same ZIP, and no
        // staging/backup dirs are left behind
        assert_eq!(snapshot(dir.path()), before);
    }

    #[test]
    fn test_update_accepts_manifest_with_other_extension() {
        let dir = tempfile::tempdir().unwrap();
        let v1 = create_test_zip(&[("MyAddon/MyAddon.txt", b"## Version: 1.0\n")]);
        install_from_zip(&v1, dir.path()).unwrap();

        let v2 = create_test_zip(&[("MyAddon/MyAddon.addon", b"## Version: 2.0\n")]);
        install_from_zip(&v2, dir.path()).unwrap();

        assert!(!dir.path().join("MyAddon/MyAddon.txt").exists());
        assert!(dir.path().join("MyAddon/MyAddon.addon").exists());
    }

    #[test]
    fn test_update_replaces_dir_that_is_not_an_addon() {
        // Only installed addons are protected; a folder without a manifest is
        // replaced like before.
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("MyData")).unwrap();
        fs::write(dir.path().join("MyData/old.lua"), "old").unwrap();

        let zip = create_test_zip(&[("MyData/new.lua", b"new")]);
        install_from_zip(&zip, dir.path()).unwrap();

        assert!(!dir.path().join("MyData/old.lua").exists());
        assert_eq!(fs::read_to_string(dir.path().join("MyData/new.lua")).unwrap(), "new");
    }

    #[test]
    fn test_update_keeps_ttc_client_tables() {
        let dir = tempfile::tempdir().unwrap();
        let ttc = dir.path().join("TamrielTradeCentre");
        let v1 = create_test_zip(&[
            ("TamrielTradeCentre/TamrielTradeCentre.txt", b"## Version: 1.0\n"),
            ("TamrielTradeCentre/old.lua", b"-- dropped in v2\n"),
        ]);
        install_from_zip(&v1, dir.path()).unwrap();
        // Written by the TTC client after install
        fs::write(ttc.join("PriceTableNA.lua"), "-- prices").unwrap();
        fs::write(ttc.join("ItemLookUpTable_EN.lua"), "-- lookup").unwrap();
        fs::create_dir_all(ttc.join("Client").join("ErrorLog")).unwrap();
        fs::write(ttc.join("Client").join("ErrorLog").join("2026-01-23.log"), "error").unwrap();

        let v2 = create_test_zip(&[
            ("TamrielTradeCentre/TamrielTradeCentre.txt", b"## Version: 2.0\n"),
            ("TamrielTradeCentre/Client/Client.exe", b"exe"),
        ]);
        install_from_zip(&v2, dir.path()).unwrap();

        assert_eq!(fs::read_to_string(ttc.join("PriceTableNA.lua")).unwrap(), "-- prices");
        assert_eq!(fs::read_to_string(ttc.join("ItemLookUpTable_EN.lua")).unwrap(), "-- lookup");
        assert_eq!(
            fs::read_to_string(ttc.join("TamrielTradeCentre.txt")).unwrap(),
            "## Version: 2.0\n"
        );
        // Everything else the new version doesn't ship is still removed
        assert!(!ttc.join("old.lua").exists());
        assert!(!ttc.join("Client").join("ErrorLog").exists());
        assert_eq!(entry_names(dir.path()), vec!["TamrielTradeCentre"]);
    }

    #[test]
    fn test_preserved_file_keeps_installed_copy_over_zip_copy() {
        let dir = tempfile::tempdir().unwrap();
        let v1 = create_test_zip(&[(
            "TamrielTradeCentre/TamrielTradeCentre.txt",
            b"## Version: 1.0\n",
        )]);
        install_from_zip(&v1, dir.path()).unwrap();
        fs::write(dir.path().join("TamrielTradeCentre/PriceTable.lua"), "client").unwrap();

        let v2 = create_test_zip(&[
            ("TamrielTradeCentre/TamrielTradeCentre.txt", b"## Version: 2.0\n"),
            ("TamrielTradeCentre/PriceTable.lua", b"zip"),
        ]);
        install_from_zip(&v2, dir.path()).unwrap();

        assert_eq!(
            fs::read_to_string(dir.path().join("TamrielTradeCentre/PriceTable.lua")).unwrap(),
            "client"
        );
    }

    #[test]
    fn test_preserved_files_only_apply_to_their_addon() {
        let dir = tempfile::tempdir().unwrap();
        let v1 = create_test_zip(&[("OtherAddon/OtherAddon.txt", b"## Version: 1.0\n")]);
        install_from_zip(&v1, dir.path()).unwrap();
        fs::write(dir.path().join("OtherAddon/PriceTableNA.lua"), "stale").unwrap();

        let v2 = create_test_zip(&[("OtherAddon/OtherAddon.txt", b"## Version: 2.0\n")]);
        install_from_zip(&v2, dir.path()).unwrap();

        assert!(!dir.path().join("OtherAddon/PriceTableNA.lua").exists());
    }

    #[test]
    fn test_failed_extraction_leaves_existing_addon_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let v1 = create_test_zip(&[
            ("MyAddon/MyAddon.txt", b"## Version: 1.0\n"),
            ("MyAddon/main.lua", b"-- v1\n"),
            ("MyAddon/Libs/lib.lua", b"-- v1 lib\n"),
        ]);
        install_from_zip(&v1, dir.path()).unwrap();
        let before = snapshot(dir.path());

        // The first entries extract fine; the last one fails its CRC check.
        let mut v2 = create_test_zip(&[
            ("MyAddon/MyAddon.txt", b"## Version: 2.0\n"),
            ("MyAddon/main.lua", b"-- v2\n"),
            ("OtherAddon/OtherAddon.txt", b"## Version: 2.0\n"),
            ("MyAddon/zz_last.lua", b"-- CORRUPTED-PAYLOAD --\n"),
        ]);
        corrupt_stored_entry(&mut v2, b"CORRUPTED-PAYLOAD");

        let err = install_from_zip(&v2, dir.path()).unwrap_err();
        assert!(err.contains("zz_last.lua"), "unexpected error: {}", err);
        // Byte-for-byte unchanged, and no staging/backup dirs left behind
        assert_eq!(snapshot(dir.path()), before);
    }

    #[test]
    fn test_swap_failure_restores_previous_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let addons = dir.path().join("AddOns");
        for name in ["AddonA", "AddonB"] {
            fs::create_dir_all(addons.join(name)).unwrap();
            fs::write(addons.join(name).join("old.lua"), name).unwrap();
        }
        let before = snapshot(&addons);

        // Only AddonA is staged, so moving AddonB into place fails after
        // AddonA has already been swapped in.
        let staging = dir.path().join("staging");
        let backup = dir.path().join("backup");
        fs::create_dir_all(staging.join("AddonA")).unwrap();
        fs::write(staging.join("AddonA").join("new.lua"), "new").unwrap();

        let dirs = vec!["AddonA".to_string(), "AddonB".to_string()];
        let err = swap_into_place(&addons, &staging, &backup, &dirs).unwrap_err();
        assert!(err.contains("AddonB"), "unexpected error: {}", err);

        assert_eq!(snapshot(&addons), before);
        assert!(!backup.exists());
        assert!(staging.join("AddonA").join("new.lua").exists());
    }

    #[test]
    fn test_recovery_removes_leftover_staging() {
        let dir = tempfile::tempdir().unwrap();
        let leftover = dir.path().join(format!("{}crashed", STAGING_PREFIX));
        fs::create_dir_all(leftover.join("MyAddon")).unwrap();
        fs::write(leftover.join("MyAddon").join("MyAddon.txt"), "half extracted").unwrap();

        let zip = create_test_zip(&[("Other/Other.txt", b"## Title: Other\n")]);
        install_from_zip(&zip, dir.path()).unwrap();

        assert_eq!(entry_names(dir.path()), vec!["Other"]);
    }

    #[test]
    fn test_recovery_restores_orphaned_backup() {
        let dir = tempfile::tempdir().unwrap();
        let leftover = dir.path().join(format!("{}crashed", BACKUP_PREFIX));
        // Crashed after MyAddon was moved aside, before its replacement moved in
        fs::create_dir_all(leftover.join("MyAddon")).unwrap();
        fs::write(leftover.join("MyAddon").join("MyAddon.txt"), "old").unwrap();
        // Crashed after LibFoo was replaced, before its backup was deleted
        fs::create_dir_all(leftover.join("LibFoo")).unwrap();
        fs::write(leftover.join("LibFoo").join("LibFoo.txt"), "old").unwrap();
        fs::create_dir(dir.path().join("LibFoo")).unwrap();
        fs::write(dir.path().join("LibFoo").join("LibFoo.txt"), "new").unwrap();

        let zip = create_test_zip(&[("Other/Other.txt", b"## Title: Other\n")]);
        install_from_zip(&zip, dir.path()).unwrap();

        assert_eq!(entry_names(dir.path()), vec!["LibFoo", "MyAddon", "Other"]);
        assert_eq!(fs::read_to_string(dir.path().join("MyAddon/MyAddon.txt")).unwrap(), "old");
        assert_eq!(fs::read_to_string(dir.path().join("LibFoo/LibFoo.txt")).unwrap(), "new");
    }

    #[test]
    fn test_recover_interrupted_installs_standalone() {
        let dir = tempfile::tempdir().unwrap();
        let staging = dir.path().join(format!("{}crashed", STAGING_PREFIX));
        fs::create_dir_all(staging.join("MyAddon")).unwrap();
        let backup = dir.path().join(format!("{}crashed", BACKUP_PREFIX));
        fs::create_dir_all(backup.join("MyAddon")).unwrap();
        fs::write(backup.join("MyAddon").join("MyAddon.txt"), "old").unwrap();

        // The startup entry point applies the same rules without installing
        recover_interrupted_installs(dir.path());

        assert_eq!(entry_names(dir.path()), vec!["MyAddon"]);
        assert_eq!(fs::read_to_string(dir.path().join("MyAddon/MyAddon.txt")).unwrap(), "old");

        // A missing AddOns path is ignored
        recover_interrupted_installs(&dir.path().join("does-not-exist"));
    }

    #[test]
    fn test_install_skips_loose_root_files() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("README.txt"), "not from this addon").unwrap();

        let zip = create_test_zip(&[
            ("README.txt", b"addon readme"),
            ("MyAddon/MyAddon.txt", b"## Title: My Addon\n"),
        ]);

        let top_dirs = install_from_zip(&zip, dir.path()).unwrap();
        assert_eq!(top_dirs, vec!["MyAddon"]);
        assert_eq!(
            fs::read_to_string(dir.path().join("README.txt")).unwrap(),
            "not from this addon"
        );
        assert_eq!(entry_names(dir.path()), vec!["MyAddon", "README.txt"]);
    }

    #[test]
    fn test_install_rejects_reserved_dir_name() {
        let dir = tempfile::tempdir().unwrap();
        let zip = create_test_zip(&[(".grimoire-backup-1/Evil/Evil.txt", b"")]);

        let err = install_from_zip(&zip, dir.path()).unwrap_err();
        assert!(err.contains("reserved"), "unexpected error: {}", err);
        assert!(entry_names(dir.path()).is_empty());
    }

    #[test]
    fn test_install_nested_subdirs() {
        let dir = tempfile::tempdir().unwrap();
        let zip = create_test_zip(&[
            ("MyAddon/sub/deep/file.lua", b"nested"),
        ]);

        install_from_zip(&zip, dir.path()).unwrap();
        assert!(dir.path().join("MyAddon/sub/deep/file.lua").exists());
    }

    #[test]
    fn test_install_overwrites_existing() {
        let dir = tempfile::tempdir().unwrap();
        let addon_dir = dir.path().join("MyAddon");
        fs::create_dir(&addon_dir).unwrap();
        fs::write(addon_dir.join("old.lua"), "old content").unwrap();

        let zip = create_test_zip(&[
            ("MyAddon/old.lua", b"new content"),
        ]);

        install_from_zip(&zip, dir.path()).unwrap();
        let content = fs::read_to_string(dir.path().join("MyAddon/old.lua")).unwrap();
        assert_eq!(content, "new content");
    }

    #[test]
    fn test_install_path_traversal_rejected() {
        // Build a ZIP with a "../evil.txt" entry by creating a normal ZIP
        // and patching the filename in the raw bytes.
        let dir = tempfile::tempdir().unwrap();

        // Create a ZIP with a placeholder filename of the same length as "../evil.txt"
        let placeholder = "XXXevil.txt"; // same length as "../evil.txt"
        let traversal = "../evil.txt";
        assert_eq!(placeholder.len(), traversal.len());

        let zip = create_test_zip(&[(placeholder, b"malicious")]);

        // Patch the raw ZIP bytes: replace placeholder with traversal path
        // ZIP format stores filenames in both local file header and central directory
        let mut patched = zip.clone();
        let placeholder_bytes = placeholder.as_bytes();
        let traversal_bytes = traversal.as_bytes();
        for i in 0..patched.len() - placeholder_bytes.len() {
            if &patched[i..i + placeholder_bytes.len()] == placeholder_bytes {
                patched[i..i + traversal_bytes.len()].copy_from_slice(traversal_bytes);
            }
        }

        let result = install_from_zip(&patched, dir.path());
        // Should be rejected by enclosed_name() returning None
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("Invalid file path") || err.contains("path traversal"),
            "Expected path traversal error, got: {}",
            err
        );
        // Verify no file was written outside the target, and nothing inside it
        assert!(!dir.path().parent().unwrap().join("evil.txt").exists());
        assert!(entry_names(dir.path()).is_empty());
    }

    #[test]
    fn test_install_empty_zip() {
        let dir = tempfile::tempdir().unwrap();
        let zip = create_test_zip(&[]);

        let top_dirs = install_from_zip(&zip, dir.path()).unwrap();
        assert!(top_dirs.is_empty());
        assert!(entry_names(dir.path()).is_empty());
    }

    #[test]
    fn test_install_invalid_zip() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("MyAddon")).unwrap();
        fs::write(dir.path().join("MyAddon/MyAddon.txt"), "## Version: 1.0\n").unwrap();
        let before = snapshot(dir.path());

        let result = install_from_zip(b"not a zip file", dir.path());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to read ZIP archive"));
        assert_eq!(snapshot(dir.path()), before);
    }

    // ── uninstall_addon ────────────────────────────────────────────

    #[test]
    fn test_uninstall_existing() {
        let dir = tempfile::tempdir().unwrap();
        let addon_dir = dir.path().join("MyAddon");
        fs::create_dir(&addon_dir).unwrap();
        fs::write(addon_dir.join("file.lua"), "content").unwrap();

        uninstall_addon(dir.path(), "MyAddon").unwrap();
        assert!(!addon_dir.exists());
    }

    #[test]
    fn test_uninstall_nonexistent() {
        let dir = tempfile::tempdir().unwrap();
        let result = uninstall_addon(dir.path(), "DoesNotExist");
        assert!(result.is_err());
    }

    #[test]
    fn test_uninstall_path_traversal() {
        let dir = tempfile::tempdir().unwrap();
        // Create a sibling directory that path traversal might try to delete
        let sibling = dir.path().join("sibling");
        fs::create_dir(&sibling).unwrap();

        let addons_dir = dir.path().join("addons");
        fs::create_dir(&addons_dir).unwrap();

        let result = uninstall_addon(&addons_dir, "../sibling");
        // Should fail — either "not found" (canonicalize fails) or "path traversal"
        assert!(result.is_err());
        // Sibling should still exist
        assert!(sibling.exists());
    }
}
