import { useEffect, useMemo, useRef } from "react";

/** Parse in an inert document and render only text, never streamed HTML/assets. */
export function translationPreviewText(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const element of document.querySelectorAll(
    "script,style,template,iframe,object,svg,math",
  ))
    element.remove();
  const blocks = new Set([
    "P",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "LI",
    "BLOCKQUOTE",
    "DIV",
    "SECTION",
    "ARTICLE",
    "HEADER",
    "FOOTER",
    "PRE",
    "TR",
    "DT",
    "DD",
  ]);
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof Element)) return "";
    if (node.tagName === "BR") return "\n";
    const text = Array.from(node.childNodes, read).join("");
    if (blocks.has(node.tagName)) return `\n${text.trim()}\n`;
    return text;
  };
  return Array.from(document.body.childNodes, read)
    .join("")
    .replace(/\n[\t ]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function LiveTranslationPreview({
  html,
  running,
}: {
  html: string;
  running: boolean;
}) {
  const text = useMemo(() => translationPreviewText(html), [html]);
  const preview = useRef<HTMLElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (text && follow.current && preview.current) {
      preview.current.scrollTop = preview.current.scrollHeight;
    }
  }, [text]);
  return (
    <section aria-label="Translation in progress">
      <p className="dialog__muted">
        Read the translation as it arrives. This preview is incomplete and has not been
        validated or saved to your draft.
      </p>
      <section
        ref={preview}
        className="ai-reading-preview"
        aria-label="Live translation preview"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users must be able to scroll this read-only region.
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget;
          follow.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 40;
        }}
      >
        {text || (running ? "Waiting for translated text…" : "No translated text yet.")}
      </section>
      <details>
        <summary>HTML output</summary>
        <textarea
          className="ai-stream"
          aria-label="Live translation output"
          readOnly
          value={html}
        />
      </details>
    </section>
  );
}
