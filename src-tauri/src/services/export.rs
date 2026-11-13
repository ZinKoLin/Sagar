//! Export use case: review, then rebuild the translated EPUB to a
//! user-chosen destination.

use std::path::Path;

use crate::domain::{ExportOutcome, ExportReview};
use crate::epub::export;
use crate::error::AppError;
use crate::services::workspace::open_db;
use crate::storage::{self, translations};

pub fn review_export(data_dir: &Path, project_id: &str) -> Result<ExportReview, AppError> {
    let conn = open_db(data_dir)?;
    storage::documents::review(&conn, project_id)
}

pub struct ExportRequest {
    pub project_id: String,
    pub destination: std::path::PathBuf,
    pub mode: String,
    pub title: Option<String>,
    pub language: Option<String>,
    /// Draft-only: when false, chapters without any saved translation are
    /// omitted from the output instead of falling back to original content.
    pub include_original: bool,
    pub bilingual: bool,
    pub bilingual_alignments:
        std::collections::HashMap<String, Vec<crate::domain::BilingualAlignment>>,
}

pub fn export_epub(data_dir: &Path, request: ExportRequest) -> Result<ExportOutcome, AppError> {
    let conn = open_db(data_dir)?;
    if !storage::projects::project_exists(&conn, &request.project_id)? {
        return Err(AppError::new(
            "project_not_found",
            "This project no longer exists in local storage.",
        ));
    }

    // Persist metadata first so the export and the project stay consistent.
    if let Some(title) = &request.title {
        let _ = &title;
    }
    let translated_title = match &request.title {
        Some(title) => {
            let trimmed = title.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        None => None,
    };
    if translated_title.is_some() || request.language.is_some() {
        let current: (Option<String>, String) = conn.query_row(
            "SELECT translated_title, target_language FROM projects WHERE id = ?1",
            rusqlite::params![request.project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let language = request.language.clone().unwrap_or(current.1);
        crate::services::workspace::update_project_metadata(
            data_dir,
            &request.project_id,
            translated_title.clone(),
            Some(language),
            None,
        )?;
    }

    let review = storage::documents::review(&conn, &request.project_id)?;
    match request.mode.as_str() {
        "completed" if !review.complete => {
            return Err(AppError::with_details(
                "export_blocked",
                "This book still has untranslated or unreviewed chapters. \
                 Export a draft or finish the review first.",
                serde_json::to_value(&review).unwrap_or(serde_json::Value::Null),
            ));
        }
        "completed" | "draft" => {}
        other => {
            return Err(AppError::new(
                "invalid_export_mode",
                format!("“{other}” is not a valid export mode."),
            ));
        }
    }

    // Never write onto the app-owned snapshot or its directory-local temp.
    let snapshot_rel: String = conn.query_row(
        "SELECT source_snapshot_path FROM projects WHERE id = ?1",
        rusqlite::params![request.project_id],
        |row| row.get(0),
    )?;
    let snapshot_abs = data_dir.join(&snapshot_rel);
    let destination = request
        .destination
        .canonicalize()
        .unwrap_or(request.destination.clone());
    let snapshot_canonical = snapshot_abs.canonicalize().unwrap_or(snapshot_abs);
    let (original_path, source_hash): (Option<String>, String) = conn.query_row(
        "SELECT original_source_path, source_sha256 FROM projects WHERE id=?1",
        [&request.project_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let is_original_path = original_path.is_some_and(|path| {
        let path = std::path::PathBuf::from(path);
        destination == path.canonicalize().unwrap_or(path)
    });
    // Legacy projects lack a source path. Protect unchanged originals (and
    // identical copies) by their persisted import hash as well.
    let is_original_content =
        destination.is_file() && crate::services::import::hash_file(&destination)? == source_hash;
    if destination == snapshot_canonical || is_original_path || is_original_content {
        return Err(AppError::new(
            "destination_unsafe",
            "Choose a separate output file. Export cannot overwrite the original book or its stored copy.",
        ));
    }
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut chapters = Vec::new();
    let chapter_rows = storage::projects::list_chapters(&conn, &request.project_id)?;
    for chapter in &chapter_rows {
        chapters.push((chapter.id.clone(), chapter.resource_href.clone()));
    }

    let project_id = request.project_id.clone();
    // Completed exports always include every chapter; the translated-only
    // filter is a draft-mode option.
    let include_original = if request.mode == "completed" {
        true
    } else {
        request.include_original
    };
    let saved_metadata: (Option<String>, Option<String>, Option<String>, Option<String>) = conn.query_row(
        "SELECT translated_title, export_author, export_publisher, export_description FROM projects WHERE id=?1",
        [&project_id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)))?;
    let metadata = [
        ("creator", saved_metadata.1),
        ("publisher", saved_metadata.2),
        ("description", saved_metadata.3),
    ]
    .into_iter()
    .filter_map(|(name, value)| value.map(|v| (name.to_string(), v)))
    .collect();
    let outcome = export::run_export(export::ExportInput {
        snapshot_path: snapshot_canonical.clone(),
        destination: destination.clone(),
        translated_title: saved_metadata.0,
        metadata,
        custom_cover: conn.query_row(
            "SELECT custom_cover FROM projects WHERE id=?1",
            [&project_id],
            |row| row.get(0),
        )?,
        target_language: {
            conn.query_row(
                "SELECT target_language FROM projects WHERE id = ?1",
                rusqlite::params![project_id],
                |row| row.get(0),
            )?
        },
        source_language: conn.query_row(
            "SELECT source_language FROM projects WHERE id = ?1",
            rusqlite::params![project_id],
            |row| row.get(0),
        )?,
        bilingual: request.bilingual,
        bilingual_alignments: request.bilingual_alignments,
        chapters,
        include_original,
        load_blocks: Box::new(move |chapter_id: &str| {
            if let Some(document) = storage::documents::authored(&conn, chapter_id)? {
                return Ok(vec![translations::BlockForExport {
                    structural_locator: "__chapter_document__".into(),
                    element_name: "body".into(),
                    target_fragment: if matches!(document.status.as_str(), "skipped" | "pending") {
                        None
                    } else {
                        document.html
                    },
                    status: document.status,
                }]);
            }
            translations::blocks_for_export(&conn, chapter_id)
        }),
    })?;

    let mode = if request.mode == "completed" {
        "completed"
    } else {
        "draft"
    };
    Ok(ExportOutcome {
        output_path: outcome.output_path,
        mode: mode.to_string(),
        chapters_exported: outcome.chapters_exported,
        blocks_translated: outcome.blocks_translated,
        warnings: outcome.warnings,
    })
}
