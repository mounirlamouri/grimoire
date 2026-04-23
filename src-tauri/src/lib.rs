pub mod addon;
pub mod commands;
mod config;
pub mod db;
mod esoui;
pub mod resolver;
mod tray;

use std::sync::Mutex;
use tauri::Manager;

use crate::config::dirs::grimoire_data_dir;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Initialize SQLite database
            let app_dir = grimoire_data_dir(app.handle());
            std::fs::create_dir_all(&app_dir).ok();
            let db_path = app_dir.join("catalog.db");
            let conn = db::open_db(&db_path)
                .expect("failed to open catalog database");
            app.manage(Mutex::new(conn));
            app.manage(tokio::sync::Mutex::new(esoui::api::EsoUiClient::new()));

            tray::create_tray(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::addons::get_installed_addons,
            commands::addons::find_orphaned_libraries,
            commands::addons::check_catalog_availability,
            commands::catalog::sync_catalog,
            commands::catalog::get_catalog_status,
            commands::catalog::search_addons,
            commands::catalog::fetch_addon_metadata,
            commands::catalog::resolve_uids,
            commands::settings::get_addon_path,
            commands::settings::set_addon_path,
            commands::settings::get_sync_interval,
            commands::settings::set_sync_interval,
            commands::settings::get_staleness_warning_days,
            commands::settings::set_staleness_warning_days,
            commands::settings::get_staleness_error_days,
            commands::settings::set_staleness_error_days,
            commands::settings::get_hide_staleness_warnings,
            commands::settings::set_hide_staleness_warnings,
            commands::settings::get_current_api_version,
            commands::settings::get_catalog_dates,
            commands::settings::get_file_info_urls,
            commands::updates::check_for_updates,
            commands::updates::bootstrap_addon_dates,
            commands::install::install_addon,
            commands::install::install_addon_by_url,
            commands::install::update_addon,
            commands::install::uninstall_addon,
            commands::install::install_missing_deps,
            commands::sharing::export_addon_list,
            commands::sharing::upload_to_paste,
            commands::sharing::fetch_paste,
            commands::sharing::parse_addon_list,
            commands::sharing::import_install_addons,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
