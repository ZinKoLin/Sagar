import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { StatusNotice } from "../../components/StatusNotice";
import { formatDirection } from "../../lib/languages";
import {
  cancelAiTranslation,
  getTranslationOutput,
  getTranslationSelection,
  listAiProviders,
  saveTranslationOutput,
  startAiTranslation,
} from "../../lib/tauri/ai";
import {
  getBookSettings,
  getProject,
  validateChapterHtml,
} from "../../lib/tauri/commands";
import { CommandError } from "../../lib/tauri/errors";
import type {
  AiProviderList,
  AiTranslationEvent,
  TranslationSelection,
} from "../../types/ai";
import type { ProjectSummary } from "../../types/project";
import { agentLabel } from "../settings/TranslationModelSection";
import { AiFixHtmlDialog } from "./AiFixHtmlDialog";
import { ApiRequestDetails } from "./ApiRequestDetails";
import { LiveTranslationPreview } from "./LiveTranslationPreview";
import { hasContent } from "./richText";
import type { useChapterEditor } from "./useChapterEditor";

export type TranslationPhase = "idle" | "running" | "proposal" | "failed" | "repair";

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
  hidden = false,
  onBackground,
  onPhaseChange,
  onOpenChapter,
  onNextChapter,
  chapterTitle,
}: {
  projectId: string;
  chapterId: string;
  editor: ReturnType<typeof useChapterEditor>;
  onClose: () => void;
  hidden?: boolean;
  onBackground?: () => void;
  onPhaseChange?: (phase: TranslationPhase) => void;
  onOpenChapter?: () => void;
  onNextChapter?: (chapterId: string) => Promise<string | null | "save-failed">;
  chapterTitle?: string;
}) {
  const [providers, setProviders] = useState<AiProviderList | null>(null);
  const [selection, setSelection] = useState<TranslationSelection | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [autoContinue, setAutoContinue] = useState(false);
  const [bookInstructions, setBookInstructions] = useState("");
  const [currentInstructions, setCurrentInstructions] = useState("");
  const [phase, setPhase] = useState<TranslationPhase>("idle");
  const [proposal, setProposal] = useState<string | null>(null);
  const [streamed, setStreamed] = useState("");
  const [apiTrace, setApiTrace] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmInsert, setConfirmInsert] = useState(false);
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [stalledSecs, setStalledSecs] = useState(0);
  const [eventsDead, setEventsDead] = useState(false);
  const [recoveryHtml, setRecoveryHtml] = useState("");
  const [savedRecoveryHtml, setSavedRecoveryHtml] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(true);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [repairOpen, setRepairOpen] = useState(false);
  const [restartConfirm, setRestartConfirm] = useState(false);
  const recoveryRef = useRef({ html: "", saved: "" });
  recoveryRef.current.html = recoveryHtml;
  recoveryRef.current.saved = savedRecoveryHtml;
  const lastOutputAt = useRef<number>(Date.now());
  const jobId = useRef<string | null>(null);
  const starting = useRef(false);
  const closed = useRef(false);
  const pendingEvents = useRef<AiTranslationEvent[]>([]);
  const receiveEvent = useRef<(event: AiTranslationEvent) => void>(() => {});
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const autoContinueRef = useRef(autoContinue);
  autoContinueRef.current = autoContinue;
  const continueNextRef = useRef<() => Promise<boolean>>(async () => false);
  const startingDraft = useRef<{ chapterId: string; version: number } | null>(null);
  const autoStartChapter = useRef<string | null>(null);
  // The event listener outlives renders; refs keep it on the latest editor.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const saveRecovery = useCallback(async () => {
    const html = recoveryRef.current.html;
    setRecoveryBusy(true);
    setRecoveryError(null);
    try {
      await saveTranslationOutput(chapterId, html);
      setSavedRecoveryHtml(html);
      recoveryRef.current.saved = html;
      return recoveryRef.current.html === html;
    } catch (error) {
      setRecoveryError(
        error instanceof Error
          ? error.message
          : "The recovery copy could not be saved. Copy the output before closing.",
      );
      return false;
    } finally {
      setRecoveryBusy(false);
    }
  }, [chapterId]);

  useEffect(() => {
    let disposed = false;
    setRecoveryLoading(true);
    getTranslationOutput(chapterId)
      .then((saved) => {
        if (disposed || starting.current || jobId.current || !saved) return;
        setStreamed(saved.html);
        setRecoveryHtml(saved.html);
        setSavedRecoveryHtml(saved.html);
        setPhase(saved.state === "partial" ? "failed" : "repair");
        setAutoContinue(false);
        autoStartChapter.current = null;
        setNotice(
          "Saved translation output restored. Review or repair its HTML without translating again.",
        );
      })
      .catch(() => {
        if (!disposed)
          setRecoveryError(
            "Saved translation output could not be loaded. Existing recovery copies have not been removed.",
          );
      })
      .finally(() => {
        if (!disposed) setRecoveryLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [chapterId]);

  useEffect(() => {
    onPhaseChange?.(phase);
  }, [onPhaseChange, phase]);

  useEffect(() => {
    if (hidden || repairOpen) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      previousFocus.current?.focus();
    };
  }, [hidden, repairOpen]);

  const handleClose = useCallback(() => {
    void (async () => {
      if (
        recoveryRef.current.html !== recoveryRef.current.saved &&
        !(await saveRecovery())
      )
        return;
      closed.current = true;
      // Closing mid-run cancels the job; the draft is always untouched.
      if (jobId.current) {
        const running = jobId.current;
        jobId.current = null;
        void cancelAiTranslation(running).catch(() => {});
      }
      closeRef.current();
    })();
  }, [saveRecovery]);

  useEffect(() => {
    if (hidden || repairOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        handleClose();
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]',
          ) ?? [],
        ).filter(
          (control) =>
            !control.closest("details:not([open])") || control.tagName === "SUMMARY",
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
  }, [handleClose, hidden, repairOpen]);

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
      if (payload.kind === "status") {
        setApiTrace((messages) =>
          messages.length < 20
            ? [...messages, payload.message]
            : [...messages.slice(0, 3), ...messages.slice(-16), payload.message],
        );
        return;
      }
      if (payload.kind === "stream") {
        setStreamed(payload.partialText ?? "");
        lastOutputAt.current = Date.now();
        setStalledSecs(0);
        return;
      }
      if (payload.partialText != null) setStreamed(payload.partialText);
      if (payload.kind === "done" && payload.proposalHtml) {
        const current = editorRef.current;
        const unchangedDraft =
          current.draft &&
          current.draft.chapterId === chapterId &&
          startingDraft.current?.chapterId === chapterId &&
          startingDraft.current.version === current.draft.version &&
          (!hiddenRef.current || autoContinueRef.current) &&
          !current.draft.conflict;
        const emptyDraft =
          unchangedDraft && !hasContent(current.draft?.html ?? "");
        const autoInsert = unchangedDraft && autoContinueRef.current;
        jobId.current = null;
        if (emptyDraft || autoInsert) {
          // Auto-continue is explicit consent to replace this chapter's draft
          // after a valid result. Without it, only empty drafts insert directly.
          current.setHtml(payload.proposalHtml);
          if (autoContinueRef.current) {
            void (async () => {
              if (!(await current.flushAll())) {
                setAutoContinue(false);
                setNotice(
                  "ပြီးသွားသောအခန်းကို မူကြမ်းထဲ သိမ်းမရသဖြင့် နောက်ခန်းဆက်ဘာသာပြန်ခြင်းကို ရပ်ထားသည်။",
                );
                return;
              }
              await continueNextRef.current();
            })();
          } else {
            closeRef.current();
          }
          return;
        }
        setProposal(payload.proposalHtml);
        setPhase("proposal");
        if (autoContinueRef.current) {
          setAutoContinue(false);
          setNotice(
            "ဒီအခန်းမှာ မူကြမ်းရှိနေတဲ့အတွက် အလိုအလျောက်ဆက်ဘာသာပြန်ခြင်းကို ရပ်ထားသည်။ အစားထိုးမီ ပြန်စစ်ပါ။",
          );
        } else setNotice(null);
        setConfirmInsert(false);
      } else if (payload.kind === "needs_repair") {
        setAutoContinue(false);
        const retained = payload.partialText ?? "";
        setRecoveryHtml(retained);
        setPhase("repair");
        setNotice(
          payload.message.replace(
            "Retry resumes from the last matching section.",
            "Repair the retained HTML without translating again.",
          ),
        );
      } else if (payload.kind === "cancelled") {
        setAutoContinue(false);
        setPhase("idle");
        setNotice("The run was cancelled. Nothing was inserted.");
      } else {
        setAutoContinue(false);
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
  // up to 30 minutes, and slow connections can stall output for minutes.
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
    if (
      !selection ||
      !consent ||
      jobId.current ||
      starting.current ||
      recoveryLoading ||
      phase === "repair"
    ) {
      return;
    }
    starting.current = true;
    const draft = editorRef.current.draft;
    startingDraft.current =
      draft?.chapterId === chapterId ? { chapterId, version: draft.version } : null;
    pendingEvents.current = [];
    lastOutputAt.current = Date.now();
    setStalledSecs(0);
    setPhase("running");
    setApiTrace([]);
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
      setAutoContinue(false);
      setPhase("failed");
      setNotice(
        error instanceof CommandError ? error.message : "The proposal could not start.",
      );
    }
  }, [
    chapterId,
    consent,
    selection,
    streamed,
    currentInstructions,
    recoveryLoading,
    phase,
  ]);

  useEffect(() => {
    if (
      !autoContinue ||
      !consent ||
      !selection ||
      autoStartChapter.current !== chapterId ||
      recoveryLoading ||
      phase !== "idle" ||
      editor.draft?.chapterId !== chapterId
    )
      return;
    autoStartChapter.current = null;
    if (editor.draft.conflict) {
      setAutoContinue(false);
      setNotice("ဒီအခန်းရဲ့ သိမ်းဆည်းမှုမှာ ပဋိပက္ခရှိနေတဲ့အတွက် နောက်ခန်းဆက်ဘာသာပြန်ခြင်းကို ရပ်ထားသည်။");
      return;
    }
    void handleGenerate();
  }, [
    autoContinue,
    chapterId,
    consent,
    editor.draft,
    handleGenerate,
    phase,
    recoveryLoading,
    selection,
  ]);

  const continueToNextChapter = useCallback(async () => {
    if (!autoContinue || !onNextChapter) return false;
    const next = await onNextChapter(chapterId);
    if (next === "save-failed") {
      setAutoContinue(false);
      setNotice("ပြီးသွားသောအခန်းကို မူကြမ်းထဲ သိမ်းမရသဖြင့် နောက်ခန်းဆက်ဘာသာပြန်ခြင်းကို ရပ်ထားသည်။");
      return false;
    }
    if (!next) {
      setAutoContinue(false);
      setNotice("အခန်းအားလုံး ဘာသာပြန်ပြီးပါပြီ။");
      setPhase("idle");
      setProposal(null);
      return false;
    }
    autoStartChapter.current = next;
    setPhase("idle");
    setProposal(null);
    setStreamed("");
    setNotice("ဒီအခန်းပြီးပါပြီ။ နောက်အခန်းအတွက် ပြင်ဆင်နေသည်…");
    return true;
  }, [autoContinue, chapterId, onNextChapter]);
  continueNextRef.current = continueToNextChapter;

  const checkRetainedHtml = useCallback(async () => {
    const html = recoveryRef.current.html;
    if (!(await saveRecovery())) return;
    setRecoveryBusy(true);
    try {
      const validated = await validateChapterHtml(html);
      if (recoveryRef.current.html !== html) return;
      setProposal(validated);
      setPhase("proposal");
      setConfirmInsert(false);
      setNotice(
        "HTML checked locally; no translation was run. Formatting may differ from the source. Review it before inserting; the original returned output remains in recovery storage.",
      );
    } catch (error) {
      setRecoveryError(
        error instanceof Error
          ? error.message
          : "The HTML still needs repair. Your translated text is kept.",
      );
    } finally {
      setRecoveryBusy(false);
    }
  }, [saveRecovery]);

  const copyRetainedHtml = useCallback(() => {
    if (typeof navigator.clipboard?.writeText !== "function") {
      setRecoveryError(
        "Copying is unavailable. Select and copy the retained HTML below.",
      );
      return;
    }
    void navigator.clipboard
      .writeText(recoveryRef.current.html)
      .then(() => setCopied(true))
      .catch(() =>
        setRecoveryError(
          "The HTML could not be copied. Select and copy the retained HTML below.",
        ),
      );
  }, []);

  const handleCancel = useCallback(() => {
    setAutoContinue(false);
    if (!jobId.current) {
      return;
    }
    const running = jobId.current;
    void cancelAiTranslation(running).catch(() => {
      // The worker emits the terminal event; unknown jobs are already gone.
    });
  }, []);

  const handleInsert = useCallback(() => {
    if (
      !proposal ||
      !editor.draft ||
      editor.draft.chapterId !== chapterId ||
      editor.draft.conflict
    ) {
      return;
    }
    if (hasContent(editor.draft.html) && !confirmInsert) {
      setConfirmInsert(true);
      return;
    }
    editor.setHtml(proposal);
    setConfirmInsert(false);
    if (autoContinueRef.current) {
      void (async () => {
        if (!(await editor.flushAll())) {
          setAutoContinue(false);
          setNotice("ပြီးသွားသောအခန်းကို မူကြမ်းထဲ သိမ်းမရသဖြင့် နောက်ခန်းဆက်ဘာသာပြန်ခြင်းကို ရပ်ထားသည်။");
          return;
        }
        await continueNextRef.current();
      })();
    } else onClose();
  }, [chapterId, confirmInsert, editor, onClose, proposal]);

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
    <>
      <div
        className="dialog-backdrop"
        style={hidden || repairOpen ? { display: "none" } : undefined}
        aria-hidden={hidden || repairOpen || undefined}
      >
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
              {chapterTitle ? (
                <p className="dialog__muted">
                  Chapter: <strong>{chapterTitle}</strong>
                </p>
              ) : null}
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
              {recoveryLoading ? (
                <StatusNotice kind="loading">
                  Checking saved translation output…
                </StatusNotice>
              ) : null}
              {recoveryError ? (
                <StatusNotice kind="error">{recoveryError}</StatusNotice>
              ) : null}
              {phase === "repair" ? (
                <section aria-label="Retained translation recovery">
                  <p className="dialog__muted">
                    Your translated text is kept separately from the saved chapter draft.
                    Edit or repair only this HTML; Check HTML runs locally and never
                    starts translation. Formatting can differ from the source, so review
                    before inserting.
                  </p>
                  <label className="form-field">
                    <span>Retained translation HTML</span>
                    <textarea
                      className="ai-stream"
                      aria-label="Retained translation HTML"
                      value={recoveryHtml}
                      disabled={recoveryBusy}
                      onChange={(event) => {
                        setRecoveryHtml(event.target.value);
                        setRecoveryError(null);
                      }}
                    />
                  </label>
                  <p className="dialog__muted" role="status">
                    {recoveryBusy
                      ? "Saving / checking…"
                      : recoveryHtml === savedRecoveryHtml
                        ? "Recovery copy saved locally"
                        : "Save recovery edits before closing"}
                  </p>
                  <div className="button-row">
                    <button
                      type="button"
                      className="btn"
                      disabled={recoveryBusy}
                      onClick={() => void saveRecovery()}
                    >
                      <Icon name="save" />
                      {recoveryBusy ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={recoveryBusy || !recoveryHtml.trim()}
                      onClick={() => void checkRetainedHtml()}
                    >
                      <Icon name="check" />
                      Check HTML
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={recoveryBusy || !recoveryHtml.trim()}
                      onClick={() => {
                        void saveRecovery().then((ok) => {
                          if (ok) setRepairOpen(true);
                        });
                      }}
                    >
                      <Icon name="code" />
                      Repair HTML only
                    </button>
                    <button type="button" className="btn" onClick={copyRetainedHtml}>
                      <Icon name="copy" />
                      {copied ? "Copied" : "Copy HTML"}
                    </button>
                  </div>
                </section>
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
                      }}
                      placeholder="Additional guidance for this chapter…"
                    />
                  </label>
                  <p className="dialog__muted">
                    Book instructions and this run's instructions are sent together. Retry
                    applies updated guidance to unfinished sections; retained output is
                    kept.
                  </p>
                  <label className="export-ack">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                    />
                    <span>
                      I understand this chapter&apos;s text
                      {autoContinue ? "၊ နောက်ဆက်တွဲအခန်းများ၏ စာသားကိုပါ" : ""} will be sent to{" "}
                      {agentLabel(selection.agent, providers.cli, providers.custom)}
                      {selection.agent.startsWith("custom:")
                        ? " at its configured API endpoint"
                        : " through its installed tool"}{" "}
                      to generate a proposal.
                    </span>
                  </label>
                  {onNextChapter ? (
                    <>
                      <label className="export-ack">
                        <input
                          type="checkbox"
                          checked={autoContinue}
                          onChange={(event) => setAutoContinue(event.target.checked)}
                        />
                        <span>အခန်းပြီးတိုင်း ဘာသာပြန်ချက်ကို သိမ်းထည့်ပြီး နောက်အခန်းဆက်မည် (ရှိပြီးသားမူကြမ်းကို အစားထိုးနိုင်သည်)</span>
                      </label>
                      {autoContinue ? (
                        <p className="dialog__muted">
                          စစ်ဆေးမှုအောင်မြင်သော ဘာသာပြန်ချက်ကို အလိုအလျောက် သိမ်းထည့်ပါမည်။ မူကြမ်းရှိပြီးသားဆိုလျှင်
                          အစားထိုးပြီး မစစ်ဆေးရသေးသော မူကြမ်းအဖြစ် သိမ်းပါမည်။ သိမ်းမရခြင်း၊ ဘာသာပြန်/HTML အမှား၊
                          သို့မဟုတ် စာအုပ်အဆုံးရောက်လျှင် ရပ်ပါမည်။ Cancel နှိပ်လျှင် အစီအစဉ်တစ်ခုလုံး ရပ်ပါမည်။
                        </p>
                      ) : null}
                    </>
                  ) : null}
                  {phase === "failed" && streamed ? (
                    <p className="dialog__muted">
                      Retry keeps complete sections whose formatting matches the source
                      and translates the rest. An unfinished section starts again. If no
                      complete section can be kept, the chapter starts again. A completed
                      result is revalidated without translating again.
                    </p>
                  ) : null}
                  <div className="button-row">
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={
                        !consent || recoveryLoading || editor.draft?.conflict === true
                      }
                      onClick={() => void handleGenerate()}
                    >
                      <Icon name="refresh" />
                      {phase === "failed" ? "Retry" : "Generate"}
                    </button>
                  </div>
                </>
              ) : null}
              {phase === "failed" && streamed ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setRecoveryHtml(streamed);
                    setPhase("repair");
                  }}
                >
                  <Icon name="code" />
                  Review retained HTML
                </button>
              ) : null}
              {phase === "repair" ? (
                <div>
                  <button
                    type="button"
                    className="btn"
                    disabled={recoveryBusy}
                    onClick={() => setRestartConfirm(true)}
                  >
                    <Icon name="refresh" />
                    New translation…
                  </button>
                  {restartConfirm ? (
                    <div>
                      <p className="dialog__muted">
                        A new translation sends the source again. Existing recovery copies
                        will be kept.
                      </p>
                      <button
                        type="button"
                        className="btn btn--danger"
                        disabled={recoveryBusy}
                        onClick={() => {
                          void saveRecovery().then((ok) => {
                            if (!ok) return;
                            setRecoveryHtml("");
                            setSavedRecoveryHtml("");
                            setStreamed("");
                            setPhase("idle");
                            setConsent(false);
                            setRestartConfirm(false);
                            setNotice(null);
                          });
                        }}
                      >
                        <Icon name="refresh" />
                        Start new translation
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setRestartConfirm(false)}
                      >
                        <Icon name="close" />
                        Cancel
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {running ? (
                <div className="button-row">
                  {onBackground ? (
                    <button type="button" className="btn" onClick={onBackground}>
                      <Icon name="minus" />
                      Run in background
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn--cancel"
                    onClick={handleCancel}
                  >
                    <Icon name="close" />
                    Cancel
                  </button>
                </div>
              ) : null}
              {running && onBackground ? (
                <p className="dialog__muted">
                  Run in background to read or edit other chapters. Keep this book open
                  while translation runs.
                </p>
              ) : null}

              {eventsDead ? (
                <StatusNotice kind="error">
                  Live progress is unavailable. If a run never finishes, close and reopen
                  this dialog — your draft is untouched.
                </StatusNotice>
              ) : null}
              {running ? (
                <StatusNotice kind="loading">
                  Translating… ({elapsed}s elapsed — this can take up to 30 minutes)
                </StatusNotice>
              ) : null}
              {running && stalledSecs >= STALL_WARNING_AFTER_SECS ? (
                <StatusNotice kind="info">
                  No answer text for {stalledSecs}s. Your draft is safe. You can wait or
                  Cancel.
                  {selection.agent.startsWith("custom:")
                    ? " Open API request details below to check the response and reasoning activity."
                    : " The tool has not returned more answer text yet."}
                </StatusNotice>
              ) : null}
              <ApiRequestDetails messages={apiTrace} />
              {running || streamed !== "" ? (
                <LiveTranslationPreview html={streamed} running={running} />
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
                    {editor.draft?.chapterId !== chapterId && onOpenChapter ? (
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={onOpenChapter}
                      >
                        <Icon name="book" />
                        Open translated chapter
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={confirmInsert ? "btn btn--danger" : "btn btn--primary"}
                      disabled={
                        !editor.draft ||
                        editor.draft.chapterId !== chapterId ||
                        editor.draft.conflict
                      }
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
      {repairOpen ? (
        <AiFixHtmlDialog
          chapterId={chapterId}
          html={recoveryHtml}
          onApply={(fixed) => {
            setRecoveryHtml(fixed);
            setRepairOpen(false);
            setNotice(
              "Formatting repaired without translating again. Check HTML to review and insert this result; the original returned output is kept.",
            );
          }}
          onClose={() => setRepairOpen(false)}
        />
      ) : null}
    </>
  );
}
