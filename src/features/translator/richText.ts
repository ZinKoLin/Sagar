/** Only the restricted editor's inline nodes reach the Rust validator. */
export function plainFragment(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br/>");
}
export function hasContent(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (
    (doc.body.textContent ?? "").trim() !== "" ||
    doc.querySelector("img, svg, table") !== null
  );
}
export function editorContent(fragment: string): string {
  return `<p>${fragment}</p>`;
}

/** Inline chapter images while editing so relative EPUB paths are visible. */
export function displayChapterImages(
  html: string,
  images: { src: string; source: string }[],
): string {
  if (!html || images.length === 0) return html;
  const sources = new Map(images.map((image) => [image.source, image.src]));
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const image of doc.querySelectorAll("img[src]")) {
    const source = image.getAttribute("src");
    const embedded = source ? sources.get(source) : undefined;
    if (embedded) image.setAttribute("src", embedded);
  }
  return doc.body.innerHTML;
}
export function inlineFragment(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const serialize = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return plainFragment(node.textContent ?? "");
    if (!(node instanceof Element)) return "";
    const children = Array.from(node.childNodes).map(serialize).join("");
    if (node.tagName === "P") return children;
    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "<br/>";
    if (tag === "img")
      return `<img src="${plainFragment(node.getAttribute("src") ?? "")}" alt="${plainFragment(node.getAttribute("alt") ?? "")}"/>`;
    if (["strong", "em", "u", "s"].includes(tag)) return `<${tag}>${children}</${tag}>`;
    if (tag === "a")
      return `<a href="${plainFragment(node.getAttribute("href") ?? "")}">${children}</a>`;
    return children;
  };
  return Array.from(doc.body.childNodes).map(serialize).join("<br/><br/>");
}

/**
 * Canonical document XHTML: retain the reader's block structure (including
 * original div/figure/section wrappers) and SVG cover artwork so the
 * rich-text preservation check can tell lossy conversions apart instead of
 * silently dropping them.
 */
const SVG_TAGS = [
  "svg",
  "g",
  "image",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "title",
  "desc",
  "text",
  "tspan",
];
const SVG_ATTRS = [
  "href",
  "xlink:href",
  "viewBox",
  "preserveAspectRatio",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "transform",
  "opacity",
  "fill",
  "stroke",
  "stroke-width",
  "font-size",
  "text-anchor",
  "version",
];

/** Unwrap whitespace-only formatting while retaining intentional empty nodes. */
export function normalizeFormattingWhitespace(root: ParentNode): void {
  const elements = Array.from(
    root.querySelectorAll("b, strong, i, em, u, s, span"),
  ).reverse();
  for (const element of elements) {
    if (element.attributes.length !== 0 || element.children.length !== 0) continue;
    const text = element.textContent ?? "";
    if (!/^\s*$/.test(text)) continue;
    if (text.length > 0) element.replaceWith(element.ownerDocument.createTextNode(text));
  }
}

