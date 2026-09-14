//! Windows backend: a `HKCU\...\Run` value plus the Task Manager override in
//! `HKCU\...\Explorer\StartupApproved\Run`.

use std::io;

use winreg::enums::{HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE};
use winreg::RegKey;

use super::run_key::{is_startup_approved_disabled, windows_run_command};
use super::{AutostartEntry, AutostartStatus};

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const STARTUP_APPROVED_KEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

/// Registry keys under HKCU holding the entry. Injectable so tests never
/// touch the real Run key.
pub struct Location {
    pub run_key: String,
    pub approved_key: String,
}

impl Location {
    pub fn current() -> Result<Self, String> {
        Ok(Self {
            run_key: RUN_KEY.to_string(),
            approved_key: STARTUP_APPROVED_KEY.to_string(),
        })
    }
}

pub fn status(location: &Location, name: &str) -> Result<AutostartStatus, String> {
    if read_run_command(location, name)?.is_none() {
        return Ok(AutostartStatus::Disabled);
    }
    let approved = match open_key(&location.approved_key, KEY_QUERY_VALUE)? {
        Some(key) => not_found_as_none(key.get_raw_value(name))
            .map_err(|e| registry_error(&location.approved_key, e))?,
        None => None,
    };
    if approved.is_some_and(|value| is_startup_approved_disabled(&value.bytes)) {
        Ok(AutostartStatus::DisabledBySystem)
    } else {
        Ok(AutostartStatus::Enabled)
    }
}

pub fn enable(location: &Location, entry: &AutostartEntry) -> Result<(), String> {
    write_run_command(location, entry)?;
    // Clear a "Disabled" set from Task Manager so turning this on in Grimoire
    // actually takes effect.
    delete_value(&location.approved_key, &entry.name)
}

pub fn disable(location: &Location, name: &str) -> Result<(), String> {
    delete_value(&location.run_key, name)?;
    delete_value(&location.approved_key, name)
}

/// Rewrites an existing Run value whose command no longer matches. The Task
/// Manager override is left alone, so a system-disabled entry stays disabled.
pub fn refresh_if_stale(location: &Location, entry: &AutostartEntry) -> Result<bool, String> {
    match read_run_command(location, &entry.name)? {
        Some(existing) if !existing.eq_ignore_ascii_case(&windows_run_command(entry)) => {
            write_run_command(location, entry)?;
            Ok(true)
        }
        _ => Ok(false),
    }
}

fn read_run_command(location: &Location, name: &str) -> Result<Option<String>, String> {
    match open_key(&location.run_key, KEY_QUERY_VALUE)? {
        Some(key) => not_found_as_none(key.get_value::<String, _>(name))
            .map_err(|e| registry_error(&location.run_key, e)),
        None => Ok(None),
    }
}

fn write_run_command(location: &Location, entry: &AutostartEntry) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey(&location.run_key)
        .map_err(|e| registry_error(&location.run_key, e))?;
    key.set_value(&entry.name, &windows_run_command(entry))
        .map_err(|e| registry_error(&location.run_key, e))
}

fn open_key(path: &str, access: u32) -> Result<Option<RegKey>, String> {
    not_found_as_none(RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(path, access))
        .map_err(|e| registry_error(path, e))
}

fn delete_value(key_path: &str, name: &str) -> Result<(), String> {
    let Some(key) = open_key(key_path, KEY_SET_VALUE)? else {
        return Ok(());
    };
    not_found_as_none(key.delete_value(name))
        .map(|_| ())
        .map_err(|e| registry_error(key_path, e))
}

fn not_found_as_none<T>(result: io::Result<T>) -> io::Result<Option<T>> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

