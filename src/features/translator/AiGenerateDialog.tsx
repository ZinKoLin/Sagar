import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { StatusNotice } from "../../components/StatusNotice";
import { formatDirection } from "../../lib/languages";
import { loadTranslationTimeout, saveTranslationTimeout } from "../../lib/prefs";
import {
  cancelAiTranslation,
  getTranslationSelection,
  listAiProviders,
  startAiTranslation,
} from "../../lib/tauri/ai";
import { getBookSettings, getProject } from "../../lib/tauri/commands";
import { CommandError } from "../../lib/tauri/errors";
import type {
  AiProviderList,
  AiTranslationEvent,
  TranslationSelection,
} from "../../types/ai";
import type { ProjectSummary } from "../../types/project";
import { agentLabel } from "../settings/TranslationModelSection";
import { hasContent } from "./richText";
import type { useChapterEditor } from "./useChapterEditor";

type Phase = "idle" | "running" | "proposal" | "failed";

/** Silence before a running job shows a stall warning (job keeps running). */
const STALL_WARNING_AFTER_SECS = 120;

function plainText(html: string): string {
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
}

/**
 * AI proposal dialog: confirms the agent/model/direction and consent, then
 * streams the tool's output live while it translates. Proposals keep the
 * original HTML structure with only text translated. Empty drafts receive the
 * result straight into the Rich editor; anything with content previews
 * read-only and enters the draft only on explicit Insert — reviewed or
 * existing manual text is never overwritten silently.
 */
