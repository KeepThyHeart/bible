import { useCallback } from 'react';

/**
 * Prev / next chapter navigation that wraps to the next book at chapter
 * boundaries and clamps to Genesis / Revelation.
 *
 * Every move here is *sequential* - the reader is paging, not jumping - so the
 * injected `loadChapter` is expected to replace the current navigation-history
 * entry rather than append one (see `pageToChapter` in `BiblePane`). Feeding it
 * the plain panel action instead would fill "recent passages" with one row per
 * chapter read.
 */
export function useBibleNavigation(args: {
  currentBook: number;
  currentChapter: number;
  loadChapter: (book: number, chapter: number) => void;
}) {
  const { currentBook, currentChapter, loadChapter } = args;

  const handlePreviousChapter = useCallback(() => {
    if (currentChapter > 1) {
      loadChapter(currentBook, currentChapter - 1);
    } else if (currentBook > 1) {
      loadChapter(currentBook - 1, 1);
    }
  }, [currentBook, currentChapter, loadChapter]);

  const handleNextChapter = useCallback(() => {
    if (currentBook <= 66) {
      loadChapter(currentBook, currentChapter + 1);
    }
  }, [currentBook, currentChapter, loadChapter]);

  return { handlePreviousChapter, handleNextChapter };
}
