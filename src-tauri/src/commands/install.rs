use crate::addon::{installer, manifest};
use crate::config::{paths, settings};
use crate::db;
use crate::esoui::api::EsoUiClient;
use rusqlite::Connection;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, serde::Serialize)]
pub struct InstallProgress {
    pub stage: String,
    pub detail: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct InstallResult {
    pub installed_dirs: Vec<String>,
    pub auto_installed_deps: Vec<AutoInstalledDep>,
    pub missing_deps: Vec<String>,
    pub failed_deps: Vec<FailedDep>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AutoInstalledDep {
    pub dir_name: String,
    pub name: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FailedDep {
    pub dir_name: String,
    pub error: String,
}

/// Resolve the addon path, initialize the ESOUI client, and seed the visited set.
/// Shared setup for install_addon and batch import.
pub async fn prepare_install_context(
    app_handle: &tauri::AppHandle,
) -> Result<(PathBuf, EsoUiClient, HashSet<String>), String> {
    let addon_path = settings::load_settings(app_handle)
        .addon_path
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| paths::detect_addon_path())
        .ok_or("ESO addon path not configured. Go to Settings to set it.")?;

    let mut client = EsoUiClient::new();
    client.init().await?;

    let mut visited: HashSet<String> = HashSet::new();
    if let Ok(entries) = std::fs::read_dir(&addon_path) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                visited.insert(entry.file_name().to_string_lossy().to_string());
            }
        }
    }

    Ok((addon_path, client, visited))
}

/// Install an addon by its UID from the catalog.
/// After installing, resolves and auto-installs missing dependencies.
#[tauri::command]
pub async fn install_addon(
    app_handle: tauri::AppHandle,
    uid: String,
) -> Result<InstallResult, String> {
    let (addon_path, mut client, mut visited) = prepare_install_context(&app_handle).await?;
    install_addon_internal(&app_handle, &mut client, &addon_path, &uid, &mut visited).await
}

/// Internal recursive install function that resolves dependencies.
pub fn install_addon_internal<'a>(
    app_handle: &'a tauri::AppHandle,
    client: &'a mut EsoUiClient,
    addon_path: &'a Path,
    uid: &'a str,
    visited: &'a mut HashSet<String>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<InstallResult, String>> + Send + 'a>> {
    Box::pin(async move {
    let _ = app_handle.emit(
        "install-progress",
        InstallProgress {
            stage: "details".to_string(),
            detail: "Fetching addon info...".to_string(),
        },
    );

    let details_list = client.fetch_addon_details(uid).await?;
    let details = details_list
        .first()
        .ok_or_else(|| format!("No details found for addon {}", uid))?;

    let download_url = details
        .ui_download
        .as_ref()
        .filter(|u| !u.is_empty())
        .ok_or_else(|| format!("No download URL available for {}", details.ui_name))?;

    let _ = app_handle.emit(
        "install-progress",
        InstallProgress {
            stage: "download".to_string(),
            detail: format!("Downloading {}...", details.ui_name),
        },
    );

    let zip_bytes = client.download_addon(download_url).await?;

    let _ = app_handle.emit(
        "install-progress",
        InstallProgress {
            stage: "extract".to_string(),
            detail: format!("Extracting {}...", details.ui_name),
        },
    );

    let installed_dirs = installer::install_from_zip(&zip_bytes, addon_path)?;

    // Record installed version + catalog date
    let catalog_version = details.ui_version.as_deref().unwrap_or("");
    let db_state = app_handle.state::<Mutex<Connection>>();
    if let Ok(conn) = db_state.lock() {
        let catalog_date = db::lookup_catalog_date(&conn, uid).unwrap_or(None);
        for dir in &installed_dirs {
            let _ = db::record_installed_version(&conn, dir, uid, catalog_version, catalog_date);
        }
    }

    // Mark these dirs as visited
    for dir in &installed_dirs {
        visited.insert(dir.clone());
    }

    // Collect dependencies from all installed manifests
    let mut all_deps = Vec::new();
    for dir in &installed_dirs {
        if let Some(addon) = manifest::parse_single_manifest(addon_path, dir) {
            all_deps.extend(addon.depends_on);
        }
    }

    // Find missing dependencies (not on disk and not already visited)
    let missing: Vec<_> = all_deps
        .iter()
        .filter(|dep| !visited.contains(&dep.name) && !addon_path.join(&dep.name).is_dir())
        .collect();

    let mut result = InstallResult {
        installed_dirs,
        auto_installed_deps: Vec::new(),
        missing_deps: Vec::new(),
        failed_deps: Vec::new(),
    };

    if missing.is_empty() {
        let _ = app_handle.emit(
            "install-progress",
            InstallProgress {
                stage: "done".to_string(),
                detail: format!("Installed: {}", result.installed_dirs.join(", ")),
            },
        );
        return Ok(result);
    }

    let _ = app_handle.emit(
        "install-progress",
        InstallProgress {
            stage: "deps".to_string(),
            detail: format!("Resolving {} dependencies...", missing.len()),
        },
    );

    for (i, dep) in missing.iter().enumerate() {
        // Mark as visited to prevent cycles
        visited.insert(dep.name.clone());

        // Look up UID in catalog
        let dep_uid = {
            let db_state = app_handle.state::<Mutex<Connection>>();
            let conn = db_state.lock().map_err(|e| format!("DB lock error: {}", e))?;
            db::lookup_by_dir_name(&conn, &dep.name)?
                .map(|(_, uid, _, _)| uid)
        };

        let Some(dep_uid) = dep_uid else {
            result.missing_deps.push(dep.name.clone());
            continue;
        };

        let _ = app_handle.emit(
            "install-progress",
            InstallProgress {
                stage: "dep-install".to_string(),
                detail: format!(
                    "Installing dependency: {} ({}/{})",
                    dep.name,
                    i + 1,
                    missing.len()
                ),
            },
        );

        match install_addon_internal(app_handle, client, addon_path, &dep_uid, visited).await {
            Ok(dep_result) => {
                result.auto_installed_deps.push(AutoInstalledDep {
                    dir_name: dep.name.clone(),
                    name: dep.name.clone(),
                });
                // Propagate any nested dep issues
                result.auto_installed_deps.extend(dep_result.auto_installed_deps);
                result.missing_deps.extend(dep_result.missing_deps);
                result.failed_deps.extend(dep_result.failed_deps);
            }
            Err(e) => {
                result.failed_deps.push(FailedDep {
                    dir_name: dep.name.clone(),
                    error: e,
                });
            }
        }
    }

    let _ = app_handle.emit(
        "install-progress",
        InstallProgress {
            stage: "done".to_string(),
            detail: format!("Installed: {}", result.installed_dirs.join(", ")),
        },
    );

    Ok(result)
    }) // close Box::pin(async move { ... })
}