export function documentFragment(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  normalizeFormattingWhitespace(doc);
  // Tiptap's table model stores rows directly under the table. Keep the EPUB
  // section on each row while editing, then rebuild the original sections
  // before comparing or saving the serialized document.
  for (const table of doc.querySelectorAll("table")) {
    const rows = Array.from(table.querySelectorAll(":scope > tbody > tr"));
    if (!rows.some((row) => row.hasAttribute("data-sagar-table-section"))) continue;
    const groups: Array<{ tag: "thead" | "tbody" | "tfoot"; element: HTMLElement }> = [];
    for (const row of rows) {
      const marker = row.getAttribute("data-sagar-table-section");
      const tag = marker === "thead" || marker === "tfoot" ? marker : "tbody";
      row.removeAttribute("data-sagar-table-section");
      let group = groups[groups.length - 1];
      if (!group || group.tag !== tag) {
        const element = doc.createElement(tag);
        group = { tag, element };
        groups.push(group);
      }
      group.element.append(row);
    }
    const originalSections = Array.from(table.children).filter((child) =>
      ["THEAD", "TBODY", "TFOOT"].includes(child.tagName),
    );
    const firstSection = originalSections[0];
    if (firstSection) {
      for (const group of groups) table.insertBefore(group.element, firstSection);
      for (const section of originalSections) section.remove();
    }
  }
  const serialize = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      const escaped = plainFragment(node.textContent ?? "");
      return node.parentElement?.closest("pre")
        ? escaped.split("<br/>").join("\n")
        : escaped;
    }
    if (!(node instanceof Element)) return "";
    const tag = node.tagName.toLowerCase();
    const allowed = [
      "div",
      "section",
      "article",
      "aside",
      "header",
      "footer",
      "nav",
      "main",
      "figure",
      "figcaption",
      "p",
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
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "blockquote",
      "div",
      "section",
      "article",
      "main",
      "header",
      "footer",
      "aside",
      "figure",
      "figcaption",
      "pre",
      "dl",
      "dt",
      "dd",
      "span",
      "small",
      "abbr",
      "cite",
      "dfn",
      "kbd",
      "samp",
      "var",
      "mark",
      "b",
      "i",
      "code",
      "sup",
      "sub",
      "ruby",
      "rt",
      "rp",
      "strong",
      "em",
      "u",
      "s",
      "img",
      "br",
      "hr",
      "a",
      "picture",
      "source",
      ...SVG_TAGS,
    ];
    const children = Array.from(node.childNodes).map(serialize).join("");
    if (!allowed.includes(tag)) return children;
    const names = [
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
      ...(tag === "img"
        ? ["src", "srcset", "sizes", "alt", "width", "height", "loading", "decoding"]
        : tag === "source"
          ? ["src", "srcset", "sizes", "media", "type", "width", "height"]
          : tag === "a"
            ? ["href"]
            : tag === "td" || tag === "th"
              ? [
                  "colspan",
                  "rowspan",
                  "width",
                  "height",
                  "align",
                  "valign",
                  "scope",
                  "abbr",
                  "headers",
                ]
              : tag === "table"
                ? ["border", "cellpadding", "cellspacing", "width", "align"]
                : tag === "colgroup" || tag === "col"
                  ? ["span", "width"]
                  : tag === "ol" || tag === "ul"
                    ? ["start", "type"]
                    : tag === "li"
                      ? ["value"]
                      : []),
      ...(SVG_TAGS.includes(tag) ? [...SVG_ATTRS, "xmlns", "xmlns:xlink"] : []),
    ].sort();
    names.push(
      ...Array.from(node.attributes, (attr) => attr.name).filter((name) =>
        name.startsWith("aria-"),
      ),
    );
    const attributes = names
      .filter((name) => node.hasAttribute(name))
      .map((name) => ` ${name}="${plainFragment(node.getAttribute(name) ?? "")}"`)
      .join("");
    if (
      [
        "br",
        "img",
        "hr",
        "source",
        "col",
        "image",
        "path",
        "rect",
        "circle",
        "ellipse",
        "line",
        "polyline",
        "polygon",
      ].includes(tag)
    )
      return `<${tag}${attributes}/>`;
    return `<${tag}${attributes}>${children}</${tag}>`;
  };
  return Array.from(doc.body.childNodes).map(serialize).join("");
}

/** Prepare validated XHTML for Rich editing without changing readable content.
 * Run on conversion only: never during typing or IME composition. */
