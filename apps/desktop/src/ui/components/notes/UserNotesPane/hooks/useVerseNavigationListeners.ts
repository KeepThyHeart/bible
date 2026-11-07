import { useEffect } from 'react';
import { VerseIdHelper } from '@bible/core';
import { useBibleStore } from '../../../../stores/useBibleStore';
import { DEFAULT_PANEL_ID } from '../../../../stores/helpers/panelStateHelpers';
import { isDetachedWindow } from '../../../../utils/isDetachedWindow';

/** A popped-out window has no Bible pane: hand the passage to the main window. Returns true when handed over. */
function handOverToMainWindow(verseId: number, newPanel: boolean): boolean {
  if (!isDetachedWindow()) return false;
  const api = window.electron?.window?.navigateMainToVerse;
  if (!api) return false;
  void api(verseId, newPanel).catch(err => console.error('[notes] could not open the passage in the main window:', err));
  return true;
}

/**
 * Wires up the two `navigate-to-verse[-new-tab]` window event listeners that
 * the Tiptap VerseReferencePlugin dispatches when a user clicks an inline
 * Bible reference in a note.
 */
export function useVerseNavigationListeners(): void {
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.book && detail?.chapter) {
        const book = parseInt(detail.book, 10);
        const chapter = parseInt(detail.chapter, 10);
        const verse = parseInt(detail.verse, 10) || 1;
        if (!isNaN(book) && !isNaN(chapter)) {
          const verseId = VerseIdHelper.calculate(book, chapter, verse);
          if (handOverToMainWindow(verseId, false)) return;
          useBibleStore.getState().navigateToVerseInPrimary(verseId); // allow-getstate: window event listener - imperative cross-pane navigation outside render
        }
      }
    };
    window.addEventListener('navigate-to-verse', handler);
    return () => window.removeEventListener('navigate-to-verse', handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.book && detail?.chapter) {
        const book = parseInt(detail.book, 10);
        const chapter = parseInt(detail.chapter, 10);
        const verse = parseInt(detail.verse, 10) || 1;
        if (!isNaN(book) && !isNaN(chapter)) {
          if (handOverToMainWindow(VerseIdHelper.calculate(book, chapter, verse), true)) return;
          // "New tab" from a note means a new Bible panel: one panel is one
          // passage, so the note's reference opens beside the current reading
          // rather than replacing it.
          void useBibleStore.getState().openPassageInNewPanel(book, chapter, verse, DEFAULT_PANEL_ID); // allow-getstate: window event listener - imperative cross-pane navigation outside render
        }
      }
    };
    window.addEventListener('navigate-to-verse-new-tab', handler);
    return () => window.removeEventListener('navigate-to-verse-new-tab', handler);
  }, []);
}
