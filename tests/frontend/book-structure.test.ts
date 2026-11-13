import { expect, test } from "bun:test";
import { DOMParser as ProseMirrorParser, DOMSerializer } from "@tiptap/pm/model";
import { Window } from "happy-dom";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Table, TableRow } from "@tiptap/extension-table";
import {
  BookStructure,
  BookTableCell,
  BookTableHeader,
} from "../../src/features/translator/bookStructure";
import { BookAttributes } from "../../src/features/translator/bookAttributes";
import { BookAnchor } from "../../src/features/translator/bookAnchor";
import { comparableDocument, documentFragment, localizeRichValidationError, normalizeRichDocument } from "../../src/features/translator/richText";
import { runSlashCommand } from "../../src/features/translator/useSlashMenu";

const window = new Window();
Object.assign(globalThis, {
  window, document: window.document, navigator: window.navigator,
  DOMParser: window.DOMParser, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
});

const ChapterTable = Table.extend({
  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ["table", HTMLAttributes, ["tbody", 0]];
  },
});

function createEditor(html: string) {
  return new Editor({
    extensions: [ ...BookStructure, BookAttributes, BookAnchor,
      ChapterTable.configure({ resizable: false }),
      TableRow, BookTableCell, BookTableHeader,
      StarterKit.configure({ trailingNode: false, link: { openOnClick: false, autolink: false } }),
      Image.configure({ allowBase64: true }),
    ],
    content: html,
    parseOptions: { preserveWhitespace: true },
  });
}

test("Rich normalization drops empty decoration but preserves anchors, semantics and whitespace", () => {
  const input = '<h3 class="subtitle"><em></em></h3><div class="empty"><span></span></div><p>မြန်မာ <em>စာ</em>။</p>';
  const cleaned = normalizeRichDocument(input);
  expect(cleaned).toBe('<p>မြန်မာ <em>စာ</em>။</p>');
  expect(normalizeRichDocument(cleaned)).toBe(cleaned);
  expect(normalizeRichDocument('<header/><h1>Title</h1><footer/>')).toBe('<h1>Title</h1>');
  for (const retained of [
    '<h3 id="note"></h3>', '<h3 epub:type="subtitle"></h3>',
    '<h3 role="heading"></h3>', '<h3 aria-label="Subtitle"></h3>',
    '<h3 style="margin:1em"></h3>', '<h3> </h3>', '<p></p>',
    '<a id="anchor"></a>', '<pre>  \n </pre>', '<p><img src="book.png"/></p>',
  ]) {
    expect(normalizeRichDocument(retained)).toContain(retained);
  }
});

test("comparison accepts only a harmless paragraph wrapper around a standalone anchor", () => {
  expect(comparableDocument('<a id="target">Section</a>')).toBe(
    comparableDocument('<p><a id="target">Section</a></p>'),
  );
  expect(comparableDocument('<a id="target">Section</a>')).not.toBe(
    comparableDocument("<p>Section</p>"),
  );
  expect(comparableDocument('<a id="one">Section</a>')).not.toBe(
    comparableDocument('<p><a id="two">Section</a></p>'),
  );
});

test("Rich normalizes mixed book containers, bare lists and plain table cells", () => {
  const examples = [
    '<div>Before <em>မြန်မာ</em><p>Middle</p>After <strong>စာ</strong></div>',
    '<div><span>မြန်မာ</span> <strong>စာ</strong><p>Paragraph</p></div>',
    '<ul><li>မြန်မာ <small>စာ</small></li><li>Two</li></ul>',
    '<blockquote>Quoted <cite>မြန်မာစာ</cite></blockquote>',
    '<table><tbody><tr><td>မြန်မာ <abbr title="Meaning">စာ</abbr></td></tr></tbody></table>',
    '<br/><p>After the standalone break</p>',
    '<p>Before the standalone break</p><br/>',
    '<p>Inline break<br/>stays inside its paragraph</p>',
    '<div>Before a block break<br/>After a block break</div>',
    '<p aria-describedby="note">Text <small>small</small> <kbd>key</kbd><samp>output</samp><var>x</var><dfn>term</dfn><mark>mark</mark></p>',
  ];
  for (const html of examples) {
    const cleaned = normalizeRichDocument(html);
    expect(normalizeRichDocument(cleaned)).toBe(cleaned);
    const before = new DOMParser().parseFromString(html, "text/html");
    const after = new DOMParser().parseFromString(cleaned, "text/html");
    expect(after.body.textContent).toBe(before.body.textContent);
    const editor = createEditor(cleaned);
    try {
      expect(comparableDocument(editor.getHTML())).toBe(comparableDocument(cleaned));
      const saved = documentFragment(editor.getHTML());
      editor.commands.setContent(saved, { parseOptions: { preserveWhitespace: true } });
      expect(comparableDocument(editor.getHTML())).toBe(comparableDocument(cleaned));
    } finally { editor.destroy(); }
  }
});