fn registry_error(key_path: &str, err: io::Error) -> String {
    format!("Failed to access registry key HKCU\\{}: {}", key_path, err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};
    use winreg::enums::REG_BINARY;
    use winreg::RegValue;

    static NEXT_ID: AtomicU32 = AtomicU32::new(0);

    const NAME: &str = "grimoire-test";
    const TASK_MANAGER_DISABLED: [u8; 12] = [3, 0, 0, 0, 0x10, 0x32, 0x54, 0x76, 0x98, 0xBA, 0xDC, 0x01];

    /// Unique scratch keys under `HKCU\Software`, deleted on drop.
    struct TestKeys {
        root: String,
        location: Location,
    }

    impl TestKeys {
        fn new() -> Self {
            let root = format!(
                r"Software\GrimoireTest-{}-{}",
                std::process::id(),
                NEXT_ID.fetch_add(1, Ordering::SeqCst)
            );
            let location = Location {
                run_key: format!(r"{}\Run", root),
                approved_key: format!(r"{}\StartupApproved", root),
            };
            Self { root, location }
        }

        fn set_approved(&self, bytes: &[u8]) {
            let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
                .create_subkey(&self.location.approved_key)
                .unwrap();
            key.set_raw_value(NAME, &RegValue { bytes: bytes.to_vec(), vtype: REG_BINARY })
                .unwrap();
        }

        fn approved_exists(&self) -> bool {
            open_key(&self.location.approved_key, KEY_QUERY_VALUE)
                .unwrap()
                .is_some_and(|key| key.get_raw_value(NAME).is_ok())
        }
    }

    impl Drop for TestKeys {
        fn drop(&mut self) {
            let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(&self.root);
        }
    }

    fn entry(exe: &str) -> AutostartEntry {
        AutostartEntry {
            name: NAME.to_string(),
            exe_path: PathBuf::from(exe),
            args: vec!["--autostart".to_string()],
        }
    }

    #[test]
    fn test_status_disabled_when_keys_missing() {
        let keys = TestKeys::new();
        assert_eq!(status(&keys.location, NAME).unwrap(), AutostartStatus::Disabled);
    }

    #[test]
    fn test_enable_writes_run_command() {
        let keys = TestKeys::new();
        let e = entry(r"C:\Program Files\grimoire\grimoire.exe");
        enable(&keys.location, &e).unwrap();

        assert_eq!(status(&keys.location, NAME).unwrap(), AutostartStatus::Enabled);
        assert_eq!(
            read_run_command(&keys.location, NAME).unwrap().as_deref(),
            Some(r#""C:\Program Files\grimoire\grimoire.exe" --autostart"#)
        );
    }

    #[test]
    fn test_disable_removes_entry_and_is_idempotent() {
        let keys = TestKeys::new();
        enable(&keys.location, &entry(r"C:\grimoire.exe")).unwrap();
        keys.set_approved(&TASK_MANAGER_DISABLED);

        disable(&keys.location, NAME).unwrap();
        assert_eq!(status(&keys.location, NAME).unwrap(), AutostartStatus::Disabled);
        assert!(!keys.approved_exists());

        disable(&keys.location, NAME).unwrap();
    }

    #[test]
    fn test_task_manager_disabled_is_disabled_by_system() {
        let keys = TestKeys::new();
        enable(&keys.location, &entry(r"C:\grimoire.exe")).unwrap();
        keys.set_approved(&TASK_MANAGER_DISABLED);

        assert_eq!(
            status(&keys.location, NAME).unwrap(),
            AutostartStatus::DisabledBySystem
        );
    }

    #[test]
    fn test_task_manager_enabled_value_is_enabled() {
        let keys = TestKeys::new();
        enable(&keys.location, &entry(r"C:\grimoire.exe")).unwrap();
        keys.set_approved(&[2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

        assert_eq!(status(&keys.location, NAME).unwrap(), AutostartStatus::Enabled);
    }

    #[test]
    fn test_approved_value_without_run_value_is_disabled() {
        let keys = TestKeys::new();
        keys.set_approved(&TASK_MANAGER_DISABLED);

        assert_eq!(status(&keys.location, NAME).unwrap(), AutostartStatus::Disabled);
    }

    #[test]
    fn test_enable_clears_task_manager_override() {
        let keys = TestKeys::new();
        enable(&keys.location, &entry(r"C:\grimoire.exe")).unwrap();
        keys.set_approved(&TASK_MANAGER_DISABLED);

        enable(&keys.location, &entry(r"C:\grimoire.exe")).unwrap();
        assert!(!keys.approved_exists());
        assert_eq!(status(&keys.location, NAME).unwrap(), AutostartStatus::Enabled);
    }

    #[test]
    fn test_refresh_rewrites_stale_command() {
        let keys = TestKeys::new();
        enable(&keys.location, &entry(r"C:\old\grimoire.exe")).unwrap();

        let current = entry(r"C:\new\grimoire.exe");
        assert!(refresh_if_stale(&keys.location, &current).unwrap());
        assert_eq!(
            read_run_command(&keys.location, NAME).unwrap(),
            Some(windows_run_command(&current))
        );
    }

    #[test]
    fn test_refresh_noop_when_current() {
        let keys = TestKeys::new();
        let e = entry(r"C:\grimoire\grimoire.exe");
        enable(&keys.location, &e).unwrap();

        assert!(!refresh_if_stale(&keys.location, &e).unwrap());
        // Drive-letter case differences don't count as stale.
        assert!(!refresh_if_stale(&keys.location, &entry(r"c:\grimoire\grimoire.exe")).unwrap());
    }

    #[test]
    fn test_refresh_does_not_create_missing_entry() {
        let keys = TestKeys::new();
        assert!(!refresh_if_stale(&keys.location, &entry(r"C:\grimoire.exe")).unwrap());
        assert_eq!(status(&keys.location, NAME).unwrap(), AutostartStatus::Disabled);
    }

    #[test]
    fn test_refresh_keeps_system_disabled_state() {
        let keys = TestKeys::new();
        enable(&keys.location, &entry(r"C:\old\grimoire.exe")).unwrap();
        keys.set_approved(&TASK_MANAGER_DISABLED);

        assert!(refresh_if_stale(&keys.location, &entry(r"C:\new\grimoire.exe")).unwrap());
        assert_eq!(
            status(&keys.location, NAME).unwrap(),
            AutostartStatus::DisabledBySystem
        );
    }
}
