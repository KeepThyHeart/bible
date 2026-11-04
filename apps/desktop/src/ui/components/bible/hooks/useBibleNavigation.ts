import { useCallback } from 'react';
import { adjacentChapter } from '../adjacentChapter';

/**
 * Prev / next chapter navigation that crosses into the neighbouring book at chapter
 * boundaries (landing on the last chapter going back) and does nothing at Genesis 1 / Revelation 22.
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
    const target = adjacentChapter(currentBook, currentChapter, 'prev');
    if (target) loadChapter(target.book, target.chapter);
  }, [currentBook, currentChapter, loadChapter]);

  const handleNextChapter = useCallback(() => {
    const target = adjacentChapter(currentBook, currentChapter, 'next');
    if (target) loadChapter(target.book, target.chapter);
  }, [currentBook, currentChapter, loadChapter]);

  return { handlePreviousChapter, handleNextChapter };
}
