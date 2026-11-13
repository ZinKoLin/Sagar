/** Project/chapter DTOs returned by the Rust project services. */

export type ProjectSummary = {
  id: string;
  title: string;
  author: string | null;
  sourceLanguage: string | null;
  targetLanguage: string;
  reviewedBlocks: number;
  totalBlocks: number;
  unsupportedBlocks: number;
  createdAt: string;
  updatedAt: string;
};

export type ChapterSummary = {
  navigationGroups?: { id: string; title: string; resource: string | null }[];
  id: string;
  spineIndex: number;
  title: string;
  resourceHref: string;
  status: string;
  totalBlocks: number;
  reviewedBlocks: number;
  unsupportedBlocks: number;
};

export type ImportWarning = {
  code: string;
  message: string;
  location: string | null;
};

export type ImportResult = {
  project: ProjectSummary;
  chapters: ChapterSummary[];
  warnings: ImportWarning[];
};

export type CoverImage = {
  mediaType: string;
  base64: string;
};

export type BookSettings = {
  title: string;
  author: string;
  publisher: string;
  description: string;
  sourceLanguage: string;
  targetLanguage: string;
  instructions: string;
  customCover: string | null;
};
