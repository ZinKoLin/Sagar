//! Workspace use cases: loading a chapter for side-by-side editing and
//! saving translations through the revision-checked persistence layer.

use std::path::Path;

use crate::domain::{ChapterContent, SaveResult};
use crate::epub;
use crate::error::AppError;
use crate::storage::{self, projects, translations};

pub fn get_chapter(
    data_dir: &Path,
    project_id: &str,
    chapter_id: &str,
) -> Result<ChapterContent, AppError> {
    let conn = open_db(data_dir)?;
    if !projects::project_exists(&conn, project_id)? {
        return Err(AppError::new(
            "project_not_found",
            "This project no longer exists in local storage.",
        ));
    }
    let belongs: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chapters WHERE id = ?1 AND project_id = ?2",
        rusqlite::params![chapter_id, project_id],
        |row| row.get(0),
    )?;
    if belongs == 0 {
        return Err(AppError::new(
            "chapter_not_found",
            "This chapter does not belong to the selected project.",
        ));
    }

    let snapshot_path: String = conn.query_row(
        "SELECT source_snapshot_path FROM projects WHERE id = ?1",
        rusqlite::params![project_id],
        |row| row.get(0),
    )?;
    let resource_prefix = format!("epubres://{project_id}");
    let base_resource = {
        let conn = &conn;
        let href: String = conn.query_row(
            "SELECT resource_href FROM chapters WHERE id = ?1",
            rusqlite::params![chapter_id],
            |row| row.get(0),
        )?;
        href
    };

    let mut content = translations::get_chapter_content(&conn, chapter_id, &|fragment| {
        epub::preview::sanitize_fragment(fragment, "p", &base_resource, &resource_prefix)
    })?;

    // Remember where the user is working so a restart resumes here.
    translations::set_last_chapter(&conn, project_id, chapter_id)?;
    let _ = snapshot_path;
    let mut archive = epub::archive::SafeArchive::open(
        &self::snapshot_path(data_dir, project_id)?,
        &crate::security::ArchiveLimits::default(),
    )?;
    let bytes = archive.read_entry(&base_resource)?;
    content.source_document = String::from_utf8(bytes)
        .map_err(|_| AppError::new("invalid_epub", "The chapter is not UTF-8 XHTML."))?;
    let doc = roxmltree::Document::parse(&content.source_document)
        .map_err(|_| AppError::new("invalid_epub", "The chapter XHTML could not be read."))?;
    if let Some(body) = doc
        .descendants()
        .find(|n| n.has_tag_name(("http://www.w3.org/1999/xhtml", "body")))
    {
        let body_xml = &content.source_document[body.range()];
        content.preview_html =
            epub::preview::sanitize_fragment(body_xml, "body", &base_resource, &resource_prefix);
    }
    use base64::Engine;
    for img in doc
        .descendants()
        .filter(|n| n.has_tag_name(("http://www.w3.org/1999/xhtml", "img")))
    {
        let Some(src) = img.attribute("src") else {
            continue;
        };
        if src.contains(':') || src.starts_with('/') {
            continue;
        }
        let href = epub::resolve_href(&base_resource, src);
        let Ok(bytes) = archive.read_entry(&href) else {
            continue;
        };
        if bytes.len() > 8 * 1024 * 1024 {
            continue;
        }
        let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            "image/png"
        } else if bytes.starts_with(b"\xff\xd8\xff") {
            "image/jpeg"
        } else if bytes.starts_with(b"GIF8") {
            "image/gif"
        } else {
            continue;
        };
        let src = format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        );
        if !content.images.iter().any(|image| image.src == src) {
            content.images.push(crate::domain::ChapterImage {
                src,
                source: img.attribute("src").unwrap_or_default().to_string(),
                alt: img.attribute("alt").unwrap_or("Chapter image").to_string(),
            });
        }
    }
    Ok(content)
}

pub fn save_translation(
    data_dir: &Path,
    input: translations::SaveInput,
) -> Result<SaveResult, AppError> {
    let conn = open_db(data_dir)?;
    let result = translations::save_translation(&conn, input)?;
    Ok(result)
}

pub fn get_last_chapter(data_dir: &Path, project_id: &str) -> Result<Option<String>, AppError> {
    let conn = open_db(data_dir)?;
    translations::get_last_chapter(&conn, project_id)
}

pub(crate) fn validate_language_tag(raw: &str) -> Result<String, AppError> {
    let language = raw.trim().to_string();
    if language.is_empty()
        || !language
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(AppError::new(
            "invalid_language",
            "Enter a language tag such as “my” or “en-US”.",
        ));
    }
    Ok(language)
}

