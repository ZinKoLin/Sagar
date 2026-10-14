import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { StatusNotice } from "../../components/StatusNotice";
import {
  cancelAiTranslation,
  getTranslationSelection,
  listAiProviders,
  startAiHtmlFix,
} from "../../lib/tauri/ai";
import { CommandError } from "../../lib/tauri/errors";
import type {
  AiHtmlFixEvent,
  AiProviderList,
  TranslationSelection,
} from "../../types/ai";
import { agentLabel } from "../settings/TranslationModelSection";

type Phase = "idle" | "running" | "fixed" | "failed";

/**
 * AI HTML-fix dialog. Sends the user's *current* Translation HTML to the
 * selected local CLI, which restructures it into rich-text-compatible XHTML
 * without translating. The backend validates the result; the frontend fills
 * it into the draft only when the user presses Apply — the saved draft and
 * the source EPUB are untouched until then.
 */
export function AiFixHtmlDialog({
  chapterId,
  html,
  onApply,
  onClose,
}: {
  chapterId: string;
  html: string;
  onApply: (fixedHtml: string) => void;
  onClose: () => void;
}) {
  const [providers, setProviders] = useState<AiProviderList | null>(null);
  const [selection, setSelection] = useState<TranslationSelection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [fixed, setFixed] = useState<string | null>(null);
  const [streamed, setStreamed] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [eventsDead, setEventsDead] = useState(false);
  const jobId = useRef<string | null>(null);
  const starting = useRef(false);
  const closed = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const streamRef = useRef<HTMLTextAreaElement | null>(null);
  const htmlRef = useRef(html);
  htmlRef.current = html;
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
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
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
    Promise.all([listAiProviders(), getTranslationSelection()])
      .then(([list, saved]) => {
        if (cancelled) return;
        setProviders(list);
        setSelection(saved);
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
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const handleEvent = (payload: AiHtmlFixEvent) => {
      if (payload.chapterId !== chapterId || payload.jobId !== jobId.current) return;
      if (payload.kind === "started") return;
      if (payload.kind === "stream") {
        setStreamed(payload.partialText ?? "");
        requestAnimationFrame(() => {
          if (streamRef.current) {
            streamRef.current.scrollTop = streamRef.current.scrollHeight;
          }
        });
        return;
      }
      if (payload.partialText != null) setStreamed(payload.partialText);
      if (payload.kind === "done" && payload.fixedHtml) {
        jobId.current = null;
        setFixed(payload.fixedHtml);
        setPhase("fixed");
        setNotice(null);
      } else if (payload.kind === "cancelled") {
        jobId.current = null;
        setPhase("idle");
        setNotice("The run was cancelled. Nothing was changed.");
      } else {
        jobId.current = null;
        setPhase("failed");
        setNotice(payload.message);
      }
    };
    listen<AiHtmlFixEvent>("ai-html-fix-event", (event) => {
      handleEvent(event.payload);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        if (!disposed) setEventsDead(true);
      });
    return () => {
      disposed = true;
      unlisten?.();
      if (jobId.current) {
        const running = jobId.current;
        jobId.current = null;
        void cancelAiTranslation(running).catch(() => {});
      }
      setPhase("idle");
    };
  }, [chapterId]);

  useEffect(() => {
    if (phase !== "running") {
      setElapsed(0);
      return;
    }
    setElapsed(0);
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const handleFix = useCallback(async () => {
    if (!selection || !consent || jobId.current || starting.current) return;
    starting.current = true;
    setPhase("running");
    setNotice(null);
    setFixed(null);
    setStreamed("");
    try {
      const started = await startAiHtmlFix({
        chapterId,
        html: htmlRef.current,
        agent: selection.agent,
        model: selection.model,
        consent: true,
        reasoningEffort: selection.reasoningEffort,
      });
      starting.current = false;
      if (closed.current) {
        void cancelAiTranslation(started.jobId).catch(() => {});
        return;
      }
      jobId.current = started.jobId;
    } catch (error) {
      starting.current = false;
      if (closed.current) return;
      setPhase("failed");
      setNotice(
        error instanceof CommandError ? error.message : "The repair could not start.",
      );
    }
  }, [chapterId, consent, selection]);

  const handleCancelRun = useCallback(() => {
    if (!jobId.current) return;
    const running = jobId.current;
    void cancelAiTranslation(running).catch(() => {});
  }, []);

  const running = phase === "running";

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-fix-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="panel__header">
          <h2 className="panel__heading" id="ai-fix-title">
            Fix with AI?
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
            <p className="dialog__muted">
              Your current Translation HTML is sent to the tool, which restructures it
              into rich-text-compatible XHTML without translating. Your code is kept until
              you press Apply, and the source book is never modified.
            </p>

            {phase === "idle" || phase === "failed" ? (
              <>
                <label className="export-ack">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  <span>
                    I understand my current draft HTML will be sent to{" "}
                    {agentLabel(selection.agent, providers.cli, providers.custom)} on this
                    computer to repair its structure.
                  </span>
                </label>
                <div className="button-row">
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={!consent}
                    onClick={() => void handleFix()}
                  >
                    {phase === "failed" ? "Retry repair" : "Yes, fix with AI"}
                  </button>
                </div>
              </>
            ) : null}

            {running ? (
              <div className="button-row">
                <button type="button" className="btn" onClick={handleCancelRun}>
                  Cancel run
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
                Repairing… ({elapsed}s elapsed — large drafts can take up to 60 minutes)
              </StatusNotice>
            ) : null}
            {running || streamed !== "" ? (
              <textarea
                ref={streamRef}
                className="ai-stream"
                aria-label="Live repair output"
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

            {fixed ? (
              <section aria-label="Fixed HTML preview">
                <div
                  className="ai-proposal"
                  // The backend validates the fix against the chapter schema.
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: allowlisted server-validated fragment
                  dangerouslySetInnerHTML={{ __html: fixed }}
                />
                <div className="button-row">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => onApply(fixed)}
                  >
                    Apply fixed HTML
                  </button>
                </div>
                <p className="dialog__muted">
                  Applying replaces your current draft (kept as an unreviewed draft, never
                  marked reviewed). Check the preview first.
                </p>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
