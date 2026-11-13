import { expect, test } from "bun:test";
import { chapterTree } from "../../src/features/chapters/chapterTree";
import type { ChapterSummary } from "../../src/types/project";

function chapter(id: string, groups: ChapterSummary["navigationGroups"] = []): ChapterSummary {
  return { id, title: id, resourceHref: `${id}.xhtml`, spineIndex: 0, status: "not_started", totalBlocks: 0, reviewedBlocks: 0, unsupportedBlocks: 0, navigationGroups: groups };
}
const volume = { id: "volume-1", title: "Volume 1", resource: "v1.xhtml" };
test("volume opening remains selectable without a duplicate row", () => {
  const tree = chapterTree([chapter("intro"), chapter("v1"), chapter("c1", [volume]), chapter("c2", [volume])]);
  expect(tree.map(node => node.id)).toEqual(["intro", "volume-1"]);
  expect(tree[1].chapter?.id).toBe("v1");
  expect(tree[1].children.map(node => node.chapter?.id)).toEqual(["c1", "c2"]);
});
test("unlinked and nested groups preserve spine order and stable chapter identity", () => {
  const part = { id: "part", title: "အပိုင်း", resource: null };
  const tree = chapterTree([chapter("c2", [volume, part]), chapter("c1", [volume]), chapter("after")]);
  expect(tree[0].children[0].children[0].chapter?.id).toBe("c2");
  expect(tree[0].children[1].chapter?.id).toBe("c1");
  expect(tree[1].chapter?.id).toBe("after");
});
test("flat books and empty lists retain their original shape", () => {
  expect(chapterTree([])).toEqual([]);
  expect(chapterTree([chapter("b"), chapter("a")]).map(node => node.id)).toEqual(["b", "a"]);
});
