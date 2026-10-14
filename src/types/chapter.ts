/** Chapter content, block and export DTOs from the Rust workspace services. */

import type { ImportWarning } from "./project";

export type BlockStatus = "pending" | "draft" | "reviewed" | "skipped";

export type BlockView = {
  id: string;
  blockIndex: number;
  elementName: string;
  structuralLocator: string;
  /** Sanitized inner HTML for the read-only pane. */
  sourceHtml: string;
  sourcePlainText: string;
  sourceEditorHtml: string | null;
  hasInlineMarkup: boolean;
  supportStatus: string;
  targetPlainText: string | null;
  targetHtml: string | null;
  status: BlockStatus;
  revision: number;
};

export type ChapterContent = {
  chapterId: string;
  title: string;
  resourceHref: string;
  blocks: BlockView[];
  sourceDocument: string;
  previewHtml: string;
  images: { src: string; source: string; alt: string }[];
  document: {
    html: string | null;
    status: BlockStatus;
    revision: number;
    authored: boolean;
  };
};

export type SaveResult = {
  blockId: string;
  revision: number;
  status: BlockStatus;
  savedAt: string;
  chapterStatus: string;
};

export type ChapterReview = {
  chapterId: string;
  spineIndex: number;
  title: string;
  totalBlocks: number;
  reviewed: number;
  skipped: number;
  draft: number;
  pending: number;
  unsupported: number;
};

export type ExportReview = {
  projectId: string;
  title: string;
  sourceLanguage: string | null;
  targetLanguage: string;
  translatedTitle: string | null;
  chapters: ChapterReview[];
  reviewedTotal: number;
  skippedTotal: number;
  draftTotal: number;
  pendingTotal: number;
  unsupportedTotal: number;
  complete: boolean;
};

export type ExportOutcome = {
  outputPath: string;
  mode: string;
  chaptersExported: number;
  blocksTranslated: number;
  warnings: ImportWarning[];
};
