import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { Splitter } from "../../components/Splitter";
import { StatusNotice } from "../../components/StatusNotice";
import { formatDirection } from "../../lib/languages";
import {
  loadSidebarWidth,
  loadSourceWidth,
  saveSidebarWidth,
  saveSourceWidth,
} from "../../lib/prefs";
import {
  getChapter,
  getLastChapter,
  getProject,
  listChapters,
} from "../../lib/tauri/commands";
import type { ChapterContent, ExportOutcome } from "../../types/chapter";
import type { ChapterSummary, ImportWarning, ProjectSummary } from "../../types/project";
import { ChapterPicker } from "../chapters/ChapterPicker";
import { ChapterSidebar } from "../chapters/ChapterSidebar";
import { ExportDialog } from "../export/ExportDialog";
import { SourcePane } from "../reader/SourcePane";
import { AiGenerateDialog, type TranslationPhase } from "../translator/AiGenerateDialog";
import { TargetPane } from "../translator/TargetPane";
import { useChapterEditor } from "../translator/useChapterEditor";
import { BookSettingsDialog } from "./BookSettingsDialog";
import { LanguageDialog } from "./LanguageDialog";

type ProjectState =
  | { status: "loading" }
  | { status: "ready"; project: ProjectSummary; chapters: ChapterSummary[] }
  | { status: "error"; message: string };

type ContentState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; content: ChapterContent }
  | { status: "error"; message: string };

type WorkspaceFrameProps = {
  projectId: string;
  importWarnings: ImportWarning[];
  onBackToLibrary: () => void;
};

const SAVE_LABEL: Record<string, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  error: "Couldn't save · see chapter",
};

