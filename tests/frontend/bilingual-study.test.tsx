import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { BilingualStudyView } from "../../src/features/reader/BilingualStudyView";

test("bilingual study displays translated sentences together and colors matching phrases", async () => {
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    localStorage: window.localStorage,
    DOMParser: window.DOMParser,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const sourceHtml = "<p>First sentence. Second sentence?</p>";
  const targetHtml = "<p>ပထမစာကြောင်း။ ဒုတိယစာကြောင်း။</p>";
  try {
    localStorage.clear();
    const hash = (text: string) => {
      let value = 2166136261;
      for (let index = 0; index < text.length; index++)
        value = Math.imul(value ^ text.charCodeAt(index), 16777619);
      return (value >>> 0).toString(36);
    };
    localStorage.setItem(
      "sagar:bilingual-alignments:v2:chapter-1",
      JSON.stringify({
        sourceHash: hash("First sentence.\nSecond sentence?"),
        targetHash: hash("ပထမစာကြောင်း။\nဒုတိယစာကြောင်း။"),
        matches: [
          {
            sourceIndex: 0,
            targetIndex: 0,
            sourceText: "First",
            targetText: "ပထမ",
            meaning: "အစပိုင်းကို ရည်ညွှန်းသည်",
            grammarNote: "နာမဝိသေသန",
          },
        ],
      }),
    );
    await act(async () => {
      root.render(
        createElement(BilingualStudyView, {
          chapterId: "chapter-1",
          sourceHtml,
          targetHtml,
        }),
      );
    });
    expect(container.textContent).toContain("First sentence.");
    expect(container.textContent).toContain("ပထမစာကြောင်း။");
    expect(container.querySelectorAll(".bilingual-study__mark--0").length).toBe(2);
    expect(container.querySelector(".bilingual-study__mark")?.getAttribute("title")).toContain(
      "သဒ္ဒါ: နာမဝိသေသန",
    );
    expect(container.querySelectorAll("select")).toHaveLength(0);
    expect(container.textContent).not.toContain("တွဲဖက်မထားသော ဘာသာပြန်");
    const firstPair = container.querySelector(".bilingual-study__pair");
    expect(firstPair?.querySelector(".bilingual-study__source")?.textContent).toContain(
      "First sentence.",
    );
    expect(firstPair?.querySelector(".bilingual-study__target")?.textContent).toContain(
      "ပထမစာကြောင်း။",
    );

    await act(async () => root.unmount());
  } finally {
    await act(async () => root.unmount());
    container.remove();
    await window.happyDOM.close();
  }
});
