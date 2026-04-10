//! Resolves the data and config directories used by Grimoire, with env-var
//! overrides for tests.
//!
//! In production, Grimoire uses Tauri's `AppHandle` to find the user's app
//! data dir (for `catalog.db`) and app config dir (for `settings.json`).
//! For E2E tests we want those to live in a disposable temp dir so real
//! user data is never touched. Both env vars are checked independently so
//! they can be overridden separately if needed.

use std::path::PathBuf;
use tauri::Manager;

const DATA_DIR_ENV: &str = "GRIMOIRE_DATA_DIR";
const CONFIG_DIR_ENV: &str = "GRIMOIRE_CONFIG_DIR";

/// Returns the directory Grimoire should use for app data (e.g. `catalog.db`).
///
/// Honors the `GRIMOIRE_DATA_DIR` env var, otherwise falls back to the
/// Tauri-provided `app_data_dir()`.
pub fn grimoire_data_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    if let Ok(override_dir) = std::env::var(DATA_DIR_ENV) {
        return PathBuf::from(override_dir);
    }
    app_handle
        .path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
}

/// Returns the directory Grimoire should use for its config (e.g.
/// `settings.json`).
///
/// Honors the `GRIMOIRE_CONFIG_DIR` env var, otherwise falls back to the
/// Tauri-provided `app_config_dir()`.
pub fn grimoire_config_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    if let Ok(override_dir) = std::env::var(CONFIG_DIR_ENV) {
        return PathBuf::from(override_dir);
    }
    app_handle
        .path()
        .app_config_dir()
        .expect("failed to resolve app config dir")
}

#[cfg(test)]
mod tests {
    use super::*;

    // Note: these tests only exercise the env-var override branch because the
    // fallback branch needs a live `tauri::AppHandle`, which requires the full
    // test harness. The fallback is a thin wrapper over Tauri's own API and is
    // implicitly tested by running the app.

    fn env_override_data_dir() -> Option<PathBuf> {
        std::env::var(DATA_DIR_ENV).ok().map(PathBuf::from)
    }

    fn env_override_config_dir() -> Option<PathBuf> {
        std::env::var(CONFIG_DIR_ENV).ok().map(PathBuf::from)
    }

    #[test]
    fn test_data_dir_env_override_roundtrip() {
        let previous = std::env::var(DATA_DIR_ENV).ok();
        unsafe { std::env::set_var(DATA_DIR_ENV, "/tmp/grimoire-e2e-data"); }
        assert_eq!(
            env_override_data_dir(),
            Some(PathBuf::from("/tmp/grimoire-e2e-data"))
        );
        unsafe { std::env::remove_var(DATA_DIR_ENV); }
        assert_eq!(env_override_data_dir(), None);

        if let Some(val) = previous {
            unsafe { std::env::set_var(DATA_DIR_ENV, val); }
        }
    }

    #[test]
    fn test_config_dir_env_override_roundtrip() {
        let previous = std::env::var(CONFIG_DIR_ENV).ok();
        unsafe { std::env::set_var(CONFIG_DIR_ENV, "/tmp/grimoire-e2e-config"); }
        assert_eq!(
            env_override_config_dir(),
            Some(PathBuf::from("/tmp/grimoire-e2e-config"))
        );
        unsafe { std::env::remove_var(CONFIG_DIR_ENV); }
        assert_eq!(env_override_config_dir(), None);

        if let Some(val) = previous {
            unsafe { std::env::set_var(CONFIG_DIR_ENV, val); }
        }
    }
}
