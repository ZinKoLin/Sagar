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
        attributes: {
          bookAria: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              Object.fromEntries(
                Array.from(element.attributes)
                  .filter((attr) => attr.name.startsWith("aria-"))
                  .map((attr) => [attr.name, attr.value]),
              ),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes.bookAria;
              return value && typeof value === "object"
                ? Object.fromEntries(
                    Object.entries(value).filter(
                      ([name, text]) =>
                        name.startsWith("aria-") && typeof text === "string",
                    ),
                  )
                : {};
            },
          },
          ...Object.fromEntries(
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
                  typeof attributes[name] === "string"
                    ? { [name]: attributes[name] }
                    : {},
              },
            ]),
          ),
        },
      },
      {
        types: ["listItem"],
        attributes: {
          value: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("value"),
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.value === "string"
                ? { value: attributes.value }
                : {},
          },
        },
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
    ];
  },
});