export function normalizeRichDocument(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  // XHTML permits self-closing containers; the HTML parser would treat
  // <header/> as an opening tag and swallow the following chapter into it.
  const xml = parser.parseFromString(
    `<w xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:xlink="http://www.w3.org/1999/xlink">${html}</w>`,
    "application/xhtml+xml",
  );
  if (!xml.querySelector("parsererror")) {
    doc.body.replaceChildren(
      ...Array.from(xml.documentElement.childNodes, (node) => doc.importNode(node, true)),
    );
  }
  const emptyDecorations =
    "em,strong,u,s,code,b,i,span,h1,h2,h3,h4,h5,h6,div,header,footer";
  for (const element of Array.from(
    doc.body.querySelectorAll(emptyDecorations),
  ).reverse()) {
    // Class names alone do not give an empty decoration content. IDs, language,
    // role, EPUB semantics, styles, labels and all other attributes protect it.
    if (
      element.children.length === 0 &&
      /^[\t\r\n ]*$/.test(element.textContent ?? "") &&
      Array.from(element.attributes).every((attr) => attr.name === "class") &&
      !element.closest("pre,svg,picture,table")
    )
      element.remove();
  }
  const blocks =
    "p,h1,h2,h3,h4,h5,h6,ul,ol,li,blockquote,br,hr,table,colgroup,thead,tbody,tfoot,tr,td,th,caption,div,section,article,main,header,footer,aside,figure,figcaption,pre,dl,dt,dd,svg,picture,a";
  for (const parent of Array.from(
    doc.querySelectorAll(
      "body,ul,ol,table,colgroup,thead,tbody,tfoot,tr,div,section,article,main,header,footer,aside,figure,figcaption,dd,li,blockquote,td,th",
    ),
  )) {
    if (Array.from(parent.children).some((child) => child.matches(blocks))) {
      for (const child of Array.from(parent.childNodes)) {
        const besideInline = [child.previousSibling, child.nextSibling].some(
          (sibling) => sibling instanceof Element && !sibling.matches(blocks),
        );
        if (
          child.nodeType === Node.TEXT_NODE &&
          !besideInline &&
          /^[\t\r\n ]*$/.test(child.textContent ?? "")
        )
          child.remove();
      }
    }
  }
  for (const parent of Array.from(
    doc.querySelectorAll(
      "body,div,section,article,main,header,footer,aside,figure,figcaption,dd,li,blockquote,td,th",
    ),
  )) {
    if (
      parent.closest("svg,picture") ||
      parent.closest("table")?.querySelector("thead,tfoot,caption")
    )
      continue;
    const needsBlocks =
      parent.matches("body,li,blockquote,td,th") ||
      Array.from(parent.children).some((child) => child.matches(blocks));
    if (!needsBlocks) continue;
    let run: ChildNode[] = [];
    const wrap = () => {
      if (
        run.some(
          (node) =>
            node.nodeType === Node.ELEMENT_NODE ||
            !/^[\t\r\n ]*$/.test(node.textContent ?? ""),
        )
      ) {
        const paragraph = doc.createElement("p");
        run[0].before(paragraph);
        paragraph.append(...run);
      } else {
        for (const node of run) node.remove();
      }
      run = [];
    };
    for (const child of Array.from(parent.childNodes)) {
      if (child instanceof Element && child.matches(blocks)) wrap();
      else run.push(child);
    }
    wrap();
  }
  return documentFragment(doc.body.innerHTML);
}

