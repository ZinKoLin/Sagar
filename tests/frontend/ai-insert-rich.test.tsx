import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";

mock.module("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));
let rejectValidation = false;
let lastSavedHtml: string | null = null;
mock.module("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    if (command === "save_chapter_document") {
      lastSavedHtml = args?.html as string | null;
      return { revision: 2, status: "draft" };
    }
    // Simulate the Rust validator accepting well-formed fragments verbatim.
    if (command === "validate_chapter_html") {
      // Real Rust AppError failures arrive as { code, message }.
      if (rejectValidation)
        throw { code: "invalid_translation", message: "Unsupported <marquee> element." };
      return (args?.html as string) ?? "";
    }
    throw new Error(`Unexpected command: ${command}`);
  },
}));
mock.module("@tauri-apps/plugin-dialog", () => ({
  open: async () => null,
  save: async () => null,
}));

// Load Tiptap in a browser environment so it mounts immediately, as in the
// desktop release. Importing without window silently tests its deferred SSR path.
const browserWindow = new Window();
Object.assign(globalThis, { window: browserWindow, document: browserWindow.document });

const { TargetPane } = await import("../../src/features/translator/TargetPane");
const { useChapterEditor } = await import("../../src/features/translator/useChapterEditor");
type EditorApi = ReturnType<typeof useChapterEditor>;

let api: EditorApi | null = null;

function Harness({ proposal, chapterId = "ch1" }: { proposal: string | null; chapterId?: string }) {
  const content = useMemo(
    () => ({
      chapterId,
      title: "Chapter 1",
      // Fresh chapter: no translation yet.
      document: { html: "", status: "not_started", revision: 1 },
      images: [],
    }),
    [chapterId],
  );
  const editor = useChapterEditor(content as never);
  api = editor;
  // Simulate AiGenerateDialog's empty-draft path: proposal goes straight in.
  useEffect(() => {
    if (proposal !== null) editor.setHtml(proposal);
  }, [proposal, editor.setHtml]);
  return createElement(TargetPane, {
    projectId: "p1",
    content: content as never,
    loading: false,
    error: null,
    onRetry: () => {},
    onReloadAfterConflict: () => {},
    editor,
  });
}

async function settle(window: Window, rounds = 8) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
  // let happy-dom + tiptap flush
  await act(async () => {});
}

test("failed validation lands in HTML view with a visible error, views stay usable", async () => {
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    DOMParser: window.DOMParser,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  rejectValidation = true;
  try {
    await act(async () => {
      root.render(createElement(Harness, { proposal: null }));
    });
    await settle(window);
    await act(async () => {
      root.render(createElement(Harness, { proposal: "<p>Has unsupported markup.</p>" }));
    });
    await settle(window);
    // Rejected content is kept in the code view with the reason visible…
    const code = container.querySelector('textarea[aria-label="Translation HTML code"]');
    expect(code).not.toBeNull();
    expect(code?.value).toContain("Has unsupported markup.");
    expect(container.textContent).toContain("Unsupported <marquee> element.");
    // …and neither view button is left wedged disabled.
    const richButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Rich text view"]',
    );
    const htmlButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="HTML view"]',
    );
    expect(richButton?.disabled).toBe(false);
    expect(htmlButton?.disabled).toBe(false);
  } finally {
    rejectValidation = false;
    await act(async () => root.unmount());
    container.remove();
    await window.happyDOM.close();
  }
});

