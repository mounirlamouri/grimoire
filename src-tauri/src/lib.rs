mod addon;
mod commands;
mod config;
mod db;
mod esoui;
mod resolver;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Initialize SQLite database
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir).ok();
            let db_path = app_dir.join("catalog.db");
            let conn = db::open_db(&db_path)
                .expect("failed to open catalog database");
            app.manage(Mutex::new(conn));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::addons::get_installed_addons,
            commands::addons::find_orphaned_libraries,
            commands::catalog::sync_catalog,
            commands::catalog::get_catalog_status,
            commands::catalog::search_addons,
            commands::settings::get_addon_path,
            commands::settings::set_addon_path,
            commands::settings::get_sync_interval,
            commands::settings::set_sync_interval,
            commands::updates::check_for_updates,
            commands::install::install_addon,
            commands::install::update_addon,
            commands::install::uninstall_addon,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
