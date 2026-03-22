use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct InstalledAddon {
    pub dir_name: String,
    pub title: String,
    pub author: String,
    pub version: String,
    pub addon_version: Option<u32>,
    pub api_versions: Vec<u32>,
    pub depends_on: Vec<Dependency>,
    pub optional_depends_on: Vec<Dependency>,
    pub is_library: bool,
    pub description: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct Dependency {
    pub name: String,
    pub min_version: Option<u32>,
}

/// Parse the manifest for a single addon directory.
/// Returns None if the directory has no valid manifest.
pub fn parse_single_manifest(addons_path: &Path, dir_name: &str) -> Option<InstalledAddon> {
    let dir = addons_path.join(dir_name);
    let txt_path = dir.join(format!("{}.txt", dir_name));
    let addon_path = dir.join(format!("{}.addon", dir_name));
    let manifest_path = if txt_path.exists() {
        txt_path
    } else if addon_path.exists() {
        addon_path
    } else {
        return None;
    };
    parse_manifest(dir_name, &manifest_path).ok()
}

/// Scan the AddOns directory and parse all addon manifests.
pub fn scan_installed_addons(addons_path: &Path) -> Result<Vec<InstalledAddon>, std::io::Error> {
    let mut addons = Vec::new();

    for entry in fs::read_dir(addons_path)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let dir_name = entry.file_name().to_string_lossy().to_string();
        // ESO accepts both .txt and .addon manifest extensions
        let txt_path = path.join(format!("{}.txt", &dir_name));
        let addon_path = path.join(format!("{}.addon", &dir_name));
        let manifest_path = if txt_path.exists() {
            Some(txt_path)
        } else if addon_path.exists() {
            Some(addon_path)
        } else {
            None
        };

        if let Some(manifest_path) = manifest_path {
            if let Ok(addon) = parse_manifest(&dir_name, &manifest_path) {
                addons.push(addon);
            }
        }
    }

    addons.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(addons)
}

fn parse_manifest(dir_name: &str, path: &Path) -> Result<InstalledAddon, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let content = String::from_utf8_lossy(&bytes);

    let mut addon = InstalledAddon {
        dir_name: dir_name.to_string(),
        title: dir_name.to_string(),
        author: String::new(),
        version: String::new(),
        addon_version: None,
        api_versions: Vec::new(),
        depends_on: Vec::new(),
        optional_depends_on: Vec::new(),
        is_library: false,
        description: String::new(),
    };

    for line in content.lines() {
        let line = line.trim();
        if let Some(value) = line.strip_prefix("## Title:") {
            addon.title = strip_color_codes(value.trim());
        } else if let Some(value) = line.strip_prefix("## Author:") {
            addon.author = strip_color_codes(value.trim());
        } else if let Some(value) = line.strip_prefix("## Version:") {
            addon.version = value.trim().to_string();
        } else if let Some(value) = line.strip_prefix("## AddOnVersion:") {
            addon.addon_version = value.trim().parse().ok();
        } else if let Some(value) = line.strip_prefix("## APIVersion:") {
            addon.api_versions = value
                .split_whitespace()
                .filter_map(|v| v.parse().ok())
                .collect();
        } else if let Some(value) = line.strip_prefix("## DependsOn:") {
            addon.depends_on = parse_dependencies(value);
        } else if let Some(value) = line.strip_prefix("## PCDependsOn:") {
            // Some addons use PCDependsOn for PC-specific dependencies (vs console)
            addon.depends_on.extend(parse_dependencies(value));
        } else if let Some(value) = line.strip_prefix("## OptionalDependsOn:") {
            addon.optional_depends_on = parse_dependencies(value);
        } else if let Some(value) = line.strip_prefix("## IsLibrary:") {
            addon.is_library = value.trim().eq_ignore_ascii_case("true");
        } else if let Some(value) = line.strip_prefix("## Description:") {
            addon.description = strip_color_codes(value.trim());
        }
    }

    Ok(addon)
}

fn parse_dependencies(value: &str) -> Vec<Dependency> {
    value
        .split_whitespace()
        .filter(|s| !s.is_empty())
        .map(|dep| {
            if let Some((name, ver)) = dep.split_once(">=") {
                Dependency {
                    name: name.to_string(),
                    min_version: ver.parse().ok(),
                }
            } else {
                Dependency {
                    name: dep.to_string(),
                    min_version: None,
                }
            }
        })
        .collect()
}