for (const proposal of [
  '<p>Body with continued numbering</p><ol><li value="6"><p>မြန်မာစာ</p></li></ol>',
  "<p>Translated one.</p><p>Translated two.</p>",
  "<h2>Title</h2><p>Body with <em>emphasis</em> and မြန်မာ text.</p>",
  '<h1 class="title">မြန်မာပုံပြင်</h1><h3 class="subtitle"><em></em></h3><p>Body with မြန်မာစာ။</p>',
  '<div>Body with <small>မြန်မာ</small><p>Paragraph</p>Loose text</div><ul><li>Text</li></ul>',
  '<p>Body with table</p><table><caption>ဇယား</caption><thead><tr><th>ခေါင်းစဉ်</th></tr></thead><tbody><tr><td>စာသား</td></tr></tbody></table><p>After</p>',
  (await Bun.file(new URL("../fixtures/ai/link-target.xhtml", import.meta.url)).text())
    .replace("<header/>", "<header></header>")
    .replace("<footer/>", "<footer></footer>"),
]) {
  test(`AI proposal reaches the Rich editor: ${proposal.slice(0, 30)}`, async () => {
    const window = new Window();
    Object.assign(globalThis, {
      window,
      document: window.document,
      navigator: window.navigator,
      DOMParser: window.DOMParser,
      Node: window.Node,
      Element: window.Element,
      HTMLElement: window.HTMLElement,
      getComputedStyle: window.getComputedStyle.bind(window),
      requestAnimationFrame: window.requestAnimationFrame.bind(window),
      cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    api = null;
    try {
      await act(async () => {
        root.render(createElement(Harness, { proposal: null }));
      });
      await settle(window);
      // Rich editor mounted and ready.
      const richButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Rich text view"]',
      );
      expect(richButton).not.toBeNull();
      expect(richButton?.disabled).toBe(false);


      // AI done on an empty draft: straight into the draft.
      await act(async () => {
        root.render(createElement(Harness, { proposal }));
      });
      await settle(window);

      const richEditor = container.querySelector(".chapter-editor");
      expect(richEditor).not.toBeNull();
      expect(richEditor?.textContent).toContain(
        proposal.includes("Translated") ? "Translated one." : proposal.includes("titlepage") ? "မြန်မာပုံပြင်များ" : "Body with",
      );
      // Still in Rich view, no HTML trap, no error notice.
      expect(
        container.querySelector('textarea[aria-label="Translation HTML code"]'),
      ).toBeNull();
      expect(container.querySelector(".rich-block, .chapter-editor")).not.toBeNull();
      expect(richButton?.disabled).toBe(false);
      if (proposal.includes('value="6"')) {
        expect(richEditor?.querySelector("li")?.getAttribute("value")).toBe("6");
      }
      if (proposal.includes('class="subtitle"')) {
        expect(richEditor?.querySelector("h3")).toBeNull();
        expect(api?.draft?.html).not.toContain('class="subtitle"');
        await act(async () => { expect(await api?.flushAll()).toBe(true); });
        expect(lastSavedHtml).not.toContain('class="subtitle"');
        expect(lastSavedHtml).toContain("မြန်မာစာ");
      }
      // A previously saved proposal must also return from HTML to Rich.
      const htmlButton = container.querySelector<HTMLButtonElement>('button[aria-label="HTML view"]');
      await act(async () => htmlButton?.click());
      expect(container.querySelector('textarea[aria-label="Translation HTML code"]')).not.toBeNull();
      await act(async () => richButton?.click());
      await settle(window);
      expect(richButton?.getAttribute("aria-pressed")).toBe("true");
      expect(container.querySelector('textarea[aria-label="Translation HTML code"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      await window.happyDOM.close();
    }
  });
}


test("HTML returns to Rich after immediate mount and chapter navigation without Strict Mode", async () => {
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    DOMParser: window.DOMParser,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    for (const chapterId of ["ch1", "ch2", "ch1"]) {
      await act(async () => {
        root.render(createElement(Harness, { proposal: null, chapterId }));
      });
      await settle(window);
      const rich = container.querySelector<HTMLButtonElement>('button[aria-label="Rich text view"]');
      const html = container.querySelector<HTMLButtonElement>('button[aria-label="HTML view"]');
      expect(rich?.disabled).toBe(false);
      await act(async () => html?.click());
      expect(container.querySelector('textarea[aria-label="Translation HTML code"]')).not.toBeNull();
      expect(rich?.disabled).toBe(false);
      await act(async () => api?.setHtml("<p>မင်္ဂလာပါ <em>translation</em></p>"));
      await act(async () => rich?.click());
      await settle(window);
      expect(rich?.getAttribute("aria-pressed")).toBe("true");
      expect(container.querySelector('textarea[aria-label="Translation HTML code"]')).toBeNull();
      expect(container.querySelector(".chapter-editor")?.textContent).toContain("မင်္ဂလာပါ translation");
    }
  } finally {
    await act(async () => root.unmount());
    container.remove();
    await window.happyDOM.close();
  }
});