test("Rich view conversion preserves standalone breaks at the document root", () => {
  const html = normalizeRichDocument("<br/><p>After</p>");
  const editor = createEditor("");
  try {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const parsed = ProseMirrorParser.fromSchema(editor.schema).parse(wrapper, {
      preserveWhitespace: true,
    });
    const roundTrip = document.createElement("div");
    roundTrip.append(
      DOMSerializer.fromSchema(editor.schema).serializeFragment(parsed.content),
    );
    expect(comparableDocument(roundTrip.innerHTML)).toBe(comparableDocument(html));
  } finally {
    editor.destroy();
  }
});

test("Rich view keeps standalone breaks as siblings inside EPUB containers", () => {
  const html = normalizeRichDocument(
    "<div><p>Before</p><br/><p>After</p></div>",
  );
  const editor = createEditor("");
  try {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const parsed = ProseMirrorParser.fromSchema(editor.schema).parse(wrapper, {
      preserveWhitespace: true,
    });
    const roundTrip = document.createElement("div");
    roundTrip.append(
      DOMSerializer.fromSchema(editor.schema).serializeFragment(parsed.content),
    );
    expect(comparableDocument(roundTrip.innerHTML)).toBe(comparableDocument(html));
    expect(roundTrip.innerHTML).toContain("<br");
    expect(roundTrip.innerHTML).not.toContain("<p><br");
  } finally {
    editor.destroy();
  }
});

test("table validation errors identify the bad tag and preserve the saved HTML", () => {
  const message = localizeRichValidationError(
    "A table row can contain only <td> or <th> cells. Found <p> inside <tr>.",
  );
  expect(message).toContain("<p>");
  expect(message).toContain("<tr>");
  expect(message).toContain("HTML ကို မဖျက်ထားပါ");
});

test("Protected tables retain assets, links and column groups without mounting them in the editor", () => {
  const html = '<p>Before</p><table><colgroup span="2"><col width="50%"/><col style="width:25%"/></colgroup><caption>Caption</caption><thead><tr><th id="heading">မြန်မာ</th></tr></thead><tbody><tr><td><a href="https://example.com">Link</a><img src="image.png" alt="Asset"/></td></tr></tbody><tfoot><tr><td>Foot</td></tr></tfoot></table><p>After</p>';
  const editor = createEditor(html);
  try {
    expect(comparableDocument(editor.getHTML())).toBe(comparableDocument(html));
    expect(editor.view.dom.querySelector("img,a[href],script")).toBeNull();
    expect(editor.view.dom.textContent).toContain("မြန်မာ");
    editor.commands.insertContentAt(1, "မင်္ဂလာပါ ");
    expect(editor.getHTML()).toContain("မင်္ဂလာပါ Before");
    const saved = documentFragment(editor.getHTML());
    editor.commands.setContent(saved);
    expect(comparableDocument(editor.getHTML())).toBe(comparableDocument(saved));
    expect(saved).toContain('src="image.png"');
    expect(saved).toContain('id="heading"');
    expect(saved).toContain('<colgroup span="2"><col width="50%"/><col style="width:25%"/></colgroup>');
  } finally { editor.destroy(); }
});

