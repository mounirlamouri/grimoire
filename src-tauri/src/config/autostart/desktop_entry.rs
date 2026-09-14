//! Pure helpers for the XDG autostart `.desktop` file. Compiled on Linux and
//! in tests on every platform.

use super::{AutostartEntry, AutostartStatus};

pub fn render_desktop_entry(entry: &AutostartEntry) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Grimoire\n\
         Comment=ESO addon manager\n\
         Exec={}\n\
         Icon=grimoire\n\
         Terminal=false\n\
         X-GNOME-Autostart-enabled=true\n",
        exec_value(entry)
    )
}

/// Reads whether a `.desktop` file is active. GNOME Tweaks and KDE turn an
/// autostart entry off by setting `X-GNOME-Autostart-enabled=false` or
/// `Hidden=true` rather than deleting the file.
pub fn desktop_entry_status(contents: &str) -> AutostartStatus {
    let disabled = desktop_entry_values(contents).any(|(key, value)| match key {
        "Hidden" => value.eq_ignore_ascii_case("true"),
        "X-GNOME-Autostart-enabled" => value.eq_ignore_ascii_case("false"),
        _ => false,
    });
    if disabled {
        AutostartStatus::DisabledBySystem
    } else {
        AutostartStatus::Enabled
    }
}

/// Returns the raw `Exec=` value from the `[Desktop Entry]` group.
pub fn desktop_exec_value(contents: &str) -> Option<&str> {
    desktop_entry_values(contents)
        .find(|(key, _)| *key == "Exec")
        .map(|(_, value)| value)
}

/// Iterates `key=value` pairs in the `[Desktop Entry]` group.
fn desktop_entry_values(contents: &str) -> impl Iterator<Item = (&str, &str)> + '_ {
    let mut in_group = false;
    contents.lines().filter_map(move |line| {
        let line = line.trim();
        if line.starts_with('[') {
            in_group = line == "[Desktop Entry]";
            return None;
        }
        if !in_group || line.starts_with('#') {
            return None;
        }
        let (key, value) = line.split_once('=')?;
        Some((key.trim(), value.trim()))
    })
}

/// Builds the `Exec=` value per the Desktop Entry spec: the executable is
/// always quoted, arguments only when they contain reserved characters. The
/// result is then escaped as a desktop-file string value.
fn exec_value(entry: &AutostartEntry) -> String {
    let mut parts = vec![quote_exec_arg(&entry.exe_path.to_string_lossy())];
    for arg in &entry.args {
        if arg.is_empty() || arg.chars().any(is_exec_reserved) {
            parts.push(quote_exec_arg(arg));
        } else {
            parts.push(arg.replace('%', "%%"));
        }
    }
    escape_string_value(&parts.join(" "))
}

fn is_exec_reserved(c: char) -> bool {
    matches!(
        c,
        ' ' | '\t' | '\n' | '"' | '\'' | '\\' | '>' | '<' | '~' | '|' | '&' | ';' | '$' | '*'
            | '?' | '#' | '(' | ')' | '`'
    )
}

/// Double-quotes an Exec argument. Inside quotes, `"`, `` ` ``, `$` and `\`
/// must be backslash-escaped, and a literal `%` is written as `%%`.
fn quote_exec_arg(arg: &str) -> String {
    let mut quoted = String::with_capacity(arg.len() + 2);
    quoted.push('"');
    for c in arg.chars() {
        match c {
            '"' | '`' | '$' | '\\' => {
                quoted.push('\\');
                quoted.push(c);
            }
            '%' => quoted.push_str("%%"),
            _ => quoted.push(c),
        }
    }
    quoted.push('"');
    quoted
}

