import React, { useEffect, useRef } from 'react';
import { announce } from '../services/announcer';
import { useLayoutStore } from '../stores/useLayoutStore';
import { adjacentChapter } from './bible/adjacentChapter';
import { useI18n } from '../contexts/useI18n';
import { useBiblePaneContext } from './BiblePaneContext';
import { useDirection } from '@bible/ui';

/**
 * Chapter heading with navigation arrows, displayed inside the Bible text area.
 * The heading is clickable to open the book/chapter picker.
 */
const BibleHeader: React.FC = () => {
  const { t } = useI18n();
  // B-036: the Bible text may be set in its own direction (an English chapter in
  // an Arabic UI is LTR), but these arrows belong to the app chrome. The
  // `.rtl-mirror` rule keys off the UI direction, so the row must too, or the
  // arrows are mirrored while the row is not (Next ends up on the wrong side).
  const uiDir = useDirection();
  const {
    currentBookName,
    currentChapter,
    currentBook,
    isLoading,
    handlePreviousChapter,
    handleNextChapter,
    setShowBookPicker,
  } = useBiblePaneContext();

  // B-113: speak the new chapter (any route: arrows, Alt+Up/Down, picker, typed
  // reference, result click). Not on first render, not while loading, and only
  // from the pane the reader is in, so synced panes do not repeat it.
  const panelId = (useBiblePaneContext() as { panelId?: string }).panelId;
  const lastActivePanelId = useLayoutStore(s => s.lastActiveBiblePanelId);
  const prevRef = useRef<string | null>(null);
  const chapterKey = `${currentBook}:${currentChapter}`;
  useEffect(() => {
    if (isLoading) return;
    const prev = prevRef.current;
    prevRef.current = chapterKey;
    if (prev === null || prev === chapterKey) return;
    if (panelId && lastActivePanelId && panelId !== lastActivePanelId) return;
    announce(t('a11y.announce.chapter', { reference: `${currentBookName} ${currentChapter}` }));
  }, [chapterKey, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div dir={uiDir} className="flex items-center justify-between mb-lg border-b border-border pb-sm">
      <button
        onClick={handlePreviousChapter}
        disabled={isLoading || !adjacentChapter(currentBook, currentChapter, 'prev')}
        className="flex items-center px-2 py-1 hover:bg-background-active rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        title={t('biblePane.previousChapterTitle')}
      >
        <svg className="w-5 h-5 rtl-mirror" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <h2
        className="text-3xl font-bold text-text-heading cursor-pointer hover:text-accent transition-colors text-center"
        onClick={() => setShowBookPicker(true)}
        title={t('biblePane.goToBookChapterTitle')}
        data-testid="bible-chapter-heading"
        tabIndex={-1}
        data-pane-focus
      >
        <bdi>{currentBookName} {currentChapter}</bdi>
        <svg className="inline w-4 h-4 ms-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </h2>
      <button
        onClick={handleNextChapter}
        disabled={isLoading || !adjacentChapter(currentBook, currentChapter, 'next')}
        className="flex items-center px-2 py-1 hover:bg-background-active rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        title={t('biblePane.nextChapterTitle')}
      >
        <svg className="w-5 h-5 rtl-mirror" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
};

export default BibleHeader;
