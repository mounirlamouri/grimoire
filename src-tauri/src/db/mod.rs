use rusqlite::Connection;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS addons (
    uid         TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    version     TEXT,
    date        TEXT,
    downloads   INTEGER DEFAULT 0,
    favorites   INTEGER DEFAULT 0,
    directories TEXT,
    category_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_addons_name ON addons(name);
CREATE INDEX IF NOT EXISTS idx_addons_directories ON addons(directories);
";

pub fn open_db(db_path: &std::path::Path) -> Result<Connection, String> {
    let conn = Connection::open(db_path).map_err(|e| format!("Failed to open database: {}", e))?;
    conn.execute_batch(SCHEMA)
        .map_err(|e| format!("Failed to create schema: {}", e))?;
    Ok(conn)
}
