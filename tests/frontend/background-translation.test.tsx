import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AiTranslationEvent, AiHtmlFixEvent } from "../../src/types/ai";
import type { ChapterContent } from "../../src/types/chapter";

let receive: (event: { payload: AiTranslationEvent }) => void = () => {};
const calls: string[] = [];
const saves: { chapterId: string; html: string }[] = [];
const recoveryCopies: string[] = [];
let storedOutput: { id: string; html: string; state: string; createdAt: string } | null = null;
let failRecoveryWrites = false;
let receiveFix: (event: { payload: AiHtmlFixEvent }) => void = () => {};
mock.module("@tauri-apps/api/event", () => ({
  listen: async (_name: string, callback: typeof receive) => {
    if (_name === "ai-html-fix-event") {
      receiveFix = callback as unknown as typeof receiveFix;
      return () => { receiveFix = () => {}; };
    }
    receive = callback;
    return () => { receive = () => {}; };
  },
}));
mock.module("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    calls.push(command);
    if (command === "list_ai_providers") return { cli: [{ id: "codex", label: "Codex", available: true, binaries: [] }], custom: [] };
    if (command === "get_translation_selection") return { agent: "codex", model: "test", reasoningEffort: null };
    if (command === "get_project") return { id: "project", title: "Example book", sourceLanguage: "en", targetLanguage: "my" };
    if (command === "list_chapters") return [source, other].map((chapter, spineIndex) => ({ id: chapter.chapterId, title: chapter.title, spineIndex, totalBlocks: 1, reviewedBlocks: 0, unsupportedBlocks: 0 }));
    if (command === "get_last_chapter") return "source";
    if (command === "get_chapter") return args.chapterId === "source" ? source : other;
    if (command === "validate_chapter_html") {
      if (!String(args.html).endsWith("</p>")) throw new Error("The HTML is not closed; your text is kept.");
      return args.html;
    }
    if (command === "get_translation_output") return storedOutput;
    if (command === "save_translation_output") {
      if (failRecoveryWrites) throw { code: "io_error", message: "Recovery disk unavailable" };
      recoveryCopies.push(String(args.html));
      storedOutput = { id: String(recoveryCopies.length), html: String(args.html), state: "edited", createdAt: "now" };
      return;
    }
    if (command === "start_ai_html_fix") return { jobId: "repair-job" };
    if (command === "get_book_settings") return { instructions: "" };
    if (command === "start_ai_translation") {
      expect(args.chapterId).toBe("source");
      receive({ payload: { jobId: "job", chapterId: "source", kind: "stream", partialText: "<p>မြန်မာ", proposalHtml: null, message: "" } });
      return { jobId: "job" };
    }
    if (command === "cancel_ai_translation") return;
    if (command === "save_chapter_document") {
      saves.push({ chapterId: String(args.chapterId), html: String(args.html) });
      return { revision: Number(args.expectedRevision) + 1, status: "draft" };
    }
    throw new Error(`Unexpected command ${command}`);
  },
}));

const { AiGenerateDialog } = await import("../../src/features/translator/AiGenerateDialog");
const { useChapterEditor } = await import("../../src/features/translator/useChapterEditor");
function chapter(id: string, html: string): ChapterContent {
  return { chapterId: id, title: id, resourceHref: `${id}.xhtml`, blocks: [], sourceDocument: "", sourcePrefix: "", sourceSuffix: "", previewHtml: "", images: [], document: { html, status: "draft", revision: 1, authored: true } };
}
const source = chapter("source", "");
const other = chapter("other", "<p>Saved other chapter</p>");
let editorApi: ReturnType<typeof useChapterEditor> | null = null;
function Harness({
  initial = source,
  onNextChapter,
}: {
  initial?: ChapterContent;
  onNextChapter?: (chapterId: string) => Promise<string | null | "save-failed">;
} = {}) {
  const [active, setActive] = useState(initial);
  const [hidden, setHidden] = useState(false);
  const [closed, setClosed] = useState(false);
  const editor = useChapterEditor(active);
  editorApi = editor;
  return createElement("div", null,
    createElement("button", { onClick: () => setActive(other) }, "Other chapter"),
    createElement("button", { onClick: () => setHidden(false) }, "Show progress"),
    !closed && createElement(AiGenerateDialog, {
      projectId: "project", chapterId: "source", editor, hidden,
      onBackground: () => setHidden(true), onClose: () => setClosed(true),
      onOpenChapter: () => setActive(source),
      onNextChapter,
    }),
  );
}