export function AiGenerateDialog({
  projectId,
  chapterId,
  editor,
  onClose,
}: {
  projectId: string;
  chapterId: string;
  editor: ReturnType<typeof useChapterEditor>;
  onClose: () => void;
}) {
  const [providers, setProviders] = useState<AiProviderList | null>(null);
  const [selection, setSelection] = useState<TranslationSelection | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [bookInstructions, setBookInstructions] = useState("");
  const [currentInstructions, setCurrentInstructions] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [proposal, setProposal] = useState<string | null>(null);
  const [streamed, setStreamed] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmInsert, setConfirmInsert] = useState(false);
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [stalledSecs, setStalledSecs] = useState(0);
  const [timeoutMinutes, setTimeoutMinutes] = useState(loadTranslationTimeout);
  const [eventsDead, setEventsDead] = useState(false);
  const lastOutputAt = useRef<number>(Date.now());
  const jobId = useRef<string | null>(null);
  const starting = useRef(false);
  const closed = useRef(false);
  const pendingEvents = useRef<AiTranslationEvent[]>([]);
  const receiveEvent = useRef<(event: AiTranslationEvent) => void>(() => {});
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const streamRef = useRef<HTMLTextAreaElement | null>(null);
  // The event listener outlives renders; refs keep it on the latest editor.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      previousFocus.current?.focus();
    };
  }, []);

  const handleClose = useCallback(() => {
    closed.current = true;
    // Closing mid-run cancels the job; the draft is always untouched.
    if (jobId.current) {
      const running = jobId.current;
      jobId.current = null;
      void cancelAiTranslation(running).catch(() => {});
    }
    closeRef.current();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        handleClose();
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
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
  }, [handleClose]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listAiProviders(),
      getTranslationSelection(),
      getProject(projectId),
      getBookSettings(projectId),
    ])
      .then(([list, saved, current, book]) => {
        if (cancelled) return;
        setProviders(list);
        setSelection(saved);
        setProject(current);
        setBookInstructions(book.instructions);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof CommandError
            ? error.message
            : "AI settings could not be loaded.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Own exactly one job: events for other chapters are ignored, and closing
  // the dialog cancels the in-flight run.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const handleEvent = (payload: AiTranslationEvent) => {
      if (payload.chapterId !== chapterId || payload.jobId !== jobId.current) {
        return;
      }
      if (payload.kind === "started") {
        // The worker is alive; the elapsed ticker shows progress.
        return;
      }
      if (payload.kind === "stream") {
        setStreamed(payload.partialText ?? "");
        lastOutputAt.current = Date.now();
        setStalledSecs(0);
        // Follow the live output; runs after paint so the new text is laid out.
        requestAnimationFrame(() => {
          if (streamRef.current) {
            streamRef.current.scrollTop = streamRef.current.scrollHeight;
          }
        });
        return;
      }
      if (payload.partialText != null) setStreamed(payload.partialText);
      if (payload.kind === "done" && payload.proposalHtml) {
        const current = editorRef.current;
        const emptyDraft =
          current.draft &&
          !current.draft.conflict &&
          !hasContent(current.draft.html ?? "");
        jobId.current = null;
        if (emptyDraft) {
          // Fresh chapters go straight into the Rich editor; anything with
          // content stays for explicit Insert confirmation below.
          current.setHtml(payload.proposalHtml);
          closeRef.current();
          return;
        }
        setProposal(payload.proposalHtml);
        setPhase("proposal");
        setNotice(null);
        setConfirmInsert(false);
      } else if (payload.kind === "cancelled") {
        setPhase("idle");
        setNotice("The run was cancelled. Nothing was inserted.");
      } else {
        setPhase("failed");
        setNotice(payload.message);
      }
      jobId.current = null;
    };
    receiveEvent.current = handleEvent;
    listen<AiTranslationEvent>("ai-translation-event", (event) => {
      if (starting.current && !jobId.current && event.payload.chapterId === chapterId) {
        pendingEvents.current.push(event.payload);
      } else {
        handleEvent(event.payload);
      }
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        if (!disposed) {
          setEventsDead(true);
        }
      });
    return () => {
      disposed = true;
      receiveEvent.current = () => {};
      unlisten?.();
      if (jobId.current) {
        const running = jobId.current;
        jobId.current = null;
        void cancelAiTranslation(running).catch(() => {});
      }
      setPhase("idle");
    };
  }, [chapterId]);

  // Elapsed + stall tickers while a run is in flight; translation can take
  // up to 60 minutes, and slow connections can stall output for minutes.
  useEffect(() => {
    if (phase !== "running") {
      setElapsed(0);
      setStalledSecs(0);
      return;
    }
    setElapsed(0);
    setStalledSecs(0);
    const timer = setInterval(() => {
      setElapsed((value) => value + 1);
      setStalledSecs(Math.floor((Date.now() - lastOutputAt.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const handleGenerate = useCallback(async () => {
    if (!selection || !consent || jobId.current || starting.current) {
      return;
    }
    starting.current = true;
    pendingEvents.current = [];
    lastOutputAt.current = Date.now();
    setStalledSecs(0);
    setPhase("running");
    setNotice(null);
    setProposal(null);
    const previousOutput = streamed;
    setConfirmInsert(false);
    setCopied(false);
    try {
      const started = await startAiTranslation({
        chapterId,
        agent: selection.agent,
        model: selection.model,
        consent: true,
        previousOutput,
        currentInstructions,
        reasoningEffort: selection.reasoningEffort,
        timeoutMinutes,
      });
      starting.current = false;
      if (closed.current) {
        void cancelAiTranslation(started.jobId).catch(() => {});
        return;
      }
      jobId.current = started.jobId;
      for (const event of pendingEvents.current) receiveEvent.current(event);
      pendingEvents.current = [];
    } catch (error) {
      starting.current = false;
      pendingEvents.current = [];
      if (closed.current) return;
      setPhase("failed");
      setNotice(
        error instanceof CommandError ? error.message : "The proposal could not start.",
      );
    }
  }, [chapterId, consent, selection, streamed, currentInstructions, timeoutMinutes]);

  const handleCancel = useCallback(() => {
    if (!jobId.current) {
      return;
    }
    const running = jobId.current;
    void cancelAiTranslation(running).catch(() => {
      // The worker emits the terminal event; unknown jobs are already gone.
    });
  }, []);

  const handleInsert = useCallback(() => {
    if (!proposal || !editor.draft || editor.draft.conflict) {
      return;
    }
    if (hasContent(editor.draft.html) && !confirmInsert) {
      setConfirmInsert(true);
      return;
    }
    editor.setHtml(proposal);
    setConfirmInsert(false);
    onClose();
  }, [confirmInsert, editor, onClose, proposal]);

  const handleCopy = useCallback(() => {
    if (!proposal) {
      return;
    }
    const text = plainText(proposal);
    if (typeof navigator.clipboard?.writeText !== "function") {
      setNotice("Copying is not available in this view.");
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch(() => setNotice("The proposal could not be copied."));
  }, [proposal]);

  const running = phase === "running";

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-generate-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="panel__header">
          <h2 className="panel__heading" id="ai-generate-title">
            AI translation proposal
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label={running ? "Cancel and close" : "Close"}
            title={running ? "Cancel and close" : "Close"}
            onClick={handleClose}
          >
            <Icon name="close" />
          </button>
        </div>

        {loadError ? (
          <StatusNotice kind="error">{loadError}</StatusNotice>
        ) : !providers ? (
          <StatusNotice kind="loading">Loading AI settings…</StatusNotice>
        ) : !selection ? (
          <StatusNotice kind="info">
            No translation agent selected yet. Choose one in Library → AI settings →
            Translation Model.
          </StatusNotice>
        ) : (
          <>
            <p className="dialog__muted">
              Agent{" "}
              <strong>
                {agentLabel(selection.agent, providers.cli, providers.custom)}
              </strong>{" "}
              · Model <strong>{selection.model}</strong>
              {" · "}Effort <strong>{selection.reasoningEffort ?? "Default"}</strong>
            </p>
            {project ? (
              <p className="dialog__muted" role="status">
                Translating{" "}
                {formatDirection(project.sourceLanguage, project.targetLanguage)} — the
                languages set in the workspace footer. The original formatting is sent
                along so it can be preserved.
              </p>
            ) : null}

            {phase === "idle" || phase === "failed" ? (
              <>
                {bookInstructions ? (
                  <details>
                    <summary>Book instructions</summary>
                    <p className="book-instructions">{bookInstructions}</p>
                  </details>
                ) : null}
                <label className="form-field">
                  <span>Instructions for this run (optional)</span>
                  <textarea
                    rows={3}
                    maxLength={20000}
                    value={currentInstructions}
                    onChange={(event) => {
                      setCurrentInstructions(event.target.value);
                      setStreamed("");
                    }}
                    placeholder="Additional guidance for this chapter…"
                  />
                </label>
                <p className="dialog__muted">
                  Book instructions and this run's instructions are sent together.
                  Changing these instructions restarts translation on Retry.
                </p>
                <label className="form-field">
                  <span>Time limit</span>
                  <select
                    value={timeoutMinutes}
                    onChange={(event) => {
                      const minutes = Number(event.target.value);
                      setTimeoutMinutes(minutes);
                      saveTranslationTimeout(minutes);
                    }}
                  >
                    <option value={60}>1 hour</option>
                    <option value={120}>2 hours</option>
                    <option value={240}>4 hours</option>
                    <option value={0}>No time limit</option>
                  </select>
                </label>
                {timeoutMinutes === 0 ? (
                  <p className="dialog__muted">
                    The run can keep using your allowance until it finishes or you cancel.
                  </p>
                ) : null}
                <label className="export-ack">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  <span>
                    I understand this chapter&apos;s text will be sent to{" "}
                    {agentLabel(selection.agent, providers.cli, providers.custom)} on this
                    computer to generate a proposal.
                  </span>
                </label>
                {phase === "failed" && streamed ? (
                  <p className="dialog__muted">
                    Retry keeps complete sections whose formatting matches the source and
                    translates the rest. An unfinished section starts again. If no
                    complete section can be kept, the chapter starts again. A completed
                    result is revalidated without translating again.
                  </p>
                ) : null}
                <div className="button-row">
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={!consent || editor.draft?.conflict === true}
                    onClick={() => void handleGenerate()}
                  >
                    <Icon name="refresh" />
                    {phase === "failed" ? "Retry" : "Generate"}
                  </button>
                </div>
              </>
            ) : null}

            {running ? (
              <div className="button-row">
                <button type="button" className="btn btn--cancel" onClick={handleCancel}>
                  <Icon name="close" />
                  Cancel
                </button>
              </div>
            ) : null}

            {eventsDead ? (
              <StatusNotice kind="error">
                Live progress is unavailable. If a run never finishes, close and reopen
                this dialog — your draft is untouched.
              </StatusNotice>
            ) : null}
            {running ? (
              <StatusNotice kind="loading">
                Translating… ({elapsed}s elapsed —{" "}
                {timeoutMinutes === 0
                  ? "no time limit; cancel anytime"
                  : `time limit: ${timeoutMinutes} minutes`}
                )
              </StatusNotice>
            ) : null}
            {running && stalledSecs >= STALL_WARNING_AFTER_SECS ? (
              <StatusNotice kind="info">
                No output for {stalledSecs}s — still running. Slow connections can stall
                for minutes; your draft is safe. You can wait or Cancel.
              </StatusNotice>
            ) : null}
            {running || streamed !== "" ? (
              <textarea
                ref={streamRef}
                className="ai-stream"
                aria-label="Live translation output"
                readOnly
                value={streamed}
              />
            ) : null}
            {phase === "failed" && notice ? (
              <StatusNotice kind="error">{notice}</StatusNotice>
            ) : null}
            {phase !== "failed" && notice ? (
              <StatusNotice kind="info">{notice}</StatusNotice>
            ) : null}

            {proposal ? (
              <section aria-label="AI proposal preview">
                <div
                  className="ai-proposal"
                  // The backend validates proposals against the chapter schema.
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: allowlisted server-validated fragment
                  dangerouslySetInnerHTML={{ __html: proposal }}
                />
                <div className="button-row">
                  <button
                    type="button"
                    className={confirmInsert ? "btn btn--danger" : "btn btn--primary"}
                    disabled={!editor.draft || editor.draft.conflict}
                    onClick={handleInsert}
                  >
                    <Icon name="check" />
                    {confirmInsert ? "Confirm replace draft" : "Insert into draft"}
                  </button>
                  <button type="button" className="btn" onClick={handleCopy}>
                    <Icon name="copy" />
                    {copied ? "Copied" : "Copy text"}
                  </button>
                </div>
                {confirmInsert ? (
                  <p className="dialog__muted">
                    Your current draft has content. Inserting replaces it (kept as an
                    unreviewed draft, never marked reviewed).
                  </p>
                ) : null}
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
