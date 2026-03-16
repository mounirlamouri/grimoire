use crate::addon::installer;
use crate::config::{paths, settings};
use crate::db;
use crate::esoui::api::EsoUiClient;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, serde::Serialize)]
pub struct InstallProgress {
    pub stage: String,
    pub detail: String,
}

/// Install an addon by its UID from the catalog.
/// Fetches addon details to get the download URL, downloads the ZIP,
/// and extracts it into the AddOns folder.
#[tauri::command]
pub async fn install_addon(app_handle: tauri::AppHandle, uid: String) -> Result<Vec<String>, String> {
    let addon_path = settings::load_settings(&app_handle)
        .addon_path
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| paths::detect_addon_path())
        .ok_or("ESO addon path not configured. Go to Settings to set it.")?;

    let _ = app_handle.emit(
        "install-progress",
        InstallProgress {
            stage: "details".to_string(),
            detail: "Fetching addon info...".to_string(),
        },
    );

    // Fetch addon details to get the download URL
    let mut client = EsoUiClient::new();
    client.init().await?;

    let details_list = client.fetch_addon_details(&uid).await?;
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
            detail: "Downloading addon...".to_string(),
        },
    );

    // Download the ZIP
    log::info!("Downloading addon {} from {}", uid, download_url);
    let zip_bytes = client.download_addon(download_url).await?;
    log::info!("Downloaded {} bytes for addon {}", zip_bytes.len(), uid);

    let _ = app_handle.emit(
        "install-progress",
        InstallProgress {
            stage: "extract".to_string(),
            detail: "Extracting files...".to_string(),
        },
    );

    // Extract to AddOns folder
    log::info!("Extracting addon {} to {}", uid, addon_path.display());
    let installed_dirs = installer::install_from_zip(&zip_bytes, &addon_path)?;
    log::info!("Extracted addon {} dirs: {:?}", uid, installed_dirs);

    // Record installed version so update checking knows we have the latest
    let catalog_version = details.ui_version.as_deref().unwrap_or("");
    let db_state = app_handle.state::<Mutex<Connection>>();
    if let Ok(conn) = db_state.lock() {
        for dir in &installed_dirs {
            let _ = db::record_installed_version(&conn, dir, &uid, catalog_version);
        }
    }

    let _ = app_handle.emit(
        "install-progress",
        InstallProgress {
            stage: "done".to_string(),
            detail: format!("Installed: {}", installed_dirs.join(", ")),
        },
    );

    Ok(installed_dirs)
}

/// Update an addon — same as install (downloads latest ZIP and overwrites).
#[tauri::command]
pub async fn update_addon(app_handle: tauri::AppHandle, uid: String) -> Result<Vec<String>, String> {
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
