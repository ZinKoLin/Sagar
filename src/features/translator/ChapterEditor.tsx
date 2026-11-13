import Image from "@tiptap/extension-image";
import { Table, TableRow } from "@tiptap/extension-table";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import { BookAnchor } from "./bookAnchor";
import { BookAttributes } from "./bookAttributes";
import { BookStructure, BookTableCell, BookTableHeader } from "./bookStructure";
import { documentFragment, normalizeRichDocument } from "./richText";
import { useSlashMenu } from "./useSlashMenu";

const ChapterTable = Table.extend({
  renderHTML({ HTMLAttributes }) {
    return ["table", HTMLAttributes, ["tbody", 0]];
  },
});

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
  const [initialHtml] = useState(() => normalizeRichDocument(html) || "<p></p>");
  const editor = useEditor({
    extensions: [
      ...BookStructure,
      BookAttributes,
      BookAnchor,
      ChapterTable.configure({ resizable: false }),
      TableRow,
      BookTableCell,
      BookTableHeader,
      StarterKit.configure({
        trailingNode: false,
        link: { openOnClick: false, autolink: false },
      }),
      Image.configure({ allowBase64: true }),
    ],
    content: initialHtml,
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
