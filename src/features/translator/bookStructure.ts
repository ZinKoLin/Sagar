import Image from "@tiptap/extension-image";
import { TableCell, TableHeader } from "@tiptap/extension-table";
import { Node } from "@tiptap/react";
import { documentFragment } from "./richText";

/** Structural XHTML containers remain in the document while their text is edited. */
const containers = [
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "aside",
  "figure",
  "figcaption",
  "dl",
  "dd",
];
const blockSelector =
  "p,h1,h2,h3,h4,h5,h6,ul,ol,li,blockquote,hr,table,div,section,article,main,header,footer,aside,figure,figcaption,pre,dl,dt,dd,svg,picture,img,a";
const inline = [
  "span",
  "b",
  "i",
  // Keep semantic inline tags as XHTML nodes. Mapping <em>/<strong> to the
  // editor's italic/bold marks can rewrite one tag as the other when marks
  // overlap or carry EPUB classes, which trips the HTML preservation guard.
  "em",
  "strong",
  "u",
  "s",
  "code",
  "sup",
  "sub",
  "ruby",
  "rt",
  "rp",
  "small",
  "abbr",
  "cite",
  "dfn",
  "kbd",
  "samp",
  "var",
  "mark",
];

export const BookStructure = [
  // ProseMirror's document schema cannot place a normal hardBreak directly
  // at the top level, so retain standalone XHTML breaks as block atoms.
  Node.create({
    name: "book_standalone_break",
    group: "block",
    atom: true,
    selectable: false,
    priority: 130,
    parseHTML: () => [
      {
        tag: "br",
        // A break inside a text block is an inline hard break. Breaks that
        // normalizeRichDocument leaves as siblings of blocks (including
        // inside EPUB containers such as div/blockquote) must stay block
        // nodes or ProseMirror wraps them in a paragraph on serialization.
        priority: 130,
        getAttrs: (element) =>
          element.parentElement?.closest("p,h1,h2,h3,h4,h5,h6,pre,dt")
            ? false
            : null,
      },
    ],
    renderHTML: () => ["br"],
  }),
  Node.create({
    name: "book_preserved_table",
    group: "block",
    atom: true,
    addAttributes: () => ({ original: { default: "", rendered: false } }),
    parseHTML: () => [
      {
        tag: "table",
        priority: 130,
        getAttrs: (element) =>
          element.querySelector("thead,tfoot,caption,colgroup")
            ? { original: documentFragment(element.outerHTML) }
            : false,
      },
    ],
    renderHTML: ({ node }) => {
      const holder = document.createElement("div");
      holder.innerHTML = node.attrs.original as string;
      return holder.firstElementChild ?? document.createElement("table");
    },
    addNodeView:
      () =>
      ({ node }) => {
        const dom = document.createElement("div");
        dom.className = "book-protected-content";
        dom.contentEditable = "false";
        const label = document.createElement("p");
        label.textContent = "Table preserved — edit in HTML view.";
        dom.append(label);
        const source = new DOMParser().parseFromString(
          node.attrs.original as string,
          "text/html",
        );
        const copy = (parent: HTMLElement, child: globalThis.Node) => {
          if (child.nodeType === globalThis.Node.TEXT_NODE) {
            parent.append(document.createTextNode(child.textContent ?? ""));
          } else if (child instanceof Element) {
            const tag = child.tagName.toLowerCase();
            // Build an inert text/table preview, without links, images, CSS or
            // imported attributes that could fetch or execute in the WebView.
            const safe = document.createElement(
              [
                "table",
                "colgroup",
                "col",
                "thead",
                "tbody",
                "tfoot",
                "tr",
                "td",
                "th",
                "caption",
                "p",
                "em",
                "strong",
                "br",
              ].includes(tag)
                ? tag
                : "span",
            );
            for (const name of ["colspan", "rowspan"]) {
              const value = child.getAttribute(name);
              if (value && /^\d+$/.test(value) && Number(value) <= 100)
                safe.setAttribute(name, value);
            }
            for (const nested of Array.from(child.childNodes)) copy(safe, nested);
            parent.append(safe);
          }
        };
        for (const child of Array.from(source.body.childNodes)) copy(dom, child);
        return { dom };
      },
  }),
  // Marks cannot represent empty elements. Keep empty source formatting as
  // inline nodes instead, including IDs and other book attributes.
  ...["em", "strong", "u", "s", "code"].map((tag) =>
    Node.create({
      name: `book_empty_${tag}`,
      group: "inline",
      inline: true,
      atom: true,
      selectable: false,
      parseHTML: () => [
        {
          tag,
          priority: 120,
          getAttrs: (element) => (element.childNodes.length === 0 ? {} : false),
        },
      ],
      renderHTML: ({ HTMLAttributes }) => [tag, HTMLAttributes],
    }),
  ),
  // Keep EPUB links as inline XHTML nodes instead of Tiptap Link marks. The
  // mark parser rejects proprietary but valid book schemes such as kindle:embed
  // and silently drops their href during HTML → Rich conversion.
  Node.create({
    name: "book_inline_link",
    group: "inline",
    inline: true,
    content: "inline*",
    defining: true,
    priority: 125,
    addAttributes: () => ({
      href: {
        default: null,
        parseHTML: (element) => element.getAttribute("href"),
      },
    }),
    parseHTML: () => [
      {
        tag: "a[href]",
        priority: 125,
        getAttrs: (element) =>
          element.parentElement?.closest(
            "p,h1,h2,h3,h4,h5,h6,span,pre,dt,sup,sub,ruby,rt,rp,blockquote,li,td,th",
          )
            ? {}
            : false,
      },
    ],
    renderHTML: ({ HTMLAttributes }) => ["a", HTMLAttributes, 0],
    addNodeView: () => () => {
      const dom = document.createElement("a");
      dom.addEventListener("click", (event) => event.preventDefault());
      return { dom, contentDOM: dom };
    },
  }),
  // EPUB containers can mix paragraphs and standalone links. Keep those
  // links as blocks so parsing does not silently add a paragraph wrapper.
  Node.create({
    name: "book_block_link",
    group: "block",
    content: "inline*",
    defining: true,
    addAttributes: () => ({
      href: {
        default: null,
        parseHTML: (element) => element.getAttribute("href"),
      },
    }),
    parseHTML: () => [
      {
        tag: "a",
        priority: 120,
        getAttrs: (element) => {
          const parent = element.parentElement;
          return parent?.matches(`${containers.join(",")},body`) &&
            Array.from(parent.children).some((child) =>
              child.matches(blockSelector),
            )
            ? {}
            : false;
        },
      },
    ],
    renderHTML: ({ HTMLAttributes }) => ["a", HTMLAttributes, 0],
    // Preserve the URL in serialized XHTML, but never navigate from the editor.
    addNodeView: () => () => {
      const dom = document.createElement("a");
      return { dom, contentDOM: dom };
    },
  }),
  // A standalone EPUB image is structural content, not a paragraph break.
  // Keep its complete XHTML as an inert atom: mounting an imported <img> in
  // the privileged editor WebView could fetch a book-relative resource, while
  // the stock image node may normalize a block image during HTML round-trip.
  Node.create({
    name: "book_block_image",
    group: "block",
    atom: true,
    selectable: false,
    priority: 125,
    addAttributes: () => ({ original: { default: "", rendered: false } }),
    parseHTML: () => [
      {
        tag: "img",
        priority: 125,
        getAttrs: (element) =>
          element.parentElement?.closest(
            "p,h1,h2,h3,h4,h5,h6,span,a,pre,dt,sup,sub,ruby,rt,rp",
          )
            ? false
            : { original: documentFragment(element.outerHTML) },
      },
    ],
    renderHTML: ({ node }) => {
      const holder = document.createElement("div");
      holder.innerHTML = node.attrs.original as string;
      return holder.firstElementChild ?? document.createElement("img");
    },
    addNodeView: () => ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "book-protected-content";
      dom.contentEditable = "false";
      const source = new DOMParser().parseFromString(
        node.attrs.original as string,
        "text/html",
      );
      dom.textContent = `Image preserved${source.querySelector("img")?.getAttribute("alt") ? `: ${source.querySelector("img")?.getAttribute("alt")}` : ""} — edit in HTML view.`;
      return { dom };
    },
  }),
  Image.extend({
    name: "book_inline_image",
    parseHTML: () => [
      {
        tag: "img[src]",
        priority: 120,
        getAttrs: (element) =>
          element.parentElement?.closest(
            "p,h1,h2,h3,h4,h5,h6,span,a,pre,dt,sup,sub,ruby,rt,rp",
          )
            ? {}
            : false,
      },
    ],
  }).configure({ inline: true, allowBase64: true }),
  ...["svg", "picture"].map((tag) =>
    Node.create({
      name: `book_${tag}`,
      group: "block",
      atom: true,
      addAttributes: () => ({
        original: { default: "", rendered: false },
      }),
      parseHTML: () => [
        {
          tag,
          priority: 110,
          getAttrs: (element) => ({ original: documentFragment(element.outerHTML) }),
        },
      ],
      renderHTML: ({ node }) => {
        const holder = document.createElement("div");
        holder.innerHTML = node.attrs.original as string;
        return holder.firstElementChild ?? document.createElement("div");
      },
      // Never execute or fetch embedded artwork in the privileged editor DOM.
      // Serialization retains its markup; the Rust validator owns export safety.
      addNodeView: () => () => {
        const dom = document.createElement("div");
        dom.className = "book-protected-content";
        dom.contentEditable = "false";
        dom.textContent =
          tag === "svg"
            ? "SVG ပုံကို ထိန်းသိမ်းထားသည်။ HTML မြင်ကွင်းတွင် ပြင်ဆင်ပါ။"
            : "Responsive image — preserved. Edit in HTML view.";
        return { dom };
      },
    }),
  ),
  ...containers.map((tag) =>
    Node.create({
      name: `book_${tag}`,
      group: "block",
      content: "block*",
      defining: true,
      parseHTML: () => [
        {
          tag,
          priority: 110,
          getAttrs: (element) =>
            Array.from(element.children).some((child) => child.matches(blockSelector))
              ? {}
              : false,
        },
      ],
      renderHTML: ({ HTMLAttributes }) => [tag, HTMLAttributes, 0],
    }),
  ),
  ...containers.map((tag) =>
    Node.create({
      name: `book_text_${tag}`,
      group: "block",
      content: "inline*",
      defining: true,
      parseHTML: () => [
        {
          tag,
          priority: 111,
          getAttrs: (element) =>
            Array.from(element.children).some((child) => child.matches(blockSelector))
              ? false
              : {},
        },
      ],
      renderHTML: ({ HTMLAttributes }) => [tag, HTMLAttributes, 0],
    }),
  ),
  ...["pre", "dt"].map((tag) =>
    Node.create({
      name: `book_${tag}`,
      group: "block",
      content: "inline*",
      whitespace: tag === "pre" ? "pre" : "normal",
      defining: true,
      parseHTML: () => [
        {
          tag,
          priority: 110,
          getAttrs: (element) =>
            tag === "pre" &&
            element.childNodes.length === 1 &&
            element.firstElementChild?.tagName === "CODE"
              ? false
              : {},
        },
      ],
      renderHTML: ({ HTMLAttributes }) => [tag, HTMLAttributes, 0],
    }),
  ),
  ...inline.map((tag) =>
    Node.create({
      name: `book_${tag}`,
      group: "inline",
      inline: true,
      content: "inline*",
      parseHTML: () => [
        {
          tag,
          priority: 110,
          // Code inside <pre> belongs to StarterKit's codeBlock text content.
          // Parsing it as a separate inline node empties <pre><code> and moves
          // its text into a new paragraph during Rich serialization.
          getAttrs: (element) =>
            tag === "code" && element.parentElement?.closest("pre")
              ? false
              : {},
        },
      ],
      renderHTML: ({ HTMLAttributes }) => [tag, HTMLAttributes, 0],
    }),
  ),
];

/**
 * Table cells without the stock align → style normalization.
 *
 * Tiptap's TableCell/TableHeader parse legacy `align="center"` (and
 * `style="text-align: …"`) into an `align` attribute that always renders
 * `style="text-align: …"`. A backend-valid `<td align="center">` round-trips
 * as `<td align="center" style="text-align: center;">`, fails the
 * comparable-document check, and traps AI-translated chapters in HTML view.
 * The original `align`/`style` attributes are preserved verbatim by the
 * global BookAttributes instead; there is no cell-alignment UI to keep.
 *
 * Tables with thead/tfoot/caption use the protected table node above:
 * prosemirror-tables would rewrite their sections on ordinary transactions.
 * They remain intact in Rich view while other chapter text stays editable.
 */
export const BookTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
    };
  },
});

export const BookTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
    };
  },
});

export const bookStructureNames = BookStructure.map((extension) => extension.name);
