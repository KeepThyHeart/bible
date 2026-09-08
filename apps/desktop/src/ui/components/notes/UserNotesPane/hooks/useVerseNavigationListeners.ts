import { useEffect } from 'react';
import { VerseIdHelper } from '@bible/core';
import { useBibleStore } from '../../../../stores/useBibleStore';
import { DEFAULT_PANEL_ID } from '../../../../stores/helpers/panelStateHelpers';

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