pub fn update_project_metadata(
    data_dir: &Path,
    project_id: &str,
    translated_title: Option<String>,
    target_language: Option<String>,
    source_language: Option<String>,
) -> Result<(), AppError> {
    let conn = open_db(data_dir)?;
    if !projects::project_exists(&conn, project_id)? {
        return Err(AppError::new(
            "project_not_found",
            "This project no longer exists in local storage.",
        ));
    }
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(title) = translated_title {
        let title = title.trim().to_string();
        conn.execute(
            "UPDATE projects SET translated_title = ?1 WHERE id = ?2",
            rusqlite::params![
                if title.is_empty() { None } else { Some(title) },
                project_id
            ],
        )?;
    }
    if let Some(language) = target_language {
        let language = validate_language_tag(&language)?;
        conn.execute(
            "UPDATE projects SET target_language = ?1 WHERE id = ?2",
            rusqlite::params![language, project_id],
        )?;
    }
    if let Some(language) = source_language {
        // An empty source tag clears back to unknown; anything else must be a
        // valid tag. Source is informational only and never rewrites book text.
        let trimmed = language.trim();
        if trimmed.is_empty() {
            conn.execute(
                "UPDATE projects SET source_language = NULL WHERE id = ?1",
                rusqlite::params![project_id],
            )?;
        } else {
            let language = validate_language_tag(trimmed)?;
            conn.execute(
                "UPDATE projects SET source_language = ?1 WHERE id = ?2",
                rusqlite::params![language, project_id],
            )?;
        }
    }
    conn.execute(
        "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, project_id],
    )?;
    Ok(())
}

/// Snapshot path for a project, validated before filesystem use.
pub fn snapshot_path(data_dir: &Path, project_id: &str) -> Result<std::path::PathBuf, AppError> {
    let conn = open_db(data_dir)?;
    let relative: String = conn.query_row(
        "SELECT source_snapshot_path FROM projects WHERE id = ?1",
        rusqlite::params![project_id],
        |row| row.get(0),
    )?;
    let mut resolved = data_dir.to_path_buf();
    for segment in relative.split('/') {
        crate::security::is_safe_entry_name(segment)?;
        resolved.push(segment);
    }
    Ok(resolved)
}

pub fn open_db(data_dir: &Path) -> Result<rusqlite::Connection, AppError> {
    storage::initialize(data_dir)?;
    storage::open_database(&data_dir.join("sagar.db"))
}

/// Restricted rich-text saves share the authoritative translation repository.
pub fn save_rich_translation(
    data_dir: &Path,
    block_id: String,
    target_html: Option<String>,
    status: String,
    expected_revision: i64,
) -> Result<SaveResult, AppError> {
    let conn = open_db(data_dir)?;
    translations::save_rich_translation(&conn, block_id, target_html, status, expected_revision)
}

pub fn save_chapter_document(
    data_dir: &Path,
    chapter_id: &str,
    html: Option<String>,
    status: &str,
    revision: i64,
) -> Result<SaveResult, AppError> {
    let conn = open_db(data_dir)?;
    storage::documents::save(&conn, chapter_id, html, status, revision)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_project() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("temp dir");
        let conn = open_db(dir.path()).expect("open db");
        conn.execute(
            "INSERT INTO projects
                (id, source_sha256, source_snapshot_path, title, created_at, updated_at)
             VALUES ('p1', 'abc', 'projects/p1/source.epub', 'T',
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .expect("seed project");
        dir
    }

    #[test]
    fn source_language_updates_validate_and_clear() {
        let dir = setup_project();
        // EPUB metadata is often missing; the source tag starts unknown.
        let project = crate::services::projects::get_project(dir.path(), "p1").expect("project");
        assert_eq!(project.source_language, None);

        update_project_metadata(dir.path(), "p1", None, None, Some("en".into())).expect("set");
        let project = crate::services::projects::get_project(dir.path(), "p1").expect("project");
        assert_eq!(project.source_language.as_deref(), Some("en"));

        let error = update_project_metadata(dir.path(), "p1", None, None, Some("en US!".into()))
            .expect_err("invalid source tag rejected");
        assert_eq!(error.code, "invalid_language");

        update_project_metadata(dir.path(), "p1", None, None, Some("  ".into())).expect("clear");
        let project = crate::services::projects::get_project(dir.path(), "p1").expect("project");
        assert_eq!(project.source_language, None);

        // Target validation is unchanged and None leaves values alone.
        let error = update_project_metadata(dir.path(), "p1", None, Some("my MM!".into()), None)
            .expect_err("invalid target tag rejected");
        assert_eq!(error.code, "invalid_language");
        let project = crate::services::projects::get_project(dir.path(), "p1").expect("project");
        assert_eq!(project.target_language, "my");

        let error = update_project_metadata(dir.path(), "ghost", None, None, Some("en".into()))
            .expect_err("unknown project rejected");
        assert_eq!(error.code, "project_not_found");
    }
}