/** Compare structural content without code indentation between block elements. */
function prepareComparableDocument(html: string): Document {
  const document = new DOMParser().parseFromString(html, "text/html");
  // ProseMirror represents formatting as marks, so duplicate nested marks
  // collapse to one mark. Repeated unadorned wrappers have the same appearance.
  for (const element of Array.from(
    document.querySelectorAll("em em, strong strong, u u, s s"),
  ).reverse()) {
    if (
      element.attributes.length === 0 &&
      element.parentElement?.tagName === element.tagName &&
      element.parentElement.attributes.length === 0
    )
      element.replaceWith(...Array.from(element.childNodes));
  }
  // ProseMirror requires inline nodes at the document root to live in a block
  // and may serialize a standalone EPUB anchor as <p><a>…</a></p>. Treat only
  // that exact, attribute-free wrapper as equivalent; the anchor and all its
  // attributes/content must still match, so this cannot hide a dropped link.
  for (const paragraph of Array.from(document.body.querySelectorAll("p"))) {
    const meaningful = Array.from(paragraph.childNodes).filter(
      (node) =>
        node.nodeType !== Node.TEXT_NODE || (node.textContent ?? "").trim() !== "",
    );
    if (
      paragraph.attributes.length === 0 &&
      meaningful.length === 1 &&
      meaningful[0] instanceof Element &&
      meaningful[0].matches("a")
    )
      paragraph.replaceWith(meaningful[0]);
  }
  for (const element of document.querySelectorAll("[style]")) {
    if (element instanceof HTMLElement)
      element.setAttribute("style", element.style.cssText);
  }
  // ProseMirror list items require block content. Normalize valid EPUB list
  // items with direct inline children to the equivalent paragraph form when
  // comparing, while preserving block children such as figures in the item.
  const listBlocks = new Set([
    "div",
    "section",
    "article",
    "aside",
    "header",
    "footer",
    "nav",
    "main",
    "figure",
    "figcaption",
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "blockquote",
    "table",
    "hr",
  ]);
  for (const item of document.querySelectorAll("li")) {
    let run: ChildNode[] = [];
    const flush = () => {
      if (
        run.some(
          (node) => (node.textContent ?? "").trim() !== "" || node instanceof Element,
        )
      ) {
        const children = Array.from(item.childNodes);
        const firstIndex = children.indexOf(run[0]);
        const before = children[firstIndex + run.length] ?? null;
        const paragraph = document.createElement("p");
        run.forEach((node) => {
          paragraph.append(node);
        });
        item.insertBefore(paragraph, before);
      }
      run = [];
    };
    for (const node of Array.from(item.childNodes)) {
      if (node instanceof Element && listBlocks.has(node.tagName.toLowerCase())) flush();
      else run.push(node);
    }
    flush();
  }
  for (const element of document.querySelectorAll(
    "body, ul, ol, blockquote, table, thead, tbody, tfoot, tr, div, section, article, main, header, footer, aside, figure, figcaption, dl, svg, g",
  )) {
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && !(node.textContent ?? "").trim())
        node.remove();
    }
  }
  const blockChildren = new Set([
    "div",
    "section",
    "article",
    "aside",
    "header",
    "footer",
    "nav",
    "main",
    "figure",
    "figcaption",
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "blockquote",
    "table",
    "hr",
  ]);
  for (const item of document.querySelectorAll("li")) {
    for (const node of Array.from(item.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE || (node.textContent ?? "").trim() !== "")
        continue;
      const isBlock = (neighbor: ChildNode | null) =>
        neighbor instanceof Element && blockChildren.has(neighbor.tagName.toLowerCase());
      if (isBlock(node.previousSibling) && isBlock(node.nextSibling)) node.remove();
    }
  }
  const cellBlocks = new Set([
    "div",
    "section",
    "article",
    "aside",
    "header",
    "footer",
    "nav",
    "main",
    "figure",
    "figcaption",
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "blockquote",
    "table",
    "hr",
  ]);
  for (const cell of document.querySelectorAll("td, th")) {
    let run: ChildNode[] = [];
    const flush = () => {
      if (
        run.length &&
        run.some(
          (node) => (node.textContent ?? "").trim() !== "" || node instanceof Element,
        )
      ) {
        const before = run[run.length - 1].nextSibling;
        const paragraph = document.createElement("p");
        run.forEach((node) => {
          paragraph.append(node);
        });
        cell.insertBefore(paragraph, before);
      }
      run = [];
    };
    for (const node of Array.from(cell.childNodes)) {
      if (node instanceof Element && cellBlocks.has(node.tagName.toLowerCase())) flush();
      else run.push(node);
    }
    flush();
  }
  // XHTML indentation and line breaks inside ordinary text collapse to spaces
  // in HTML. Normalize them before documentFragment turns text newlines into
  // explicit <br/> elements.
  const textBlocks = new Set([
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "td",
    "th",
    "blockquote",
  ]);
  const walker = document.createTreeWalker(document.body, 4);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  for (const node of textNodes) {
    const parent = node.parentElement;
    if (!parent) continue;
    let text = node.data.replace(/[\t\n\r\f ]+/g, " ");
    const previous = node.previousSibling;
    const next = node.nextSibling;
    if (textBlocks.has(parent.tagName.toLowerCase())) {
      if (!previous || (previous instanceof Element && previous.tagName === "BR"))
        text = text.replace(/^ /, "");
      if (!next || (next instanceof Element && next.tagName === "BR"))
        text = text.replace(/ $/, "");
    }
    if (
      text === " " &&
      (!previous ||
        !next ||
        (previous instanceof Element && previous.tagName === "BR") ||
        (next instanceof Element && next.tagName === "BR"))
    )
      node.remove();
    else node.data = text;
  }
  for (const element of Array.from(
    document.querySelectorAll("span, b, strong, i, em, u, s, sup, sub, a"),
  ).reverse()) {
    if (!element.parentNode) continue;
    const first = element.firstChild;
    if (first?.nodeType === Node.TEXT_NODE && first.textContent?.startsWith(" ")) {
      first.textContent = first.textContent.slice(1);
      element.parentNode.insertBefore(document.createTextNode(" "), element);
    }
    const last = element.lastChild;
    if (last?.nodeType === Node.TEXT_NODE && last.textContent?.endsWith(" ")) {
      last.textContent = last.textContent.slice(0, -1);
      element.after(document.createTextNode(" "));
    }
  }
  const inlineTextBlocks = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6"]);
  for (const block of document.querySelectorAll("p, h1, h2, h3, h4, h5, h6")) {
    let previousWasSpace = false;
    const collapse = (parent: Element) => {
      for (const child of Array.from(parent.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          let text = "";
          for (const char of child.textContent ?? "") {
            if (char === " ") {
              if (!previousWasSpace) text += char;
              previousWasSpace = true;
            } else {
              text += char;
              previousWasSpace = false;
            }
          }
          child.textContent = text;
        } else if (child instanceof Element) {
          const tag = child.tagName.toLowerCase();
          if (tag === "br") previousWasSpace = false;
          else if (!inlineTextBlocks.has(tag)) collapse(child);
        }
      }
    };
    collapse(block);
  }
  return document;
}

