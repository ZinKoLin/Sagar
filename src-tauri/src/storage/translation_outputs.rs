//! Immutable recovery copies of provider output, separate from authored drafts.
use crate::error::AppError;
use rusqlite::{Connection, OptionalExtension, params};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationOutput {
    pub id: String,
    pub html: String,
    pub state: String,
    pub created_at: String,
}

pub fn insert(
    conn: &Connection,
    chapter_id: &str,
    html: &str,
    state: &str,
) -> Result<(), AppError> {
    if html.is_empty() {
        return Ok(());
    }
    // Each checkpoint is a new row: a failed retry/repair cannot erase earlier text.
    conn.execute(
        "INSERT INTO translation_outputs(id,chapter_id,html,state,created_at) VALUES(?1,?2,?3,?4,?5)",
        params![uuid::Uuid::new_v4().to_string(), chapter_id, html, state, chrono::Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

pub fn latest(conn: &Connection, chapter_id: &str) -> Result<Option<TranslationOutput>, AppError> {
    Ok(conn.query_row(
        "SELECT id,html,state,created_at FROM translation_outputs WHERE chapter_id=?1 ORDER BY rowid DESC LIMIT 1",
        [chapter_id],
        |row| Ok(TranslationOutput { id: row.get(0)?, html: row.get(1)?, state: row.get(2)?, created_at: row.get(3)? }),
    ).optional()?)
}

pub fn was_returned(conn: &Connection, chapter_id: &str, html: &str) -> Result<bool, AppError> {
    Ok(conn.query_row("SELECT EXISTS(SELECT 1 FROM translation_outputs WHERE chapter_id=?1 AND html=?2 AND state='returned')", params![chapter_id,html], |row| row.get(0))?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn malformed_unicode_outputs_survive_reopen_without_changing_drafts() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("sagar.db");
        let first = "<p>မြန်မာ <i>စာ";
        {
            let conn = crate::storage::open_database(&path).expect("db");
            crate::storage::migrations::apply(&conn).expect("migrate");
            conn.execute("INSERT INTO projects(id,source_sha256,source_snapshot_path,title,created_at,updated_at) VALUES('p','hash','source.epub','Book','now','now')", []).expect("project");
            conn.execute("INSERT INTO chapters(id,project_id,spine_index,manifest_item_id,resource_href,title) VALUES('c','p',0,'item','c.xhtml','Chapter')", []).expect("chapter");
            conn.execute("INSERT INTO chapter_documents(chapter_id,html,status,revision) VALUES('c','<p>Manual</p>','reviewed',4)", []).expect("draft");
            insert(&conn, "c", first, "returned").expect("malformed output is recoverable");
            insert(&conn, "c", "<p>ပြင်ထားသောစာ</p>", "edited").expect("new copy");
            assert!(insert(&conn, "missing", first, "partial").is_err());
        }
        let conn = crate::storage::open_database(&path).expect("reopen");
        crate::storage::migrations::apply(&conn).expect("idempotent migration");
        assert_eq!(
            latest(&conn, "c").expect("latest").expect("output").html,
            "<p>ပြင်ထားသောစာ</p>"
        );
        let original: String = conn
            .query_row(
                "SELECT html FROM translation_outputs ORDER BY rowid LIMIT 1",
                [],
                |r| r.get(0),
            )
            .expect("original copy");
        assert_eq!(original, first);
        assert!(was_returned(&conn, "c", first).expect("completed attempt retained"));
        let error = crate::services::ai_translate::start_ai_translation(
            dir.path(),
            crate::services::ai_translate::StartTranslationInput {
                timeout_minutes: None,
                chapter_id: "c".into(),
                agent: "codex".into(),
                model: "test".into(),
                consent: true,
                previous_output: Some(first.into()),
                current_instructions: None,
                reasoning_effort: None,
            },
            |_| panic!("a completed attempt must not launch a provider"),
        )
        .err()
        .expect("completed output is not translated again");
        assert_eq!(error.code, "translation_already_returned");
        let draft: (String, i64) = conn
            .query_row(
                "SELECT html,revision FROM chapter_documents WHERE chapter_id='c'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("draft");
        assert_eq!(draft, ("<p>Manual</p>".to_string(), 4));
    }
}
