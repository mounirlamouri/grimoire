use rusqlite::{params, Connection};
use std::path::Path;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS catalog_addons (
    uid             TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    version         TEXT,
    date            INTEGER,
    downloads       INTEGER DEFAULT 0,
    favorites       INTEGER DEFAULT 0,
    downloads_monthly INTEGER DEFAULT 0,
    directories     TEXT,
    category_id     TEXT,
    author          TEXT,
    download_url    TEXT,
    file_info_url   TEXT
);

CREATE INDEX IF NOT EXISTS idx_catalog_name ON catalog_addons(name);
CREATE INDEX IF NOT EXISTS idx_catalog_directories ON catalog_addons(directories);
CREATE INDEX IF NOT EXISTS idx_catalog_author ON catalog_addons(author);

CREATE TABLE IF NOT EXISTS catalog_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS installed_versions (
    dir_name        TEXT PRIMARY KEY,
    uid             TEXT NOT NULL,
    catalog_version TEXT NOT NULL
);
";

/// ESOUI category ID for libraries.
const LIBRARY_CATEGORY_ID: &str = "53";

/// A row from catalog_addons, returned to the frontend.
#[derive(Debug, serde::Serialize, Clone)]
pub struct CatalogAddon {
    pub uid: String,
    pub name: String,
    pub version: Option<String>,
    pub downloads: i64,
    pub favorites: i64,
    pub downloads_monthly: i64,
    pub directories: Option<String>,
    pub category_id: Option<String>,
    pub author: Option<String>,
    pub download_url: Option<String>,
    pub file_info_url: Option<String>,
    pub is_library: bool,
}

fn is_library(category_id: &Option<String>) -> bool {
    category_id.as_deref() == Some(LIBRARY_CATEGORY_ID)
}

pub fn open_db(db_path: &Path) -> Result<Connection, String> {
    let conn =
        Connection::open(db_path).map_err(|e| format!("Failed to open database: {}", e))?;
    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|e| format!("Failed to set WAL mode: {}", e))?;
    conn.execute_batch(SCHEMA)
        .map_err(|e| format!("Failed to create schema: {}", e))?;
    Ok(conn)
}

/// Returns the number of addons in the catalog.
pub fn catalog_count(conn: &Connection) -> Result<i64, String> {
    conn.query_row("SELECT COUNT(*) FROM catalog_addons", [], |row| row.get(0))
        .map_err(|e| format!("Failed to count catalog: {}", e))
}

/// Returns the last sync timestamp (ISO 8601 string) or None.
pub fn last_sync_time(conn: &Connection) -> Result<Option<String>, String> {
    let result = conn.query_row(
        "SELECT value FROM catalog_meta WHERE key = 'last_sync'",
        [],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to read last sync time: {}", e)),
    }
}

/// Upsert all catalog entries in a single transaction.
pub fn upsert_catalog(
    conn: &Connection,
    addons: &[(String, String, Option<String>, Option<i64>, i64, i64, i64, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)],
) -> Result<(), String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    // Clear and reinsert — simpler and faster than upserting thousands of rows
    tx.execute("DELETE FROM catalog_addons", [])
        .map_err(|e| format!("Failed to clear catalog: {}", e))?;

    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO catalog_addons (uid, name, version, date, downloads, favorites, downloads_monthly, directories, category_id, author, download_url, file_info_url)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            )
            .map_err(|e| format!("Failed to prepare insert: {}", e))?;

        for row in addons {
            stmt.execute(params![
                row.0, row.1, row.2, row.3, row.4, row.5, row.6, row.7, row.8, row.9, row.10, row.11
            ])
            .map_err(|e| format!("Failed to insert addon: {}", e))?;
        }
    }

    // Update sync timestamp
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "INSERT OR REPLACE INTO catalog_meta (key, value) VALUES ('last_sync', ?1)",
        params![now],
    )
    .map_err(|e| format!("Failed to update sync time: {}", e))?;

    tx.commit()
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;
    Ok(())
}

