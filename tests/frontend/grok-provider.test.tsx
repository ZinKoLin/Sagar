import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const requests: { command: string; args?: Record<string, unknown> }[] = [];
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: Record<string, unknown>) => {
    requests.push({ command, args });
    if (command === "get_translation_selection") return null;
    if (command === "list_translation_models") return {
      agent: args?.agent, source: "live", message: "",
      models: [{ id: "grok-4.7", label: "grok-4.7", detail: null, reasoningEfforts: null }],
    };
    if (command === "set_translation_selection") return { ...args, updatedAt: "" };
    throw new Error(`Unexpected command: ${command}`);
  },
}));
const { TranslationModelSection } = await import("../../src/features/settings/TranslationModelSection");

test("Grok setup is available without a key and configured Grok uses the direct API agent", async () => {
  const window = new Window();
  Object.assign(globalThis, {
    window, document: window.document, navigator: window.navigator,
    HTMLElement: window.HTMLElement, Node: window.Node, Element: window.Element,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const cli = [{ id: "codex", label: "Codex", binaries: ["codex"], available: true }];
  let configured = false;
  const onConfigureGrok = () => { configured = true; };
  try {
    await act(async () => root.render(createElement(TranslationModelSection, { cli, custom: [], onConfigureGrok })));
    let agent = container.querySelector<HTMLSelectElement>('[aria-label="Translation agent"]')!;
    expect(agent.querySelector('option[value="setup:xai"]')).not.toBeNull();
    await act(async () => {
      agent.value = "setup:xai";
      agent.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    expect(configured).toBe(true);
    expect(requests.some(({ args }) => args?.agent === "setup:xai")).toBe(false);
    await act(async () => root.render(createElement(TranslationModelSection, {
      cli, onConfigureGrok,
      custom: [{ id: "xai-test", name: "Grok (xAI)", baseUrl: "https://api.x.ai/v1", model: "grok-4.7", hasApiKey: true, createdAt: "", updatedAt: "" }],
    })));
    agent = container.querySelector<HTMLSelectElement>('[aria-label="Translation agent"]')!;
    expect(agent.querySelector('option[value="setup:xai"]')).toBeNull();
    expect(agent.querySelector('option[value="custom:xai-test"]')?.textContent).toContain("xAI API");
    await act(async () => {
      agent.value = "custom:xai-test";
      agent.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLInputElement>('.model-list input')!.click());
    const save = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "Save")!;
    await act(async () => save.click());
    expect(requests.find(({ command }) => command === "set_translation_selection")?.args).toEqual({ agent: "custom:xai-test", model: "grok-4.7", reasoningEffort: null });
    expect(requests.some(({ args }) => args?.agent === "opencode")).toBe(false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    await window.happyDOM.close();
  }
});