export function normalizeRichHtmlForEditor(html: string): string {
  return prepareComparableDocument(html).body.innerHTML;
}

/** Compare preserved structure and visible text while allowing HTML whitespace normalization. */
export function sameRichDocument(leftHtml: string, rightHtml: string): boolean {
  const left = prepareComparableDocument(leftHtml);
  const right = prepareComparableDocument(rightHtml);
  const signature = (document: Document) => {
    const structure = document.cloneNode(true) as Document;
    const walker = structure.createTreeWalker(structure.body, 4);
    const textNodes: Text[] = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
    for (const node of textNodes) node.remove();
    return documentFragment(structure.body.innerHTML);
  };
  const textSignature = (document: Document) => {
    const canonical = new DOMParser().parseFromString(
      documentFragment(document.body.innerHTML),
      "text/html",
    );
    return Array.from(canonical.body.querySelectorAll("*"), (element) => {
      const text = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join("");
      return `${element.tagName.toLowerCase()}:${text.replace(/\s+/g, " ").trim()}`;
    });
  };
  return (
    signature(left) === signature(right) &&
    JSON.stringify(textSignature(left)) === JSON.stringify(textSignature(right))
  );
}

/** Canonical form used by editor tests and by callers comparing one document. */
export function comparableDocument(html: string): string {
  return documentFragment(prepareComparableDocument(html).body.innerHTML);
}

/** Describe the first structural mismatch without exposing chapter text. */
export function describeRichTextMismatch(source: string, converted: string): string {
  const left = comparableDocument(source);
  const right = comparableDocument(converted);
  let offset = 0;
  while (offset < left.length && offset < right.length && left[offset] === right[offset])
    offset += 1;
  const tagAt = (html: string) => {
    const opening = html.lastIndexOf("<", offset);
    const closing = html.indexOf(">", opening);
    if (opening < 0 || closing < 0) return "document";
    const match = /^<\/?([a-z][a-z0-9:-]*)/i.exec(html.slice(opening, closing + 1));
    return match?.[1]?.toLowerCase() ?? "document";
  };
  const expected = tagAt(left);
  const actual = tagAt(right);
  return expected === actual
    ? `<${expected}> အတွင်းရှိ attribute သို့မဟုတ် စာရင်းပုံစံ မတူညီနေသည်။`
    : `သိမ်းထားသော HTML တွင် <${expected}> ဖြစ်ပြီး Rich စာသားတွင် <${actual}> ဖြစ်နေသည်။`;
}

/** Give table-validation failures a repair hint without exposing book text. */
export function localizeRichValidationError(message: string): string {
  if (!/table|column group|row group/i.test(message)) return message;
  const found = /Found <([a-z][a-z0-9:-]*)> inside <([a-z][a-z0-9:-]*)>\./i.exec(message);
  const detail = found ? ` <${found[1]}> ကို <${found[2]}> အတွင်း တွေ့ရှိပါတယ်။` : "";
  return `ဇယားဖွဲ့စည်းပုံ မကိုက်ညီပါ။${detail} HTML မြင်ကွင်းမှာ ဇယားတစ်ခုစီတွင် အတန်း (<tr>)၊ အတန်းတစ်ခုစီတွင် အချက်အလက်ဆဲလ် (<td>) သို့မဟုတ် ခေါင်းစဉ်ဆဲလ် (<th>) ပါရှိကြောင်း စစ်ဆေးပြီး Rich စာသားမြင်ကွင်းကို ပြန်ဖွင့်ပါ။ သိမ်းထားတဲ့ HTML ကို မဖျက်ထားပါ။`;
}
