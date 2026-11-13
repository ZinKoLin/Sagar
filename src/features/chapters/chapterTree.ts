import type { ChapterSummary } from "../../types/project";

export type ChapterNode = {
  id: string;
  title: string;
  chapter?: ChapterSummary;
  children: ChapterNode[];
};

/** Keep spine order, grouping only contiguous chapters with the same TOC parent. */
export function chapterTree(chapters: ChapterSummary[]): ChapterNode[] {
  const roots: ChapterNode[] = [];
  for (const chapter of chapters) {
    let siblings = roots;
    for (const group of chapter.navigationGroups ?? []) {
      let node = siblings[siblings.length - 1];
      if (node?.id !== group.id) {
        const opening =
          node?.chapter?.resourceHref === group.resource
            ? siblings.pop()?.chapter
            : undefined;
        node = { id: group.id, title: group.title, chapter: opening, children: [] };
        siblings.push(node);
      }
      siblings = node.children;
    }
    siblings.push({ id: chapter.id, title: chapter.title, chapter, children: [] });
  }
  return roots;
}
