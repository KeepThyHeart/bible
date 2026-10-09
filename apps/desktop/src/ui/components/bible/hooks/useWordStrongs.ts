import { useEffect, useState } from 'react';
import { VerseIdHelper, type InterlinearSpan } from '@bible/core/browser';
import { interlinearToSpans } from '../../../extensions/chapterLayers';

/** Chapter rows per `abbreviation|book|chapter`; a failed fetch is cached as empty so it is not retried per right-click. */
const rowCache = new Map<string, Promise<InterlinearSpan[]>>();

/** Test hook: forget cached chapter rows. */
export function resetWordStrongsCache(): void {
  rowCache.clear();
}

/** The Strong's number an interlinear span list assigns to a word, if any. */
export function strongsAt(spans: readonly InterlinearSpan[], verseId: number, wordIndex: number): string | undefined {
  return spans.find((s) => s.verseId === verseId && s.strongs && wordIndex >= s.start && wordIndex <= s.end)?.strongs;
}

async function fetchRows(abbreviation: string, book: number, chapter: number): Promise<InterlinearSpan[]> {
  const key = `${abbreviation}|${book}|${chapter}`;
  let p = rowCache.get(key);
  if (!p) {
    p = import('../../../services/electronAPI')
      .then(({ bibleAPI }) => bibleAPI.getInterlinearWordsForChapter(abbreviation, book, chapter))
      .then((byVerse) => interlinearToSpans(byVerse as Parameters<typeof interlinearToSpans>[0]))
      .catch((): InterlinearSpan[] => []);
    rowCache.set(key, p);
  }
  return p;
}

/**
 * Strong's number of a right-clicked word, when the module has interlinear rows for it (for the word items feature modules add).
 * Resolves after the chapter's rows arrive; `undefined` until then and for modules without interlinear data.
 */
export function useWordStrongs(abbreviation: string | undefined, verseId: number | undefined, wordIndex: number | undefined): string | undefined {
  const [found, setFound] = useState<string | undefined>(undefined);
  useEffect(() => {
    setFound(undefined);
    if (!abbreviation || verseId === undefined || wordIndex === undefined) return;
    const { bookNumber, chapter } = VerseIdHelper.parse(verseId);
    let cancelled = false;
    void fetchRows(abbreviation, bookNumber, chapter).then((rows) => {
      if (!cancelled) setFound(strongsAt(rows, verseId, wordIndex));
    });
    return () => { cancelled = true; };
  }, [abbreviation, verseId, wordIndex]);
  return found;
}
