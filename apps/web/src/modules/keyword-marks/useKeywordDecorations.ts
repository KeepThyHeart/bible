import { useEffect, useMemo } from 'preact/hooks';
import { keywordMarkStore } from './keywordMarkStore';
import { useStore } from '../../hooks/useStore';
import { interlinearToSpans } from '../../host/chapterLayers';
import type { ChapterMarks, KeywordSurface } from './chapterMarks';
import type { IInterlinearDataProvider } from '../../providers/interfaces';
import type { InterlinearWordData, VerseData } from '../../types';

export interface KeywordDecorationsInput {
  moduleAbbr: string;
  moduleId: number | undefined;
  language: string | undefined;
  book: number | null;
  chapter: number | null;
  verses: readonly VerseData[];
  surface: KeywordSurface;
  /** Rows Study already holds for this chapter (used instead of a fetch). */
  studyRows?: readonly InterlinearWordData[];
  /** Server-backed interlinear source for non-Study surfaces. */
  interlinearProvider?: IInterlinearDataProvider;
}

/**
 * The keyword marks for the chapter in view: matches the active sets and
 * fetches interlinear rows when a rule wants them (Standard and Reading, from
 * the server only). The host resolves the marks' layer per verse for the renderers.
 */
export function useKeywordDecorations(paneId: string, input: KeywordDecorationsInput): ChapterMarks | null {
  // Re-render on any store change (pane state, interlinear cache).
  useStore(keywordMarkStore, () => keywordMarkStore.interlinearRevision);
  const enabled = keywordMarkStore.isEnabled(paneId);
  const { book, chapter, moduleAbbr, moduleId, language, verses, surface, studyRows, interlinearProvider } = input;

  const chapterKey = `${moduleAbbr}:${book}:${chapter}`;
  const studySpans = useMemo(
    () => (studyRows && studyRows.length > 0 ? interlinearToSpans(studyRows) : undefined),
    [studyRows],
  );
  const usable = enabled && !!book && !!chapter && moduleId !== undefined && verses.length > 0;

  // Reading the store inside render is deliberate: the store memoises, and the
  // revision read above re-renders us when its inputs change.
  const marks = usable
    ? keywordMarkStore.getChapterMarks(paneId, {
        chapterKey, moduleId: moduleId!, language: language ?? 'en', verses, interlinear: studySpans,
      })
    : null;

  const wants = keywordMarkStore.wantsInterlinear(marks);
  useEffect(() => {
    // Study loads its own rows (BiblePane); every other surface asks the server.
    if (!usable || !wants || surface === 'study' || !interlinearProvider || !book || !chapter) return;
    keywordMarkStore.ensureInterlinear(
      chapterKey,
      () => interlinearProvider.getInterlinear(book, chapter, moduleAbbr).then((d) => d.words),
    );
  }, [usable, wants, surface, interlinearProvider, chapterKey]);

  // Study's rows double as the cache for a later switch to Standard or Reading.
  useEffect(() => {
    if (usable && studyRows && studyRows.length > 0) keywordMarkStore.seedInterlinear(chapterKey, studyRows);
  }, [usable, studyRows, chapterKey]);

  // Let subscribers that read the legend (the toolbar button) re-render with the new marks.
  useEffect(() => { keywordMarkStore.marksComputed(paneId); }, [paneId, marks, enabled]);
  return marks;
}