test("auto-continue inserts a valid result over the unchanged draft and advances", async () => {
  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, navigator: window.navigator,
    DOMParser: window.DOMParser, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
    requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  calls.length = 0; saves.length = 0; storedOutput = null;
  const nextChapterCalls: string[] = [];
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const click = async (label: string) => {
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === label);
    expect(button).toBeDefined();
    await act(async () => button!.click());
  };
  try {
    await act(async () => root.render(createElement(Harness, {
      initial: chapter("source", "<p>Existing draft</p>"),
      onNextChapter: async (chapterId) => { nextChapterCalls.push(chapterId); return null; },
    })));
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => checkboxes[0]!.click()); // consent
    await act(async () => checkboxes[1]!.click()); // insert and continue
    await click("Generate");
    await act(async () => receive({ payload: {
      jobId: "job", chapterId: "source", kind: "done", partialText: null,
      proposalHtml: "<p>ပြီးပြည့်စုံသော ဘာသာပြန်ချက်</p>", message: "",
    } }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(editorApi!.draft?.html).toBe("<p>ပြီးပြည့်စုံသော ဘာသာပြန်ချက်</p>");
    expect(saves.at(-1)).toEqual({ chapterId: "source", html: "<p>ပြီးပြည့်စုံသော ဘာသာပြန်ချက်</p>" });
    expect(nextChapterCalls).toEqual(["source"]);
    expect(container.textContent).not.toContain("Insert into draft");
    expect(container.textContent).toContain("အခန်းအားလုံး ဘာသာပြန်ပြီးပါပြီ။");
  } finally {
    await act(async () => root.unmount()); container.remove(); await window.happyDOM.close();
  }
});

test("background translation survives navigation/editing and inserts only into its original chapter", async () => {
  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, navigator: window.navigator,
    DOMParser: window.DOMParser, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
    requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  calls.length = 0; saves.length = 0;
  storedOutput = null;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const click = async (text: string) => {
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === text);
    expect(button).toBeDefined();
    await act(async () => button!.click());
  };
  const event = (kind: AiTranslationEvent["kind"], extra: Partial<AiTranslationEvent> = {}) => receive({ payload: { jobId: "job", chapterId: "source", kind, partialText: null, proposalHtml: null, message: "", ...extra } });
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click("Generate");
    expect(container.textContent).toContain("မြန်မာ");
    await click("Run in background");
    expect(container.querySelector<HTMLElement>(".dialog-backdrop")?.style.display).toBe("none");
    await act(async () => window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(calls).not.toContain("cancel_ai_translation");
    await click("Other chapter");
    await act(async () => { editorApi!.setHtml("<p>မြန်မာ manual edit</p>"); });
    await act(async () => { expect(await editorApi!.flushAll()).toBe(true); });
    expect(saves).toEqual([{ chapterId: "other", html: "<p>မြန်မာ manual edit</p>" }]);
    await act(async () => event("done", { jobId: "stale", proposalHtml: "<p>Wrong job</p>" }));
    expect(editorApi!.draft?.html).toContain("manual edit");
    await act(async () => event("failed", { message: "Provider unavailable", partialText: "<p>မြန်မာ" }));
    await click("Show progress");
    expect(container.textContent).toContain("Provider unavailable");
    await click("Retry");
    await click("Run in background");
    expect(editorApi!.draft?.html).toContain("manual edit");
    await act(async () => event("done", { proposalHtml: "<p>ဘာသာပြန်ပြီး</p>" }));
    expect(editorApi!.draft?.chapterId).toBe("other");
    expect(editorApi!.draft?.html).toContain("manual edit");
    await click("Show progress");
    const insert = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "Insert into draft")!;
    expect(insert.disabled).toBe(true);
    await click("Open translated chapter");
    expect(editorApi!.draft?.chapterId).toBe("source");
    await click("Insert into draft");
    await act(async () => { expect(await editorApi!.flushAll()).toBe(true); });
    expect(saves.at(-1)).toEqual({ chapterId: "source", html: "<p>ဘာသာပြန်ပြီး</p>" });
    expect(calls).not.toContain("cancel_ai_translation");
  } finally {
    await act(async () => root.unmount()); container.remove(); await window.happyDOM.close();
  }
});

test("workspace progress survives the real chapter picker lifecycle", async () => {
  const { WorkspaceFrame } = await import("../../src/features/workspace/WorkspaceFrame");
  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, navigator: window.navigator,
    DOMParser: window.DOMParser, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  calls.length = 0; saves.length = 0;
  storedOutput = null;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const clickLabel = async (label: string) => {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    expect(button).not.toBeNull();
    await act(async () => button.click());
  };
  const clickText = async (label: string) => {
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === label)!;
    expect(button).toBeDefined();
    await act(async () => button.click());
  };
  try {
    await act(async () => root.render(createElement(WorkspaceFrame, { projectId: "project", importWarnings: [], onBackToLibrary: () => {} })));
    await clickLabel("Generate an AI translation proposal");
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await clickText("Generate");
    await clickText("Run in background");
    await clickLabel("Next chapter");
    expect(container.querySelector(".chapter-editor")?.textContent).toContain("Saved other chapter");
    expect(container.querySelector('[aria-label="Open translation progress"]')?.textContent).toContain("Ch. 1");
    expect(calls).not.toContain("cancel_ai_translation");
    await act(async () => receive({ payload: { jobId: "job", chapterId: "source", kind: "done", partialText: null, proposalHtml: "<p>ဘာသာပြန်ပြီး</p>", message: "" } }));
    expect(container.querySelector(".chapter-editor")?.textContent).toContain("Saved other chapter");
    expect(container.querySelector('[aria-label="Open translation progress"]')?.textContent).toContain("Translation ready");
    await clickLabel("Open translation progress");
    await clickText("Open translated chapter");
    await clickText("Insert into draft");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 750)); });
    expect(saves.at(-1)?.chapterId).toBe("source");
    expect(container.querySelector(".chapter-editor")?.textContent).toContain("ဘာသာပြန်ပြီး");
  } finally {
    await act(async () => root.unmount()); container.remove(); await window.happyDOM.close();
  }
});

