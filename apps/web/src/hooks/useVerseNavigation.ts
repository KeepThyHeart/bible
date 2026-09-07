import { useCallback } from 'preact/hooks';
import { bibleStore } from '../stores/bibleStore';
import { MAX_CHAPTERS } from '../constants';

/**
 * Provides prev/next sequential verse navigation callbacks.
 * Handles wrapping across chapter and book boundaries.
 */
export function useVerseNavigation(
  book: number | null,
  chapter: number | null,
  verse: number | null,
) {
  const handlePrevVerse = useCallback(() => {
    if (!book || !chapter || !verse) return;
    if (verse > 1) {
      bibleStore.navigateTo(book, chapter, verse - 1);
    } else if (chapter > 1) {
      bibleStore.navigateTo(book, chapter - 1);
    } else if (book > 1) {
      const prevBook = book - 1;
      const lastChapter = MAX_CHAPTERS[prevBook] || 1;
      bibleStore.navigateTo(prevBook, lastChapter);
    }
  }, [book, chapter, verse]);

  const handleNextVerse = useCallback(() => {
    if (!book || !chapter || !verse) return;
    const tab = bibleStore.getActiveTab();
    const maxVerse = tab?.verses?.length || 999;
    if (verse < maxVerse) {
      bibleStore.navigateTo(book, chapter, verse + 1);
    } else {
      const maxChap = MAX_CHAPTERS[book] || 1;
      if (chapter < maxChap) {
        bibleStore.navigateTo(book, chapter + 1, 1);
      } else if (book < 66) {
        bibleStore.navigateTo(book + 1, 1, 1);
      }
    }
  }, [book, chapter, verse]);

  return { handlePrevVerse, handleNextVerse };
}
