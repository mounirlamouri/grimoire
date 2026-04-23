use std::fs;
use std::path::Path;

/// Reads the live game APIVersion from `AddOnSettings.txt`, which ESO rewrites
/// on each launch. The file sits alongside the `AddOns/` folder, so we resolve
/// the parent of the configured addon path.
///
/// Returns `None` when the file is missing (user never launched ESO), unreadable,
/// or doesn't contain a parseable `#Version <integer>` directive.
pub fn read_current_api_version(addons_path: &Path) -> Option<u32> {
    let settings_file = addons_path.parent()?.join("AddOnSettings.txt");
    let contents = fs::read_to_string(&settings_file).ok()?;
    parse_version_line(&contents)
}

fn parse_version_line(contents: &str) -> Option<u32> {
    for line in contents.lines() {
        if let Some(rest) = line.strip_prefix("#Version ") {
            if let Ok(v) = rest.trim().parse::<u32>() {
                return Some(v);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write_settings(dir: &Path, body: &str) {
        fs::write(dir.join("AddOnSettings.txt"), body).unwrap();
    }

    #[test]
    fn reads_version_from_first_line() {
        let dir = tempdir().unwrap();
        let live = dir.path();
        let addons = live.join("AddOns");
        fs::create_dir_all(&addons).unwrap();
        write_settings(live, "#Version 101049\n#AddOnsEnabled 1\n");
        assert_eq!(read_current_api_version(&addons), Some(101049));
    }

    #[test]
    fn ignores_acknowledged_out_of_date_line() {
        let dir = tempdir().unwrap();
        let live = dir.path();
        let addons = live.join("AddOns");
        fs::create_dir_all(&addons).unwrap();
        write_settings(
            live,
            "#Version 101049\n#AcknowledgedOutOfDateAddonsVersion 101033\n",
        );
        assert_eq!(read_current_api_version(&addons), Some(101049));
    }

    #[test]
    fn returns_none_when_file_missing() {
        let dir = tempdir().unwrap();
        let addons = dir.path().join("AddOns");
        fs::create_dir_all(&addons).unwrap();
        assert_eq!(read_current_api_version(&addons), None);
    }

    #[test]
    fn returns_none_when_no_version_line() {
        let dir = tempdir().unwrap();
        let live = dir.path();
        let addons = live.join("AddOns");
        fs::create_dir_all(&addons).unwrap();
        write_settings(live, "#AddOnsEnabled 1\n#Default\n");
        assert_eq!(read_current_api_version(&addons), None);
    }

    #[test]
    fn returns_none_when_version_value_not_integer() {
        let dir = tempdir().unwrap();
        let live = dir.path();
        let addons = live.join("AddOns");
        fs::create_dir_all(&addons).unwrap();
        write_settings(live, "#Version abc\n");
        assert_eq!(read_current_api_version(&addons), None);
    }

    #[test]
    fn parses_version_with_trailing_whitespace() {
        assert_eq!(parse_version_line("#Version 101049   \n"), Some(101049));
    }

    #[test]
    fn first_version_line_wins() {
        let contents = "#Version 101049\n#Version 101050\n";
        assert_eq!(parse_version_line(contents), Some(101049));
    }
}
