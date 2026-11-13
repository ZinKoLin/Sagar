// biome-ignore-all lint/a11y/noNoninteractiveTabindex: the scrollable chapter region must support keyboard scrolling.
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { StatusNotice } from "../../components/StatusNotice";
import {
  exportEpub,
  pickExportDestination,
  reviewExport,
  type BilingualAlignmentExport,
} from "../../lib/tauri/commands";
import type { ExportOutcome, ExportReview } from "../../types/chapter";
import type { ProjectSummary } from "../../types/project";

type ExportDialogProps = {
  project: ProjectSummary;
  onClose: () => void;
  /** Flushes pending chapter saves before reviewing/exporting. */
  onFlushSaves: () => Promise<boolean>;
  onOutcome: (outcome: ExportOutcome) => void;
};

function cachedAlignmentsForChapter(chapterId: string): BilingualAlignmentExport[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(`sagar:bilingual-alignments:v2:${chapterId}`) ?? "null",
    );
    if (!value || typeof value !== "object" || !("matches" in value)) return [];
    const matches = (value as { matches?: unknown }).matches;
    if (!Array.isArray(matches)) return [];
    return matches.filter(
      (match): match is BilingualAlignmentExport =>
        !!match &&
        typeof match === "object" &&
        "sourceText" in match &&
        typeof match.sourceText === "string" &&
        "targetText" in match &&
        typeof match.targetText === "string" &&
        "meaning" in match &&
        typeof match.meaning === "string" &&
        "grammarNote" in match &&
        typeof match.grammarNote === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Export review dialog: metadata fields, actionable chapter counts and an
 * explicit draft acknowledgement, per the export design rules.
 */
export function ExportDialog({
  project,
  onClose,
  onFlushSaves,
  onOutcome,
}: ExportDialogProps) {
  const [review, setReview] = useState<ExportReview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState(project.title);
  const [language, setLanguage] = useState(project.targetLanguage);
  const [languageError, setLanguageError] = useState<string | null>(null);
  const [draftAck, setDraftAck] = useState(false);
  const [includeOriginal, setIncludeOriginal] = useState(true);
  const [bilingual, setBilingual] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      previousFocus.current?.focus();
    };
  }, []);

  const loadReview = useCallback(() => {
    setLoadError(null);
    onFlushSaves()
      .then((ok) => {
        if (!ok) {
          setLoadError("The chapter could not be saved. Resolve its save error first.");
          return null;
        }
        return reviewExport(project.id);
      })
      .then((result) => {
        if (result) {
          setReview(result);
          if (result.translatedTitle !== null && result.translatedTitle !== "") {
            setTitle(result.translatedTitle);
          }
        }
      })
      .catch((error: unknown) => {
        setLoadError(
          error instanceof Error
            ? error.message
            : "The export review could not be loaded.",
        );
      });
  }, [onFlushSaves, project.id]);

  useEffect(() => {
    loadReview();
  }, [loadReview]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (!exporting) onClose();
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
          ) ?? [],
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialogRef.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, exporting]);

  const languageValid =
    language.trim().length > 0 &&
    [...language.trim()].every((c) => /[A-Za-z0-9-]/.test(c));

  const translatedChapters =
    review?.chapters.filter((c) => c.reviewed || c.draft).length ?? 0;

  async function runExport(mode: "completed" | "draft") {
    if (!review) {
      return;
    }
    if (!languageValid) {
      setLanguageError("Enter a language tag such as “my” or “en-US”.");
      return;
    }
    if (mode === "draft" && !draftAck) {
      return;
    }
    if (mode === "draft" && !includeOriginal && translatedChapters === 0) {
      setExportError(
        "No translated chapters to export. Translate at least one chapter or enable original content.",
      );
      return;
    }
    setExportError(null);
    setLanguageError(null);
    const fileBase = (title.trim() || review.title).replace(/[\\/:*?"<>|]/g, "_");
    const destination = await pickExportDestination(
      `${fileBase}-${language.trim()}${bilingual ? "-bilingual" : ""}.epub`,
    );
    if (destination === null) {
      return; // Save dialog cancelled.
    }
    setExporting(true);
    try {
      const outcome = await exportEpub(
        project.id,
        destination,
        mode,
        title.trim() === "" ? null : title.trim(),
        language.trim(),
        mode === "draft" ? includeOriginal : true,
        bilingual,
        bilingual
          ? Object.fromEntries(
              review.chapters
                .map((chapter) => [chapter.chapterId, cachedAlignmentsForChapter(chapter.chapterId)] as const)
                .filter(([, matches]) => matches.length > 0),
            )
          : {},
      );
      onOutcome(outcome);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "The book could not be exported.",
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="panel__header export-dialog__header">
          <h2 className="panel__heading" id="export-dialog-title">
            Export EPUB
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            title="Close"
            disabled={exporting}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>

        {loadError ? (
          <StatusNotice kind="error" onRetry={loadReview}>
            {loadError}
          </StatusNotice>
        ) : null}
        {!loadError && !review ? (
          <StatusNotice kind="loading">Reviewing saved translations…</StatusNotice>
        ) : null}

        {review ? (
          <>
            <div className="export-dialog__settings">
              <div className="form-grid">
                <label className="form-field">
                  <span>Translated title</span>
                  <input
                    type="text"
                    value={title}
                    placeholder={review.title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Target language (BCP 47)</span>
                  <input
                    type="text"
                    value={language}
                    onChange={(event) => {
                      setLanguage(event.target.value);
                      setLanguageError(null);
                    }}
                    aria-invalid={language !== "" && !languageValid}
                  />
                  {languageError ? (
                    <span className="form-field__error">{languageError}</span>
                  ) : null}
                </label>
              </div>

              <p className="export-dialog__explanation">
                Draft export includes{" "}
                <strong>reviewed translations and saved drafts</strong>.{" "}
                {includeOriginal ? (
                  <>
                    Empty chapters and chapters marked “Keep original” retain the original
                    content.
                  </>
                ) : (
                  <>
                    Empty chapters and chapters marked “Keep original” are{" "}
                    <strong>omitted</strong> — the draft contains only translated
                    chapters.
                  </>
                )}
              </p>
              {!review.complete ? (
                <label className="export-ack">
                  <input
                    type="checkbox"
                    checked={includeOriginal}
                    onChange={(event) => setIncludeOriginal(event.target.checked)}
                  />
                  <span>Include original content for untranslated chapters.</span>
                </label>
              ) : null}
              <label className="export-ack">
                <input
                  type="checkbox"
                  checked={bilingual}
                  onChange={(event) => setBilingual(event.target.checked)}
                />
                <span>
                  Export a bilingual EPUB (original {review.sourceLanguage ?? "source"} followed by translation).
                </span>
              </label>
              {bilingual ? (
                <p className="dialog__muted">
                  Previously analyzed word colors and meaning notes are included when available. Open each chapter in the bilingual reader first to analyze it.
                </p>
              ) : null}
              <div className="export-summary">
                <span className="export-chip export-chip--success">
                  {review.reviewedTotal} reviewed
                </span>
                <span className="export-chip">{review.skippedTotal} keep original</span>
                <span className="export-chip export-chip--warning">
                  {review.draftTotal} draft
                </span>
                <span className="export-chip export-chip--warning">
                  {review.pendingTotal} not translated
                </span>
                {review.unsupportedTotal > 0 ? (
                  <span className="export-chip export-chip--muted">
                    {review.unsupportedTotal} preserved unsupported
                  </span>
                ) : null}
              </div>
            </div>
            {review.chapters.length > 0 ? (
              <section
                className="export-dialog__chapters"
                aria-label="Chapter export review"
                tabIndex={0}
              >
                <table className="export-table">
                  <thead>
                    <tr>
                      <th scope="col">Chapter</th>
                      <th scope="col">Status</th>
                      <th scope="col">Draft export includes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {review.chapters.map((chapter) => (
                      <tr key={chapter.chapterId}>
                        <td>{chapter.title}</td>
                        <td>
                          <span
                            className={`chapter-export-status chapter-export-status--${chapter.reviewed ? "reviewed" : chapter.draft ? "draft" : "original"}`}
                          >
                            {chapter.reviewed
                              ? "Reviewed"
                              : chapter.skipped
                                ? "Keep original"
                                : chapter.draft
                                  ? "Draft"
                                  : "Not translated"}
                          </span>
                        </td>
                        <td>
                          {chapter.reviewed || chapter.draft
                            ? "Saved translation"
                            : includeOriginal
                              ? "Original content"
                              : "Omitted"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}

            <div className="export-dialog__footer">
              {!review.complete ? (
                <label className="export-ack">
                  <input
                    type="checkbox"
                    checked={draftAck}
                    onChange={(event) => setDraftAck(event.target.checked)}
                  />
                  <span>
                    Include unreviewed drafts. I understand these translations may be
                    incomplete.
                  </span>
                </label>
              ) : null}

              {exportError ? (
                <StatusNotice kind="error">{exportError}</StatusNotice>
              ) : null}

              <div className="button-row dialog__actions">
                <button
                  type="button"
                  className={`btn${review.complete ? " btn--primary" : ""}`}
                  disabled={!review.complete || exporting}
                  onClick={() => void runExport("completed")}
                  title={
                    review.complete
                      ? "All chapters are reviewed or intentionally kept original"
                      : "Finish reviewing every chapter to enable a completed export"
                  }
                >
                  <Icon name="download" />
                  Export completed EPUB
                </button>
                <button
                  type="button"
                  className={`btn${!review.complete ? " btn--primary" : ""}`}
                  disabled={
                    review.complete ||
                    !draftAck ||
                    exporting ||
                    (!includeOriginal && translatedChapters === 0)
                  }
                  onClick={() => void runExport("draft")}
                  title={
                    !includeOriginal && translatedChapters === 0
                      ? "Translate at least one chapter or enable original content"
                      : undefined
                  }
                >
                  <Icon name="download" />
                  Export draft…
                </button>
              </div>
              <p className="dialog__muted">
                Save a separate EPUB to a location you choose. Your original book stays
                unchanged.
              </p>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
