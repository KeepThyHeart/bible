import React, { useMemo } from 'react';
// Deep import, not the `@bible/core` barrel: the barrel's `export * from
// './Data'` chain drags in modules that assume a filesystem/Node runtime.
// This mirrors the existing `@bible/core/*` path mapping in tsconfig.json
// (added for the QuickJS guest bundle for the same reason) - importing only
// the one standalone, dependency-free file keeps the renderer bundle safe.
import type { SearchResult } from '@bible/core/types/search';
import { BookChapterPicker as SharedBookChapterPicker } from '@bible/ui';
import type { BookChapterPickerLabels } from '@bible/ui';
import { useI18n } from '../contexts/useI18n';
import { localizedBookNames, localizedBookAliases } from '../constants/bibleBooks';
import { VerseIdHelper } from '@bible/core';
import { useSearchStore } from '../stores/useSearchStore';
import { sanitizeHtml } from '../utils/sanitize';
// Section colour coding for the book grid lives in `constants/bibleSections`,
// shared with the search distribution sparkline so a book is the same hue
// wherever the reader meets it.
import { sectionButtonStyle } from '../constants/bibleSections';

interface BookChapterPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (book: number, chapter: number, verse?: number) => void;
  currentBook?: number | null;
  currentChapter?: number | null;
}

const TITLE_ID = 'book-chapter-picker-title';

/**
 * Search results streamed into the picker. The search store is owned by another part of the app: this
 * only reads its state (and the wrapper calls its exported `performSearch` action, never mutating it
 * directly).
 */
const SearchResults: React.FC<{ query: string; onPick: (result: SearchResult) => void }> = ({ query, onPick }) => {
  const { t } = useI18n();
  const searchResults = useSearchStore(s => s.searchResults);
  const isSearching = useSearchStore(s => s.isSearching);
  const resultsForQuery = useSearchStore(s => s.resultsForQuery);
  return (
    <>
      {isSearching && resultsForQuery !== query && (
        <div className="text-center text-text-secondary py-8">
          {t('bookChapterPicker.searching')}
        </div>
      )}
      {!isSearching && resultsForQuery === query && searchResults.length === 0 && (
        <div className="text-center text-text-secondary py-8">
          {t('bookChapterPicker.noSearchResults')}
        </div>
      )}
      {resultsForQuery === query && searchResults.length > 0 && (
        <div className="flex flex-col gap-1" role="list" aria-label={t('bookChapterPicker.searchResultsLabel')}>
          {searchResults.map((result, i) => (
            <button
              key={`${result.module}-${result.verseId}-${i}`}
              type="button"
              role="listitem"
              className="text-start px-2 py-2 text-sm rounded border border-border hover:bg-background-hover transition-colors"
              onClick={() => onPick(result)}
            >
              <div className="font-semibold text-text-primary">{result.reference}</div>
              <div
                className="text-text-secondary text-xs mt-0.5"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(result.snippet || result.text) }}
              />
            </button>
          ))}
        </div>
      )}
    </>
  );
};

/**
 * Desktop "go to passage" dialog: this file owns the modal frame (overlay, size, position, theme surface)
 * and the app data (localized names, i18n labels, search store); the picker itself is `@bible/ui`.
 */
const BookChapterPicker: React.FC<BookChapterPickerProps> = ({ isOpen, onClose, onSelect, currentBook, currentChapter }) => {
  const { t, localizer } = useI18n();
  const bookNames = useMemo(() => localizedBookNames(localizer), [localizer]);
  const bookAliases = useMemo(() => localizedBookAliases(localizer), [localizer]);
  const labels = useMemo<Partial<BookChapterPickerLabels>>(() => ({
    title: t('bookChapterPicker.goToPassage'),
    back: t('bookChapterPicker.back'),
    close: t('bookChapterPicker.close'),
    go: t('bookChapterPicker.go'),
    referencePlaceholder: t('bookChapterPicker.referencePlaceholder'),
    oldTestament: t('bookChapterPicker.oldTestament'),
    newTestament: t('bookChapterPicker.newTestament'),
    noMatchingBooks: t('bookChapterPicker.noMatchingBooks'),
    selectChapter: t('bookChapterPicker.selectChapter'),
    searchFor: (query: string) => t('bookChapterPicker.searchFor', { query }),
    // The number alone is not a name - say which chapter of which book, so it reads as a passage, not a digit.
    chapterOption: (book: string, chapter: number) => t('bookChapterPicker.chapterOption', { book, chapter }),
  }), [t]);
  const icons = useMemo(() => ({
    back: <span aria-hidden="true" className="rtl-mirror">&larr;</span>,
  }), []);

  if (!isOpen) return null;

  // Clicking a search result opens that verse via the existing onSelect mechanism.
  const pickSearchResult = (result: SearchResult) => {
    const { bookNumber, chapter, verse } = VerseIdHelper.parse(result.verseId);
    onSelect(bookNumber, chapter, verse);
  };

  return (
    <div
      className="fixed inset-0 bg-background-overlay z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        className="bg-surface rounded-lg shadow-xl w-[420px] max-h-[80vh] flex flex-col"
        style={{ backgroundColor: 'var(--theme-bg-primary)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <SharedBookChapterPicker
          current={{ book: currentBook ?? null, chapter: currentChapter }}
          // Desktop's onSelect takes (book, chapter, verse?): the shared picker's endVerse is not forwarded.
          onPick={(book, chapter, verse) => (verse === undefined ? onSelect(book, chapter) : onSelect(book, chapter, verse))}
          onClose={onClose}
          bookName={(book) => bookNames[book]}
          bookAliases={bookAliases}
          labels={labels}
          icons={icons}
          titleId={TITLE_ID}
          // Desktop keeps its original reference dialect ("Jude 5" is chapter 5) and soft current-book tint.
          referenceSyntax="basic"
          currentBookAppearance="soft"
          cellStyle={sectionButtonStyle}
          search={{
            // `performSearch` is owned by the search store; this only invokes its exported action.
            onSearch: (query) => useSearchStore.getState().performSearch(query), // allow-getstate: event handler - search store owned elsewhere, invoking its exported action
            results: (query) => <SearchResults query={query} onPick={pickSearchResult} />,
          }}
        />
      </div>
    </div>
  );
};

export default BookChapterPicker;
