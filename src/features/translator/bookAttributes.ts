import { Extension } from "@tiptap/react";
import { bookStructureNames } from "./bookStructure";

/** Retain source XHTML attributes when switching/editing in rich text. */
export const BookAttributes = Extension.create({
  name: "bookAttributes",
  addGlobalAttributes() {
    return [
      {
        types: [
          ...bookStructureNames,
          "paragraph",
          "hardBreak",
          "bookAnchor",
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
          "code",
          "codeBlock",
        ],
        attributes: Object.fromEntries(
          [
            "class",
            "id",
            "style",
            "title",
            "lang",
            "dir",
            "role",
            "epub:type",
            "xmlns:epub",
            "xml:lang",
          ].map((name) => [
            name,
            {
              default: null,
              parseHTML: (element: HTMLElement) => element.getAttribute(name),
              renderHTML: (attributes: Record<string, unknown>) =>
                typeof attributes[name] === "string" ? { [name]: attributes[name] } : {},
            },
          ]),
        ),
      },
      {
        types: ["image", "book_inline_image"],
        attributes: Object.fromEntries(
          ["srcset", "sizes", "width", "height", "loading", "decoding"].map((name) => [
            name,
            {
              default: null,
              parseHTML: (element: HTMLElement) => element.getAttribute(name),
              renderHTML: (attributes: Record<string, unknown>) =>
                typeof attributes[name] === "string" ? { [name]: attributes[name] } : {},
            },
          ]),
        ),
      },
      {
        types: ["table", "tableCell", "tableHeader"],
        attributes: Object.fromEntries(
          [
            "width",
            "height",
            "align",
            "valign",
            "scope",
            "abbr",
            "headers",
            "border",
            "cellpadding",
            "cellspacing",
          ].map((name) => [
            name,
            {
              default: null,
              parseHTML: (element: HTMLElement) => element.getAttribute(name),
              renderHTML: (attributes: Record<string, unknown>) =>
                typeof attributes[name] === "string" ? { [name]: attributes[name] } : {},
            },
          ]),
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
