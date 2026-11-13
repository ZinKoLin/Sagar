//! Project repository: transactional writes for import and read queries for
//! the library and workspace. All SQL lives here, never in services or UI.

use rusqlite::Connection;

use crate::domain::{ChapterSummary, ProjectSummary};
use crate::error::AppError;

/// Input rows for a transactional project creation at import time.
pub struct NewProject {
    pub id: String,
    pub source_sha256: String,
    pub original_source_path: Option<String>,
    /// Path relative to the app data dir, using '/' separators.
    pub source_snapshot_path: String,
    pub title: String,
    pub author: Option<String>,
    pub source_language: Option<String>,
    pub created_at: String,
}

pub struct NewChapter {
    pub id: String,
    pub spine_index: i64,
    pub manifest_item_id: String,
    pub resource_href: String,
    pub title: String,
}

pub struct NewBlock {
    pub id: String,
    pub block_index: i64,
    pub structural_locator: String,
    pub element_name: String,
    pub source_xhtml_fragment: String,
    pub source_plain_text: String,
    pub is_translatable: bool,
    pub supported: bool,
}

/// Inserts a project with its chapters, blocks and pending translation rows
/// in a single transaction so an interrupted import leaves no partial project.
pub fn create_project(
    conn: &Connection,
    project: &NewProject,
    chapters: &[(NewChapter, Vec<NewBlock>)],
) -> Result<(), AppError> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO projects (id, source_sha256, source_snapshot_path, title, author,
            source_language, created_at, updated_at, original_source_path)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8)",
        rusqlite::params![
            project.id,
            project.source_sha256,
            project.source_snapshot_path,
            project.title,
            project.author,
            project.source_language,
            project.created_at,
            project.original_source_path,
        ],
    )?;
    for (chapter, blocks) in chapters {
        tx.execute(
            "INSERT INTO chapters (id, project_id, spine_index, manifest_item_id,
                resource_href, title)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                chapter.id,
                project.id,
                chapter.spine_index,
                chapter.manifest_item_id,
                chapter.resource_href,
                chapter.title,
            ],
        )?;
        for block in blocks {
            tx.execute(
                "INSERT INTO blocks (id, chapter_id, block_index, structural_locator,
                    element_name, source_xhtml_fragment, source_plain_text,
                    is_translatable, support_status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![
                    block.id,
                    chapter.id,
                    block.block_index,
                    block.structural_locator,
                    block.element_name,
                    block.source_xhtml_fragment,
                    block.source_plain_text,
                    block.is_translatable,
                    if block.supported {
                        "supported"
                    } else {
                        "unsupported"
                    },
                ],
            )?;
            tx.execute(
                "INSERT INTO translations (block_id) VALUES (?1)",
                rusqlite::params![block.id],
            )?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Finds an existing project imported from the same source content.
pub fn find_by_source_hash(
    conn: &Connection,
    sha256: &str,
) -> Result<Option<ProjectSummary>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.title, p.author, p.source_language, p.target_language,
                p.created_at, p.updated_at,
                COALESCE(s.total, 0), COALESCE(s.reviewed, 0), COALESCE(s.unsupported, 0)
         FROM projects p
         LEFT JOIN project_progress s ON s.project_id = p.id
         WHERE p.source_sha256 = ?1
         ORDER BY p.created_at
         LIMIT 1",
    )?;
    let mut rows = stmt.query(rusqlite::params![sha256])?;
    match rows.next()? {
        Some(row) => Ok(Some(project_from_row(row)?)),
        None => Ok(None),
    }
}

/// Lists projects by most recently updated.
pub fn list_projects(conn: &Connection) -> Result<Vec<ProjectSummary>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.title, p.author, p.source_language, p.target_language,
                p.created_at, p.updated_at,
                COALESCE(s.total, 0), COALESCE(s.reviewed, 0), COALESCE(s.unsupported, 0)
         FROM projects p
         LEFT JOIN project_progress s ON s.project_id = p.id
         ORDER BY p.updated_at DESC, p.id",
    )?;
    let rows = stmt.query_map([], project_from_row)?;
    let mut projects = Vec::new();
    for row in rows {
        projects.push(row?);
    }
    Ok(projects)
}

pub fn get_project(conn: &Connection, project_id: &str) -> Result<ProjectSummary, AppError> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.title, p.author, p.source_language, p.target_language,
                p.created_at, p.updated_at,
                COALESCE(s.total, 0), COALESCE(s.reviewed, 0), COALESCE(s.unsupported, 0)
         FROM projects p
         LEFT JOIN project_progress s ON s.project_id = p.id
         WHERE p.id = ?1",
    )?;
    let mut rows = stmt.query(rusqlite::params![project_id])?;
    match rows.next()? {
        Some(row) => Ok(project_from_row(row)?),
        None => Err(AppError::new(
            "project_not_found",
            "This project no longer exists in local storage.",
        )),
    }
}

/// Deletes a project's rows; chapters, blocks and translations cascade
/// (foreign keys are on). Returns false when the project does not exist.
pub fn delete_project_rows(conn: &Connection, project_id: &str) -> Result<bool, AppError> {
    let deleted = conn.execute(
        "DELETE FROM projects WHERE id = ?1",
        rusqlite::params![project_id],
    )?;
    Ok(deleted > 0)
}

pub fn project_exists(conn: &Connection, project_id: &str) -> Result<bool, AppError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM projects WHERE id = ?1",
        rusqlite::params![project_id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// Chapters in OPF spine order with per-chapter progress counts.
pub fn list_chapters(conn: &Connection, project_id: &str) -> Result<Vec<ChapterSummary>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT ch.id, ch.spine_index, ch.title, ch.resource_href, ch.status,
                COUNT(b.id),
                COALESCE(SUM(CASE WHEN t.status IN ('reviewed', 'skipped') THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN b.support_status != 'supported' THEN 1 ELSE 0 END), 0)
         FROM chapters ch
         LEFT JOIN blocks b ON b.chapter_id = ch.id
         LEFT JOIN translations t ON t.block_id = b.id
         WHERE ch.project_id = ?1
         GROUP BY ch.id
         ORDER BY ch.spine_index",
    )?;
    let rows = stmt.query_map(rusqlite::params![project_id], |row| {
        Ok(ChapterSummary {
            navigation_groups: Vec::new(),
            id: row.get(0)?,
            spine_index: row.get(1)?,
            title: row.get(2)?,
            resource_href: row.get(3)?,
            status: row.get(4)?,
            total_blocks: row.get(5)?,
            reviewed_blocks: row.get(6)?,
            unsupported_blocks: row.get(7)?,
        })
    })?;
    let mut chapters = Vec::new();
    for row in rows {
        chapters.push(row?);
    }
    Ok(chapters)
}

fn project_from_row(row: &rusqlite::Row<'_>) -> Result<ProjectSummary, rusqlite::Error> {
    Ok(ProjectSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        author: row.get(2)?,
        source_language: row.get(3)?,
        target_language: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        total_blocks: row.get(7)?,
        reviewed_blocks: row.get(8)?,
        unsupported_blocks: row.get(9)?,
    })
}