test("completed HTML failures are repaired and checked without restarting translation", async () => {
  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, navigator: window.navigator,
    DOMParser: window.DOMParser, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
    requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  storedOutput = null; calls.length = 0; saves.length = 0; recoveryCopies.length = 0;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const click = async (label: string) => {
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === label)!;
    expect(button).toBeDefined(); await act(async () => button.click());
  };
  const raw = "<p>မြန်မာ <i>စာ";
  const fixed = "<p>မြန်မာ <i>စာ</i></p>";
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click("Generate");
    await act(async () => receive({ payload: { jobId: "job", chapterId: "source", kind: "needs_repair", partialText: raw, proposalHtml: null, message: "HTML needs repair." } }));
    const retained = () => container.querySelector<HTMLTextAreaElement>('[aria-label="Retained translation HTML"]')!;
    expect(retained().value).toBe(raw);
    expect([...container.querySelectorAll("button")].some(button => button.textContent?.trim() === "Retry")).toBe(false);
    await click("Check HTML");
    expect(retained().value).toBe(raw);
    expect(editorApi!.draft?.html).toBe("");
    expect(recoveryCopies).toContain(raw);
    await click("Repair HTML only");
    await act(async () => container.querySelector<HTMLInputElement>('.dialog-backdrop:last-child input[type="checkbox"]')!.click());
    await click("Yes, fix with AI");
    await act(async () => receiveFix({ payload: { jobId: "repair-job", chapterId: "source", kind: "done", partialText: null, fixedHtml: fixed, message: "Repair ready." } }));
    await click("Apply fixed HTML");
    expect(retained().value).toBe(fixed);
    await click("Check HTML");
    expect(calls.filter(command => command === "start_ai_translation")).toHaveLength(1);
    expect(calls.filter(command => command === "start_ai_html_fix")).toHaveLength(1);
    await click("Insert into draft");
    await act(async () => { expect(await editorApi!.flushAll()).toBe(true); });
    expect(saves.at(-1)).toEqual({ chapterId: "source", html: fixed });
    expect(recoveryCopies).toContain(raw);
    expect(recoveryCopies).toContain(fixed);
  } finally {
    await act(async () => root.unmount()); container.remove(); await window.happyDOM.close();
  }
});

test("saved malformed output restores on dialog reopen without any provider call", async () => {
  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, navigator: window.navigator,
    DOMParser: window.DOMParser, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const html = "<p>ပြန်ရသောစာ <i>စာ";
  storedOutput = { id: "saved", html, state: "returned", createdAt: "now" };
  calls.length = 0;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Harness)));
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Retained translation HTML"]')?.value).toBe(html);
    expect(container.textContent).toContain("Recovery copy saved locally");
    expect(calls).not.toContain("start_ai_translation");
    expect(calls).not.toContain("start_ai_html_fix");
    expect(editorApi!.draft?.html).toBe("");
  } finally {
    await act(async () => root.unmount()); container.remove(); await window.happyDOM.close(); storedOutput = null;
  }
});

test("a failed recovery save keeps the window and translated output available", async () => {
  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, navigator: window.navigator,
    DOMParser: window.DOMParser, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  storedOutput = null; failRecoveryWrites = true;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "Generate")!.click());
    await act(async () => receive({ payload: { jobId: "job", chapterId: "source", kind: "needs_repair", partialText: "<p>မပျောက်ရမည့်စာ", proposalHtml: null, message: "Needs repair" } }));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Retained translation HTML"]')?.value).toBe("<p>မပျောက်ရမည့်စာ");
    expect(container.textContent).toContain("Recovery disk unavailable");
    failRecoveryWrites = false;
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(storedOutput?.html).toBe("<p>မပျောက်ရမည့်စာ");
  } finally {
    await act(async () => root.unmount()); container.remove(); await window.happyDOM.close(); failRecoveryWrites = false; storedOutput = null;
  }
});
