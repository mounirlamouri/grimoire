use std::fs;
use std::io;
use std::path::Path;
use zip::ZipArchive;

/// Install an addon from a ZIP byte buffer into the AddOns directory.
///
/// ESO addon ZIPs typically contain one or more top-level directories
/// (e.g., `MyAddon/`, `MyAddonLib/`) with the addon files inside.
/// This function extracts directly into `addons_path`, so the ZIP's
/// top-level dirs become subdirectories of AddOns.
///
/// Returns the list of top-level directories that were extracted.
pub fn install_from_zip(zip_bytes: &[u8], addons_path: &Path) -> Result<Vec<String>, String> {
    let cursor = io::Cursor::new(zip_bytes);
    let mut archive =
        ZipArchive::new(cursor).map_err(|e| format!("Failed to read ZIP archive: {}", e))?;

    let mut top_dirs: Vec<String> = Vec::new();

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry {}: {}", i, e))?;

        let raw_name = file
            .enclosed_name()
            .ok_or_else(|| format!("Invalid file path in ZIP entry {}", i))?
            .to_owned();

        // Security: reject paths that escape the target directory
        if raw_name.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return Err(format!(
                "ZIP contains path traversal: {}",
                raw_name.display()
            ));
        }

        let out_path = addons_path.join(&raw_name);

        // Track top-level directories
        if let Some(first) = raw_name.components().next() {
            let dir_name = first.as_os_str().to_string_lossy().to_string();
            if !top_dirs.contains(&dir_name) {
                top_dirs.push(dir_name);
            }
        }

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
    use std::io::Write;

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
        // Verify no file was written outside the target
        assert!(!dir.path().parent().unwrap().join("evil.txt").exists());
    }

    #[test]
    fn test_install_empty_zip() {
        let dir = tempfile::tempdir().unwrap();
        let zip = create_test_zip(&[]);

        let top_dirs = install_from_zip(&zip, dir.path()).unwrap();
        assert!(top_dirs.is_empty());
    }

    #[test]
    fn test_install_invalid_zip() {
        let dir = tempfile::tempdir().unwrap();
        let result = install_from_zip(b"not a zip file", dir.path());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to read ZIP archive"));
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