/// Search the catalog by name or author. Returns up to `limit` results.
pub fn search_catalog(
    conn: &Connection,
    query: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<CatalogAddon>, String> {
    let pattern = format!("%{}%", query);
    let mut stmt = conn
        .prepare(
            "SELECT uid, name, version, downloads, favorites, downloads_monthly, directories, category_id, author, download_url, file_info_url
             FROM catalog_addons
             WHERE name LIKE ?1 OR author LIKE ?1
             ORDER BY downloads DESC
             LIMIT ?2 OFFSET ?3",
        )
        .map_err(|e| format!("Failed to prepare search: {}", e))?;

    let rows = stmt
        .query_map(params![pattern, limit, offset], row_to_catalog_addon)
        .map_err(|e| format!("Failed to search catalog: {}", e))?;

    collect_rows(rows)
}

/// Browse the catalog (all addons, paginated, sorted by downloads).
pub fn browse_catalog(
    conn: &Connection,
    limit: i64,
    offset: i64,
) -> Result<Vec<CatalogAddon>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT uid, name, version, downloads, favorites, downloads_monthly, directories, category_id, author, download_url, file_info_url
             FROM catalog_addons
             ORDER BY downloads DESC
             LIMIT ?1 OFFSET ?2",
        )
        .map_err(|e| format!("Failed to prepare browse: {}", e))?;

    let rows = stmt
        .query_map(params![limit, offset], row_to_catalog_addon)
        .map_err(|e| format!("Failed to browse catalog: {}", e))?;

    collect_rows(rows)
}