test("Translated titlepage links remain editable without added paragraphs", async () => {
  // Rust serializes empty XHTML containers with explicit closing tags.
  const html = (await Bun.file(new URL("../fixtures/ai/link-target.xhtml", import.meta.url)).text())
    .replace("<header/>", "<header></header>")
    .replace("<footer/>", "<footer></footer>");
  const editor = createEditor(html);
  try {
    expect(comparableDocument(editor.getHTML())).toBe(comparableDocument(html));
    expect(editor.view.dom.querySelector("a[href]")).toBeNull();
    const saved = documentFragment(editor.getHTML());
    expect(saved).not.toContain("target=");
    expect(saved).toContain('href="https://example.com/book"');
    expect(saved).toContain('class="link"');
    let position = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "book_block_link") position = pos + 1;
    });
    expect(position).toBeGreaterThan(0);
    editor.commands.insertContentAt(position, "မြန်မာ ");
    expect(editor.getHTML()).toContain("မြန်မာ Book website");
    const edited = documentFragment(editor.getHTML());
    editor.commands.setContent(edited, { parseOptions: { preserveWhitespace: true } });
    expect(comparableDocument(editor.getHTML())).toBe(comparableDocument(edited));
  } finally {
    editor.destroy();
  }
});

test("standalone root links remain block anchors beside chapter blocks", () => {
  for (const anchor of [
    '<a href="kindle:embed:0003?mime=image/jpg"><img src="cover.jpg" alt="Cover"/></a>',
    '<a id="target">Section target</a>',
    '<a>Unadorned standalone anchor</a>',
  ]) {
    const normalized = normalizeRichDocument(`<p>Before</p>${anchor}<p>After</p>`);
    const editor = createEditor(normalized);
    try {
      expect(comparableDocument(editor.getHTML())).toBe(comparableDocument(normalized));
      expect(normalized).toContain("</p><a");
      expect(normalized).not.toContain("</p><p><a");
      let preservedLink = false;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "book_block_link") preservedLink = true;
      });
      expect(preservedLink).toBe(true);
    } finally {
      editor.destroy();
    }
  }
});

test("TOC links retain Kindle embed and relative hrefs inside paragraphs", () => {
  const html = '<div class="page_top_padding" id="page-top"><h1 class="calibre5" id="calibre_pb_0">မာတိကာ</h1><div class="toc_fm"><p class="toc_fm1"><a href="kindle:embed:0003?mime=image/jpg" class="calibre1">မျက်နှာဖုံး</a></p><p class="toc_fm1"><a href="../Text/part0001_split_000.html#d2-d2s1" class="calibre1">အခန်းတစ်</a></p></div></div>';
  const normalized = normalizeRichDocument(html);
  const editor = createEditor(normalized);
  try {
    expect(comparableDocument(editor.getHTML())).toBe(comparableDocument(normalized));
    expect(editor.getHTML()).toContain('href="kindle:embed:0003?mime=image/jpg"');
    expect(editor.getHTML()).toContain('href="../Text/part0001_split_000.html#d2-d2s1"');
    expect(editor.getHTML()).toContain('class="calibre1"');
    let links = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "book_inline_link") links += 1;
    });
    expect(links).toBe(2);
  } finally {
    editor.destroy();
  }
});

test("Empty subtitle formatting survives Rich parsing, typing and reload", async () => {
  const html = await Bun.file(new URL("../fixtures/editor/empty-subtitle.xhtml", import.meta.url)).text();
  const editor = createEditor(html);
  try {
    expect(comparableDocument(editor.getHTML())).toBe(comparableDocument(html));
    expect(editor.getHTML()).toContain('<h3 class="subtitle"><em></em></h3>');
    let textPosition = 0;
    editor.state.doc.descendants((node, position) => {
      if (node.isText && textPosition === 0) textPosition = position;
    });
    editor.commands.insertContentAt(textPosition, "မင်္ဂလာပါ ");
    const saved = documentFragment(editor.getHTML());
    expect(saved).toContain("မင်္ဂလာပါ မြန်မာပုံပြင်");
    expect(saved).toContain('<h3 class="subtitle"><em></em></h3>');
    editor.commands.setContent(saved, { parseOptions: { preserveWhitespace: true } });
    expect(comparableDocument(editor.getHTML())).toBe(comparableDocument(saved));
    for (const tag of ["em", "strong", "u", "s", "code"]) {
      const fragment = `<p>မြန်မာ<${tag} id="note" class="empty" title="Anchor"></${tag}>စာ <${tag}>text</${tag}></p>`;
      editor.commands.setContent(fragment);
      expect(comparableDocument(editor.getHTML())).toBe(comparableDocument(fragment));
    }
  } finally {
    editor.destroy();
  }
});