/// Escapes a desktop-file string value, which is decoded before the Exec
/// quoting rules apply.
fn escape_string_value(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\t' => escaped.push_str("\\t"),
            '\r' => escaped.push_str("\\r"),
            _ => escaped.push(c),
        }
    }
    escaped
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn entry(exe: &str) -> AutostartEntry {
        entry_with_args(exe, &["--autostart"])
    }

    fn entry_with_args(exe: &str, args: &[&str]) -> AutostartEntry {
        AutostartEntry {
            name: "grimoire".to_string(),
            exe_path: PathBuf::from(exe),
            args: args.iter().map(|a| a.to_string()).collect(),
        }
    }

    fn exec_line(e: &AutostartEntry) -> String {
        desktop_exec_value(&render_desktop_entry(e)).unwrap().to_string()
    }

    #[test]
    fn test_render_full_entry() {
        assert_eq!(
            render_desktop_entry(&entry("/usr/bin/grimoire")),
            "[Desktop Entry]\n\
             Type=Application\n\
             Name=Grimoire\n\
             Comment=ESO addon manager\n\
             Exec=\"/usr/bin/grimoire\" --autostart\n\
             Icon=grimoire\n\
             Terminal=false\n\
             X-GNOME-Autostart-enabled=true\n"
        );
    }

    #[test]
    fn test_render_quotes_path_with_spaces() {
        assert_eq!(
            exec_line(&entry("/home/u/My Apps/Grimoire.AppImage")),
            r#""/home/u/My Apps/Grimoire.AppImage" --autostart"#
        );
    }

    #[test]
    fn test_render_escapes_reserved_characters_in_quotes() {
        // Exec quoting gives \" \` \$, then string escaping doubles each backslash.
        assert_eq!(
            exec_line(&entry(r#"/opt/a"b`c$d"#)),
            r#""/opt/a\\"b\\`c\\$d" --autostart"#
        );
    }

    #[test]
    fn test_render_escapes_backslash_twice() {
        assert_eq!(
            exec_line(&entry(r"/opt/back\slash/grimoire")),
            r#""/opt/back\\\\slash/grimoire" --autostart"#
        );
    }

    #[test]
    fn test_render_doubles_percent() {
        assert_eq!(
            exec_line(&entry_with_args("/opt/100%/grimoire", &["--autostart", "50%"])),
            r#""/opt/100%%/grimoire" --autostart 50%%"#
        );
    }

    #[test]
    fn test_render_quotes_args_with_reserved_characters() {
        assert_eq!(
            exec_line(&entry_with_args("/usr/bin/grimoire", &["--autostart", "--profile=My Profile"])),
            r#""/usr/bin/grimoire" --autostart "--profile=My Profile""#
        );
    }

    #[test]
    fn test_rendered_entry_is_enabled() {
        let contents = render_desktop_entry(&entry("/usr/bin/grimoire"));
        assert_eq!(desktop_entry_status(&contents), AutostartStatus::Enabled);
    }

    #[test]
    fn test_status_hidden_true_is_disabled_by_system() {
        let contents = "[Desktop Entry]\nExec=grimoire\nHidden=true\n";
        assert_eq!(desktop_entry_status(contents), AutostartStatus::DisabledBySystem);
    }

    #[test]
    fn test_status_gnome_disabled_tolerates_case_and_whitespace() {
        let contents = "[Desktop Entry]\nExec=grimoire\n  X-GNOME-Autostart-enabled = False  \n";
        assert_eq!(desktop_entry_status(contents), AutostartStatus::DisabledBySystem);
    }

    #[test]
    fn test_status_ignores_other_groups_and_comments() {
        let contents = "# Hidden=true\n[Desktop Entry]\nExec=grimoire\n# Hidden=true\n\
                        [Desktop Action quit]\nHidden=true\n";
        assert_eq!(desktop_entry_status(contents), AutostartStatus::Enabled);
    }

    #[test]
    fn test_exec_value_missing() {
        assert_eq!(desktop_exec_value("[Desktop Entry]\nName=Grimoire\n"), None);
        assert_eq!(desktop_exec_value("[Other]\nExec=grimoire\n"), None);
    }
}
