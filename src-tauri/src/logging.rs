//! File logging. Every build writes a size-bounded, rotating log file under
//! `<data dir>/logs` so bug reports have something to go on; debug builds
//! also log to stdout.

use std::path::{Path, PathBuf};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

/// Base name of the active log file (`grimoire.log`). Rotated files get a
/// timestamp suffix, e.g. `grimoire_2026-01-31_12-00-00.log`.
pub const LOG_FILE_NAME: &str = "grimoire";

/// Size at which the active log file is rotated.
const MAX_LOG_FILE_BYTES: u128 = 2 * 1024 * 1024;

/// Rotated files kept next to the active one, so at most 5 files (~10 MB).
/// Must be at least 1: the plugin computes `keep - 1` when rotating.
const KEPT_ROTATED_FILES: usize = 4;
const _: () = assert!(KEPT_ROTATED_FILES > 0);

/// Returns the logs folder inside Grimoire's data dir.
pub fn log_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("logs")
}

/// Creates the logs folder if needed and returns its path.
pub fn ensure_log_dir(data_dir: &Path) -> Result<PathBuf, String> {
    let dir = log_dir(data_dir);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create logs folder {}: {}", dir.display(), e))?;
    Ok(dir)
}

/// Where log records go: the rotating file in `log_dir`, plus stdout when
/// `include_stdout` is set (debug builds).
fn log_targets(log_dir: &Path, include_stdout: bool) -> Vec<TargetKind> {
    let mut targets = Vec::new();
    if include_stdout {
        targets.push(TargetKind::Stdout);
    }
    targets.push(TargetKind::Folder {
        path: log_dir.to_path_buf(),
        file_name: Some(LOG_FILE_NAME.to_string()),
    });
    targets
}

/// Builds the log plugin writing to `log_dir`. The plugin creates the folder.
pub fn plugin<R: tauri::Runtime>(log_dir: &Path) -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets(
            log_targets(log_dir, cfg!(debug_assertions))
                .into_iter()
                .map(Target::new),
        )
        .level(log::LevelFilter::Info)
        .max_file_size(MAX_LOG_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(KEPT_ROTATED_FILES))
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_dir_is_under_data_dir() {
        let data_dir = Path::new("grimoire-data");
        assert_eq!(log_dir(data_dir), data_dir.join("logs"));
    }

    #[test]
    fn ensure_log_dir_creates_missing_folders() {
        let tmp = tempfile::tempdir().unwrap();
        let data_dir = tmp.path().join("not-yet-created");

        let dir = ensure_log_dir(&data_dir).unwrap();

        assert_eq!(dir, data_dir.join("logs"));
        assert!(dir.is_dir());
    }

    #[test]
    fn ensure_log_dir_keeps_existing_logs() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = ensure_log_dir(tmp.path()).unwrap();
        let log_file = dir.join("grimoire.log");
        std::fs::write(&log_file, "existing entry\n").unwrap();

        assert_eq!(ensure_log_dir(tmp.path()).unwrap(), dir);
        assert_eq!(
            std::fs::read_to_string(&log_file).unwrap(),
            "existing entry\n"
        );
    }

    #[test]
    fn ensure_log_dir_reports_unusable_path() {
        let tmp = tempfile::tempdir().unwrap();
        // A file where the logs folder should be.
        std::fs::write(tmp.path().join("logs"), "").unwrap();

        let err = ensure_log_dir(tmp.path()).unwrap_err();

        assert!(err.starts_with("Failed to create logs folder"), "{}", err);
    }

    #[test]
    fn release_targets_only_write_the_log_file() {
        let dir = Path::new("data").join("logs");
        let targets = log_targets(&dir, false);

        assert_eq!(targets.len(), 1);
        assert!(matches!(
            &targets[0],
            TargetKind::Folder { path, file_name: Some(name) }
                if *path == dir && name == LOG_FILE_NAME
        ));
    }

    #[test]
    fn debug_targets_also_log_to_stdout() {
        let dir = Path::new("data").join("logs");
        let targets = log_targets(&dir, true);

        assert_eq!(targets.len(), 2);
        assert!(matches!(targets[0], TargetKind::Stdout));
        assert!(matches!(
            &targets[1],
            TargetKind::Folder { path, file_name: Some(name) }
                if *path == dir && name == LOG_FILE_NAME
        ));
    }
}