/// Strip ESO color codes like |cFFFFFF and |r from text.
fn strip_color_codes(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '|' {
            match chars.peek() {
                Some('c') => {
                    chars.next(); // skip 'c'
                    // skip 6 hex digits
                    for _ in 0..6 {
                        chars.next();
                    }
                }
                Some('r') => {
                    chars.next(); // skip 'r'
                }
                _ => result.push(c),
            }
        } else {
            result.push(c);
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── strip_color_codes ──────────────────────────────────────────

    #[test]
    fn test_strip_color_codes_basic() {
        assert_eq!(strip_color_codes("|cFF0000Red Text|r"), "Red Text");
    }

    #[test]
    fn test_strip_color_codes_multiple() {
        assert_eq!(
            strip_color_codes("|cFF0000Red|r and |c00FF00Green|r"),
            "Red and Green"
        );
    }

    #[test]
    fn test_strip_color_codes_no_codes() {
        assert_eq!(strip_color_codes("Plain Text"), "Plain Text");
    }

    #[test]
    fn test_strip_color_codes_pipe_not_color() {
        assert_eq!(strip_color_codes("A|B"), "A|B");
    }

    #[test]
    fn test_strip_color_codes_empty() {
        assert_eq!(strip_color_codes(""), "");
    }

    #[test]
    fn test_strip_color_codes_only_codes() {
        assert_eq!(strip_color_codes("|cAABBCC|r"), "");
    }

    // ── parse_dependencies ─────────────────────────────────────────

    #[test]
    fn test_parse_deps_single() {
        let deps = parse_dependencies("LibAddonMenu-2.0");
        assert_eq!(deps.len(), 1);
        assert_eq!(deps[0].name, "LibAddonMenu-2.0");
        assert_eq!(deps[0].min_version, None);
    }

    #[test]
    fn test_parse_deps_with_version() {
        let deps = parse_dependencies("LibAddonMenu-2.0>=32");
        assert_eq!(deps.len(), 1);
        assert_eq!(deps[0].name, "LibAddonMenu-2.0");
        assert_eq!(deps[0].min_version, Some(32));
    }

    #[test]
    fn test_parse_deps_multiple() {
        let deps = parse_dependencies("LibA>=10 LibB LibC>=5");
        assert_eq!(deps.len(), 3);
        assert_eq!(deps[0], Dependency { name: "LibA".into(), min_version: Some(10) });
        assert_eq!(deps[1], Dependency { name: "LibB".into(), min_version: None });
        assert_eq!(deps[2], Dependency { name: "LibC".into(), min_version: Some(5) });
    }

    #[test]
    fn test_parse_deps_empty() {
        assert!(parse_dependencies("").is_empty());
    }

    #[test]
    fn test_parse_deps_whitespace_only() {
        assert!(parse_dependencies("   ").is_empty());
    }

    #[test]
    fn test_parse_deps_invalid_version() {
        let deps = parse_dependencies("LibA>=notanumber");
        assert_eq!(deps[0].name, "LibA");
        assert_eq!(deps[0].min_version, None);
    }

    // ── parse_manifest ─────────────────────────────────────────────

    #[test]
    fn test_parse_manifest_full() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = dir.path().join("TestAddon.txt");
        fs::write(&manifest, "\
## Title: My Cool Addon
## Author: TestAuthor
## Version: 1.2.3
## AddOnVersion: 42
## APIVersion: 101047 101048
## DependsOn: LibAddonMenu-2.0>=32 LibStub
## OptionalDependsOn: LibMapPins
## IsLibrary: true
## Description: Does cool things.
").unwrap();

        let addon = parse_manifest("TestAddon", &manifest).unwrap();
        assert_eq!(addon.dir_name, "TestAddon");
        assert_eq!(addon.title, "My Cool Addon");
        assert_eq!(addon.author, "TestAuthor");
        assert_eq!(addon.version, "1.2.3");
        assert_eq!(addon.addon_version, Some(42));
        assert_eq!(addon.api_versions, vec![101047, 101048]);
        assert_eq!(addon.depends_on.len(), 2);
        assert_eq!(addon.depends_on[0].name, "LibAddonMenu-2.0");
        assert_eq!(addon.depends_on[0].min_version, Some(32));
        assert_eq!(addon.depends_on[1].name, "LibStub");
        assert_eq!(addon.optional_depends_on.len(), 1);
        assert_eq!(addon.optional_depends_on[0].name, "LibMapPins");
        assert!(addon.is_library);
        assert_eq!(addon.description, "Does cool things.");
    }

    #[test]
    fn test_parse_manifest_minimal() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = dir.path().join("Bare.txt");
        fs::write(&manifest, "SomeFile.lua\n").unwrap();

        let addon = parse_manifest("Bare", &manifest).unwrap();
        assert_eq!(addon.title, "Bare"); // defaults to dir_name
        assert_eq!(addon.author, "");
        assert_eq!(addon.version, "");
        assert_eq!(addon.addon_version, None);
        assert!(addon.api_versions.is_empty());
        assert!(addon.depends_on.is_empty());
        assert!(!addon.is_library);
    }

    #[test]
    fn test_parse_manifest_color_in_title() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = dir.path().join("Colored.txt");
        fs::write(&manifest, "## Title: |cFF0000Red Addon|r\n").unwrap();

        let addon = parse_manifest("Colored", &manifest).unwrap();
        assert_eq!(addon.title, "Red Addon");
    }

    #[test]
    fn test_parse_manifest_pc_depends_on() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = dir.path().join("PCDep.txt");
        fs::write(&manifest, "## PCDependsOn: LibStub>=5\n").unwrap();

        let addon = parse_manifest("PCDep", &manifest).unwrap();
        assert_eq!(addon.depends_on.len(), 1);
        assert_eq!(addon.depends_on[0].name, "LibStub");
        assert_eq!(addon.depends_on[0].min_version, Some(5));
    }

    #[test]
    fn test_parse_manifest_both_depends_and_pc() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = dir.path().join("Both.txt");
        fs::write(&manifest, "\
## DependsOn: LibA
## PCDependsOn: LibB
").unwrap();

        let addon = parse_manifest("Both", &manifest).unwrap();
        assert_eq!(addon.depends_on.len(), 2);
        assert_eq!(addon.depends_on[0].name, "LibA");
        assert_eq!(addon.depends_on[1].name, "LibB");
    }

    #[test]
    fn test_parse_manifest_non_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = dir.path().join("Latin1.txt");
        // 0xAE is ® in Latin-1, invalid standalone in UTF-8
        let bytes = b"## Title: Crafting\xae Helper\n## Author: Test\n".to_vec();
        fs::write(&manifest, &bytes).unwrap();

        let addon = parse_manifest("Latin1", &manifest).unwrap();
        // from_utf8_lossy replaces invalid byte with U+FFFD
        assert!(addon.title.contains("Crafting"));
        assert_eq!(addon.author, "Test");
    }

    // ── parse_single_manifest ──────────────────────────────────────

    #[test]
    fn test_parse_single_manifest_txt() {
        let dir = tempfile::tempdir().unwrap();
        let addon_dir = dir.path().join("MyAddon");
        fs::create_dir(&addon_dir).unwrap();
        fs::write(addon_dir.join("MyAddon.txt"), "## Title: My Addon\n").unwrap();

        let addon = parse_single_manifest(dir.path(), "MyAddon").unwrap();
        assert_eq!(addon.title, "My Addon");
    }

    #[test]
    fn test_parse_single_manifest_addon_ext() {
        let dir = tempfile::tempdir().unwrap();
        let addon_dir = dir.path().join("NewAddon");
        fs::create_dir(&addon_dir).unwrap();
        fs::write(addon_dir.join("NewAddon.addon"), "## Title: New Addon\n").unwrap();

        let addon = parse_single_manifest(dir.path(), "NewAddon").unwrap();
        assert_eq!(addon.title, "New Addon");
    }

    #[test]
    fn test_parse_single_manifest_missing() {
        let dir = tempfile::tempdir().unwrap();
        let addon_dir = dir.path().join("NoManifest");
        fs::create_dir(&addon_dir).unwrap();

        assert!(parse_single_manifest(dir.path(), "NoManifest").is_none());
    }

    // ── scan_installed_addons ──────────────────────────────────────

    #[test]
    fn test_scan_empty_dir() {
        let dir = tempfile::tempdir().unwrap();
        let addons = scan_installed_addons(dir.path()).unwrap();
        assert!(addons.is_empty());
    }

    #[test]
    fn test_scan_multiple_addons_sorted() {
        let dir = tempfile::tempdir().unwrap();

        // Addon "Zebra" (should be second alphabetically)
        let z_dir = dir.path().join("Zebra");
        fs::create_dir(&z_dir).unwrap();
        fs::write(z_dir.join("Zebra.txt"), "## Title: Zebra Addon\n").unwrap();

        // Addon "Alpha" (should be first alphabetically)
        let a_dir = dir.path().join("Alpha");
        fs::create_dir(&a_dir).unwrap();
        fs::write(a_dir.join("Alpha.txt"), "## Title: Alpha Addon\n").unwrap();

        let addons = scan_installed_addons(dir.path()).unwrap();
        assert_eq!(addons.len(), 2);
        assert_eq!(addons[0].title, "Alpha Addon");
        assert_eq!(addons[1].title, "Zebra Addon");
    }

    #[test]
    fn test_scan_skips_files() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("readme.txt"), "not an addon").unwrap();

        let addons = scan_installed_addons(dir.path()).unwrap();
        assert!(addons.is_empty());
    }

    #[test]
    fn test_scan_skips_no_manifest() {
        let dir = tempfile::tempdir().unwrap();
        let addon_dir = dir.path().join("EmptyDir");
        fs::create_dir(&addon_dir).unwrap();

        let addons = scan_installed_addons(dir.path()).unwrap();
        assert!(addons.is_empty());
    }

    #[test]
    fn test_scan_txt_and_addon_extensions() {
        let dir = tempfile::tempdir().unwrap();

        let a = dir.path().join("TxtAddon");
        fs::create_dir(&a).unwrap();
        fs::write(a.join("TxtAddon.txt"), "## Title: Txt\n").unwrap();

        let b = dir.path().join("AddonExt");
        fs::create_dir(&b).unwrap();
        fs::write(b.join("AddonExt.addon"), "## Title: Addon Extension\n").unwrap();

        let addons = scan_installed_addons(dir.path()).unwrap();
        assert_eq!(addons.len(), 2);
    }
}