for (const [label, html] of [
  ["continued list numbering", '<ol class="steps"><li class="first" value="6"><p>မြန်မာ <i class="BOLD_ITAL">စာ</i><span epub:type="pagebreak" id="page_148" role="doc-pagebreak" title="148"></span></p></li><li value="12"><p>နောက်</p></li></ol>'],
  ["imprint", '<section class="imprint" id="imprint" epub:type="imprint" xmlns:epub="http://www.idpf.org/2007/ops"><header><h2 epub:type="title">ထုတ်ဝေမှု</h2><img src="logo.png" srcset="logo-2x.png 2x, logo.png 1x" sizes="100vw" alt="Logo"/></header><p>မြန်မာ <a href="uncopyright.xhtml">စာ</a></p></section>'],
  ["inline semantics", '<p><span class="small"><b>မြန်မာ</b> <i>စာ</i></span><sup id="note">1</sup><sub>2</sub><code>text</code><ruby>字<rt>ji</rt><rp>(</rp></ruby></p>'],
  ["inline image", '<p>Before <img src="a.png" alt="A" srcset="a.png 1x, b.png 2x"/> after</p>'],
  ["standalone image", '<div><p>Before</p><img src="cover.png" alt="Cover" srcset="cover@2x.png 2x"/><p>After</p></div>'],
  ["image without source", '<figure><img alt="Decorative cover"/><figcaption>Caption</figcaption></figure>'],
  ["blockquote and code", '<blockquote id="quote"><p>မြန်မာ <code class="sample">x &lt; y</code></p></blockquote><pre id="sample"><code>one\n  two &amp; three</code></pre>'],
  ["definition list", '<dl><dt>Term</dt><dd><p>Meaning</p></dd></dl><pre>one\n  two</pre>'],
  ["SVG", '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><g><title>Cover</title><image xlink:href="cover.png"/><path d="M0 0L10 10"/></g></svg><p>မြန်မာ</p>'],
  ["responsive image", '<figure><picture><source srcset="a.webp" type="image/webp"/><img src="a.png" alt="A"/></picture><figcaption>Caption</figcaption></figure>'],
  ["table cell align", '<table border="1" cellpadding="4"><tbody><tr><td align="center" valign="top"><p>Hi</p></td></tr></tbody></table>'],
  ["myanmar table", '<table><tbody><tr><th><p>ခေါင်းစဉ်</p></th></tr><tr><td><p>မြန်မာ စာသား</p></td></tr></tbody></table>'],
]) {
  test(`Rich preserves ${label} through editing and reloading`, () => {
    const editor = createEditor(html);
    try {
      expect(comparableDocument(editor.getHTML())).toBe(comparableDocument(html));
      const saved = documentFragment(editor.getHTML());
      editor.commands.setContent(saved, { parseOptions: { preserveWhitespace: true } });
      expect(comparableDocument(editor.getHTML())).toBe(comparableDocument(html));
      const textPosition: number[] = [];
      editor.state.doc.descendants((node, position) => {
        if (node.isText && textPosition.length === 0) textPosition.push(position);
      });
      if (textPosition.length) {
        editor.commands.insertContentAt(textPosition[0], "မင်္ဂလာပါ ");
        expect(editor.getHTML()).toContain("မင်္ဂလာပါ ");
      }
    } finally { editor.destroy(); }
  });
}

test("SVG node view never mounts imported executable content", () => {
  const editor = createEditor('<svg><script>alert(1)</script><path d="M0 0"/></svg>');
  try {
    expect(editor.view.dom.querySelector("svg, script")).toBeNull();
    expect(editor.getHTML()).not.toContain("<script");
    expect(editor.view.dom.textContent).toContain("SVG ပုံကို ထိန်းသိမ်းထားသည်");
  } finally { editor.destroy(); }
});

test("standalone images stay intact without loading imported image resources", () => {
  const html = '<div><p>Before</p><img src="cover.png" alt="Cover" srcset="cover@2x.png 2x"/><p>After</p></div>';
  const editor = createEditor(html);
  try {
    expect(comparableDocument(editor.getHTML())).toBe(comparableDocument(html));
    expect(editor.view.dom.querySelector("img")).toBeNull();
    expect(editor.view.dom.textContent).toContain("Cover");
  } finally {
    editor.destroy();
  }
});

