import { MAX_CHAPTERS } from '@bible/core/browser';

export interface ChapterRef {
  book: number;
  chapter: number;
}

/**
 * The chapter before/after (book, chapter), crossing book boundaries (Genesis 50 -> Exodus 1,
 * Exodus 1 -> Genesis 50). `null` at the very start (Genesis 1) and end (Revelation 22) of the Bible.
 */
export function adjacentChapter(book: number, chapter: number, direction: 'prev' | 'next'): ChapterRef | null {
  const last = MAX_CHAPTERS[book];
  if (!last) return null;
  if (direction === 'prev') {
    if (chapter > 1) return { book, chapter: chapter - 1 };
    if (book <= 1) return null;
    const prevLast = MAX_CHAPTERS[book - 1];
    return prevLast ? { book: book - 1, chapter: prevLast } : null;
  }
  if (chapter < last) return { book, chapter: chapter + 1 };
  if (!MAX_CHAPTERS[book + 1]) return null;
  return { book: book + 1, chapter: 1 };
}
