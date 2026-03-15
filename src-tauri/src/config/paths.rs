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
