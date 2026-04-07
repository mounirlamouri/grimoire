use crate::addon::manifest;
use crate::config::{paths, settings};
use crate::db;
use rusqlite::Connection;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

use super::install::{install_addon_internal, prepare_install_context};

#[derive(Debug, Clone, serde::Serialize)]
pub struct ImportEntry {
    pub dir_name: String,
    pub in_catalog: bool,
    pub already_installed: bool,
    pub catalog_name: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ImportProgress {
    pub current: usize,
    pub total: usize,
    pub dir_name: String,
    pub stage: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ImportResult {
    pub installed: Vec<String>,
    pub failed: Vec<ImportFailure>,
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ImportFailure {
    pub dir_name: String,
    pub error: String,
}

/// Generate an export string from a list of selected dir_names.
/// Scans installed addons to include human-readable comments.
#[tauri::command]
pub fn export_addon_list(
    app_handle: tauri::AppHandle,
    dir_names: Vec<String>,
) -> Result<String, String> {
    let addon_path = settings::load_settings(&app_handle)
        .addon_path
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| paths::detect_addon_path())
        .ok_or("ESO addon path not configured. Go to Settings to set it.")?;

    let addons = manifest::scan_installed_addons(&addon_path).map_err(|e| e.to_string())?;

    let selected: HashSet<&str> = dir_names.iter().map(|s| s.as_str()).collect();

    let now = chrono::Local::now().format("%Y-%m-%d").to_string();
    let count = dir_names.len();

    let mut lines = Vec::new();
    lines.push("# Grimoire Addon List".to_string());
    lines.push(format!("# Exported: {}", now));
    lines.push(format!("# Addons: {}", count));
    lines.push(String::new());

    for addon in &addons {
        if selected.contains(addon.dir_name.as_str()) {
            lines.push(addon.dir_name.clone());
        }
    }

    // Include any dir_names not found in scan (shouldn't happen, but be safe)
    let scanned: HashSet<&str> = addons.iter().map(|a| a.dir_name.as_str()).collect();
    for name in &dir_names {
        if !scanned.contains(name.as_str()) {
            lines.push(name.clone());
        }
    }

    let mut text = lines.join("\n");
    text.push('\n');
    Ok(text)
}

/// Upload text content to paste.rs. Returns the paste URL.
#[tauri::command]
pub async fn upload_to_paste(content: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let response = client
        .post("https://paste.rs/")
        .body(content)
        .send()
        .await
        .map_err(|e| format!("Failed to upload to paste.rs: {}", e))?;

    match response.status().as_u16() {
        201 => {
            let url = response
                .text()
                .await
                .map_err(|e| format!("Failed to read paste.rs response: {}", e))?
                .trim()
                .to_string();
            Ok(url)
        }
        206 => Err("Addon list too large for paste service (partial upload).".to_string()),
        status => {
            let body = response.text().await.unwrap_or_default();
            Err(format!("Paste service error: HTTP {} — {}", status, body))
        }
    }
}

/// Fetch content from a paste.rs URL or paste ID.
#[tauri::command]
pub async fn fetch_paste(url_or_id: String) -> Result<String, String> {
    let paste_id = url_or_id
        .trim()
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string();

    if paste_id.is_empty() {
        return Err("Invalid paste URL or ID.".to_string());
    }

    // Strip any file extension the user may have appended (e.g., ".txt")
    let paste_id = paste_id.split('.').next().unwrap_or(&paste_id);

    let fetch_url = format!("https://paste.rs/{}", paste_id);
    let client = reqwest::Client::new();
    let response = client
        .get(&fetch_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch paste: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Paste not found or expired (HTTP {}).",
            response.status().as_u16()
        ));
    }

    response
        .text()
        .await
        .map_err(|e| format!("Failed to read paste content: {}", e))
}

/// Parse an addon list text and check each entry against the catalog and installed addons.
#[tauri::command]
pub fn parse_addon_list(
    app_handle: tauri::AppHandle,
    content: String,
) -> Result<Vec<ImportEntry>, String> {
    let addon_path = settings::load_settings(&app_handle)
        .addon_path
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| paths::detect_addon_path());

    // Collect installed dir names
    let installed: HashSet<String> = addon_path
        .as_ref()
        .and_then(|p| manifest::scan_installed_addons(p).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|a| a.dir_name)
        .collect();

    let db_state = app_handle.state::<Mutex<Connection>>();
    let conn = db_state
        .lock()
        .map_err(|e| format!("DB lock error: {}", e))?;

    let mut entries = Vec::new();
    let mut seen = HashSet::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let dir_name = trimmed.to_string();
        if !seen.insert(dir_name.clone()) {
            continue; // skip duplicates
        }

        let catalog_info = db::lookup_by_dir_name(&conn, &dir_name).unwrap_or(None);
        let in_catalog = catalog_info.is_some();
        let catalog_name = if in_catalog {
            // Try to get the addon name from catalog
            db::lookup_catalog_name(&conn, &dir_name).unwrap_or(None)
        } else {
            None
        };

        entries.push(ImportEntry {
            already_installed: installed.contains(&dir_name),
            dir_name,
            in_catalog,
            catalog_name,
        });
    }

    Ok(entries)
}

