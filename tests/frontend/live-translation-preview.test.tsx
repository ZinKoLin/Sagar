import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { LiveTranslationPreview, translationPreviewText } from "../../src/features/translator/LiveTranslationPreview";

test("streamed translation is readable inert text with Myanmar and paragraph breaks", () => {
  const window = new Window();
  Object.assign(globalThis, { DOMParser: window.DOMParser, Node: window.Node, Element: window.Element });
  const html = '<h2>ခေါင်းစဉ်</h2><p>မြန်မာ <i>စာ</i> &amp; စကား<br/>နောက်</p><p>မပြီးသေး';
  const text = translationPreviewText(html);
  expect(text).toBe('ခေါင်းစဉ်\n\nမြန်မာ စာ & စကား\nနောက်\n\nမပြီးသေး');
  expect(translationPreviewText('<script>evil()</script><style>secret</style><img src="https://example.com" onerror="evil()"/><p onclick="evil()">စာ</p>')).toBe('စာ');
  expect(translationPreviewText('<p>&lt;script&gt;စာ&lt;/script&gt;</p>')).toBe('<script>စာ</script>');
});

test("live preview updates without mounting HTML and lets readers stop following", async () => {
  const window = new Window();
  Object.assign(globalThis, {
    window, document: window.document, navigator: window.navigator,
    DOMParser: window.DOMParser, Node: window.Node, Element: window.Element,
    HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(LiveTranslationPreview, { html: "", running: true })));
    const preview = container.querySelector<HTMLElement>('[aria-label="Live translation preview"]')!;
    expect(preview.textContent).toContain("Waiting for translated text");
    expect(preview.tabIndex).toBe(0);
    Object.defineProperties(preview, { scrollHeight: { value: 1000, configurable: true }, clientHeight: { value: 200, configurable: true } });
    await act(async () => root.render(createElement(LiveTranslationPreview, { html: '<p>မြန်မာ</p>', running: true })));
    expect(preview.textContent).toBe("မြန်မာ");
    expect(preview.scrollTop).toBe(1000);
    await act(async () => { preview.scrollTop = 100; preview.dispatchEvent(new window.Event("scroll")); });
    await act(async () => root.render(createElement(LiveTranslationPreview, { html: '<p>မြန်မာ</p><p>&lt;img src=x&gt; နောက်စာ</p>', running: true })));
    expect(preview.scrollTop).toBe(100);
    expect(preview.textContent).toContain("နောက်စာ");
    expect(preview.querySelector("img,script,iframe")).toBeNull();
    expect(container.querySelector("details")?.open).toBe(false);
    const raw = container.querySelector<HTMLTextAreaElement>('[aria-label="Live translation output"]')!;
    expect(raw.readOnly).toBe(true);
    expect(raw.value).toContain("<p>မြန်မာ</p>");
    await act(async () => { preview.scrollTop = 800; preview.dispatchEvent(new window.Event("scroll")); });
    await act(async () => root.render(createElement(LiveTranslationPreview, { html: '<p>နောက်ဆုံးစာ</p>', running: false })));
    expect(preview.scrollTop).toBe(1000);
    expect(preview.textContent).toBe("နောက်ဆုံးစာ");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    await window.happyDOM.close();
  }
});
