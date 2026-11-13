import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import type { ChapterSummary } from "../../types/project";

export function ChapterPicker({
  chapters,
  chapterId,
  disabled,
  onSelect,
}: {
  chapters: ChapterSummary[];
  chapterId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const label = (chapter: ChapterSummary) =>
    `${chapter.spineIndex + 1}. ${chapter.title}`;
  const selected = chapters.find((chapter) => chapter.id === chapterId);
  const filtered = chapters.filter((chapter) =>
    `${label(chapter)} ${(chapter.navigationGroups ?? []).map((group) => group.title).join(" ")}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const activeId = filtered.some((chapter) => chapter.id === highlight)
    ? highlight
    : filtered[0]?.id;
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open && activeId)
      document
        .getElementById(`${listId}-${activeId}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, activeId, listId]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  function choose(id: string) {
    close();
    onSelect(id);
  }
  function show() {
    setQuery("");
    setHighlight(chapterId);
    setOpen(true);
  }
  return (
    <div className="chapter-picker" ref={root}>
      <button
        type="button"
        className="chapter-picker__trigger"
        ref={trigger}
        disabled={disabled}
        aria-label={`Current chapter: ${selected ? label(selected) : "Choose chapter"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show();
          }
        }}
      >
        <span>{selected ? label(selected) : "Choose chapter"}</span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open ? (
        <div className="chapter-picker__popover">
          <div className="chapter-picker__search">
            <Icon name="search" size={16} />
            <input
              ref={input}
              onBlur={(event) => {
                if (!root.current?.contains(event.relatedTarget as Node | null))
                  setOpen(false);
              }}
              role="combobox"
              aria-label="Search chapters"
              aria-expanded={true}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeId ? `${listId}-${activeId}` : undefined}
              placeholder="Search chapter title or number…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlight(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  close();
                } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const index = filtered.findIndex((chapter) => chapter.id === activeId);
                  const next = Math.max(
                    0,
                    Math.min(
                      filtered.length - 1,
                      index + (event.key === "ArrowDown" ? 1 : -1),
                    ),
                  );
                  setHighlight(filtered[next]?.id ?? null);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (activeId) choose(activeId);
                }
              }}
            />
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label="Chapters"
            className="chapter-picker__list"
          >
            {filtered.map((chapter) => (
              <button
                type="button"
                role="option"
                tabIndex={-1}
                id={`${listId}-${chapter.id}`}
                key={chapter.id}
                aria-selected={chapter.id === chapterId}
                aria-label={`${(chapter.navigationGroups ?? []).map((group) => group.title).join(" / ")} ${label(chapter)}`.trim()}
                style={{
                  paddingInlineStart: `${12 + Math.min(chapter.navigationGroups?.length ?? 0, 4) * 16}px`,
                }}
                className={`chapter-picker__option${chapter.id === activeId ? " chapter-picker__option--active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setHighlight(chapter.id)}
                onClick={() => choose(chapter.id)}
              >
                <span className="chapter-picker__option-label">
                  <Icon name="book" size={16} />
                  <span>
                    <span>{label(chapter)}</span>
                    {(chapter.navigationGroups?.length ?? 0) > 0 && (
                      <small className="chapter-picker__context">
                        {chapter.navigationGroups
                          ?.map((group) => group.title)
                          .join(" / ")}
                      </small>
                    )}
                  </span>
                </span>
                {chapter.id === chapterId ? <Icon name="check" size={16} /> : null}
              </button>
            ))}
          </div>
          <p className="chapter-picker__help" role="status">
            {filtered.length
              ? `${filtered.length} chapters · ↑↓ navigate · Enter select`
              : "No matching chapters"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
