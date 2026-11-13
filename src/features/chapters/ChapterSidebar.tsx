import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import type { ChapterSummary } from "../../types/project";

import { type ChapterNode, chapterTree } from "./chapterTree";

type ChapterSidebarProps = {
  chapters: ChapterSummary[];
  activeChapterId: string | null;
  /** Live status of the active chapter, derived from chapter saves. */
  chapterStatusOverride: string | null;
  onSelect: (chapterId: string) => void;
};

/**
 * Chapter list in OPF spine order. A chapter here is one spine resource;
 * table-of-contents anchors within a resource are not separate chapters.
 */
export function ChapterSidebar({
  chapters,
  activeChapterId,
  chapterStatusOverride,
  onSelect,
}: ChapterSidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const ancestors =
      chapters.find((chapter) => chapter.id === activeChapterId)?.navigationGroups ?? [];
    setCollapsed((previous) => {
      const next = new Set(previous);
      for (const ancestor of ancestors) next.delete(ancestor.id);
      return next;
    });
  }, [activeChapterId, chapters]);
  const statusOf = (chapter: ChapterSummary) =>
    chapter.id === activeChapterId
      ? (chapterStatusOverride ?? chapter.status)
      : chapter.status;
  const filtered = chapters.filter((chapter) => {
    const matchesText =
      `${chapter.spineIndex + 1} ${String(chapter.spineIndex + 1).padStart(2, "0")} ${chapter.title} ${(chapter.navigationGroups ?? []).map((group) => group.title).join(" ")}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase());
    const status = statusOf(chapter);
    return (
      matchesText &&
      (filter === "all" ||
        filter === status ||
        (filter === "incomplete" && status !== "completed"))
    );
  });
  function renderNode(node: ChapterNode): ReactNode {
    const chapter = node.chapter;
    const isActive = chapter?.id === activeChapterId;
    const expanded = !collapsed.has(node.id);
    const groupId = `chapter-group-${node.id}`;
    return (
      <li key={node.id}>
        <div className="chapter-list__row">
          {node.children.length > 0 && (
            <button
              type="button"
              className="icon-button chapter-list__toggle"
              aria-label={`${expanded ? "Collapse" : "Expand"} ${node.title}`}
              title={`${expanded ? "Collapse" : "Expand"} ${node.title}`}
              aria-expanded={expanded}
              aria-controls={groupId}
              onClick={() =>
                setCollapsed((previous) => {
                  const next = new Set(previous);
                  if (expanded) next.add(node.id);
                  else next.delete(node.id);
                  return next;
                })
              }
            >
              <Icon name={expanded ? "chevronDown" : "right"} />
            </button>
          )}
          {chapter ? (
            <button
              type="button"
              className="chapter-list__select"
              aria-current={isActive ? "true" : undefined}
              tabIndex={0}
              onClick={() => onSelect(chapter.id)}
            >
              <span className="chapter-list__index">
                {String(chapter.spineIndex + 1).padStart(2, "0")}
              </span>
              <span>
                <span className="chapter-list__title">
                  <Icon name="book" />
                  {chapter.title}
                </span>
                <span className="chapter-list__status">
                  {statusLabel(chapter, isActive ? chapterStatusOverride : null)}
                </span>
              </span>
            </button>
          ) : (
            <span className="chapter-list__group-title">
              <Icon name="book" />
              {node.title}
            </span>
          )}
        </div>
        {node.children.length > 0 && (
          <ol id={groupId} className="chapter-list__children" hidden={!expanded}>
            {node.children.map(renderNode)}
          </ol>
        )}
      </li>
    );
  }
  return (
    <nav className="chapter-nav" aria-label="Chapters">
      <h2 className="chapter-nav__heading">Chapters</h2>
      <div className="chapter-nav__filters">
        <label className="chapter-nav__search">
          <Icon name="search" size={16} />
          <input
            type="search"
            aria-label="Search sidebar chapters"
            placeholder="Search chapters…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCollapsed(new Set());
            }}
          />
        </label>
        <select
          className="chapter-nav__status-filter"
          aria-label="Filter chapters by progress"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setCollapsed(new Set());
          }}
        >
          <option value="all">All chapters</option>
          <option value="incomplete">Incomplete</option>
          <option value="not_started">Not started</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
        </select>
        <p className="chapter-nav__count" role="status">
          {filtered.length} of {chapters.length} chapters
        </p>
      </div>
      {chapters.length === 0 ? (
        <p className="chapter-nav__empty">No chapters found.</p>
      ) : filtered.length === 0 ? (
        <div className="chapter-nav__empty">
          <p>No matching chapters.</p>
          <button
            type="button"
            className="btn btn--small"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            <Icon name="refresh" />
            Clear filters
          </button>
        </div>
      ) : (
        <ol className="chapter-list" onKeyDown={onListKeyDown}>
          {chapterTree(filtered).map((node) => renderNode(node))}
        </ol>
      )}
    </nav>
  );
}

function onListKeyDown(event: KeyboardEvent<HTMLOListElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    return;
  }
  event.preventDefault();
  const rows = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
  ).filter((row) => !row.closest("[hidden]"));
  const currentIndex =
    document.activeElement instanceof HTMLButtonElement
      ? rows.indexOf(document.activeElement)
      : -1;
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? rows.length - 1
        : event.key === "ArrowDown"
          ? Math.min(rows.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
  const target = rows[next];
  if (target) {
    target.focus();
    target.scrollIntoView({ block: "nearest" });
  }
}

function statusLabel(chapter: ChapterSummary, liveStatus: string | null): string {
  const status =
    liveStatus === "completed"
      ? "Completed"
      : liveStatus === "in_progress"
        ? "In progress"
        : liveStatus === "not_started"
          ? "Not started"
          : chapter.status === "not_started"
            ? "Not started"
            : chapter.status === "in_progress"
              ? "In progress"
              : "Completed";
  return status;
}
