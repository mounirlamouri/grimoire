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

/// Install an addon by its UID from the catalog.
/// After installing, resolves and auto-installs missing dependencies.
#[tauri::command]
pub async fn install_addon(
    app_handle: tauri::AppHandle,
    uid: String,
) -> Result<InstallResult, String> {
    let addon_path = settings::load_settings(&app_handle)
        .addon_path
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| paths::detect_addon_path())
        .ok_or("ESO addon path not configured. Go to Settings to set it.")?;

    let mut client = EsoUiClient::new();
    client.init().await?;

    // Seed visited set with all currently installed dir names
    let mut visited: HashSet<String> = HashSet::new();
    if let Ok(entries) = std::fs::read_dir(&addon_path) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                visited.insert(entry.file_name().to_string_lossy().to_string());
            }
        }
    }

    install_addon_internal(&app_handle, &mut client, &addon_path, &uid, &mut visited).await
}

/// Internal recursive install function that resolves dependencies.
fn install_addon_internal<'a>(
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

    // Record installed version
    let catalog_version = details.ui_version.as_deref().unwrap_or("");
    let db_state = app_handle.state::<Mutex<Connection>>();
    if let Ok(conn) = db_state.lock() {
        for dir in &installed_dirs {
            let _ = db::record_installed_version(&conn, dir, uid, catalog_version);
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
                .map(|(_, uid, _)| uid)
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
