import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useRef } from "react";
import { chapterExtensions } from "./chapterSchema";
import { documentFragment } from "./richText";
import { useSlashMenu } from "./useSlashMenu";

export function ChapterEditor({
  html,
  disabled,
  onChange,
  onReady,
  onImage,
  active,
}: {
  html: string;
  disabled: boolean;
  onChange: (html: string) => void;
  onReady: (editor: Editor) => void;
  onImage: () => void;
  active: boolean;
}) {
  const keyHandler = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const editor = useEditor({
    extensions: chapterExtensions(),
    content: html || "<p></p>",
    parseOptions: { preserveWhitespace: true },
    editable: !disabled,
    editorProps: {
      handleKeyDown: (_view, event) => keyHandler.current(event),
      attributes: {
        class: "chapter-editor",
        role: "textbox",
        "aria-label": "Chapter translation",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor }) => onChange(documentFragment(editor.getHTML())),
  });
  const slashMenu = useSlashMenu(editor, onImage, active && !disabled, keyHandler);
  useEffect(() => {
    if (editor) onReady(editor);
  }, [editor, onReady]);
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  return (
    <>
      <EditorContent editor={editor} />
      {slashMenu}
    </>
  );
}
