//! Pure helpers for the Windows Run-key entry. Compiled on Windows and in
//! tests on every platform.

use super::AutostartEntry;

/// Formats the command stored in the Run value: the executable is always
/// quoted, arguments only when they contain whitespace or quotes.
pub fn windows_run_command(entry: &AutostartEntry) -> String {
    let mut command = format!("\"{}\"", entry.exe_path.display());
    for arg in &entry.args {
        command.push(' ');
        if arg.is_empty() || arg.contains([' ', '\t', '"']) {
            command.push('"');
            command.push_str(&arg.replace('"', "\\\""));
            command.push('"');
        } else {
            command.push_str(arg);
        }
    }
    command
}

/// `StartupApproved\Run` values are REG_BINARY blobs written by Task Manager:
/// the first byte is 0x02/0x06 when enabled and 0x03/0x07 when disabled,
/// followed by a FILETIME of when it was disabled. Missing or unknown values
/// count as enabled.
pub fn is_startup_approved_disabled(bytes: &[u8]) -> bool {
    bytes.first().is_some_and(|flags| flags & 1 == 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn entry(exe: &str, args: &[&str]) -> AutostartEntry {
        AutostartEntry {
            name: "grimoire".to_string(),
            exe_path: PathBuf::from(exe),
            args: args.iter().map(|a| a.to_string()).collect(),
        }
    }

    #[test]
    fn test_run_command_quotes_path_with_spaces() {
        let e = entry(r"C:\Program Files\grimoire\grimoire.exe", &["--autostart"]);
        assert_eq!(
            windows_run_command(&e),
            r#""C:\Program Files\grimoire\grimoire.exe" --autostart"#
        );
    }

    #[test]
    fn test_run_command_without_args() {
        let e = entry(r"C:\Users\me\AppData\Local\grimoire\grimoire.exe", &[]);
        assert_eq!(
            windows_run_command(&e),
            r#""C:\Users\me\AppData\Local\grimoire\grimoire.exe""#
        );
    }

    #[test]
    fn test_run_command_quotes_args_that_need_it() {
        let e = entry(r"C:\g.exe", &["--autostart", "two words", r#"say "hi""#, ""]);
        assert_eq!(
            windows_run_command(&e),
            r#""C:\g.exe" --autostart "two words" "say \"hi\"" """#
        );
    }

    #[test]
    fn test_startup_approved_enabled_values() {
        assert!(!is_startup_approved_disabled(&[0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        assert!(!is_startup_approved_disabled(&[0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    }

    #[test]
    fn test_startup_approved_disabled_values() {
        let filetime = [0x10, 0x32, 0x54, 0x76, 0x98, 0xBA, 0xDC, 0x01];
        let mut disabled = vec![0x03, 0, 0, 0];
        disabled.extend_from_slice(&filetime);
        assert!(is_startup_approved_disabled(&disabled));
        disabled[0] = 0x07;
        assert!(is_startup_approved_disabled(&disabled));
    }

    #[test]
    fn test_startup_approved_empty_value_is_enabled() {
        assert!(!is_startup_approved_disabled(&[]));
    }
}
