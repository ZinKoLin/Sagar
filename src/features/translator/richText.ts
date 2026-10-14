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
    (doc.body.textContent ?? "").trim() !== "" || doc.querySelector("img, table") !== null
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

/** Keep meaningful whitespace while removing formatting wrappers around it. */
export function normalizeFormattingWhitespace(root: ParentNode): void {
  const elements = Array.from(
    root.querySelectorAll("b, strong, i, em, u, s, span"),
  ).reverse();
  for (const element of elements) {
    if (element.attributes.length !== 0 || element.children.length !== 0) continue;
    const text = element.textContent ?? "";
    if (!/^\s*$/.test(text)) continue;
    if (text.length > 0) element.replaceWith(element.ownerDocument.createTextNode(text));
    else element.remove();
  }
}

/** Canonical document XHTML: retain paragraph/list/heading structure. */
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
    if (node.nodeType === Node.TEXT_NODE) return plainFragment(node.textContent ?? "");
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
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "td",
      "th",
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
      "span",
      "b",
      "i",
      "sup",
      "sub",
      "strong",
      "em",
      "u",
      "s",
      "img",
      "br",
      "hr",
      "a",
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
      "epub:type",
      "role",
      ...(tag === "img"
        ? ["src", "alt"]
        : tag === "table"
          ? ["border"]
          : tag === "a"
            ? ["href"]
            : tag === "td" || tag === "th"
              ? ["colspan", "rowspan"]
              : tag === "ol"
                ? ["start"]
                : []),
    ].sort();
    const attributes = names
      .filter((name) => node.hasAttribute(name))
      .map((name) => ` ${name}="${plainFragment(node.getAttribute(name) ?? "")}"`)
      .join("");
    if (["br", "img", "hr"].includes(tag)) return `<${tag}${attributes}/>`;
    return `<${tag}${attributes}>${children}</${tag}>`;
  };
  return Array.from(doc.body.childNodes).map(serialize).join("");
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
    "body, div, section, article, aside, header, footer, nav, main, figure, figcaption, ul, ol, blockquote, table, thead, tbody, tfoot, tr",
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
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
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
    const walker = structure.createTreeWalker(structure.body, NodeFilter.SHOW_TEXT);
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