/// Look up a catalog entry by directory name (matches within the comma-separated directories column).
/// Returns (version, uid, download_url) if found.
pub fn lookup_by_dir_name(
    conn: &Connection,
    dir_name: &str,
) -> Result<Option<(Option<String>, String, Option<String>)>, String> {
    // directories is stored as comma-separated, so we match exact name or surrounded by commas
    let mut stmt = conn
        .prepare(
            "SELECT version, uid, download_url FROM catalog_addons
             WHERE directories = ?1
                OR directories LIKE ?2
                OR directories LIKE ?3
                OR directories LIKE ?4",
        )
        .map_err(|e| format!("Failed to prepare lookup: {}", e))?;

    let exact = dir_name;
    let starts = format!("{},%", dir_name);
    let ends = format!("%,{}", dir_name);
    let middle = format!("%,{},%", dir_name);

    let result = stmt.query_row(params![exact, starts, ends, middle], |row| {
        Ok((
            row.get::<_, Option<String>>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    });

    match result {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to lookup dir {}: {}", dir_name, e)),
    }
}

/// Look up the download URL for an addon by UID.
pub fn lookup_download_url(conn: &Connection, uid: &str) -> Result<Option<String>, String> {
    let result = conn.query_row(
        "SELECT download_url FROM catalog_addons WHERE uid = ?1",
        params![uid],
        |row| row.get::<_, Option<String>>(0),
    );
    match result {
        Ok(Some(url)) => Ok(Some(url)),
        Ok(None) => Err(format!("Addon {} has no download URL", uid)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to lookup addon {}: {}", uid, e)),
    }
}

/// Record that an addon was installed/updated from the catalog.
pub fn record_installed_version(
    conn: &Connection,
    dir_name: &str,
    uid: &str,
    catalog_version: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO installed_versions (dir_name, uid, catalog_version)
         VALUES (?1, ?2, ?3)",
        params![dir_name, uid, catalog_version],
    )
    .map_err(|e| format!("Failed to record installed version: {}", e))?;
    Ok(())
}

/// Get the catalog version that was last installed for a given dir_name.
pub fn get_installed_catalog_version(
    conn: &Connection,
    dir_name: &str,
) -> Result<Option<String>, String> {
    let result = conn.query_row(
        "SELECT catalog_version FROM installed_versions WHERE dir_name = ?1",
        params![dir_name],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to lookup installed version: {}", e)),
    }
}

/// Remove the installed version record (e.g., after uninstall).
pub fn remove_installed_version(conn: &Connection, dir_name: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM installed_versions WHERE dir_name = ?1",
        params![dir_name],
    )
    .map_err(|e| format!("Failed to remove installed version: {}", e))?;
    Ok(())
}

fn row_to_catalog_addon(row: &rusqlite::Row) -> rusqlite::Result<CatalogAddon> {
    let category_id: Option<String> = row.get(7)?;
    Ok(CatalogAddon {
        uid: row.get(0)?,
        name: row.get(1)?,
        version: row.get(2)?,
        downloads: row.get(3)?,
        favorites: row.get(4)?,
        downloads_monthly: row.get(5)?,
        directories: row.get(6)?,
        is_library: is_library(&category_id),
        category_id,
        author: row.get(8)?,
        download_url: row.get(9)?,
        file_info_url: row.get(10)?,
    })
}

fn collect_rows(rows: impl Iterator<Item = rusqlite::Result<CatalogAddon>>) -> Result<Vec<CatalogAddon>, String> {
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read row: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Create an in-memory database with the schema applied.
    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn
    }

    /// Helper to create a catalog row tuple.
    fn catalog_row(
        uid: &str,
        name: &str,
        version: Option<&str>,
        downloads: i64,
        directories: Option<&str>,
        category_id: Option<&str>,
        author: Option<&str>,
        download_url: Option<&str>,
    ) -> (String, String, Option<String>, Option<i64>, i64, i64, i64, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>) {
        (
            uid.to_string(),
            name.to_string(),
            version.map(|s| s.to_string()),
            Some(1000),
            downloads,
            0,  // favorites
            0,  // downloads_monthly
            directories.map(|s| s.to_string()),
            category_id.map(|s| s.to_string()),
            author.map(|s| s.to_string()),
            download_url.map(|s| s.to_string()),
            None,  // file_info_url
        )
    }

    #[test]
    fn test_open_db_creates_schema() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = open_db(&db_path).unwrap();
        // Verify tables exist by querying them
        assert_eq!(catalog_count(&conn).unwrap(), 0);
        assert_eq!(last_sync_time(&conn).unwrap(), None);
    }

    #[test]
    fn test_upsert_and_count() {
        let conn = test_db();
        let rows = vec![
            catalog_row("1", "Addon One", Some("1.0"), 100, None, None, Some("Author1"), None),
            catalog_row("2", "Addon Two", Some("2.0"), 200, None, None, Some("Author2"), None),
        ];
        upsert_catalog(&conn, &rows).unwrap();
        assert_eq!(catalog_count(&conn).unwrap(), 2);
    }

    #[test]
    fn test_upsert_replaces() {
        let conn = test_db();
        let rows = vec![
            catalog_row("1", "Addon One", Some("1.0"), 100, None, None, None, None),
        ];
        upsert_catalog(&conn, &rows).unwrap();
        assert_eq!(catalog_count(&conn).unwrap(), 1);

        // Upsert again with different data — count should stay at 1
        let rows2 = vec![
            catalog_row("1", "Addon One Updated", Some("2.0"), 200, None, None, None, None),
        ];
        upsert_catalog(&conn, &rows2).unwrap();
        assert_eq!(catalog_count(&conn).unwrap(), 1);

        // Verify the data actually changed
        let results = search_catalog(&conn, "Addon One Updated", 10, 0).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].version, Some("2.0".to_string()));
    }

    #[test]
    fn test_last_sync_time_after_upsert() {
        let conn = test_db();
        assert_eq!(last_sync_time(&conn).unwrap(), None);

        upsert_catalog(&conn, &[]).unwrap();
        assert!(last_sync_time(&conn).unwrap().is_some());
    }

    #[test]
    fn test_search_catalog_by_name() {
        let conn = test_db();
        let rows = vec![
            catalog_row("1", "Awesome Addon", Some("1.0"), 100, None, None, Some("Alice"), None),
            catalog_row("2", "Other Thing", Some("1.0"), 50, None, None, Some("Bob"), None),
        ];
        upsert_catalog(&conn, &rows).unwrap();

        let results = search_catalog(&conn, "Awesome", 10, 0).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Awesome Addon");
    }

    #[test]
    fn test_search_catalog_by_author() {
        let conn = test_db();
        let rows = vec![
            catalog_row("1", "Addon A", Some("1.0"), 100, None, None, Some("Alice"), None),
            catalog_row("2", "Addon B", Some("1.0"), 50, None, None, Some("Bob"), None),
        ];
        upsert_catalog(&conn, &rows).unwrap();

        let results = search_catalog(&conn, "Bob", 10, 0).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Addon B");
    }

    #[test]
    fn test_search_catalog_no_results() {
        let conn = test_db();
        let rows = vec![
            catalog_row("1", "Addon A", Some("1.0"), 100, None, None, None, None),
        ];
        upsert_catalog(&conn, &rows).unwrap();

        let results = search_catalog(&conn, "zzzzz", 10, 0).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_browse_catalog_pagination() {
        let conn = test_db();
        let rows = vec![
            catalog_row("1", "A", None, 300, None, None, None, None),
            catalog_row("2", "B", None, 200, None, None, None, None),
            catalog_row("3", "C", None, 100, None, None, None, None),
            catalog_row("4", "D", None, 50, None, None, None, None),
            catalog_row("5", "E", None, 10, None, None, None, None),
        ];
        upsert_catalog(&conn, &rows).unwrap();

        let page1 = browse_catalog(&conn, 2, 0).unwrap();
        assert_eq!(page1.len(), 2);
        assert_eq!(page1[0].name, "A"); // 300 downloads
        assert_eq!(page1[1].name, "B"); // 200 downloads

        let page2 = browse_catalog(&conn, 2, 2).unwrap();
        assert_eq!(page2.len(), 2);
        assert_eq!(page2[0].name, "C"); // 100 downloads
    }

    #[test]
    fn test_browse_catalog_sorted_by_downloads() {
        let conn = test_db();
        let rows = vec![
            catalog_row("1", "Low", None, 10, None, None, None, None),
            catalog_row("2", "High", None, 1000, None, None, None, None),
            catalog_row("3", "Mid", None, 500, None, None, None, None),
        ];
        upsert_catalog(&conn, &rows).unwrap();

        let results = browse_catalog(&conn, 10, 0).unwrap();
        assert_eq!(results[0].name, "High");
        assert_eq!(results[1].name, "Mid");
        assert_eq!(results[2].name, "Low");
    }

    #[test]
    fn test_lookup_by_dir_name_exact() {
        let conn = test_db();
        let rows = vec![
            catalog_row("42", "My Addon", Some("1.5"), 100, Some("MyAddon"), None, None, Some("https://download")),
        ];
        upsert_catalog(&conn, &rows).unwrap();

        let result = lookup_by_dir_name(&conn, "MyAddon").unwrap();
        assert!(result.is_some());
        let (version, uid, url) = result.unwrap();
        assert_eq!(version, Some("1.5".to_string()));
        assert_eq!(uid, "42");
        assert_eq!(url, Some("https://download".to_string()));
    }

    #[test]
    fn test_lookup_by_dir_name_comma_separated() {
        let conn = test_db();
        let rows = vec![
            catalog_row("42", "Multi Dir", Some("1.0"), 100, Some("DirA,DirB,DirC"), None, None, None),
        ];
        upsert_catalog(&conn, &rows).unwrap();

        // Should find via starts_with pattern
        assert!(lookup_by_dir_name(&conn, "DirA").unwrap().is_some());
        // Should find via ends_with pattern
        assert!(lookup_by_dir_name(&conn, "DirC").unwrap().is_some());
        // Should find via middle pattern
        assert!(lookup_by_dir_name(&conn, "DirB").unwrap().is_some());
    }

    #[test]
    fn test_lookup_by_dir_name_not_found() {
        let conn = test_db();
        assert!(lookup_by_dir_name(&conn, "NonExistent").unwrap().is_none());
    }

    #[test]
    fn test_lookup_download_url() {
        let conn = test_db();
        let rows = vec![
            catalog_row("99", "Addon", None, 100, None, None, None, Some("https://example.com/addon.zip")),
        ];
        upsert_catalog(&conn, &rows).unwrap();

        let url = lookup_download_url(&conn, "99").unwrap();
        assert_eq!(url, Some("https://example.com/addon.zip".to_string()));
    }

    #[test]
    fn test_lookup_download_url_not_found() {
        let conn = test_db();
        assert!(lookup_download_url(&conn, "nonexistent").unwrap().is_none());
    }

    #[test]
    fn test_record_and_get_installed_version() {
        let conn = test_db();
        record_installed_version(&conn, "MyAddon", "42", "1.5").unwrap();

        let version = get_installed_catalog_version(&conn, "MyAddon").unwrap();
        assert_eq!(version, Some("1.5".to_string()));
    }

    #[test]
    fn test_record_installed_version_upsert() {
        let conn = test_db();
        record_installed_version(&conn, "MyAddon", "42", "1.0").unwrap();
        record_installed_version(&conn, "MyAddon", "42", "2.0").unwrap();

        let version = get_installed_catalog_version(&conn, "MyAddon").unwrap();
        assert_eq!(version, Some("2.0".to_string()));
    }

    #[test]
    fn test_remove_installed_version() {
        let conn = test_db();
        record_installed_version(&conn, "MyAddon", "42", "1.0").unwrap();
        remove_installed_version(&conn, "MyAddon").unwrap();

        assert_eq!(get_installed_catalog_version(&conn, "MyAddon").unwrap(), None);
    }

    #[test]
    fn test_get_installed_version_not_found() {
        let conn = test_db();
        assert_eq!(get_installed_catalog_version(&conn, "Unknown").unwrap(), None);
    }

    #[test]
    fn test_is_library_category() {
        assert!(is_library(&Some("53".to_string())));
        assert!(!is_library(&Some("12".to_string())));
        assert!(!is_library(&None));
    }
}
