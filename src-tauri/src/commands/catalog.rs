#[tauri::command]
pub fn search_addons(query: String) -> Result<Vec<String>, String> {
    // TODO: search local SQLite catalog
    let _ = query;
    Ok(vec![])
}
