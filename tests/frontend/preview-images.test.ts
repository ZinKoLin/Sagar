import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { displayChapterImages } from "../../src/features/translator/richText";
import { preparePreviewImages } from "../../src/lib/tauri/preview";

test("converts HTML and SVG cover images to native resource URLs", () => {
  const window = new Window();
  const previous = globalThis.DOMParser;
  globalThis.DOMParser = window.DOMParser as unknown as typeof DOMParser;
  try {
    const paths: string[] = [];
    const output = preparePreviewImages(
      '<img src="epubres://project/OEBPS/photo.jpg"/><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1104"><image href="epubres://project/OEBPS/cover.jpg"/><image xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="epubres://project/OEBPS/legacy.jpg"/></svg>',
      (path) => {
        paths.push(path);
        return `http://epubres.localhost/${path}`;
      },
    );
    expect(paths).toEqual([
      "project/OEBPS/photo.jpg", "project/OEBPS/cover.jpg", "project/OEBPS/legacy.jpg",
    ]);
    expect(output).toContain('href="http://epubres.localhost/project/OEBPS/cover.jpg"');
    expect(output).not.toContain("epubres://");
    expect(output).toContain('viewBox="0 0 800 1104"');
  } finally {
    globalThis.DOMParser = previous;
    window.happyDOM.abort();
  }
});

test("shows source EPUB images in the translation rich editor", () => {
  const window = new Window();
  const previous = globalThis.DOMParser;
  globalThis.DOMParser = window.DOMParser as unknown as typeof DOMParser;
  try {
    const output = displayChapterImages(
      '<section><p>Text</p><img src="../images/figure.png" alt="Figure"/></section>',
      [
        {
          source: "../images/figure.png",
          src: "data:image/png;base64,AA==",
        },
      ],
    );
    expect(output).toContain('src="data:image/png;base64,AA=="');
    expect(output).toContain('alt="Figure"');
  } finally {
    globalThis.DOMParser = previous;
    window.happyDOM.abort();
  }
});
