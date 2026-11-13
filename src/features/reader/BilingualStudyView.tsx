import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Icon } from "../../components/Icon";
import { type AlignmentMatch, alignTranslationSegments } from "../../lib/tauri/ai";

type Sentence = { index: number; paragraph: number; text: string };
type CachedAlignment = {
  sourceHash: string;
  targetHash: string;
  matches: AlignmentMatch[];
  completedSentenceCount?: number;
  complete?: boolean;
};
type AlignmentProgress = {
  matches: AlignmentMatch[];
  completedSentenceCount: number;
  complete: boolean;
};
const phraseColors = 6;
const alignmentBatchSize = 4;

function paragraphsFrom(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const candidates = Array.from(
    doc.body.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,dt,dd,blockquote"),
  ).filter((element) => !element.querySelector("p,h1,h2,h3,h4,h5,h6,li,dt,dd"));
  const values = candidates
    .map((element) => element.textContent?.replace(/\s+/gu, " ").trim() ?? "")
    .filter(Boolean);
  return values.length
    ? values
    : [(doc.body.textContent ?? "").replace(/\s+/gu, " ").trim()].filter(Boolean);
}

function splitSentences(html: string): Sentence[] {
  let index = 0;
  return paragraphsFrom(html).flatMap((paragraph, paragraphIndex) =>
    paragraph
      .split(/(?<=[.!?။։])\s+/u)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({ index: index++, paragraph: paragraphIndex, text })),
  );
}

