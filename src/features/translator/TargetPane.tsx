import { DOMSerializer, DOMParser as ProseMirrorParser } from "@tiptap/pm/model";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { HtmlCodeEditor } from "../../components/HtmlCode";
import { Icon } from "../../components/Icon";
import { StatusNotice } from "../../components/StatusNotice";
import { formatChapterHtml } from "../../lib/html/format";
import { validateChapterHtml } from "../../lib/tauri/commands";
import type { ChapterContent } from "../../types/chapter";
import { AiFixHtmlDialog } from "./AiFixHtmlDialog";
import { AiGenerateDialog } from "./AiGenerateDialog";
import { ChapterEditor } from "./ChapterEditor";
import { comparableDocument, displayChapterImages, hasContent } from "./richText";
import type { useChapterEditor } from "./useChapterEditor";

export function TargetPane({
  projectId,
  content,
  loading,
  error,
  onRetry,
  onReloadAfterConflict,
  editor,
}: {
  projectId: string;
  content: ChapterContent | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onReloadAfterConflict: () => void;
  editor: ReturnType<typeof useChapterEditor>;
}) {
  const [activeEditor, setActiveEditor] = useState<TiptapEditor | null>(null);
  const [, refreshToolbar] = useState(0);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imagePicker, setImagePicker] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [fixConfirmOpen, setFixConfirmOpen] = useState(false);
  const [formattingOpen, setFormattingOpen] = useState(false);
  const [view, setView] = useState<"rich" | "html">("rich");
  const [viewError, setViewError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const currentHtml = useRef("");
  const draftHtml = editor.draft?.html ?? content?.document.html ?? "";
  const richEditorHtml = content
    ? displayChapterImages(draftHtml, content.images)
    : draftHtml;
  currentHtml.current = draftHtml;
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!activeEditor) return;
    const update = () => refreshToolbar((value) => value + 1);
    activeEditor.on("transaction", update);
    return () => {
      activeEditor.off("transaction", update);
    };
  }, [activeEditor]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset toolbar when navigating to another chapter.
  useEffect(() => {
    setActiveEditor(null);
    setImagePicker(false);
    setImageError(null);
    setView("rich");
    setViewError(null);
    setAiOpen(false);
    setFixConfirmOpen(false);
    setFormattingOpen(false);
  }, [content?.chapterId]);
  const canEdit =
    view === "rich" &&
    !!activeEditor &&
    !activeEditor.isDestroyed &&
    activeEditor.isEditable;
  const showRichText = useCallback(async () => {
    if (!activeEditor || activeEditor.isDestroyed) return;
    const html = currentHtml.current;
    const destination = activeEditor;
    setSwitching(true);
    setViewError(null);
    try {
      const validated = await validateChapterHtml(html);
      if (currentHtml.current !== html || destination.isDestroyed) return;
      const wrapper = document.createElement("div");
      wrapper.innerHTML = validated;
      const parsed = ProseMirrorParser.fromSchema(destination.schema).parse(wrapper, {
        preserveWhitespace: true,
      });
      const roundTrip = document.createElement("div");
      roundTrip.append(
        DOMSerializer.fromSchema(destination.schema).serializeFragment(parsed.content),
      );
      if (
        validated.trim() !== "" &&
        comparableDocument(validated) !== comparableDocument(roundTrip.innerHTML)
      ) {
        setView("html");
        setViewError(
          "This HTML cannot be represented faithfully in rich text. Your code is kept; continue editing it here or adjust its structure.",
        );
        return;
      }
      // Apply the exact document that passed the preservation check, rather
      // than parsing the HTML a second time with different whitespace options.
      destination.commands.setContent(parsed.toJSON(), { emitUpdate: false });
      setView("rich");
    } catch (error) {
      if (currentHtml.current !== html || destination.isDestroyed) return;
      setView("html");
      setViewError(
        error instanceof Error
          ? error.message
          : "Check your HTML before switching to rich text.",
      );
    } finally {
      setSwitching(false);
    }
  }, [activeEditor]);
  useEffect(() => {
    if (view !== "rich" || !activeEditor || activeEditor.isDestroyed) return;
    const displayed = activeEditor.getHTML();
    // Ordinary editor keystrokes already updated the draft. Do not reload
    // those transactions: doing so would reset the caret and undo history.
    if (draftHtml.trim() === "" && activeEditor.isEmpty) return;
    if (comparableDocument(draftHtml) === comparableDocument(displayed)) return;
    // AI insertion / external draft updates must refresh the mounted editor
    // through the same validation and preservation checks as HTML → Rich.
    void showRichText();
  }, [activeEditor, draftHtml, showRichText, view]);
  const insertImage = (src: string, alt: string) => {
    if (canEdit) activeEditor.chain().focus().setImage({ src, alt }).run();
    setImagePicker(false);
  };
  const showHtml = useCallback(() => {
    // Rich edits and AI insertions save as a single line; normalize to one
    // block per line so the code view reads like the original source.
    // HTML typing itself is left alone to preserve the caret.
    const current = editor.draft?.html ?? "";
    const pretty = formatChapterHtml(current);
    if (editor.draft && pretty !== current) editor.setHtml(pretty);
    setImagePicker(false);
    setViewError(null);
    setView("html");
  }, [editor]);
  return (
    <section className="pane pane--target" aria-labelledby="target-pane-heading">
      <div className="pane__header">
        <h2 className="pane__heading" id="target-pane-heading">
          Translation
        </h2>
        <fieldset
          className="view-switch view-switch--icons"
          aria-label="Translation view"
        >
          <button
            type="button"
            className="icon-button"
            aria-label="Rich text view"
            title="Rich text view"
            aria-pressed={view === "rich"}
            disabled={switching || !editor.draft || editor.draft.conflict}
            onClick={() => void showRichText()}
          >
            <Icon name="richText" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="HTML view"
            title="HTML view"
            aria-pressed={view === "html"}
            disabled={switching || !editor.draft}
            onClick={showHtml}
          >
            <Icon name="code" />
          </button>
        </fieldset>
        <button
          type="button"
          className="icon-button"
          disabled={!editor.draft || editor.draft.conflict}
          aria-label="Generate an AI translation proposal"
          title="Generate an AI translation proposal"
          onClick={() => setAiOpen(true)}
        >
          <Icon name="sparkles" />
        </button>
        {view === "rich" ? (
          <button
            type="button"
            className="icon-button"
            aria-label="Formatting tools"
            title="Formatting tools"
            aria-expanded={formattingOpen}
            aria-controls="translation-formatting"
            disabled={!editor.draft || editor.draft.conflict}
            onClick={() => setFormattingOpen((open) => !open)}
          >
            <Icon name="format" />
          </button>
        ) : null}
        <div className="chapter-review-actions">
          <button
            type="button"
            className="icon-button chapter-review-button"
            aria-pressed={editor.draft?.status === "reviewed"}
            aria-label={
              editor.draft?.status === "reviewed"
                ? "Chapter reviewed"
                : "Mark chapter reviewed"
            }
            title={
              editor.draft?.status === "reviewed"
                ? "Chapter reviewed"
                : "Mark chapter reviewed"
            }
            disabled={
              !editor.draft || !hasContent(editor.draft.html) || editor.draft.conflict
            }
            onClick={() => editor.setStatus("reviewed")}
          >
            <Icon name="check" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={
              editor.draft?.status === "skipped"
                ? "Write translation"
                : "Keep original chapter"
            }
            title={
              editor.draft?.status === "skipped"
                ? "Write translation"
                : "Keep original chapter"
            }
            disabled={!editor.draft || editor.draft.conflict}
            onClick={() =>
              editor.setStatus(editor.draft?.status === "skipped" ? "draft" : "skipped")
            }
          >
            <Icon name={editor.draft?.status === "skipped" ? "edit" : "keep"} />
          </button>
        </div>
      </div>
      <div
        id="translation-formatting"
        className="editor-toolbar"
        role="toolbar"
        aria-label="Translation formatting"
        hidden={!formattingOpen || view !== "rich"}
      >
        {(
          [
            ["Bold", "bold", "B"],
            ["Italic", "italic", "I"],
            ["Underline", "underline", "U"],
            ["Strike", "strike", "S"],
          ] as const
        ).map(([label, mark]) => (
          <button
            type="button"
            key={mark}
            title={label}
            aria-label={label}
            aria-pressed={canEdit && activeEditor.isActive(mark)}
            disabled={!canEdit}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => activeEditor?.chain().focus().toggleMark(mark).run()}
          >
            <Icon name={mark} size={16} />
          </button>
        ))}
        <span className="editor-toolbar__divider" />
        <button
          type="button"
          aria-label="Inline code"
          className="icon-button"
          title="Inline code (Cmd/Ctrl + E)"
          aria-pressed={canEdit && activeEditor.isActive("code")}
          disabled={!canEdit || !activeEditor.can().toggleCode()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => activeEditor?.chain().focus().toggleCode().run()}
        >
          <Icon name="code" size={17} />
        </button>
        <button
          type="button"
          aria-label="Blockquote"
          className="icon-button"
          title="Blockquote"
          aria-pressed={canEdit && activeEditor.isActive("blockquote")}
          disabled={!canEdit || !activeEditor.can().toggleBlockquote()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => activeEditor?.chain().focus().toggleBlockquote().run()}
        >
          <Icon name="blockquote" size={17} />
        </button>
        <button
          type="button"
          aria-label="Code block"
          className="icon-button"
          title="Code block"
          aria-pressed={canEdit && activeEditor.isActive("codeBlock")}
          disabled={!canEdit || !activeEditor.can().toggleCodeBlock()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => activeEditor?.chain().focus().toggleCodeBlock().run()}
        >
          <Icon name="codeBlock" size={17} />
        </button>
        <span className="editor-toolbar__divider" />
        <button
          type="button"
          aria-label="Paragraph"
          title="Paragraph (Cmd/Ctrl + Alt + 0)"
          aria-pressed={canEdit && activeEditor.isActive("paragraph")}
          disabled={!canEdit}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => activeEditor?.chain().focus().setParagraph().run()}
        >
          <Icon name="paragraph" size={17} />
        </button>
        {([1, 2, 3] as const).map((level) => (
          <button
            key={level}
            type="button"
            className="editor-toolbar__heading"
            aria-label={`Heading ${level}`}
            title={`Heading ${level} (Cmd/Ctrl + Alt + ${level})`}
            aria-pressed={canEdit && activeEditor.isActive("heading", { level })}
            disabled={!canEdit}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => activeEditor?.chain().focus().setHeading({ level }).run()}
          >
            <Icon name="richText" />H{level}
          </button>
        ))}
        <span className="editor-toolbar__divider" />
        <button
          type="button"
          disabled={!canEdit}
          aria-label="Bullets"
          title="Bulleted list"
          aria-pressed={canEdit && activeEditor.isActive("bulletList")}
          onClick={() => activeEditor?.chain().focus().toggleBulletList().run()}
        >
          <Icon name="list" size={17} />
        </button>
        <button
          type="button"
          disabled={!canEdit}
          aria-label="Numbered list"
          title="Numbered list"
          aria-pressed={canEdit && activeEditor.isActive("orderedList")}
          onClick={() => activeEditor?.chain().focus().toggleOrderedList().run()}
        >
          <Icon name="numbered" size={17} />
        </button>
        <span className="editor-toolbar__divider" />
        <button
          type="button"
          disabled={!canEdit || !activeEditor.can().undo()}
          aria-label="Undo"
          title="Undo"
          onClick={() => activeEditor?.chain().focus().undo().run()}
        >
          <Icon name="undo" size={17} />
        </button>
        <button
          type="button"
          disabled={!canEdit || !activeEditor.can().redo()}
          aria-label="Redo"
          title="Redo"
          onClick={() => activeEditor?.chain().focus().redo().run()}
        >
          <Icon name="redo" size={17} />
        </button>
        <span className="editor-toolbar__divider" />
        <button
          type="button"
          disabled={!canEdit}
          aria-label="Insert image"
          title="Insert image"
          onClick={() => setImagePicker(!imagePicker)}
        >
          <Icon name="image" size={17} />
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/gif"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            if (
              file.size > 8 * 1024 * 1024 ||
              !["image/png", "image/jpeg", "image/gif"].includes(file.type)
            ) {
              setImageError("Choose a PNG, JPEG or GIF under 8 MB.");
              return;
            }
            const destination = activeEditor;
            const reader = new FileReader();
            reader.onerror = () =>
              setImageError("The image could not be read. Try another file.");
            reader.onload = () => {
              if (
                viewRef.current !== "rich" ||
                !destination ||
                destination.isDestroyed ||
                !destination.isEditable ||
                typeof reader.result !== "string"
              )
                return;
              destination
                .chain()
                .focus()
                .setImage({
                  src: reader.result,
                  alt: file.name.replace(/\.[^.]+$/, ""),
                })
                .run();
              setImagePicker(false);
              setImageError(null);
            };
            reader.readAsDataURL(file);
          }}
        />
      </div>
      {canEdit && activeEditor.isActive("table") ? (
        <div className="table-toolbar" role="toolbar" aria-label="Table editing">
          <span>Table</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Add row below"
            title="Add row below"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => activeEditor.chain().focus().addRowAfter().run()}
          >
            <Icon name="rowAdd" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Add column after"
            title="Add column after"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => activeEditor.chain().focus().addColumnAfter().run()}
          >
            <Icon name="columnAdd" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Delete row"
            title="Delete row"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => activeEditor.chain().focus().deleteRow().run()}
          >
            <Icon name="rowRemove" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Delete column"
            title="Delete column"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => activeEditor.chain().focus().deleteColumn().run()}
          >
            <Icon name="columnRemove" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Delete table"
            title="Delete table"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => activeEditor.chain().focus().deleteTable().run()}
          >
            <Icon name="trash" />
          </button>
        </div>
      ) : null}
      {imagePicker ? (
        <div className="image-picker">
          <div className="image-picker__heading">
            <strong>Insert into your translation</strong>
            <button
              type="button"
              className="btn btn--small"
              onClick={() => setImagePicker(false)}
            >
              <Icon name="close" />
              Close
            </button>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="upload" />
            Import image from computer…
          </button>
          <p className="dialog__muted">Images from this chapter</p>
          {content?.images.length ? (
            <div className="image-picker__grid">
              {content.images.map((image) => (
                <button
                  type="button"
                  key={image.src}
                  onClick={() => insertImage(image.src, image.alt)}
                >
                  <Icon name="image" />
                  <img src={image.src} alt={image.alt} />
                  <span>{image.alt || "Chapter image"}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="dialog__muted">
              No supported PNG, JPEG or GIF images in this chapter.
            </p>
          )}
        </div>
      ) : null}
      {imageError ? <StatusNotice kind="error">{imageError}</StatusNotice> : null}
      <div className="pane__scroll">
        {loading ? <StatusNotice kind="loading">Loading chapter…</StatusNotice> : null}
        {error ? (
          <StatusNotice kind="error" onRetry={onRetry}>
            {error}
          </StatusNotice>
        ) : null}
        {!loading && !error && content ? (
          <div className="chapter-document">
            {editor.draft?.error ? (
              <StatusNotice
                kind="error"
                onRetry={editor.draft.conflict ? onReloadAfterConflict : editor.retry}
              >
                {editor.draft.error}
              </StatusNotice>
            ) : null}
            {editor.draft?.status === "skipped" ? (
              <StatusNotice kind="info">
                This chapter will keep the original. Your draft remains saved.
              </StatusNotice>
            ) : null}
            {view === "html" ? (
              <>
                {viewError ? (
                  <StatusNotice
                    kind="error"
                    action={
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Fix with AI"
                        title="Fix with AI"
                        disabled={!editor.draft || editor.draft.conflict}
                        onClick={() => setFixConfirmOpen(true)}
                      >
                        <Icon name="sparkles" />
                      </button>
                    }
                  >
                    {viewError}
                  </StatusNotice>
                ) : null}
                <HtmlCodeEditor
                  key={content.chapterId}
                  value={editor.draft?.html ?? content.document.html ?? ""}
                  disabled={editor.draft?.conflict ?? false}
                  onChange={(value) => {
                    setViewError(null);
                    editor.setHtml(value);
                  }}
                />
              </>
            ) : null}
            <div hidden={view === "html"}>
              <ChapterEditor
                key={content.chapterId}
                html={richEditorHtml}
                disabled={editor.draft?.conflict ?? false}
                onChange={editor.setHtml}
                onReady={setActiveEditor}
                onImage={() => setImagePicker(true)}
                active={view === "rich"}
              />
            </div>
          </div>
        ) : null}
        {!loading && !error && !content ? (
          <StatusNotice kind="info">No chapter selected.</StatusNotice>
        ) : null}
      </div>
      {fixConfirmOpen && content ? (
        <AiFixHtmlDialog
          chapterId={content.chapterId}
          html={editor.draft?.html ?? content.document.html ?? ""}
          onApply={(fixedHtml) => {
            setFixConfirmOpen(false);
            setViewError(null);
            editor.setHtml(formatChapterHtml(fixedHtml));
            // Keep the corrected code visible. Rich conversion remains an
            // explicit action with the usual validation/preservation checks.
            setView("html");
          }}
          onClose={() => setFixConfirmOpen(false)}
        />
      ) : null}
      {aiOpen && content ? (
        <AiGenerateDialog
          projectId={projectId}
          chapterId={content.chapterId}
          editor={editor}
          onClose={() => setAiOpen(false)}
        />
      ) : null}
    </section>
  );
}
