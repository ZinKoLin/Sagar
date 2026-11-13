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
export function documentFragment(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
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
export function comparableDocument(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  // ProseMirror requires inline nodes at the document root to live in a block
  // and may serialize a standalone EPUB anchor as <p><a>…</a></p>. Treat only
  // that exact, attribute-free wrapper as equivalent; the anchor and all its
  // attributes/content must still match, so this cannot hide a dropped link.
  for (const paragraph of Array.from(document.body.querySelectorAll("p"))) {
    const meaningful = Array.from(paragraph.childNodes).filter(
      (node) =>
        node.nodeType !== Node.TEXT_NODE ||
        (node.textContent ?? "").trim() !== "",
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
  for (const element of document.querySelectorAll(
    "body, ul, ol, blockquote, table, thead, tbody, tfoot, tr, div, section, article, main, header, footer, aside, figure, figcaption, dl, svg, g",
  )) {
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && !(node.textContent ?? "").trim())
        node.remove();
    }
  }
  return documentFragment(document.body.innerHTML);
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
  const found = /Found <([a-z][a-z0-9:-]*)> inside <([a-z][a-z0-9:-]*)>\./i.exec(
    message,
  );
  const detail = found
    ? ` <${found[1]}> ကို <${found[2]}> အတွင်း တွေ့ရှိပါတယ်။`
    : "";
  return `ဇယားဖွဲ့စည်းပုံ မကိုက်ညီပါ။${detail} HTML မြင်ကွင်းမှာ ဇယားတစ်ခုစီတွင် အတန်း (<tr>)၊ အတန်းတစ်ခုစီတွင် အချက်အလက်ဆဲလ် (<td>) သို့မဟုတ် ခေါင်းစဉ်ဆဲလ် (<th>) ပါရှိကြောင်း စစ်ဆေးပြီး Rich စာသားမြင်ကွင်းကို ပြန်ဖွင့်ပါ။ သိမ်းထားတဲ့ HTML ကို မဖျက်ထားပါ။`;
}
