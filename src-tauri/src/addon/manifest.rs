use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Clone)]
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

#[derive(Debug, Serialize, Clone)]
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
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;

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
