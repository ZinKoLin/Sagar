import { useCallback, useEffect, useRef, useState } from "react";
import { formatChapterHtml } from "../../lib/html/format";
import { saveChapterDocument } from "../../lib/tauri/commands";
import type { BlockStatus, ChapterContent } from "../../types/chapter";
import type { SaveIndicator } from "./useTranslationEditor";

export type Draft = {
  chapterId: string;
  html: string;
  status: BlockStatus;
  revision: number;
  version: number;
  dirty: boolean;
  error: string | null;
  conflict: boolean;
};
export function useChapterEditor(content: ChapterContent | null) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const latest = useRef<Draft | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);
  const [saving, setSaving] = useState(false);
  const publish = useCallback((next: Draft | null) => {
    latest.current = next;
    setDraft(next);
  }, []);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    publish(
      content
        ? {
            chapterId: content.chapterId,
            html: formatChapterHtml(content.document.html ?? ""),
            status: content.document.status,
            revision: content.document.revision,
            version: 0,
            dirty: false,
            error: null,
            conflict: false,
          }
        : null,
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [content, publish]);

  const save = useCallback(async (): Promise<boolean> => {
    if (inflight.current) {
      const ok = await inflight.current;
      if (!ok) return false;
      return save();
    }
    const snapshot = latest.current;
    if (!snapshot?.dirty) return !snapshot?.error;
    if (snapshot.conflict) return false;
    setSaving(true);
    const request = saveChapterDocument(
      snapshot.chapterId,
      snapshot.html || null,
      snapshot.status,
      snapshot.revision,
    )
      .then((result) => {
        const current = latest.current;
        if (current?.chapterId === snapshot.chapterId) {
          const changed = current.version !== snapshot.version;
          publish({
            ...current,
            revision: result.revision,
            status: changed ? current.status : result.status,
            dirty: changed,
            error: null,
            conflict: false,
          });
        }
        return true;
      })
      .catch((error: unknown) => {
        const current = latest.current;
        if (current?.chapterId === snapshot.chapterId)
          publish({
            ...current,
            error:
              error instanceof Error ? error.message : "The chapter could not be saved.",
            conflict:
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              error.code === "revision_conflict",
          });
        return false;
      })
      .finally(() => {
        inflight.current = null;
        setSaving(false);
      });
    inflight.current = request;
    return request;
  }, [publish]);
  const setHtml = useCallback(
    (html: string) => {
      const current = latest.current;
      if (!current || current.conflict || current.html === html) return;
      publish({
        ...current,
        html,
        status: "draft",
        version: current.version + 1,
        dirty: true,
        error: null,
      });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void save();
      }, 600);
    },
    [publish, save],
  );
  const flushAll = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (latest.current?.error) return false;
    while (latest.current?.dirty || inflight.current) {
      if (!(await save())) return false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    }
    return true;
  }, [save]);
  const setStatus = useCallback(
    (status: BlockStatus) => {
      const current = latest.current;
      if (!current || current.conflict) return;
      publish({
        ...current,
        status,
        version: current.version + 1,
        dirty: true,
        error: null,
      });
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      void save();
    },
    [publish, save],
  );
  const retry = useCallback((): Promise<boolean> => {
    const current = latest.current;
    if (!current || current.conflict) return Promise.resolve(false);
    publish({ ...current, error: null });
    return save();
  }, [publish, save]);
  const indicator: SaveIndicator = draft?.error
    ? "error"
    : saving
      ? "saving"
      : draft?.dirty
        ? "unsaved"
        : "saved";
  const chapterStatus = !draft
    ? null
    : draft.status === "reviewed" || draft.status === "skipped"
      ? "completed"
      : draft.status === "draft"
        ? "in_progress"
        : "not_started";
  return { draft, setHtml, setStatus, retry, flushAll, indicator, chapterStatus };
}
