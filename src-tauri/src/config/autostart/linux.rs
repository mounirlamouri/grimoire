//! Linux backend: an XDG autostart `.desktop` file.

use std::fs;
use std::io;
use std::path::PathBuf;

use super::desktop_entry::{desktop_entry_status, desktop_exec_value, render_desktop_entry};
use super::{AutostartEntry, AutostartStatus};

/// Directory holding autostart entries. Injectable so tests never touch the
/// real `~/.config/autostart`.
pub struct Location {
    pub autostart_dir: PathBuf,
}

impl Location {
    /// `$XDG_CONFIG_HOME/autostart`, falling back to `~/.config/autostart`.
    pub fn current() -> Result<Self, String> {
        ::dirs::config_dir()
            .map(|dir| Self {
                autostart_dir: dir.join("autostart"),
            })
            .ok_or_else(|| "Could not determine the user config directory".to_string())
    }

    fn entry_path(&self, name: &str) -> PathBuf {
        self.autostart_dir.join(format!("{}.desktop", name))
    }
}

pub fn status(location: &Location, name: &str) -> Result<AutostartStatus, String> {
    Ok(match read_entry(location, name)? {
        Some(contents) => desktop_entry_status(&contents),
        None => AutostartStatus::Disabled,
    })
}

pub fn enable(location: &Location, entry: &AutostartEntry) -> Result<(), String> {
    fs::create_dir_all(&location.autostart_dir).map_err(|e| {
        format!("Failed to create {}: {}", location.autostart_dir.display(), e)
    })?;
    write_entry(location, entry)
}

pub fn disable(location: &Location, name: &str) -> Result<(), String> {
    let path = location.entry_path(name);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Failed to remove {}: {}", path.display(), e)),
    }
}

/// Rewrites an enabled entry whose `Exec` line no longer matches. Entries the
/// desktop has disabled are left alone, since rewriting would re-enable them.
pub fn refresh_if_stale(location: &Location, entry: &AutostartEntry) -> Result<bool, String> {
    let Some(contents) = read_entry(location, &entry.name)? else {
        return Ok(false);
    };
    if desktop_entry_status(&contents) != AutostartStatus::Enabled {
        return Ok(false);
    }
    let expected = render_desktop_entry(entry);
    if desktop_exec_value(&contents) == desktop_exec_value(&expected) {
        return Ok(false);
    }
    write_entry(location, entry)?;
    Ok(true)
}

fn read_entry(location: &Location, name: &str) -> Result<Option<String>, String> {
    let path = location.entry_path(name);
    match fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read {}: {}", path.display(), e)),
    }
}

/// Writes via a temp file + rename so a crash never leaves a truncated entry.
fn write_entry(location: &Location, entry: &AutostartEntry) -> Result<(), String> {
    let path = location.entry_path(&entry.name);
    let tmp = location
        .autostart_dir
        .join(format!(".{}.desktop.tmp", entry.name));
    fs::write(&tmp, render_desktop_entry(entry))
        .and_then(|()| fs::rename(&tmp, &path))
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const NAME: &str = "grimoire-test";

    fn location(dir: &TempDir) -> Location {
        Location {
            autostart_dir: dir.path().join("autostart"),
        }
    }

    fn entry(exe: &str) -> AutostartEntry {
        AutostartEntry {
            name: NAME.to_string(),
            exe_path: PathBuf::from(exe),
            args: vec!["--autostart".to_string()],
        }
    }

    fn contents(loc: &Location) -> String {
        fs::read_to_string(loc.entry_path(NAME)).unwrap()
    }

    #[test]
    fn test_status_disabled_when_missing() {
        let dir = TempDir::new().unwrap();
        assert_eq!(status(&location(&dir), NAME).unwrap(), AutostartStatus::Disabled);
    }

    #[test]
    fn test_enable_creates_dir_and_file() {
        let dir = TempDir::new().unwrap();
        let loc = location(&dir);
        let e = entry("/home/u/My Apps/Grimoire.AppImage");
        enable(&loc, &e).unwrap();

        assert_eq!(contents(&loc), render_desktop_entry(&e));
        assert_eq!(status(&loc, NAME).unwrap(), AutostartStatus::Enabled);
        let names: Vec<_> = fs::read_dir(&loc.autostart_dir)
            .unwrap()
            .map(|f| f.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(names, vec![format!("{}.desktop", NAME)], "no temp file left behind");
    }

    #[test]
    fn test_disable_removes_file_and_is_idempotent() {
        let dir = TempDir::new().unwrap();
        let loc = location(&dir);
        enable(&loc, &entry("/usr/bin/grimoire")).unwrap();

        disable(&loc, NAME).unwrap();
        assert!(!loc.entry_path(NAME).exists());
        assert_eq!(status(&loc, NAME).unwrap(), AutostartStatus::Disabled);

        disable(&loc, NAME).unwrap();
    }

    #[test]
    fn test_desktop_disabled_entry_and_enable_reenables() {
        let dir = TempDir::new().unwrap();
        let loc = location(&dir);
        enable(&loc, &entry("/usr/bin/grimoire")).unwrap();
        let disabled = contents(&loc).replace(
            "X-GNOME-Autostart-enabled=true",
            "X-GNOME-Autostart-enabled=false",
        );
        fs::write(loc.entry_path(NAME), disabled).unwrap();
        assert_eq!(status(&loc, NAME).unwrap(), AutostartStatus::DisabledBySystem);

        enable(&loc, &entry("/usr/bin/grimoire")).unwrap();
        assert_eq!(status(&loc, NAME).unwrap(), AutostartStatus::Enabled);
    }

    #[test]
    fn test_refresh_rewrites_stale_exec() {
        let dir = TempDir::new().unwrap();
        let loc = location(&dir);
        enable(&loc, &entry("/home/u/Old/Grimoire.AppImage")).unwrap();

        let current = entry("/home/u/New/Grimoire.AppImage");
        assert!(refresh_if_stale(&loc, &current).unwrap());
        assert_eq!(contents(&loc), render_desktop_entry(&current));
    }

    #[test]
    fn test_refresh_noop_when_current() {
        let dir = TempDir::new().unwrap();
        let loc = location(&dir);
        let e = entry("/usr/bin/grimoire");
        enable(&loc, &e).unwrap();

        assert!(!refresh_if_stale(&loc, &e).unwrap());
    }

    #[test]
    fn test_refresh_does_not_create_missing_entry() {
        let dir = TempDir::new().unwrap();
        let loc = location(&dir);

        assert!(!refresh_if_stale(&loc, &entry("/usr/bin/grimoire")).unwrap());
        assert!(!loc.entry_path(NAME).exists());
    }

    #[test]
    fn test_refresh_keeps_system_disabled_entry() {
        let dir = TempDir::new().unwrap();
        let loc = location(&dir);
        enable(&loc, &entry("/home/u/Old/Grimoire.AppImage")).unwrap();
        let disabled = format!("{}Hidden=true\n", contents(&loc));
        fs::write(loc.entry_path(NAME), &disabled).unwrap();

        assert!(!refresh_if_stale(&loc, &entry("/home/u/New/Grimoire.AppImage")).unwrap());
        assert_eq!(contents(&loc), disabled);
    }
}
