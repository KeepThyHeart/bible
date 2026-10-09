import { useEffect, useMemo, useState } from 'preact/hooks';
import { loadChapterOccurrences, type ChapterMeasures, type MeasureOccurrence } from '@bible/core/browser';
import { isEnabled } from '../../utils/featureFlags';
import { interlinearToSpans } from '../../host/chapterLayers';
import { useSettings } from '../host/contributedSettings';
import { computeWebChapterMeasures, webMeasurePreferences } from './chapterMeasures';
import type { InterlinearWordData, VerseData } from '../../types';

export interface MeasureDecorationsInput {
  book: number | null;
  chapter: number | null;
  verses: readonly VerseData[];
  /** Language of the Bible module text. */
  moduleLanguage: string | undefined;
  surface: 'standard' | 'reading' | 'study';
  /** Rows Study already holds for this chapter. */
  studyRows?: readonly InterlinearWordData[];
  uiLocale: string;
}

const NONE: ChapterMeasures | null = null;

/**
 * Weights, measures and money notes for the chapter in view: loads the
 * chapter's occurrences (lazily, per testament), then computes the paint
 * layer, the word index and the popup models. Re-computes when the settings,
 * the UI locale, the surface or the verses change.
 */
export function useMeasureDecorations(input: MeasureDecorationsInput): ChapterMeasures | null {
  const { book, chapter, verses, moduleLanguage, surface, studyRows, uiLocale } = input;
  const settings = useSettings();
  const includeDrafts = isEnabled('measureDrafts');
  const prefs = useMemo(
    () => webMeasurePreferences(settings as Record<string, unknown>, uiLocale, includeDrafts),
    [settings, uiLocale, includeDrafts],
  );

  const wanted = prefs.enabled && prefs.display !== 'off' && !!book && !!chapter && verses.length > 0;
  const chapterKey = `${book}:${chapter}:${includeDrafts}`;
  const [loaded, setLoaded] = useState<{ key: string; occurrences: MeasureOccurrence[] } | null>(null);

  useEffect(() => {
    if (!wanted || !book || !chapter) return;
    let cancelled = false;
    loadChapterOccurrences(book, chapter, { includeDrafts })
      .then((occurrences) => { if (!cancelled) setLoaded({ key: chapterKey, occurrences }); })
      .catch(() => { if (!cancelled) setLoaded({ key: chapterKey, occurrences: [] }); });
    return () => { cancelled = true; };
  }, [wanted, book, chapter, includeDrafts, chapterKey]);

  const spans = useMemo(
    () => (studyRows && studyRows.length > 0 ? interlinearToSpans(studyRows) : undefined),
    [studyRows],
  );
  const occurrences = loaded && loaded.key === chapterKey ? loaded.occurrences : null;

  return useMemo(() => {
    if (!wanted || !occurrences || occurrences.length === 0) return NONE;
    return computeWebChapterMeasures({
      occurrences, verses, moduleLanguage, interlinear: spans, uiLocale, prefs, surface,
    });
  }, [wanted, occurrences, verses, moduleLanguage, spans, uiLocale, prefs, surface]);
}