function hashText(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

function cacheKey(chapterId: string) {
  return `sagar:bilingual-alignments:v2:${chapterId}`;
}

function loadCache(
  chapterId: string,
  sourceHash: string,
  targetHash: string,
): AlignmentProgress | null {
  try {
    const cached = JSON.parse(
      localStorage.getItem(cacheKey(chapterId)) ?? "null",
    ) as CachedAlignment | null;
    if (
      cached?.sourceHash === sourceHash &&
      cached.targetHash === targetHash &&
      Array.isArray(cached.matches)
    ) {
      const completedSentenceCount =
        cached.completedSentenceCount ?? Number.MAX_SAFE_INTEGER;
      return {
        matches: cached.matches,
        completedSentenceCount,
        complete: cached.complete ?? completedSentenceCount === Number.MAX_SAFE_INTEGER,
      };
    }
  } catch {
    // Ignore an invalid/stale cache and make a fresh alignment request.
  }
  return null;
}

async function analyzeAlignment(
  chapterId: string,
  source: Sentence[],
  target: Sentence[],
  sourceHash: string,
  targetHash: string,
  initial: AlignmentProgress,
  isCancelled: () => boolean,
  onBatchStart: (start: number, end: number) => void,
  onProgress: (progress: AlignmentProgress) => void,
): Promise<AlignmentProgress> {
  const total = Math.max(source.length, target.length);
  const matches = [...initial.matches];
  let completedSentenceCount = Math.min(initial.completedSentenceCount, total);
  for (
    let offset = completedSentenceCount;
    offset < total;
    offset += alignmentBatchSize
  ) {
    const sourceBatch = source.slice(offset, offset + alignmentBatchSize);
    const targetBatch = target.slice(offset, offset + alignmentBatchSize);
    onBatchStart(offset + 1, Math.min(offset + alignmentBatchSize, total));
    const result =
      sourceBatch.length && targetBatch.length
        ? await alignTranslationSegments({
            chapterId,
            sourceSentences: sourceBatch.map((sentence) => sentence.text),
            targetSentences: targetBatch.map((sentence) => sentence.text),
            consent: true,
          })
        : [];
    if (isCancelled()) return { matches, completedSentenceCount, complete: false };
    matches.push(
      ...result.map((match) => ({
        ...match,
        sourceIndex: match.sourceIndex + offset,
        targetIndex: match.targetIndex + offset,
      })),
    );
    completedSentenceCount = Math.min(offset + alignmentBatchSize, total);
    const progress = {
      matches: [...matches],
      completedSentenceCount,
      complete: completedSentenceCount >= total,
    };
    try {
      localStorage.setItem(
        cacheKey(chapterId),
        JSON.stringify({
          sourceHash,
          targetHash,
          matches,
          completedSentenceCount,
          complete: progress.complete,
        } satisfies CachedAlignment),
      );
    } catch {
      /* Keep progress visible for this session even if storage is unavailable. */
    }
    onProgress(progress);
  }
  return { matches, completedSentenceCount, complete: true };
}

function renderAligned(
  text: string,
  matches: Array<{ match: AlignmentMatch; color: number }>,
  side: "source" | "target",
) {
  const positions = matches
    .flatMap(({ match, color }) => {
      const phrase = side === "source" ? match.sourceText : match.targetText;
      const start = text.indexOf(phrase);
      return start < 0
        ? []
        : [{ start, end: start + phrase.length, color, match, phrase }];
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const item of positions) {
    if (item.start < cursor) continue;
    if (item.start > cursor) nodes.push(text.slice(cursor, item.start));
    nodes.push(
      <mark
        className={`bilingual-study__mark bilingual-study__mark--${item.color % phraseColors}`}
        title={`${item.match.sourceText} = ${item.match.targetText}\n${item.match.meaning}\nသဒ္ဒါ: ${item.match.grammarNote}`}
        key={`${item.start}-${item.end}-${item.color}`}
      >
        {text.slice(item.start, item.end)}
      </mark>,
    );
    cursor = item.end;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export function BilingualStudyView({
  chapterId,
  sourceHtml,
  targetHtml,
}: {
  chapterId: string;
  sourceHtml: string;
  targetHtml: string;
}) {
  const source = useMemo(() => splitSentences(sourceHtml), [sourceHtml]);
  const target = useMemo(() => splitSentences(targetHtml), [targetHtml]);
  const sourceText = source.map((sentence) => sentence.text).join("\n");
  const targetText = target.map((sentence) => sentence.text).join("\n");
  const sourceHash = hashText(sourceText);
  const targetHash = hashText(targetText);
  const [matches, setMatches] = useState<AlignmentMatch[]>(
    () => loadCache(chapterId, sourceHash, targetHash)?.matches ?? [],
  );
  const [analyzing, setAnalyzing] = useState(false);
  const [activeRange, setActiveRange] = useState<[number, number] | null>(null);
  const [completedSentenceCount, setCompletedSentenceCount] = useState(
    () => loadCache(chapterId, sourceHash, targetHash)?.completedSentenceCount ?? 0,
  );
  const [error, setError] = useState<string | null>(null);
  const displayPairs = useMemo(() => {
    const sourceParagraphs = new Map<number, Sentence[]>();
    const targetParagraphs = new Map<number, Sentence[]>();
    for (const sentence of source)
      sourceParagraphs.set(sentence.paragraph, [
        ...(sourceParagraphs.get(sentence.paragraph) ?? []),
        sentence,
      ]);
    for (const sentence of target)
      targetParagraphs.set(sentence.paragraph, [
        ...(targetParagraphs.get(sentence.paragraph) ?? []),
        sentence,
      ]);
    return [...sourceParagraphs.entries()].flatMap(([paragraph, sourceSentences]) => {
      const targetSentences = targetParagraphs.get(paragraph) ?? [];
      const paired = sourceSentences.map((sourceSentence, index) => ({
        source: sourceSentence,
        target: targetSentences[index],
      }));
      return [
        ...paired,
        ...targetSentences.slice(sourceSentences.length).map((targetSentence) => ({
          source: undefined,
          target: targetSentence,
        })),
      ];
    });
  }, [source, target]);

  useEffect(() => {
    let cancelled = false;
    const cached = loadCache(chapterId, sourceHash, targetHash);
    setError(null);
    setMatches(cached?.matches ?? []);
    setCompletedSentenceCount(
      Math.min(
        cached?.completedSentenceCount ?? 0,
        Math.max(source.length, target.length),
      ),
    );
    if (cached?.complete || !source.length || !target.length) {
      setAnalyzing(false);
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setTimeout(() => {
      setAnalyzing(true);
      void analyzeAlignment(
        chapterId,
        source,
        target,
        sourceHash,
        targetHash,
        cached ?? { matches: [], completedSentenceCount: 0, complete: false },
        () => cancelled,
        (start, end) => setActiveRange([start, end]),
        (progress) => {
          setMatches(progress.matches);
          setCompletedSentenceCount(progress.completedSentenceCount);
          setActiveRange(null);
        },
      )
        .catch((reason: unknown) => {
          if (!cancelled)
            setError(
              reason instanceof Error ? reason.message : "စကားလုံးအရောင်တွဲဖော်ပြမှု မအောင်မြင်ပါ။",
            );
        })
        .finally(() => {
          if (!cancelled) setAnalyzing(false);
        });
    }, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [chapterId, source, target, sourceHash, targetHash]);

  if (!source.length)
    return <p className="bilingual-study__empty">ဒီအခန်းမှာ ဖတ်ရန် စာသားမရှိပါ။</p>;

  function renderSentence(sentence: Sentence, side: "source" | "target") {
    const sentenceMatches = matches
      .map((match, color) => ({ match, color }))
      .filter(({ match }) =>
        side === "source"
          ? match.sourceIndex === sentence.index &&
            sentence.text.includes(match.sourceText)
          : match.targetIndex === sentence.index &&
            sentence.text.includes(match.targetText),
      );
    return renderAligned(sentence.text, sentenceMatches, side);
  }

  return (
    <article className="bilingual-study" aria-label="အင်္ဂလိပ်-မြန်မာ စာကြောင်းတွဲဖတ်ရန်">
      <p className="bilingual-study__hint">
        အင်္ဂလိပ်စာကြောင်းတစ်ကြောင်းစီအောက်မှာ မြန်မာဘာသာပြန်ကို ပြထားပါတယ်။ အရောင်တူတဲ့ စကားလုံးပေါ်မှာ
        မောက်စ်တင်ပါက နှစ်ဘာသာအဓိပ္ပာယ်နဲ့ သဒ္ဒါအခန်းကဏ္ဍကို ကြည့်နိုင်ပါတယ်။ ပထမဆုံးဖွင့်ချိန်မှာ ရွေးထားတဲ့ AI ဝန်ဆောင်မှုနဲ့
        ခွဲခြမ်းစိတ်ဖြာပြီး ဒီစက်ထဲမှာ သိမ်းပါတယ်။
      </p>
      {analyzing ? (
        <p className="bilingual-study__analysis" role="status">
          တူညီတဲ့ အဓိပ္ပာယ်ရှိတဲ့ စကားလုံးနဲ့ စကားစုတွေအတွက် အရောင်တွေ ရှာဖွေနေပါတယ်… ({completedSentenceCount}/
          {Math.max(source.length, target.length)} စာကြောင်းပြီးပါပြီ
          {activeRange
            ? `၊ ယခု ${activeRange[0]}–${activeRange[1]} ကြောင်းကို စစ်ဆေးနေပါတယ်`
            : ""}
          )
        </p>
      ) : null}
      {error ? (
        <div className="bilingual-study__analysis-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="အရောင်တွဲဖော်ပြမှု ထပ်ရှာရန်"
            title="ထပ်စမ်းရန်"
            onClick={() => {
              setAnalyzing(true);
              setError(null);
              const cached = loadCache(chapterId, sourceHash, targetHash);
              void analyzeAlignment(
                chapterId,
                source,
                target,
                sourceHash,
                targetHash,
                cached ?? { matches: [], completedSentenceCount: 0, complete: false },
                () => false,
                (start, end) => setActiveRange([start, end]),
                (progress) => {
                  setMatches(progress.matches);
                  setCompletedSentenceCount(progress.completedSentenceCount);
                  setActiveRange(null);
                },
              )
                .catch((reason: unknown) => {
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : "စကားလုံးအရောင်တွဲဖော်ပြမှု မအောင်မြင်ပါ။",
                  );
                })
                .finally(() => setAnalyzing(false));
            }}
          >
            <Icon name="refresh" />
          </button>
        </div>
      ) : null}
      {!analyzing && !error && matches.length === 0 && target.length > 0 ? (
        <div className="bilingual-study__analysis-error" role="status">
          <span>အရောင်တွဲဖို့ ကိုက်ညီတဲ့ စကားလုံး မရသေးပါ။ ထပ်ရှာကြည့်ပါ။</span>
          <button
            type="button"
            className="icon-button"
            aria-label="အရောင်တွဲဖော်ပြမှု ထပ်ရှာရန်"
            title="အရောင်ထပ်ရှာရန်"
            onClick={() => {
              localStorage.removeItem(cacheKey(chapterId));
              setAnalyzing(true);
              const cached = loadCache(chapterId, sourceHash, targetHash);
              void analyzeAlignment(
                chapterId,
                source,
                target,
                sourceHash,
                targetHash,
                cached ?? { matches: [], completedSentenceCount: 0, complete: false },
                () => false,
                (start, end) => setActiveRange([start, end]),
                (progress) => {
                  setMatches(progress.matches);
                  setCompletedSentenceCount(progress.completedSentenceCount);
                  setActiveRange(null);
                },
              )
                .catch((reason: unknown) => {
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : "စကားလုံးအရောင်တွဲဖော်ပြမှု မအောင်မြင်ပါ။",
                  );
                })
                .finally(() => setAnalyzing(false));
            }}
          >
            <Icon name="refresh" />
          </button>
        </div>
      ) : null}
      <div className="bilingual-study__pairs">
        {displayPairs.map(({ source: sourceSentence, target: targetSentence }, index) => (
          <section
            className="bilingual-study__pair"
            key={`${sourceSentence?.index ?? "extra"}-${targetSentence?.index ?? index}`}
          >
            {sourceSentence ? (
              <p className="bilingual-study__source" lang="en">
                {renderSentence(sourceSentence, "source")}
              </p>
            ) : null}
            {targetSentence ? (
              <p className="bilingual-study__target" lang="my">
                {renderSentence(targetSentence, "target")}
              </p>
            ) : null}
          </section>
        ))}
      </div>
    </article>
  );
}
