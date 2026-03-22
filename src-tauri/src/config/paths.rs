use std::path::PathBuf;

/// Attempt to auto-detect the ESO AddOns folder.
/// Checks Windows, Wine, and Steam/Proton paths.
pub fn detect_addon_path() -> Option<PathBuf> {
    let candidates = get_candidate_paths();
    candidates.into_iter().find(|p| p.is_dir())
}

fn get_candidate_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Some(docs) = dirs::document_dir() {
        // Windows: Documents/Elder Scrolls Online/live/AddOns
        paths.push(docs.join("Elder Scrolls Online").join("live").join("AddOns"));
    }

    if let Some(home) = dirs::home_dir() {
        // Linux (Wine default prefix)
        paths.push(
            home.join(".wine")
                .join("drive_c")
                .join("users")
                .join(whoami())
                .join("Documents")
                .join("Elder Scrolls Online")
                .join("live")
                .join("AddOns"),
        );

        // Linux (Steam/Proton) — ESO app ID is 306130
        paths.push(
            home.join(".steam")
                .join("steam")
                .join("steamapps")
                .join("compatdata")
                .join("306130")
                .join("pfx")
                .join("drive_c")
                .join("users")
                .join("steamuser")
                .join("Documents")
                .join("Elder Scrolls Online")
                .join("live")
                .join("AddOns"),
        );

        // Flatpak Steam
        paths.push(
            home.join(".var")
                .join("app")
                .join("com.valvesoftware.Steam")
                .join(".steam")
                .join("steam")
                .join("steamapps")
                .join("compatdata")
                .join("306130")
                .join("pfx")
                .join("drive_c")
                .join("users")
                .join("steamuser")
                .join("Documents")
                .join("Elder Scrolls Online")
                .join("live")
                .join("AddOns"),
        );
    }

    paths
}

fn whoami() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "user".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_candidate_paths_not_empty() {
        let paths = get_candidate_paths();
        // Should always return at least one candidate (Windows docs path)
        assert!(!paths.is_empty());
    }

    #[test]
    fn test_candidate_paths_contain_eso_addons() {
        let paths = get_candidate_paths();
        // Every candidate should end with Elder Scrolls Online/live/AddOns
        for path in &paths {
            let path_str = path.to_string_lossy();
            assert!(
                path_str.contains("Elder Scrolls Online") && path_str.contains("AddOns"),
                "Candidate path doesn't contain expected ESO path: {}",
                path_str
            );
        }
    }

    #[test]
    fn test_candidate_paths_include_wine_and_steam() {
        let paths = get_candidate_paths();
        let path_strs: Vec<String> = paths.iter().map(|p| p.to_string_lossy().to_string()).collect();

        // Should have at least the Wine path and the Steam/Proton path
        // (plus Windows docs and possibly Flatpak)
        if dirs::home_dir().is_some() {
            assert!(
                path_strs.iter().any(|p| p.contains(".wine")),
                "Should include Wine prefix path"
            );
            assert!(
                path_strs.iter().any(|p| p.contains("306130")),
                "Should include Steam/Proton path with ESO app ID 306130"
            );
            assert!(
                path_strs.iter().any(|p| p.contains("com.valvesoftware.Steam")),
                "Should include Flatpak Steam path"
            );
        }
    }

    #[test]
    fn test_detect_addon_path_returns_none_for_nonexistent() {
        // On a machine without ESO installed, detect should return None
        // (unless this is actually an ESO machine, in which case it returns Some)
        // We just verify it doesn't panic
        let _ = detect_addon_path();
    }

    #[test]
    fn test_whoami_returns_nonempty() {
        let name = whoami();
        assert!(!name.is_empty());
    }
}
