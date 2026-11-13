import { type MouseEvent, useEffect, useRef, useState } from "react";
import { HtmlCode } from "../../components/HtmlCode";
import { Icon } from "../../components/Icon";
import { StatusNotice } from "../../components/StatusNotice";
import type { ChapterContent } from "../../types/chapter";
import { BilingualStudyView } from "./BilingualStudyView";

/** Full chapter preview is allowlisted in Rust. Raw XHTML is displayed as text. */
export function SourcePane({
  content,
  loading,
  error,
  onRetry,
  targetHtml,
}: {
  content: ChapterContent | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  targetHtml: string;
}) {
  const [view, setView] = useState<"reader" | "html" | "bilingual">("reader");
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "error">(
    "idle",
  );
  const copyRequest = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset feedback and invalidate pending clipboard results when the displayed chapter or view changes.
  useEffect(() => {
    setCopyState("idle");
    copyRequest.current += 1;
    return () => {
      copyRequest.current += 1;
    };
  }, [content, loading, error, view]);

  async function copyHtml() {
    if (!content || loading || error || copyState === "copying") return;
    const request = ++copyRequest.current;
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(content.sourceDocument);
      if (request === copyRequest.current) setCopyState("copied");
    } catch {
      if (request === copyRequest.current) setCopyState("error");
    }
  }
  return (
    <section className="pane pane--source" aria-labelledby="source-pane-heading">
      <div className="pane__header">
        <h2 className="pane__heading" id="source-pane-heading">
          {view === "bilingual" ? "အင်္ဂလိပ်-မြန်မာ တွဲဖတ်" : "Original"}
          <span className="pane__badge">{view === "bilingual" ? "ဖတ်ရန်" : "Read only"}</span>
        </h2>
        <fieldset className="view-switch view-switch--icons" aria-label="မူရင်းစာဖတ်မြင်ကွင်း">
          {view === "html" ? (
            <button
              type="button"
              className="icon-button"
              aria-label="Copy original HTML"
              title={copyState === "copied" ? "HTML copied" : "Copy original HTML"}
              disabled={loading || !!error || !content || copyState === "copying"}
              onClick={() => void copyHtml()}
            >
              <Icon name={copyState === "copied" ? "check" : "copy"} />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button"
            aria-label="Original reader view"
            title="Reader view"
            aria-pressed={view === "reader"}
            onClick={() => setView("reader")}
          >
            <Icon name="book" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="အင်္ဂလိပ်-မြန်မာ တွဲဖတ်မြင်ကွင်း"
            title="အင်္ဂလိပ်နဲ့ မြန်မာဘာသာပြန်ကို တွဲဖတ်ရန်"
            aria-pressed={view === "bilingual"}
            onClick={() => setView("bilingual")}
          >
            <Icon name="languages" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Original HTML view"
            title="HTML view"
            aria-pressed={view === "html"}
            onClick={() => setView("html")}
          >
            <Icon name="code" />
          </button>
        </fieldset>
      </div>
      <div className="pane__scroll">
        {copyState === "copied" ? (
          <StatusNotice kind="success">Original HTML copied.</StatusNotice>
        ) : null}
        {copyState === "error" ? (
          <StatusNotice
            kind="error"
            onRetry={() => void copyHtml()}
            retryLabel="Copy again"
          >
            Could not copy HTML. Try again or select the code and copy it manually.
          </StatusNotice>
        ) : null}
        {loading ? <StatusNotice kind="loading">Loading chapter…</StatusNotice> : null}
        {error ? (
          <StatusNotice kind="error" onRetry={onRetry}>
            {error}
          </StatusNotice>
        ) : null}
        {!loading && !error && content ? (
          view === "html" ? (
            <HtmlCode value={content.sourceDocument} />
          ) : view === "bilingual" ? (
            <BilingualStudyView
              key={content.chapterId}
              chapterId={content.chapterId}
              sourceHtml={content.previewHtml}
              targetHtml={targetHtml}
            />
          ) : (
            <article
              className="book-text"
              aria-label="Original chapter content"
              onClick={interceptLinkClicks}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.target as HTMLElement).closest("a"))
                  event.preventDefault();
              }}
            >
              <div dangerouslySetInnerHTML={{ __html: content.previewHtml }} />
            </article>
          )
        ) : null}
        {!loading && !error && !content ? (
          <StatusNotice kind="info">No chapter selected.</StatusNotice>
        ) : null}
      </div>
    </section>
  );
}
function interceptLinkClicks(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (target?.closest("a")) event.preventDefault();
}
