//! Project, chapter and import-result models.

/// A visible library/workspace project row with progress counts.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub source_language: Option<String>,
    pub target_language: String,
    /// Reviewed or intentionally skipped blocks.
    pub reviewed_blocks: i64,
    pub total_blocks: i64,
    pub unsupported_blocks: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// A spine-ordered chapter row with per-chapter progress.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterSummary {
    pub navigation_groups: Vec<crate::epub::nav::NavGroup>,
    pub id: String,
    pub spine_index: i64,
    pub title: String,
    pub resource_href: String,
    /// `not_started` | `in_progress` | `completed` (derived later, stored now).
    pub status: String,
    pub total_blocks: i64,
    pub reviewed_blocks: i64,
    pub unsupported_blocks: i64,
}

/// A non-fatal finding surfaced to the user instead of silently degrading
/// content (invariant: no silent loss).
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportWarning {
    /// Stable code, e.g. `unsupported_element`, `missing_resource`.
    pub code: String,
    /// Short human-readable explanation; no paths or internal logs.
    pub message: String,
    /// Optional chapter/block location in user terms.
    pub location: Option<String>,
}

/// Returned by `import_epub`.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub project: ProjectSummary,
    pub chapters: Vec<ChapterSummary>,
    pub warnings: Vec<ImportWarning>,
}

/// Cover image bytes for library thumbnails, served only from the app-owned
/// immutable snapshot.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverImage {
    pub media_type: String,
    pub base64: String,
}

/// Decodes entity-escaped fragment text back to plain text. Translated
/// fragments are escaped plain text, so this is their inverse for nav labels.
pub fn strip_fragment(fragment: &str) -> String {
    fragment
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}