export function WorkspaceFrame({
  projectId,
  importWarnings,
  onBackToLibrary,
}: WorkspaceFrameProps) {
  const [projectState, setProjectState] = useState<ProjectState>({
    status: "loading",
  });
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [contentState, setContentState] = useState<ContentState>({
    status: "idle",
  });
  const [warningsVisible, setWarningsVisible] = useState(importWarnings.length > 0);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [sourceWidth, setSourceWidth] = useState(loadSourceWidth);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportOutcome, setExportOutcome] = useState<ExportOutcome | null>(null);
  const [langOpen, setLangOpen] = useState(false);
  const [bookSettingsOpen, setBookSettingsOpen] = useState(false);
  const [translationChapterId, setTranslationChapterId] = useState<string | null>(null);
  const [translationHidden, setTranslationHidden] = useState(false);
  const [translationPhase, setTranslationPhase] = useState<TranslationPhase>("idle");
  const readingRef = useRef<HTMLDivElement>(null);
  const loadSequence = useRef(0);
  const contentRef = useRef<ChapterContent | null>(null);

  const loadChapter = useCallback(
    (chapterId: string) => {
      const sequence = ++loadSequence.current;
      setContentState({ status: "loading" });
      getChapter(projectId, chapterId)
        .then((content) => {
          if (sequence !== loadSequence.current) return;
          contentRef.current = content;
          setContentState({ status: "ready", content });
        })
        .catch((error: unknown) => {
          if (sequence !== loadSequence.current) return;
          contentRef.current = null;
          setContentState({
            status: "error",
            message:
              error instanceof Error ? error.message : "The chapter could not be loaded.",
          });
        });
    },
    [projectId],
  );

  useEffect(() => {
    let cancelled = false;
    setProjectState({ status: "loading" });
    Promise.all([
      getProject(projectId),
      listChapters(projectId),
      getLastChapter(projectId),
    ])
      .then(([project, chapters, lastChapterId]) => {
        if (cancelled) {
          return;
        }
        setProjectState({ status: "ready", project, chapters });
        const initial =
          lastChapterId && chapters.some((chapter) => chapter.id === lastChapterId)
            ? lastChapterId
            : (chapters[0]?.id ?? null);
        setActiveChapterId(initial);
        if (initial !== null) {
          loadChapter(initial);
        } else {
          setContentState({ status: "idle" });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setProjectState({
            status: "error",
            message:
              error instanceof Error ? error.message : "The project could not be loaded.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadChapter, projectId]);

  const editor = useChapterEditor(
    contentState.status === "ready" ? contentState.content : null,
  );

  const continueTranslation = useCallback(
    async (currentChapterId: string): Promise<string | null | "save-failed"> => {
      if (projectState.status !== "ready") return null;
      const ordered = [...projectState.chapters].sort(
        (a, b) => a.spineIndex - b.spineIndex,
      );
      const currentIndex = ordered.findIndex(
        (chapter) => chapter.id === currentChapterId,
      );
      const next = ordered[currentIndex + 1];
      if (!next) return null;
      if (!(await editor.flushAll())) return "save-failed";
      setActiveChapterId(next.id);
      loadChapter(next.id);
      setTranslationChapterId(next.id);
      setTranslationHidden(false);
      return next.id;
    },
    [editor, loadChapter, projectState],
  );

  const selectChapter = useCallback(
    (chapterId: string) => {
      if (chapterId === activeChapterId) {
        return;
      }
      // Flush pending writes before navigation; keep the current chapter if
      // saving fails so work is never silently discarded.
      void editor.flushAll().then((ok) => {
        if (ok) {
          setActiveChapterId(chapterId);
          loadChapter(chapterId);
        }
      });
    },
    [activeChapterId, editor, loadChapter],
  );

  const reloadAfterConflict = useCallback(() => {
    if (activeChapterId !== null) {
      loadChapter(activeChapterId);
    }
  }, [activeChapterId, loadChapter]);

  // Cmd/Ctrl+S flushes pending saves and shows the real result.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void editor.flushAll();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editor]);

  const persistSidebar = useCallback((value: number) => {
    setSidebarWidth(value);
    saveSidebarWidth(value);
  }, []);

  const persistSource = useCallback((value: number) => {
    setSourceWidth(value);
    saveSourceWidth(value);
  }, []);

  const chapters = projectState.status === "ready" ? projectState.chapters : [];
  const project = projectState.status === "ready" ? projectState.project : null;
  const content = contentState.status === "ready" ? contentState.content : null;
  const activeChapter =
    chapters.find((chapter) => chapter.id === activeChapterId) ?? null;
  const translatingChapter = chapters.find(
    (chapter) => chapter.id === translationChapterId,
  );

  return (
    <div className="workspace">
      <header className="workspace__toolbar">
        <button
          type="button"
          className="icon-button"
          aria-label="Back to library"
          title={
            translationPhase === "running" && translationChapterId
              ? "Back to library (cancels translation)"
              : "Back to library"
          }
          onClick={() => {
            void editor.flushAll().then((ok) => {
              if (ok) onBackToLibrary();
            });
          }}
        >
          <Icon name="back" />
        </button>
        <p className="workspace__book">
          <span className="workspace__book-title">{project?.title ?? "Loading…"}</span>
        </p>
        <div className="workspace__chapterbar">
          <button
            type="button"
            className="icon-button"
            aria-label="Chapters"
            title="Toggle chapter sidebar"
            aria-expanded={sidebarVisible}
            onClick={() => setSidebarVisible(!sidebarVisible)}
          >
            <Icon name="sidebar" />
          </button>
          <ChapterPicker
            chapters={chapters}
            chapterId={activeChapterId}
            disabled={!chapters.length || contentState.status === "loading"}
            onSelect={selectChapter}
          />
          <div className="workspace__chapter-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Previous chapter"
              title="Previous chapter"
              disabled={
                !activeChapter ||
                activeChapter.spineIndex === 0 ||
                contentState.status === "loading"
              }
              onClick={() => {
                const index = chapters.findIndex(
                  (chapter) => chapter.id === activeChapterId,
                );
                if (chapters[index - 1]) selectChapter(chapters[index - 1].id);
              }}
            >
              <Icon name="left" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Next chapter"
              title="Next chapter"
              disabled={
                !activeChapter ||
                activeChapter.spineIndex === chapters.length - 1 ||
                contentState.status === "loading"
              }
              onClick={() => {
                const index = chapters.findIndex(
                  (chapter) => chapter.id === activeChapterId,
                );
                if (chapters[index + 1]) selectChapter(chapters[index + 1].id);
              }}
            >
              <Icon name="right" />
            </button>
          </div>
        </div>
        <button
          type="button"
          className="btn workspace__save-action"
          aria-label="Save chapter"
          title="Save chapter (Ctrl+S)"
          disabled={
            !editor.draft ||
            editor.draft.conflict ||
            editor.indicator === "saving" ||
            (!editor.draft.dirty && !editor.draft.error)
          }
          onClick={() => {
            if (editor.draft?.error) void editor.retry();
            else void editor.flushAll();
          }}
        >
          <Icon name={editor.indicator === "saving" ? "refresh" : "save"} spin={editor.indicator === "saving"} />
          {editor.indicator === "saving" ? "Saving…" : "Save"}
        </button>
        <span
          className={`workspace__save workspace__save--${editor.indicator}`}
          role="status"
          aria-live="polite"
        >
          {SAVE_LABEL[editor.indicator]}
        </span>
        {translationChapterId ? (
          <button
            type="button"
            className="btn workspace__translation"
            onClick={() => setTranslationHidden(false)}
            title={`Open translation progress: ${translatingChapter?.title ?? "chapter"}`}
            aria-label="Open translation progress"
          >
            <Icon
              name={translationPhase === "running" ? "refresh" : "sparkles"}
              spin={translationPhase === "running"}
            />
            <span role="status">
              {translationPhase === "running"
                ? "Translating"
                : translationPhase === "proposal"
                  ? "Translation ready"
                  : translationPhase === "failed"
                    ? "Translation failed"
                    : translationPhase === "repair"
                      ? "HTML needs repair"
                      : "Translation"}
              {" · "}
              {translatingChapter ? `Ch. ${translatingChapter.spineIndex + 1}` : ""}
            </span>
          </button>
        ) : null}
        <button
          type="button"
          className="icon-button"
          aria-label="Export EPUB"
          title="Export EPUB"
          disabled={projectState.status !== "ready"}
          onClick={() => setExportOpen(true)}
        >
          <Icon name="download" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Book settings"
          title="Book metadata and AI instructions"
          disabled={!project}
          onClick={() => setBookSettingsOpen(true)}
        >
          <Icon name="settings" />
        </button>
      </header>

      {projectState.status === "loading" ? (
        <div className="workspace__notice">
          <StatusNotice kind="loading">Loading project…</StatusNotice>
        </div>
      ) : null}
      {projectState.status === "error" ? (
        <div className="workspace__notice">
          <StatusNotice kind="error" onRetry={onBackToLibrary}>
            {projectState.message}
          </StatusNotice>
        </div>
      ) : null}

      {warningsVisible && importWarnings.length > 0 ? (
        <section className="panel workspace__warnings" aria-label="Import notes">
          <div className="panel__header">
            <h2 className="panel__heading">Import notes</h2>
            <button
              type="button"
              className="btn"
              onClick={() => setWarningsVisible(false)}
            >
              <Icon name="close" />
              Dismiss
            </button>
          </div>
          <ul className="warning-list">
            {importWarnings.map((warning, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static per-import list
              <li key={`${warning.code}-${index}`} className="warning-list__item">
                {warning.location ? (
                  <strong className="warning-list__location">{warning.location}</strong>
                ) : null}
                <span>{warning.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="workspace__body">
        {sidebarVisible ? (
          <>
            <div className="workspace__sidebar" style={{ width: sidebarWidth }}>
              <ChapterSidebar
                chapters={chapters}
                activeChapterId={activeChapterId}
                chapterStatusOverride={editor.chapterStatus}
                onSelect={selectChapter}
              />
            </div>
            <Splitter
              label="Resize chapters sidebar"
              orientation="vertical"
              value={sidebarWidth}
              min={200}
              max={360}
              onChange={persistSidebar}
            />
          </>
        ) : null}
        <div className="workspace__panes">
          <div
            ref={readingRef}
            className="workspace__reading"
            style={
              sourceWidth > 0
                ? { flex: `0 0 clamp(220px, ${sourceWidth}px, calc(100% - 245px))` }
                : undefined
            }
          >
            <SourcePane
              content={content}
              loading={contentState.status === "loading"}
              error={contentState.status === "error" ? contentState.message : null}
              onRetry={reloadAfterConflict}
              targetHtml={editor.draft?.html ?? content?.document.html ?? ""}
            />
          </div>
          <Splitter
            label="Resize source and translation panes"
            orientation="vertical"
            value={
              sourceWidth === 0
                ? (readingRef.current?.getBoundingClientRect().width ?? 560)
                : sourceWidth
            }
            min={320}
            max={1400}
            onChange={persistSource}
          />
          <TargetPane
            projectId={projectId}
            content={content}
            loading={contentState.status === "loading"}
            error={contentState.status === "error" ? contentState.message : null}
            onRetry={reloadAfterConflict}
            onReloadAfterConflict={reloadAfterConflict}
            editor={editor}
            onOpenTranslation={() => {
              if (!translationChapterId && content) {
                setTranslationChapterId(content.chapterId);
                setTranslationPhase("idle");
              }
              setTranslationHidden(false);
            }}
          />
        </div>
      </div>

      <footer className="workspace__status">
        {activeChapter ? (
          <>
            <span>
              Chapter {activeChapter.spineIndex + 1} of {chapters.length}
            </span>
            <span>
              {editor.draft?.status === "reviewed"
                ? "Chapter reviewed"
                : editor.draft?.status === "skipped"
                  ? "Original chapter retained"
                  : editor.draft?.status === "draft"
                    ? "Chapter draft"
                    : "Ready to write"}
            </span>
          </>
        ) : (
          <span>No chapter selected</span>
        )}
        {project ? (
          <button
            type="button"
            className="workspace__lang"
            onClick={() => setLangOpen(true)}
            title="Show and change the translation languages"
          >
            <Icon name="languages" />
            {formatDirection(project.sourceLanguage, project.targetLanguage)}
          </button>
        ) : null}
      </footer>

      {langOpen && project ? (
        <LanguageDialog
          project={project}
          onClose={() => setLangOpen(false)}
          onSaved={(updated) =>
            setProjectState((current) =>
              current.status === "ready" ? { ...current, project: updated } : current,
            )
          }
        />
      ) : null}
      {translationChapterId ? (
        <AiGenerateDialog
          projectId={projectId}
          chapterId={translationChapterId}
          chapterTitle={translatingChapter?.title}
          editor={editor}
          hidden={translationHidden}
          onBackground={() => setTranslationHidden(true)}
          onPhaseChange={setTranslationPhase}
          onOpenChapter={() => selectChapter(translationChapterId)}
          onNextChapter={continueTranslation}
          onClose={() => {
            setTranslationChapterId(null);
            setTranslationHidden(false);
          }}
        />
      ) : null}

      {bookSettingsOpen && project ? (
        <BookSettingsDialog
          project={project}
          onClose={() => setBookSettingsOpen(false)}
          onSaved={(updated) =>
            setProjectState((current) =>
              current.status === "ready" ? { ...current, project: updated } : current,
            )
          }
        />
      ) : null}
      {exportOpen && project ? (
        <ExportDialog
          project={project}
          onClose={() => setExportOpen(false)}
          onFlushSaves={editor.flushAll}
          onOutcome={(outcome) => {
            setExportOutcome(outcome);
            setExportOpen(false);
          }}
        />
      ) : null}
      {exportOutcome ? (
        <ExportOutcomePanel
          outcome={exportOutcome}
          onDismiss={() => setExportOutcome(null)}
        />
      ) : null}
    </div>
  );
}

function ExportOutcomePanel({
  outcome,
  onDismiss,
}: {
  outcome: ExportOutcome;
  onDismiss: () => void;
}) {
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="alertdialog" aria-label="Export finished">
        <div className="panel__header">
          <h2 className="panel__heading">
            Export {outcome.mode === "completed" ? "completed" : "draft"} finished
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            title="Close"
            onClick={onDismiss}
          >
            <Icon name="close" />
          </button>
        </div>
        <StatusNotice kind="success">
          {outcome.blocksTranslated} translated chapter
          {outcome.blocksTranslated === 1 ? "" : "s"} written across{" "}
          {outcome.chaptersExported} chapter{outcome.chaptersExported === 1 ? "" : "s"}.
        </StatusNotice>
        <p className="dialog__path">
          Output file:
          <code>{outcome.outputPath}</code>
        </p>
        {outcome.warnings.length > 0 ? (
          <ul className="warning-list">
            {outcome.warnings.map((warning, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static per-export list
              <li key={`${warning.code}-${index}`} className="warning-list__item">
                {warning.location ? (
                  <strong className="warning-list__location">{warning.location}</strong>
                ) : null}
                <span>{warning.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dialog__muted">No validation warnings.</p>
        )}
      </div>
    </div>
  );
}
