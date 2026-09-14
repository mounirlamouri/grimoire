//! Per-user "launch at login" registration.
//!
//! - Windows: a value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
//!   plus the Task Manager override under `...\Explorer\StartupApproved\Run`.
//! - Linux: an XDG autostart `.desktop` file in `$XDG_CONFIG_HOME/autostart`.
//!
//! The OS entry is the source of truth for whether autostart is on, so the
//! Settings page stays accurate when the user toggles it from Task Manager or
//! their desktop's autostart settings. Only the "start minimized" preference
//! lives in `settings.json`.
//!
//! The registered command always carries `--autostart`; at launch the app
//! combines that flag with the setting to decide whether to stay in the tray.

use serde::Serialize;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

#[cfg(any(target_os = "linux", test))]
mod desktop_entry;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(any(windows, test))]
mod run_key;
#[cfg(windows)]
mod windows;

#[cfg(target_os = "linux")]
use self::linux as platform;
#[cfg(windows)]
use self::windows as platform;

/// Command-line flag passed by the OS autostart entry.
pub const AUTOSTART_ARG: &str = "--autostart";

const NAME_ENV: &str = "GRIMOIRE_AUTOSTART_NAME";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AutostartStatus {
    Enabled,
    Disabled,
    /// The entry exists but the OS or desktop environment has turned it off
    /// (Windows Task Manager, GNOME Tweaks, KDE autostart settings).
    DisabledBySystem,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AutostartEntry {
    /// Registry value name (Windows) or `.desktop` file stem (Linux).
    pub name: String,
    pub exe_path: PathBuf,
    pub args: Vec<String>,
}

impl AutostartEntry {
    /// Builds the entry for the currently running executable.
    pub fn for_current_exe() -> Result<Self, String> {
        let exe = std::env::current_exe()
            .map_err(|e| format!("Failed to resolve Grimoire executable path: {}", e))?;
        // The AppImage runtime sets APPIMAGE to the .AppImage file and APPDIR
        // to the mount point the binary actually runs from.
        let appimage = std::env::var_os("APPIMAGE");
        let appdir = std::env::var_os("APPDIR");
        Ok(Self {
            name: entry_name(),
            exe_path: resolve_launch_path(&exe, appimage.as_deref(), appdir.as_deref()),
            args: vec![AUTOSTART_ARG.to_string()],
        })
    }
}

/// Name of the autostart entry: `$GRIMOIRE_AUTOSTART_NAME` if set (used by
/// E2E tests), otherwise `grimoire-dev` for debug builds so `cargo tauri dev`
/// never overwrites the installed app's `grimoire` entry.
pub fn entry_name() -> String {
    entry_name_from(
        std::env::var(NAME_ENV).ok().as_deref(),
        cfg!(debug_assertions),
    )
}

fn entry_name_from(override_name: Option<&str>, debug_build: bool) -> String {
    if let Some(name) = override_name.filter(|name| is_valid_entry_name(name)) {
        return name.to_string();
    }
    if debug_build { "grimoire-dev" } else { "grimoire" }.to_string()
}

/// Entry names become registry value names and file names, so restrict them
/// to a safe character set.
fn is_valid_entry_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// Returns the path the OS should launch. Inside an AppImage, `current_exe`
/// points into a temporary mount, so the `.AppImage` file itself is used
/// instead. The APPIMAGE variable is only trusted when this process really
/// runs from that mount, since child processes can inherit it.
pub fn resolve_launch_path(
    current_exe: &Path,
    appimage: Option<&OsStr>,
    appdir: Option<&OsStr>,
) -> PathBuf {
    match (appimage, appdir) {
        (Some(image), Some(dir))
            if !image.is_empty() && !dir.is_empty() && current_exe.starts_with(dir) =>
        {
            PathBuf::from(image)
        }
        _ => current_exe.to_path_buf(),
    }
}

/// Whether the main window should stay hidden at startup.
pub fn should_start_hidden(args: &[String], start_minimized_on_autostart: bool) -> bool {
    start_minimized_on_autostart && args.iter().any(|arg| arg == AUTOSTART_ARG)
}

pub fn status(name: &str) -> Result<AutostartStatus, String> {
    platform::status(&platform::Location::current()?, name)
}

pub fn enable(entry: &AutostartEntry) -> Result<(), String> {
    platform::enable(&platform::Location::current()?, entry)
}

pub fn disable(name: &str) -> Result<(), String> {
    platform::disable(&platform::Location::current()?, name)
}

/// If an entry already exists but launches a different command (e.g. the
/// AppImage was moved), rewrites it. Never creates an entry and never
/// re-enables one the system has disabled. Returns whether it rewrote.
pub fn refresh_if_stale(entry: &AutostartEntry) -> Result<bool, String> {
    platform::refresh_if_stale(&platform::Location::current()?, entry)
}

#[cfg(not(any(windows, target_os = "linux")))]
mod platform {
    use super::{AutostartEntry, AutostartStatus};

    const UNSUPPORTED: &str = "Launch at login is only supported on Windows and Linux";

    pub struct Location;

    impl Location {
        pub fn current() -> Result<Self, String> {
            Err(UNSUPPORTED.to_string())
        }
    }

    pub fn status(_: &Location, _: &str) -> Result<AutostartStatus, String> {
        Err(UNSUPPORTED.to_string())
    }

    pub fn enable(_: &Location, _: &AutostartEntry) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }

    pub fn disable(_: &Location, _: &str) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }

    pub fn refresh_if_stale(_: &Location, _: &AutostartEntry) -> Result<bool, String> {
        Err(UNSUPPORTED.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|v| v.to_string()).collect()
    }

    #[test]
    fn test_entry_name_release_and_debug_defaults() {
        assert_eq!(entry_name_from(None, false), "grimoire");
        assert_eq!(entry_name_from(None, true), "grimoire-dev");
    }

    #[test]
    fn test_entry_name_override_wins() {
        assert_eq!(entry_name_from(Some("grimoire-e2e"), false), "grimoire-e2e");
        assert_eq!(entry_name_from(Some("grimoire-e2e"), true), "grimoire-e2e");
    }

    #[test]
    fn test_entry_name_rejects_unsafe_override() {
        for bad in ["", "../evil", "a/b", r"a\b", ".hidden", "has space"] {
            assert_eq!(entry_name_from(Some(bad), false), "grimoire", "override {:?}", bad);
        }
    }

    #[test]
    fn test_resolve_launch_path_uses_appimage_when_running_inside_it() {
        let exe = Path::new("/tmp/.mount_GrimoXYZ/usr/bin/grimoire");
        let path = resolve_launch_path(
            exe,
            Some(OsStr::new("/home/u/My Apps/Grimoire.AppImage")),
            Some(OsStr::new("/tmp/.mount_GrimoXYZ")),
        );
        assert_eq!(path, PathBuf::from("/home/u/My Apps/Grimoire.AppImage"));
    }

    #[test]
    fn test_resolve_launch_path_ignores_inherited_appimage_env() {
        // e.g. a .deb install launched from a terminal opened by another AppImage
        let exe = Path::new("/usr/bin/grimoire");
        let path = resolve_launch_path(
            exe,
            Some(OsStr::new("/home/u/Other.AppImage")),
            Some(OsStr::new("/tmp/.mount_Other")),
        );
        assert_eq!(path, PathBuf::from("/usr/bin/grimoire"));
    }

    #[test]
    fn test_resolve_launch_path_without_appimage_env() {
        let exe = Path::new("/usr/bin/grimoire");
        assert_eq!(resolve_launch_path(exe, None, None), exe);
        assert_eq!(
            resolve_launch_path(exe, Some(OsStr::new("")), Some(OsStr::new(""))),
            exe
        );
        assert_eq!(
            resolve_launch_path(exe, Some(OsStr::new("/home/u/G.AppImage")), None),
            exe
        );
    }

    #[test]
    fn test_should_start_hidden() {
        let autostart = args(&["grimoire", "--autostart"]);
        assert!(should_start_hidden(&autostart, true));
        assert!(!should_start_hidden(&autostart, false));
        assert!(!should_start_hidden(&args(&["grimoire"]), true));
        assert!(!should_start_hidden(&args(&["grimoire", "--autostart-other"]), true));
    }

    #[test]
    fn test_status_serializes_snake_case() {
        assert_eq!(serde_json::to_string(&AutostartStatus::Enabled).unwrap(), "\"enabled\"");
        assert_eq!(serde_json::to_string(&AutostartStatus::Disabled).unwrap(), "\"disabled\"");
        assert_eq!(
            serde_json::to_string(&AutostartStatus::DisabledBySystem).unwrap(),
            "\"disabled_by_system\""
        );
    }
}
