import React, { useMemo } from 'react';
import { useI18n } from '../../contexts/useI18n';
import { BOOK_NAMES, localizedBookNames } from '../../constants/bibleBooks';
import { adjacentChapter } from './adjacentChapter';

/**
 * "<- Genesis 1  .  Genesis 3 ->" at the end of a chapter (task 0197): a quiet way to keep reading
 * without scrolling back to the header arrows. Crosses book boundaries; each side is omitted at the
 * very start (Genesis 1) / end (Revelation 22) of the Bible. Plain buttons, so Tab reaches them and
 * Enter/Space activates them. Kept a small separate component: other blocks (reading-plan
 * start/end markers) sit next to it in the reader.
 */
export interface ChapterEndLinksProps {
  book: number;
  chapter: number;
  onPrevious: () => void;
  onNext: () => void;
}

const linkClass =
  'inline-flex items-center gap-1 px-2 py-1 -mx-2 rounded text-sm text-text-tertiary hover:text-accent hover:bg-background-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors';

const ChapterEndLinks: React.FC<ChapterEndLinksProps> = ({ book, chapter, onPrevious, onNext }) => {
  const { t, localizer } = useI18n();
  const names = useMemo(() => (localizer ? localizedBookNames(localizer) : BOOK_NAMES), [localizer]);
  const prev = adjacentChapter(book, chapter, 'prev');
  const next = adjacentChapter(book, chapter, 'next');
  if (!prev && !next) return null;

  const label = (ref: { book: number; chapter: number }): string => `${names[ref.book] ?? ref.book} ${ref.chapter}`;

  return (
    <nav
      className="mt-xl pt-md border-t border-border flex items-center justify-between gap-md"
      aria-label={t('biblePane.chapterLinksLabel')}
      data-testid="chapter-end-links"
    >
      {prev ? (
        <button
          type="button"
          className={linkClass}
          onClick={onPrevious}
          aria-label={`${t('biblePane.previousChapterTitle')}: ${label(prev)}`}
          data-testid="chapter-end-prev"
        >
          <svg className="w-3.5 h-3.5 rtl-mirror" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <bdi>{label(prev)}</bdi>
        </button>
      ) : <span />}
      {next ? (
        <button
          type="button"
          className={linkClass}
          onClick={onNext}
          aria-label={`${t('biblePane.nextChapterTitle')}: ${label(next)}`}
          data-testid="chapter-end-next"
        >
          <bdi>{label(next)}</bdi>
          <svg className="w-3.5 h-3.5 rtl-mirror" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      ) : <span />}
    </nav>
  );
};

export default ChapterEndLinks;
