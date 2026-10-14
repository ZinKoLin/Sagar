import Image from "@tiptap/extension-image";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Node } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { BookAttributes } from "./bookAttributes";

// Keep EPUB containers and inline wrappers as nodes, including empty ID/pagebreak
// spans. A mark would discard an empty span and its navigation anchor.
const BookDiv = Node.create({
  name: "bookDiv",
  group: "block",
  content: "block*",
  defining: true,
  parseHTML: () => [{ tag: "div" }],
  renderHTML: ({ HTMLAttributes }) => ["div", HTMLAttributes, 0],
});

// Semantic EPUB containers have the same block content as div, but retain their
// own element names for chapter/footnote/navigation semantics and export.
const BookSection = BookDiv.extend({
  name: "bookSection",
  addAttributes: () => ({ containerTag: { default: "section", rendered: false } }),
  parseHTML: () =>
    ["section", "article", "aside", "header", "footer", "nav", "main"].map((tag) => ({
      tag,
      getAttrs: () => ({ containerTag: tag }),
    })),
  renderHTML: ({ node, HTMLAttributes }) => [node.attrs.containerTag, HTMLAttributes, 0],
});

const BookFigure = Node.create({
  name: "bookFigure",
  group: "block",
  content: "block*",
  defining: true,
  parseHTML: () => [{ tag: "figure" }],
  renderHTML: ({ HTMLAttributes }) => ["figure", HTMLAttributes, 0],
});

const BookFigcaption = Node.create({
  name: "bookFigcaption",
  group: "block",
  content: "inline*",
  defining: true,
  parseHTML: () => [
    {
      tag: "figcaption",
      priority: 100,
      getAttrs: (element) =>
        element.querySelector(
          "p, div, section, article, aside, header, footer, nav, main, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, table, hr",
        )
          ? false
          : {},
    },
  ],
  renderHTML: ({ HTMLAttributes }) => ["figcaption", HTMLAttributes, 0],
});

const BookFigcaptionBlocks = BookFigcaption.extend({
  name: "bookFigcaptionBlocks",
  content: "block*",
  parseHTML: () => [
    {
      tag: "figcaption",
      priority: 101,
      getAttrs: (element) =>
        element.querySelector(
          "p, div, section, article, aside, header, footer, nav, main, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, table, hr",
        )
          ? {}
          : false,
    },
  ],
  renderHTML: ({ HTMLAttributes }) => ["figcaption", HTMLAttributes, 0],
});

const BookSpan = Node.create({
  name: "bookSpan",
  group: "inline",
  inline: true,
  content: "inline*",
  selectable: false,
  parseHTML: () => [{ tag: "span" }],
  renderHTML: ({ HTMLAttributes }) => ["span", HTMLAttributes, 0],
});

// Preserve legacy EPUB b/i tags rather than canonicalizing them to strong/em.
// Prefer these node rules over StarterKit's matching bold/italic mark rules.
const BookBold = BookSpan.extend({
  name: "bookBold",
  parseHTML: () => [{ tag: "b", priority: 100 }],
  renderHTML: ({ HTMLAttributes }) => ["b", HTMLAttributes, 0],
});

const BookItalic = BookSpan.extend({
  name: "bookItalic",
  parseHTML: () => [{ tag: "i", priority: 100 }],
  renderHTML: ({ HTMLAttributes }) => ["i", HTMLAttributes, 0],
});

const BookSuperscript = BookSpan.extend({
  name: "bookSuperscript",
  parseHTML: () => [{ tag: "sup" }],
  renderHTML: ({ HTMLAttributes }) => ["sup", HTMLAttributes, 0],
});

const BookSubscript = BookSpan.extend({
  name: "bookSubscript",
  parseHTML: () => [{ tag: "sub" }],
  renderHTML: ({ HTMLAttributes }) => ["sub", HTMLAttributes, 0],
});

// Links with no text cannot be represented by a mark. Keep destination-only
// anchors as atoms, in either a block container or an inline text container.
const BookAnchor = Node.create({
  name: "bookAnchor",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  parseHTML: () => [
    {
      tag: "a[id]:not([href])",
      getAttrs: (element) => (element.childNodes.length === 0 ? {} : false),
    },
  ],
  renderHTML: ({ HTMLAttributes }) => ["a", HTMLAttributes],
});

const BookBlockAnchor = BookAnchor.extend({
  name: "bookBlockAnchor",
  group: "block",
  inline: false,
  parseHTML: () => [
    {
      tag: "a[id]:not([href])",
      priority: 100,
      context: "doc/|bookDiv/|bookSection/|blockquote/|listItem/|tableCell/|tableHeader/",
      getAttrs: (element) => (element.childNodes.length === 0 ? {} : false),
    },
  ],
});

const ChapterTable = Table.extend({
  renderHTML({ HTMLAttributes }) {
    return ["table", HTMLAttributes, ["tbody", 0]];
  },
});

const ChapterTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      sectionTag: {
        default: "tbody",
        parseHTML: (element: HTMLElement) => {
          const marker = element.getAttribute("data-sagar-table-section");
          if (marker === "thead" || marker === "tfoot") return marker;
          const parentTag = element.parentElement?.tagName.toLowerCase();
          return parentTag === "thead" || parentTag === "tfoot" ? parentTag : "tbody";
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.sectionTag === "thead" || attributes.sectionTag === "tfoot"
            ? { "data-sagar-table-section": attributes.sectionTag }
            : {},
      },
    };
  },
});

export function chapterExtensions() {
  return [
    BookAttributes,
    BookDiv,
    BookSection,
    BookFigure,
    BookSpan,
    BookBold,
    BookItalic,
    BookSuperscript,
    BookSubscript,
    BookAnchor,
    BookBlockAnchor,
    ChapterTable.configure({ resizable: false }),
    ChapterTableRow,
    TableCell,
    TableHeader,
    StarterKit.extend({
      addExtensions() {
        return (this.parent?.() ?? []).map((extension) =>
          extension.name === "listItem"
            ? extension.extend({ content: "block*" })
            : extension,
        );
      },
    }).configure({
      code: false,
      codeBlock: false,
      trailingNode: false,
      link: { openOnClick: false, autolink: false },
    }),
    BookFigcaption,
    BookFigcaptionBlocks,
    Image.configure({ allowBase64: true }),
  ];
}
