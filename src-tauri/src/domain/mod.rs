//! Domain models shared by services, storage and the typed command bridge.
//! Field names serialize to camelCase to match the TypeScript DTOs in
//! src/types.

mod ai;
mod chapter;
mod project;

pub use ai::{
    AiHtmlFixEvent, AiHtmlFixStart, AiProviderList, AiTranslationEvent, AiTranslationStart,
    CliCheckResult, CliProviderId, CliProviderStatus, CustomProviderSummary, CustomTestResult,
    TranslationModel, TranslationModelList, TranslationSelection,
};
pub use chapter::{
    BilingualAlignment, BlockView, ChapterContent, ChapterDocument, ChapterImage, ChapterReview,
    ExportOutcome, ExportReview, SaveResult,
};
pub use project::{
    ChapterSummary, CoverImage, ImportResult, ImportWarning, ProjectSummary, strip_fragment,
};
