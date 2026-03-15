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
";

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
        .query_map(params![pattern, limit, offset], |row| {
            Ok(CatalogAddon {
                uid: row.get(0)?,
                name: row.get(1)?,
                version: row.get(2)?,
                downloads: row.get(3)?,
                favorites: row.get(4)?,
                downloads_monthly: row.get(5)?,
                directories: row.get(6)?,
                category_id: row.get(7)?,
                author: row.get(8)?,
                download_url: row.get(9)?,
                file_info_url: row.get(10)?,
            })
        })
        .map_err(|e| format!("Failed to search catalog: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| format!("Failed to read row: {}", e))?);
    }
    Ok(results)
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
        .query_map(params![limit, offset], |row| {
            Ok(CatalogAddon {
                uid: row.get(0)?,
                name: row.get(1)?,
                version: row.get(2)?,
                downloads: row.get(3)?,
                favorites: row.get(4)?,
                downloads_monthly: row.get(5)?,
                directories: row.get(6)?,
                category_id: row.get(7)?,
                author: row.get(8)?,
                download_url: row.get(9)?,
                file_info_url: row.get(10)?,
            })
        })
        .map_err(|e| format!("Failed to browse catalog: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| format!("Failed to read row: {}", e))?);
    }
    Ok(results)
}
