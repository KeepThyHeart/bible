/**
 * The chapter the primary (first) Bible panel has loaded, as a plain value for chapter mode's
 * Follow. Mirrors what CommentaryPane watches: the first `verse_id` of the active tab's verses.
 * A pop-out has no Bible panel: the chapter arrives from the main window (`bible-chapter-changed`)
 * and the translation comes from the main window.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { useBibleStore } from '../../../stores/useBibleStore';
import { getMainActiveTranslation } from '../../../utils/mainActiveTranslation';
import { parseVerseId } from '../../../utils/verseReference';

export interface PrimaryBibleChapter {
  book: number | null;
  chapter: number | null;
  firstVerseId: number | null;
  /** A preview (cross-reference glance) is showing: the reader's subject has not changed. */
  previewActive: boolean;
  /** Abbreviation of the Bible pane's active tab, or null. */
  translation: string | null;
}

// A pop-out has no Bible panel; the main window tells it which chapter its Bible pane loaded
// (`bible-chapter-changed`). Shared by every caller in the window, subscribed once.
let detachedChapterVerseId: number | null = null;
const detachedListeners = new Set<() => void>();
let detachedWired = false;

function wireDetachedChapter(): void {
  if (detachedWired) return;
  const on = window.electron?.window?.onBibleChapterChanged;
  if (!on) return;
  detachedWired = true;
  on((verseId: number) => {
    if (verseId === detachedChapterVerseId) return;
    detachedChapterVerseId = verseId;
    detachedListeners.forEach(l => l());
  });
}

function subscribeDetached(listener: () => void): () => void {
  wireDetachedChapter();
  detachedListeners.add(listener);
  return () => { detachedListeners.delete(listener); };
}
const getDetachedChapterVerseId = (): number | null => detachedChapterVerseId;

/** Test hook: forget what the main window last announced. */
export function resetDetachedChapterForTests(): void {
  detachedChapterVerseId = null;
  detachedWired = false;
  detachedListeners.clear();
}

const subscribeNothing = (): (() => void) => () => {};
const getNull = (): number | null => null;

export function usePrimaryBibleChapter(isDetached: boolean): PrimaryBibleChapter {
  const detachedVerse = useSyncExternalStore(
    isDetached ? subscribeDetached : subscribeNothing,
    isDetached ? getDetachedChapterVerseId : getNull,
  );
  const panel = useBibleStore(s => (isDetached ? null : (s.panels.values().next().value ?? null)));
  return useMemo(() => {
    if (isDetached) {
      const parsedDetached = detachedVerse ? parseVerseId(detachedVerse) : null;
      return {
        book: parsedDetached?.bookNumber ?? null,
        chapter: parsedDetached?.chapter ?? null,
        firstVerseId: detachedVerse,
        previewActive: false,
        translation: getMainActiveTranslation(),
      };
    }
    if (!panel) {
      return { book: null, chapter: null, firstVerseId: null, previewActive: false, translation: getMainActiveTranslation() };
    }
    const tab = panel.openTabs[panel.activeTabIndex];
    const verses = tab ? panel.versesByTab.get(tab.tabId) : undefined;
    const firstVerseId = verses && verses.length > 0 && verses[0].verse_id ? verses[0].verse_id : null;
    const parsed = firstVerseId ? parseVerseId(firstVerseId) : null;
    return {
      book: parsed?.bookNumber ?? null,
      chapter: parsed?.chapter ?? null,
      firstVerseId,
      previewActive: (panel.previewVerseId ?? null) !== null,
      translation: tab?.abbreviation ?? null,
    };
  }, [isDetached, panel, detachedVerse]);
}