/// Update an addon — same as install (downloads latest ZIP and overwrites).
#[tauri::command]
pub async fn update_addon(
    app_handle: tauri::AppHandle,
    uid: String,
) -> Result<InstallResult, String> {
    install_addon(app_handle, uid).await
}

/// Install missing dependencies for an addon, given a list of dir_names.
/// Looks up each dir_name in the catalog to find its UID, then installs it.
#[tauri::command]
pub async fn install_missing_deps(
    app_handle: tauri::AppHandle,
    dir_names: Vec<String>,
) -> Result<InstallResult, String> {
    let mut result = InstallResult {
        installed_dirs: Vec::new(),
        auto_installed_deps: Vec::new(),
        missing_deps: Vec::new(),
        failed_deps: Vec::new(),
    };

    for dir_name in &dir_names {
        // Look up UID in catalog
        let dep_uid = {
            let db_state = app_handle.state::<Mutex<Connection>>();
            let conn = db_state.lock().map_err(|e| format!("DB lock error: {}", e))?;
            db::lookup_by_dir_name(&conn, dir_name)?
                .map(|(_, uid, _, _)| uid)
        };

        let Some(uid) = dep_uid else {
            result.missing_deps.push(dir_name.clone());
            continue;
        };

        match install_addon(app_handle.clone(), uid).await {
            Ok(sub) => {
                result.installed_dirs.extend(sub.installed_dirs);
                result.auto_installed_deps.push(AutoInstalledDep {
                    dir_name: dir_name.clone(),
                    name: dir_name.clone(),
                });
                result.auto_installed_deps.extend(sub.auto_installed_deps);
                result.missing_deps.extend(sub.missing_deps);
                result.failed_deps.extend(sub.failed_deps);
            }
            Err(e) => {
                result.failed_deps.push(FailedDep {
                    dir_name: dir_name.clone(),
                    error: e,
                });
            }
        }
    }

    Ok(result)
}

/// Parse an ESOUI URL and extract the addon UID.
/// Accepts URLs like `https://www.esoui.com/downloads/info1234.html`
/// or `https://www.esoui.com/downloads/info1234-SomeAddon.html`.
fn parse_esoui_url(url: &str) -> Result<String, String> {
    use std::sync::LazyLock;
    static RE: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"esoui\.com/downloads/info(\d+)").unwrap());
    let caps = RE
        .captures(url)
        .ok_or_else(|| format!("Could not find an addon ID in the URL: {}", url))?;
    Ok(caps[1].to_string())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct UrlInstallResult {
    pub addon_name: String,
    pub already_installed: bool,
    #[serde(flatten)]
    pub install: Option<InstallResult>,
}

