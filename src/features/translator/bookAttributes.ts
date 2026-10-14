import { Extension } from "@tiptap/react";

/** Retain source XHTML attributes when switching/editing in rich text. */
export const BookAttributes = Extension.create({
  name: "bookAttributes",
  addGlobalAttributes() {
    return [
      {
        types: [
          "bookDiv",
          "bookSection",
          "bookFigure",
          "bookFigcaption",
          "bookFigcaptionBlocks",
          "bookSpan",
          "bookBold",
          "bookItalic",
          "bookSuperscript",
          "bookSubscript",
          "bookAnchor",
          "bookBlockAnchor",
          "paragraph",
          "table",
          "tableRow",
          "tableCell",
          "tableHeader",
          "heading",
          "bulletList",
          "orderedList",
          "listItem",
          "blockquote",
          "horizontalRule",
          "image",
          "link",
          "bold",
          "italic",
          "underline",
          "strike",
        ],
        attributes: Object.fromEntries(
          ["class", "id", "style", "title", "lang", "dir", "epub:type", "role"].map(
            (name) => [
              name,
              {
                default: null,
                parseHTML: (element: HTMLElement) => element.getAttribute(name),
                renderHTML: (attributes: Record<string, unknown>) =>
                  typeof attributes[name] === "string"
                    ? { [name]: attributes[name] }
                    : {},
              },
            ],
          ),
        ),
      },
      {
        types: ["table"],
        attributes: {
          border: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("border"),
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.border === "string" ? { border: attributes.border } : {},
          },
        },
      },
    ];
  },
});
