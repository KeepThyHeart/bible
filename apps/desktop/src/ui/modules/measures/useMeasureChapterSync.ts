/**
 * Pane-level hook (task 0069): keeps the weights-and-measures marks of the
 * chapter on screen current in `useMeasureStore`. Verses read their share of it
 * through `useResolvedVerseDecorations`; verse text never waits on it.
 */
import { useEffect } from 'react';
import type { MeasureSurface } from '@bible/core/browser';
import { useMeasureStore } from './useMeasureStore';
import type { PaneVerse } from '../../extensions/chapterLayers';

export interface MeasureChapterSyncParams {
  tabId: string | undefined;
  moduleId: number;
  abbreviation: string | undefined;
  language: string | undefined;
  bookNumber: number;
  chapter: number;
  verses: readonly PaneVerse[];
  surface: MeasureSurface;
  uiLocale: string;
  /** False in views that render no decorations (Parallel). */
  active: boolean;
}

export function useMeasureChapterSync(p: MeasureChapterSyncParams): void {
  // Re-sync when any setting changes (the store recomputes on `setValue` itself, so this only
  // needs the values that decide whether there is anything to compute at all).
  const { tabId, moduleId, abbreviation, language, bookNumber, chapter, verses, surface, uiLocale, active } = p;

  useEffect(() => {
    if (!tabId || !active) return;
    if (!abbreviation || verses.length === 0) {
      useMeasureStore.getState().clearChapter(tabId); // allow-getstate: effect-time write
      return;
    }
    useMeasureStore.getState().syncChapter({ // allow-getstate: effect-time write, not a render read
      tabId, moduleId, abbreviation, language: language ?? 'en', bookNumber, chapter, verses, surface, uiLocale,
    });
    return () => useMeasureStore.getState().clearChapter(tabId); // allow-getstate: cleanup
  }, [tabId, active, moduleId, abbreviation, language, bookNumber, chapter, verses, surface, uiLocale]);
}