test("Cell align attributes round-trip verbatim without injected styles", () => {
  const editor = createEditor(
    '<table border="1" cellpadding="4"><tbody><tr><td align="center" valign="top"><p>Hi</p></td></tr></tbody></table>',
  );
  try {
    // Regression: the stock cell parsed align="center" into a style
    // ("text-align: center"), so AI-translated chapters with aligned cells
    // failed the HTML → Rich preservation check and trapped users in HTML.
    expect(editor.getHTML()).not.toContain("text-align");
    expect(comparableDocument(editor.getHTML())).toBe(
      comparableDocument(
        '<table border="1" cellpadding="4"><tbody><tr><td align="center" valign="top"><p>Hi</p></td></tr></tbody></table>',
      ),
    );
    editor.commands.setTextSelection(5);
    expect(editor.chain().focus().addRowAfter().run()).toBe(true);
  } finally {
    editor.destroy();
  }
});

test("Table sections remain intact as protected content while surrounding text is editable", () => {
  for (const html of [
    '<table><thead><tr><th><p>H</p></th></tr></thead><tbody><tr><td><p>C</p></td></tr></tbody></table>',
    '<table><caption>Cap</caption><tbody><tr><td><p>C</p></td></tr></tbody></table>',
  ]) {
    const editor = createEditor(html);
    try {
      expect(comparableDocument(editor.getHTML())).toBe(comparableDocument(html));
      expect(editor.view.dom.textContent).toContain("Table preserved");
      expect(editor.view.dom.querySelector(".book-protected-content table")).not.toBeNull();
      expect(editor.isActive("table")).toBe(false);
    } finally {
      editor.destroy();
    }
  }
});

for (const [command, query, nodeName] of [
  ["blockquote", "/blockquote", "blockquote"],
  ["code", "/code", "codeBlock"],
] as const) {
  test(`Slash ${command} removes the query, preserves text, and undoes as one edit`, () => {
    const editor = createEditor(`<p>${query} မြန်မာ</p>`);
    try {
      editor.commands.setTextSelection(query.length + 1);
      expect(runSlashCommand(editor, command, { from: 1, to: query.length + 1 }, () => {})).toBe(true);
      expect(editor.isActive(nodeName)).toBe(true);
      expect(editor.state.doc.textContent).toBe(" မြန်မာ");
      const saved = documentFragment(editor.getHTML());
      editor.commands.undo();
      expect(editor.state.doc.textContent).toBe(`${query} မြန်မာ`);
      editor.commands.setContent(saved, { parseOptions: { preserveWhitespace: true } });
      expect(comparableDocument(editor.getHTML())).toBe(comparableDocument(saved));
    } finally { editor.destroy(); }
  });
}

test("Toolbar inline code toggles selected Myanmar text and preserves escaping", () => {
  const editor = createEditor("<p>မြန်မာ &lt;code&gt;</p>");
  try {
    editor.commands.selectAll();
    expect(editor.commands.toggleCode()).toBe(true);
    expect(editor.getHTML()).toContain("<code>မြန်မာ &lt;code&gt;</code>");
    expect(editor.commands.toggleCode()).toBe(true);
    expect(editor.getHTML()).not.toContain("<code>");
    editor.commands.toggleBlockquote();
    expect(editor.isActive("blockquote")).toBe(true);
    editor.commands.setTextSelection(3);
    editor.commands.toggleBlockquote();
    expect(editor.isActive("blockquote")).toBe(false);
    editor.commands.toggleCodeBlock();
    expect(editor.isActive("codeBlock")).toBe(true);
    editor.commands.toggleCodeBlock();
    expect(editor.isActive("paragraph")).toBe(true);
  } finally { editor.destroy(); }
});

test("Slash inline code formats subsequent input and ignores a disabled editor", () => {
  const editor = createEditor("<p>/inline code</p>");
  try {
    editor.commands.setTextSelection(13);
    expect(runSlashCommand(editor, "inlineCode", { from: 1, to: 13 }, () => {})).toBe(true);
    editor.view.dispatch(editor.state.tr.insertText("မြန်မာ"));
    expect(editor.getHTML()).toContain("<code>မြန်မာ</code>");
    editor.commands.setContent("<p>/code</p>");
    editor.setEditable(false);
    expect(runSlashCommand(editor, "code", { from: 1, to: 6 }, () => {})).toBe(false);
    expect(editor.state.doc.textContent).toBe("/code");
  } finally { editor.destroy(); }
});
