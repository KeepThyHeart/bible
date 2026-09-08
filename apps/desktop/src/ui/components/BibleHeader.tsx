import React from 'react';
import { useI18n } from '../contexts/useI18n';
import { useBiblePaneContext } from './BiblePaneContext';

/**
 * Chapter heading with navigation arrows, displayed inside the Bible text area.
 * The heading is clickable to open the book/chapter picker.
 */
const BibleHeader: React.FC = () => {
  const { t } = useI18n();
  const {
    currentBookName,
    currentChapter,
    currentBook,
    isLoading,
    handlePreviousChapter,
    handleNextChapter,
    setShowBookPicker,
  } = useBiblePaneContext();

  return (
    <div className="flex items-center justify-between mb-lg border-b border-border pb-sm">
      <button
        onClick={handlePreviousChapter}
        disabled={isLoading || (currentBook === 1 && currentChapter === 1)}
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
      >
        {currentBookName} {currentChapter}
        <svg className="inline w-4 h-4 ms-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </h2>
      <button
        onClick={handleNextChapter}
        disabled={isLoading}
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
