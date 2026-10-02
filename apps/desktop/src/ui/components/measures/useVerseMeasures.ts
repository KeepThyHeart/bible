/**
 * Weights, measures and money for one verse, for the Study panel (task 0069).
 *
 * Reads the reader's measure preferences from the measure store and loads the
 * verse's chapter rows lazily; the models are rebuilt whenever a measure
 * setting, the verse or the UI language changes. A failed load yields no models
 * (the Study section just hides) and never throws.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  computeVerseMeasures,
  loadChapterOccurrences,
  type MeasureOccurrence,
  type MeasurePopupModel,
} from '@bible/core/browser';
import { useMeasureStore } from '../../stores/useMeasureStore';

export function useVerseMeasures(verseId: number | null, uiLocale: string): MeasurePopupModel[] {
  const values = useMeasureStore((s) => s.values);
  const prefs = useMemo(
    () => useMeasureStore.getState().resolvedPrefs(uiLocale), // allow-getstate: derived from the subscribed `values`
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [values, uiLocale],
  );
  const [loaded, setLoaded] = useState<{ key: string; rows: MeasureOccurrence[] } | null>(null);

  const book = verseId ? Math.floor(verseId / 1_000_000) : 0;
  const chapter = verseId ? Math.floor(verseId / 1000) % 1000 : 0;
  const key = `${book}|${chapter}|${prefs.includeDrafts}`;
  const wanted = !!verseId && prefs.enabled;

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    loadChapterOccurrences(book, chapter, { includeDrafts: prefs.includeDrafts })
      .then((rows) => { if (!cancelled) setLoaded({ key, rows }); })
      .catch(() => { if (!cancelled) setLoaded({ key, rows: [] }); });
    return () => { cancelled = true; };
  }, [wanted, book, chapter, key, prefs.includeDrafts]);

  return useMemo(() => {
    if (!wanted || !verseId || !loaded || loaded.key !== key) return [];
    try {
      return computeVerseMeasures({ occurrences: loaded.rows, verseId, uiLocale, prefs });
    } catch {
      return [];
    }
  }, [wanted, verseId, loaded, key, uiLocale, prefs]);
}
