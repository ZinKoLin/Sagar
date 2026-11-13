import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { ChapterSidebar } from "../../src/features/chapters/ChapterSidebar";
import type { ChapterSummary } from "../../src/types/project";

test("accordion preserves selection, hides children and supports keyboard navigation", async () => {
  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, navigator: window.navigator,
    HTMLElement: window.HTMLElement, HTMLButtonElement: window.HTMLButtonElement,
    Node: window.Node, Element: window.Element, IS_REACT_ACT_ENVIRONMENT: true });
  const chapters: ChapterSummary[] = ["v1", "c1", "c2"].map((id, spineIndex) => ({
    id, spineIndex, title: id === "v1" ? "Volume 1" : `မြန်မာ ${id}`, resourceHref: `${id}.xhtml`,
    status: "not_started", totalBlocks: 0, reviewedBlocks: 0, unsupportedBlocks: 0,
    navigationGroups: id === "v1" ? [] : [{ id: "volume", title: "Volume 1", resource: "v1.xhtml" }],
  }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let selected = "";
  const render = (active: string) => root.render(createElement(ChapterSidebar, {
    chapters, activeChapterId: active, chapterStatusOverride: null, onSelect: (id) => { selected = id; },
  }));
  try {
    await act(async () => render("c1"));
    const toggle = container.querySelector<HTMLButtonElement>("[aria-controls]")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await act(async () => toggle.click());
    expect(container.querySelector("ol[hidden]")).not.toBeNull();
    const opening = container.querySelector<HTMLButtonElement>(".chapter-list__select")!;
    await act(async () => opening.click());
    expect(selected).toBe("v1");
    await act(async () => { toggle.focus(); toggle.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(document.activeElement).toBe(opening);
    await act(async () => render("c2"));
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[aria-current="true"]')?.textContent).toContain("မြန်မာ c2");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("header picker includes volume context and indents grouped chapters", async () => {
  const { ChapterPicker } = await import("../../src/features/chapters/ChapterPicker");
  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, navigator: window.navigator,
    HTMLElement: window.HTMLElement, Node: window.Node, Element: window.Element, IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let chosen = "";
  try {
    await act(async () => root.render(createElement(ChapterPicker, {
      chapters: [{ id: "chapter", title: "Chapter 1", spineIndex: 6, resourceHref: "c1.xhtml",
        status: "not_started", totalBlocks: 0, reviewedBlocks: 0, unsupportedBlocks: 0,
        navigationGroups: [{ id: "volume", title: "Volume 1", resource: "v1.xhtml" }] }],
      chapterId: "chapter", disabled: false, onSelect: (id) => { chosen = id; },
    })));
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    const option = container.querySelector<HTMLButtonElement>('[role="option"]')!;
    expect(option.getAttribute("aria-label")).toContain("Volume 1");
    expect(option.style.paddingInlineStart).toBe("28px");
    expect(option.querySelector("small")?.textContent).toBe("Volume 1");
    await act(async () => option.click());
    expect(chosen).toBe("chapter");
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