/// Install a list of addons by dir_name. Emits import-progress events.
/// Uses a single HTTP client and visited set across all installs for efficiency.
#[tauri::command]
pub async fn import_install_addons(
    app_handle: tauri::AppHandle,
    dir_names: Vec<String>,
) -> Result<ImportResult, String> {
    let total = dir_names.len();
    let mut result = ImportResult {
        installed: Vec::new(),
        failed: Vec::new(),
        skipped: Vec::new(),
    };

    // Initialize once: addon path, HTTP client, visited set
    let (addon_path, mut client, mut visited) = prepare_install_context(&app_handle).await?;

    // Look up UIDs for all dir_names
    let uids: Vec<(String, Option<String>)> = {
        let db_state = app_handle.state::<Mutex<Connection>>();
        let conn = db_state
            .lock()
            .map_err(|e| format!("DB lock error: {}", e))?;

        dir_names
            .iter()
            .map(|name| {
                let uid = db::lookup_by_dir_name(&conn, name)
                    .unwrap_or(None)
                    .map(|(_, uid, _, _)| uid);
                (name.clone(), uid)
            })
            .collect()
    };

    for (i, (dir_name, uid)) in uids.into_iter().enumerate() {
        let _ = app_handle.emit(
            "import-progress",
            ImportProgress {
                current: i,
                total,
                dir_name: dir_name.clone(),
                stage: "installing".to_string(),
            },
        );

        if visited.contains(&dir_name) {
            result.skipped.push(dir_name);
            continue;
        }

        let Some(uid) = uid else {
            result.failed.push(ImportFailure {
                dir_name,
                error: "Not found in ESOUI catalog".to_string(),
            });
            continue;
        };

        match install_addon_internal(&app_handle, &mut client, &addon_path, &uid, &mut visited)
            .await
        {
            Ok(_install_result) => {
                result.installed.push(dir_name);
            }
            Err(e) => {
                result.failed.push(ImportFailure {
                    dir_name,
                    error: e,
                });
            }
        }
    }

    // Emit final progress
    let _ = app_handle.emit(
        "import-progress",
        ImportProgress {
            current: total,
            total,
            dir_name: String::new(),
            stage: "done".to_string(),
        },
    );

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_lines_ignores_comments_and_blanks() {
        let content = "# Comment line\n\nAddon1\n  Addon2  \n# Another comment\nAddon3\n";
        let entries = parse_lines(content);
        assert_eq!(entries, vec!["Addon1", "Addon2", "Addon3"]);
    }

    #[test]
    fn test_parse_lines_deduplicates() {
        let content = "Addon1\nAddon2\nAddon1\n";
        let entries = parse_lines(content);
        assert_eq!(entries, vec!["Addon1", "Addon2"]);
    }

    #[test]
    fn test_parse_lines_empty() {
        let content = "# Only comments\n\n  \n";
        let entries = parse_lines(content);
        assert!(entries.is_empty());
    }

    #[test]
    fn test_parse_lines_whitespace_handling() {
        let content = "  LibAddonMenu-2.0  \n\tSomeAddon\t\n";
        let entries = parse_lines(content);
        assert_eq!(entries, vec!["LibAddonMenu-2.0", "SomeAddon"]);
    }

    #[test]
    fn test_export_format_header() {
        // Verify the format structure without needing a real AppHandle
        let lines = vec![
            "# Grimoire Addon List".to_string(),
            "# Exported: 2026-04-06".to_string(),
            "# Addons: 2".to_string(),
            String::new(),
            "Addon1".to_string(),
            "Addon2".to_string(),
        ];
        let text = lines.join("\n");
        let parsed = parse_lines(&text);
        assert_eq!(parsed, vec!["Addon1", "Addon2"]);
    }

    #[test]
    fn test_extract_paste_id_from_url() {
        let url = "https://paste.rs/AbCd";
        let id = url.trim().trim_end_matches('/').rsplit('/').next().unwrap();
        assert_eq!(id, "AbCd");
    }

    #[test]
    fn test_extract_paste_id_with_trailing_slash() {
        let url = "https://paste.rs/AbCd/";
        let id = url.trim().trim_end_matches('/').rsplit('/').next().unwrap();
        assert_eq!(id, "AbCd");
    }

    #[test]
    fn test_extract_paste_id_bare() {
        let id_str = "AbCd";
        let id = id_str.trim().trim_end_matches('/').rsplit('/').next().unwrap();
        assert_eq!(id, "AbCd");
    }

    /// Helper used by tests to parse lines without needing DB/AppHandle
    fn parse_lines(content: &str) -> Vec<String> {
        let mut entries = Vec::new();
        let mut seen = HashSet::new();
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let name = trimmed.to_string();
            if seen.insert(name.clone()) {
                entries.push(name);
            }
        }
        entries
    }
}
