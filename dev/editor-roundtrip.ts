import { DOMSerializer, DOMParser as ProseMirrorParser } from "@tiptap/pm/model";
import { Editor } from "@tiptap/react";
import { chapterExtensions } from "../src/features/translator/chapterSchema";
import {
  normalizeRichHtmlForEditor,
  sameRichDocument,
} from "../src/features/translator/richText";
import fixture from "../tests/fixtures/ai/pagebreak-wrapper.xhtml?raw";

const results = document.querySelector("#results");
let failures = 0;
let checks = 0;
function check(name: string, passed: boolean) {
  checks++;
  const row = document.createElement("li");
  row.textContent = `${passed ? "PASS" : "FAIL"}: ${name}`;
  results?.append(row);
  if (!passed) failures++;
}

try {
  const editor = new Editor({ extensions: chapterExtensions(), content: fixture });
  const wrapper = document.createElement("div");
  wrapper.innerHTML = fixture;
  const parsed = ProseMirrorParser.fromSchema(editor.schema).parse(wrapper);
  const serialized = document.createElement("div");
  serialized.append(
    DOMSerializer.fromSchema(editor.schema).serializeFragment(parsed.content),
  );
  check(
    "HTML → rich text keeps the complete EPUB structure",
    sameRichDocument(fixture, serialized.innerHTML),
  );
  check(
    "Editor load preserves wrappers and empty pagebreak spans",
    sameRichDocument(fixture, editor.getHTML()),
  );
  editor.commands.setContent(fixture, { emitUpdate: false });
  check(
    "External AI insertion preserves the EPUB structure",
    sameRichDocument(fixture, editor.getHTML()),
  );
  let textPosition: number | undefined;
  editor.state.doc.descendants((node, position) => {
    if (textPosition === undefined && node.isText && node.text?.includes("မြန်မာစာ")) {
      textPosition = position;
    }
  });
  if (textPosition !== undefined)
    editor.commands.insertContentAt(textPosition, "ပြင်ဆင်ထားသော ");
  const output = document.createElement("div");
  output.innerHTML = editor.getHTML();
  check(
    "Burmese text remains editable",
    output.textContent?.includes("ပြင်ဆင်ထားသော မြန်မာစာ") === true,
  );
  check(
    "Editing keeps both navigation IDs and EPUB roles",
    ["page_v", "page_vi"].every((id) => {
      const marker = output.querySelector(`[id="${id}"]`);
      return (
        marker?.getAttribute("epub:type") === "pagebreak" &&
        marker.getAttribute("role") === "doc-pagebreak"
      );
    }),
  );
  check(
    "Editing keeps the div wrapper and styled inline span",
    output.querySelector("div.dedication") !== null &&
      output.querySelector("span.emphasis")?.textContent === "Unicode",
  );
  check(
    "Editing keeps empty anchors in block and inline positions",
    ["idParaDest-3", "inline-anchor"].every((id) => {
      const anchor = output.querySelector(`[id="${id}"]`);
      return anchor?.tagName === "A" && anchor.childNodes.length === 0;
    }),
  );
  check(
    "Ordinary text links still preserve their destination",
    output.querySelector('a[href="#page_v"]')?.textContent === "Reference",
  );
  check(
    "Legacy b/i and standard strong/em formatting remain distinct",
    output.querySelector("b.legacy-bold i")?.textContent === "စောင်း" &&
      output.querySelector("strong")?.textContent === "Strong" &&
      output.querySelector("em")?.textContent === "Emphasis",
  );
  check(
    "Semantic section containers preserve nesting, IDs, attributes and empty anchors",
    [
      "section#chapter-section.chapter",
      "section#nested-section",
      "section > a#section-anchor",
      "section header",
      "section article",
      "section aside",
      "section footer",
      "section nav",
      "section main",
    ].every((selector) => output.querySelector(selector) !== null) &&
      output.querySelector("#chapter-section")?.getAttribute("epub:type") === "chapter" &&
      output.querySelector("aside")?.getAttribute("role") === "doc-footnote",
  );
  check(
    "Superscript footnote links and subscript formulas retain formatting and attributes",
    output
      .querySelector('sup#footnote-reference > a[href="#footnote"]')
      ?.getAttribute("epub:type") === "noteref" &&
      output.querySelector("sup a")?.getAttribute("role") === "doc-noteref" &&
      output.querySelector("sup")?.textContent === "1" &&
      output.querySelector("sub.formula")?.textContent === "2",
  );
  const tableFixture =
    '<section><ol><li><p>Before <em>marked</em> text.</p><table border="1"><thead><tr><th><p>Heading</p></th><th><p>Second</p></th></tr></thead><tbody><tr><td><p>One</p></td><td><p><b>Two</b></p></td></tr></tbody><tfoot><tr><td><p>Total</p></td><td><p>Three</p></td></tr></tfoot></table><p>After</p></li></ol></section>';
  const tableWrapper = document.createElement("div");
  tableWrapper.innerHTML = tableFixture;
  const tableDocument = ProseMirrorParser.fromSchema(editor.schema).parse(tableWrapper);
  const tableOutput = document.createElement("div");
  tableOutput.append(
    DOMSerializer.fromSchema(editor.schema).serializeFragment(tableDocument.content),
  );
  check(
    "Table headers and footers round-trip inside a list without changing text",
    sameRichDocument(tableFixture, tableOutput.innerHTML),
  );
  const normalizedWrapper = document.createElement("div");
  normalizedWrapper.innerHTML = normalizeRichHtmlForEditor(tableFixture);
  const normalizedParsed = ProseMirrorParser.fromSchema(editor.schema).parse(
    normalizedWrapper,
  );
  const normalizedOutput = document.createElement("div");
  normalizedOutput.append(
    DOMSerializer.fromSchema(editor.schema).serializeFragment(normalizedParsed.content),
  );
  check(
    "Editor-normalized table markup preserves the same text and structure",
    sameRichDocument(tableFixture, normalizedOutput.innerHTML),
  );
  editor.destroy();
} catch (error) {
  check(`Unexpected error: ${String(error)}`, false);
}
const status = document.querySelector("#status");
if (status)
  status.textContent =
    failures === 0 ? `All ${checks} checks passed` : `${failures} checks failed`;