/// Install an addon by its ESOUI page URL.
#[tauri::command]
pub async fn install_addon_by_url(
    app_handle: tauri::AppHandle,
    url: String,
) -> Result<UrlInstallResult, String> {
    let uid = parse_esoui_url(&url)?;

    // Look up the addon name and directories from the catalog
    let (catalog_name, directories) = {
        let db_state = app_handle.state::<Mutex<Connection>>();
        let conn = db_state.lock().map_err(|e| format!("DB lock error: {}", e))?;
        let name = db::lookup_catalog_name_by_uid(&conn, &uid)?;
        let dirs = db::lookup_directories_by_uid(&conn, &uid)?;
        (name, dirs)
    };

    // Check if the addon is already installed
    if let Some(ref dirs) = directories {
        let addon_path = settings::load_settings(&app_handle)
            .addon_path
            .map(PathBuf::from)
            .filter(|p| p.is_dir())
            .or_else(|| paths::detect_addon_path());

        if let Some(addon_path) = addon_path {
            let is_installed = dirs
                .split(',')
                .any(|d| addon_path.join(d.trim()).is_dir());
            if is_installed {
                return Ok(UrlInstallResult {
                    addon_name: catalog_name.unwrap_or_else(|| format!("Addon {}", uid)),
                    already_installed: true,
                    install: None,
                });
            }
        }
    }

    let install = install_addon(app_handle.clone(), uid).await?;

    // Use catalog name if available, otherwise read from the installed manifest
    let addon_name = catalog_name.unwrap_or_else(|| {
        let addon_path = settings::load_settings(&app_handle)
            .addon_path
            .map(PathBuf::from)
            .filter(|p| p.is_dir())
            .or_else(|| paths::detect_addon_path());
        if let Some(addon_path) = addon_path {
            if let Some(dir) = install.installed_dirs.first() {
                if let Some(addon) = manifest::parse_single_manifest(&addon_path, dir) {
                    return addon.title;
                }
            }
        }
        format!("Addon {}", url)
    });

    Ok(UrlInstallResult { addon_name, already_installed: false, install: Some(install) })
}

/// Uninstall an addon by removing its directory from the AddOns folder.
#[tauri::command]
pub fn uninstall_addon(app_handle: tauri::AppHandle, dir_name: String) -> Result<(), String> {
    let addon_path = settings::load_settings(&app_handle)
        .addon_path
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| paths::detect_addon_path())
        .ok_or("ESO addon path not configured. Go to Settings to set it.")?;

    installer::uninstall_addon(&addon_path, &dir_name)?;

    // Clean up installed version record
    let db_state = app_handle.state::<Mutex<Connection>>();
    if let Ok(conn) = db_state.lock() {
        let _ = db::remove_installed_version(&conn, &dir_name);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_esoui_url_standard() {
        assert_eq!(parse_esoui_url("https://www.esoui.com/downloads/info1234.html").unwrap(), "1234");
    }

    #[test]
    fn parse_esoui_url_with_addon_name() {
        assert_eq!(
            parse_esoui_url("https://www.esoui.com/downloads/info2501-LibAddonMenu.html").unwrap(),
            "2501"
        );
    }

    #[test]
    fn parse_esoui_url_no_scheme() {
        assert_eq!(
            parse_esoui_url("esoui.com/downloads/info999.html").unwrap(),
            "999"
        );
    }

    #[test]
    fn parse_esoui_url_invalid() {
        assert!(parse_esoui_url("https://google.com").is_err());
    }

    #[test]
    fn parse_esoui_url_no_id() {
        assert!(parse_esoui_url("https://www.esoui.com/downloads/info.html").is_err());
    }

    #[test]
    fn parse_esoui_url_empty() {
        assert!(parse_esoui_url("").is_err());
    }

    #[test]
    fn parse_esoui_url_just_a_number() {
        assert!(parse_esoui_url("1234").is_err());
    }

    #[test]
    fn parse_esoui_url_with_query_and_fragment() {
        assert_eq!(
            parse_esoui_url("https://www.esoui.com/downloads/info1234-Addon.html?ref=foo#comments").unwrap(),
            "1234"
        );
    }

    #[test]
    fn parse_esoui_url_http_scheme() {
        assert_eq!(
            parse_esoui_url("http://www.esoui.com/downloads/info5678.html").unwrap(),
            "5678"
        );
    }

    #[test]
    fn parse_esoui_url_leading_zeros() {
        assert_eq!(
            parse_esoui_url("https://www.esoui.com/downloads/info0042.html").unwrap(),
            "0042"
        );
    }
}
