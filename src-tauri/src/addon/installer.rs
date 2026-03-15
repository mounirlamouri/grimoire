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
