//! Chapter content and save/revision models.

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockView {
    pub id: String,
    pub block_index: i64,
    pub element_name: String,
    /// Stable-in-snapshot element-index path used to patch the source at export.
    pub structural_locator: String,
    /// Sanitized inner XHTML for read-only preview (event handlers removed).
    pub source_html: String,
    pub source_plain_text: String,
    pub source_editor_html: Option<String>,
    /// True when the source fragment contains inline markup (links,
    /// emphasis) that a plain-text translation will not carry over.
    pub has_inline_markup: bool,
    pub support_status: String,
    pub target_plain_text: Option<String>,
    pub target_html: Option<String>,
    pub status: String,
    pub revision: i64,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterContent {
    pub chapter_id: String,
    pub title: String,
    pub resource_href: String,
    pub blocks: Vec<BlockView>,
    pub source_document: String,
    pub preview_html: String,
    pub images: Vec<ChapterImage>,
    pub document: ChapterDocument,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub block_id: String,
    pub revision: i64,
    pub status: String,
    pub saved_at: String,
    pub chapter_status: String,
}

/// Per-chapter review report used by the export review dialog.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterReview {
    pub chapter_id: String,
    pub spine_index: i64,
    pub title: String,
    pub total_blocks: i64,
    pub reviewed: i64,
    pub skipped: i64,
    pub draft: i64,
    pub pending: i64,
    pub unsupported: i64,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReview {
    pub project_id: String,
    pub title: String,
    pub source_language: Option<String>,
    pub target_language: String,
    pub translated_title: Option<String>,
    pub chapters: Vec<ChapterReview>,
    pub reviewed_total: i64,
    pub skipped_total: i64,
    pub draft_total: i64,
    pub pending_total: i64,
    pub unsupported_total: i64,
    /// True when every supported required block is reviewed or skipped.
    pub complete: bool,
}

/// Export outcome.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOutcome {
    pub output_path: String,
    pub mode: String,
    pub chapters_exported: usize,
    pub blocks_translated: usize,
    pub warnings: Vec<crate::domain::ImportWarning>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterImage {
    pub src: String,
    pub source: String,
    pub alt: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterDocument {
    pub html: Option<String>,
    pub status: String,
    pub revision: i64,
    pub authored: bool,
}
