/**
 * Pane-level hook (task 0065): keeps the keyword-mark match of the chapter on
 * screen current in `useKeywordMarkStore`. Verses read their share of it through
 * `useResolvedVerseDecorations`. Verse text never waits on it.
 */
import { useEffect } from 'react';
import { useKeywordMarkStore } from './useKeywordMarkStore';
import type { PaneVerse } from './keywordMarkLayer';

export interface KeywordChapterSyncParams {
  tabId: string | undefined;
  moduleId: number;
  abbreviation: string | undefined;
  language: string | undefined;
  bookNumber: number;
  chapter: number;
  verses: readonly PaneVerse[];
  /** False in views that render no decorations (Parallel). */
  active: boolean;
}

export function useKeywordChapterSync(p: KeywordChapterSyncParams): void {
  const enabled = useKeywordMarkStore((s) => (p.tabId ? s.tabs[p.tabId]?.enabled === true : false));
  const { tabId, moduleId, abbreviation, language, bookNumber, chapter, verses, active } = p;

  useEffect(() => {
    if (!tabId || !active) return;
    const store = useKeywordMarkStore.getState(); // allow-getstate: effect-time write, not a render read
    if (!enabled || !abbreviation || verses.length === 0) {
      store.clearChapter(tabId);
      return;
    }
    store.syncChapter({ tabId, moduleId, abbreviation, language: language ?? 'en', bookNumber, chapter, verses });
    return () => useKeywordMarkStore.getState().clearChapter(tabId); // allow-getstate: cleanup
  }, [enabled, tabId, active, moduleId, abbreviation, language, bookNumber, chapter, verses]);
}
