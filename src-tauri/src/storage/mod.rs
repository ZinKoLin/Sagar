//! SQLite project storage, owned exclusively by Rust. The frontend never
//! issues SQL; it goes through commands → services → this module.

pub mod ai_providers;
pub mod ai_translate;
pub mod documents;
pub mod migrations;
pub mod projects;
pub mod translation_outputs;
pub mod translations;

use std::path::Path;

use crate::error::AppError;
use rusqlite::Connection;

pub struct StorageInfo {
    pub schema_version: i64,
}

fn configure(conn: &Connection) -> Result<(), AppError> {
    // WAL returns the resulting mode as a row, so read it via query_row.
    let _journal_mode: String =
        conn.query_row("PRAGMA journal_mode = WAL;", [], |row| row.get(0))?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(())
}

/// Opens (creating if needed) the project database at `path`.
pub fn open_database(path: &Path) -> Result<Connection, AppError> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    Ok(conn)
}

/// Ensures the app-owned data directory and database exist, applies pending
/// migrations and reports the resulting schema version.
pub fn initialize(app_data_dir: &Path) -> Result<StorageInfo, AppError> {
    std::fs::create_dir_all(app_data_dir)?;
    let conn = open_database(&app_data_dir.join("sagar.db"))?;
    let schema_version = migrations::apply(&conn)?;
    Ok(StorageInfo { schema_version })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Opens an isolated in-memory database for migration tests.
    fn open_in_memory() -> Result<Connection, AppError> {
        let conn = Connection::open_in_memory()?;
        configure(&conn)?;
        Ok(conn)
    }

    #[test]
    fn fresh_database_is_migrated_to_latest_version() {
        let conn = open_in_memory().expect("open in-memory database");
        let version = migrations::apply(&conn).expect("apply migrations");
        assert_eq!(version, migrations::latest_version());

        conn.execute(
            "INSERT INTO app_meta (key, value) VALUES ('greeting', 'hello')",
            [],
        )
        .expect("insert into migrated schema");
    }

    #[test]
    fn applying_migrations_twice_is_idempotent() {
        let conn = open_in_memory().expect("open in-memory database");
        migrations::apply(&conn).expect("first migration run");
        conn.execute(
            "INSERT INTO app_meta (key, value) VALUES ('key', 'kept')",
            [],
        )
        .expect("insert between migration runs");

        let version = migrations::apply(&conn).expect("second migration run");
        assert_eq!(version, migrations::latest_version());

        let value: String = conn
            .query_row("SELECT value FROM app_meta WHERE key = 'key'", [], |row| {
                row.get(0)
            })
            .expect("select preserved value");
        assert_eq!(value, "kept");
    }

    #[test]
    fn file_database_persists_schema_and_data_across_reopen() {
        let dir = tempfile::tempdir().expect("create temp directory");
        let db_path = dir.path().join("persistence-test.db");

        {
            let conn = open_database(&db_path).expect("open file database");
            let version = migrations::apply(&conn).expect("apply migrations");
            assert_eq!(version, migrations::latest_version());
            conn.execute(
                "INSERT INTO app_meta (key, value) VALUES ('seed', 'one')",
                [],
            )
            .expect("insert durable row");
        }

        let conn = open_database(&db_path).expect("reopen file database");
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("read schema version");
        assert_eq!(version, migrations::latest_version());

        let value: String = conn
            .query_row("SELECT value FROM app_meta WHERE key = 'seed'", [], |row| {
                row.get(0)
            })
            .expect("select durable row");
        assert_eq!(value, "one");

        let foreign_keys: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .expect("read foreign_keys pragma");
        assert_eq!(
            foreign_keys, 1,
            "foreign keys must be enabled on every open"
        );
    }
}
