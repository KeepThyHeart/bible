import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  computeVerseMeasures, loadChapterOccurrences, type MeasureOccurrence, type MeasurePopupModel,
} from '@bible/core/browser';
import { isEnabled } from '../../utils/featureFlags';
import { useSettings } from '../host/contributedSettings';
import { webMeasurePreferences } from './chapterMeasures';

const NONE: MeasurePopupModel[] = [];

/**
 * Weights, measures and money notes of one verse, for the Study panel. Works whatever the in-text
 * display setting is (that only governs marks in the text). Loads the chapter lazily; a failure or
 * disabled measures yield an empty list so the section hides. Re-computes when the measure settings,
 * the UI locale or the verse change.
 */
export function useVerseMeasures(verseId: number | null, uiLocale: string): MeasurePopupModel[] {
  const settings = useSettings();
  const includeDrafts = isEnabled('measureDrafts');
  const prefs = useMemo(
    () => webMeasurePreferences(settings as Record<string, unknown>, uiLocale, includeDrafts),
    [settings, uiLocale, includeDrafts],
  );

  const book = verseId ? Math.floor(verseId / 1_000_000) : 0;
  const chapter = verseId ? Math.floor((verseId % 1_000_000) / 1_000) : 0;
  const chapterKey = `${book}:${chapter}:${includeDrafts}`;
  const wanted = prefs.enabled && book > 0 && chapter > 0;
  const [loaded, setLoaded] = useState<{ key: string; occurrences: MeasureOccurrence[] } | null>(null);

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    loadChapterOccurrences(book, chapter, { includeDrafts })
      .then((occurrences) => { if (!cancelled) setLoaded({ key: chapterKey, occurrences }); })
      .catch(() => { if (!cancelled) setLoaded({ key: chapterKey, occurrences: [] }); });
    return () => { cancelled = true; };
  }, [wanted, book, chapter, includeDrafts, chapterKey]);

  const occurrences = loaded && loaded.key === chapterKey ? loaded.occurrences : null;
  return useMemo(() => {
    if (!wanted || !verseId || !occurrences || occurrences.length === 0) return NONE;
    try {
      return computeVerseMeasures({ occurrences, verseId, uiLocale, prefs });
    } catch {
      return NONE;
    }
  }, [wanted, verseId, occurrences, uiLocale, prefs]);
}
