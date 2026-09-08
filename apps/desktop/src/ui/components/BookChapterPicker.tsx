import React, { useState, useEffect, useRef, useCallback } from 'react';
// Deep import, not the `@bible/core` barrel: the barrel's `export * from
// './Data'` chain drags in modules that assume a filesystem/Node runtime.
// This mirrors the existing `@bible/core/*` path mapping in tsconfig.json
// (added for the QuickJS guest bundle for the same reason) - importing only
// the one standalone, dependency-free file keeps the renderer bundle safe.
import type { SearchResult } from '@bible/core/types/search';
import { useI18n } from '../contexts/useI18n';
import { BOOK_NAMES, BOOK_ALIASES, MAX_CHAPTERS, OT_BOOKS, NT_BOOKS } from '../constants/bibleBooks';
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

/** Normalize Roman numeral prefixes (i, ii, iii) to Arabic digits */
function normalizeRomanPrefix(input: string): string {
  return input
    .replace(/^iii\b\s*/i, '3 ')
    .replace(/^ii\b\s*/i, '2 ')
    .replace(/^i\b\s*/i, '1 ');
}

function parseReference(input: string): { book: number; chapter: number; verse?: number } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const normalized = normalizeRomanPrefix(trimmed.toLowerCase());

  const candidates: [string, number][] = [];
  for (const [numStr, name] of Object.entries(BOOK_NAMES)) {
    const bookNum = parseInt(numStr, 10);
    const lowerName = name.toLowerCase();
    candidates.push([lowerName, bookNum]);
    candidates.push([lowerName.substring(0, 3), bookNum]);
    if (/^\d/.test(lowerName)) candidates.push([lowerName.replace(' ', ''), bookNum]);
  }
  for (const [alias, bookNum] of Object.entries(BOOK_ALIASES)) {
    candidates.push([alias.toLowerCase(), bookNum]);
  }
  candidates.sort((a, b) => b[0].length - a[0].length);

  for (const [abbr, bookNum] of candidates) {
    if (normalized.startsWith(abbr)) {
      const rest = normalized.substring(abbr.length).trim();
      const match = rest.match(/^(\d+)(?::(\d+))?$/);
      if (match) {
        return { book: bookNum, chapter: parseInt(match[1], 10), verse: match[2] ? parseInt(match[2], 10) : undefined };
      }
      if (!rest) return { book: bookNum, chapter: 1 };
    }
  }

  const partialMatch = normalized.match(/^(\d?\s*[a-zA-Z]+)\s+(\d+)(?::(\d+))?$/);
  if (partialMatch) {
    const bookPart = partialMatch[1].replace(/\s+/g, ' ').trim();
    const chapter = parseInt(partialMatch[2], 10);
    const verse = partialMatch[3] ? parseInt(partialMatch[3], 10) : undefined;
    for (const [abbr, bookNum] of candidates) {
      if (abbr.startsWith(bookPart) && abbr.length > bookPart.length) {
        return { book: bookNum, chapter, verse };
      }
    }
  }

  return null;
}

function fuzzyMatch(text: string, filter: string): boolean {
  let ti = 0;
  for (let fi = 0; fi < filter.length; fi++) {
    const idx = text.indexOf(filter[fi], ti);
    if (idx === -1) return false;
    ti = idx + 1;
  }
  return true;
}

function filterBooks(books: number[], filter: string): number[] {
  if (!filter) return books;
  const lower = normalizeRomanPrefix(filter.toLowerCase());
  const aliasesByBook = new Map<number, string[]>();
  for (const [alias, bookNum] of Object.entries(BOOK_ALIASES)) {
    const list = aliasesByBook.get(bookNum) ?? [];
    list.push(alias.toLowerCase());
    aliasesByBook.set(bookNum, list);
  }
  return books.filter(num => {
    const name = BOOK_NAMES[num]?.toLowerCase() ?? '';
    if (name.startsWith(lower)) return true;
    if (name.substring(0, 3).startsWith(lower)) return true;
    if (/^\d/.test(name) && name.replace(' ', '').startsWith(lower)) return true;
    const aliases = aliasesByBook.get(num);
    if (aliases?.some(a => a.startsWith(lower))) return true;
    if (fuzzyMatch(name, lower)) return true;
    return false;
  });
}

function getBookFilterText(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^\d+$/.test(trimmed)) return '';
  const match = trimmed.match(/^(\d?\s*[a-zA-Z]+)\s*\d/);
  if (match) return match[1].trim();
  return trimmed;
}

const BookChapterPicker: React.FC<BookChapterPickerProps> = ({ isOpen, onClose, onSelect, currentBook, currentChapter }) => {
  const { t } = useI18n();
  const [selectedBook, setSelectedBook] = useState<number | null>(null);
  const [refValue, setRefValue] = useState('');
  const refInputRef = useRef<HTMLInputElement>(null);
  const currentBookRef = useRef<HTMLButtonElement>(null);

  // Search-mode state: when the typed text isn't a recognized passage, the
  // picker offers to search for it instead and streams results into this
  // same dialog rather than failing silently. The search store itself is
  // owned by another part of the app - this component only reads its state
  // and calls its already-exported `performSearch` action, never mutates it
  // directly.
  const [searchMode, setSearchMode] = useState(false);
  const [searchSubmittedQuery, setSearchSubmittedQuery] = useState('');
  const searchResults = useSearchStore(s => s.searchResults);
  const isSearching = useSearchStore(s => s.isSearching);
  const resultsForQuery = useSearchStore(s => s.resultsForQuery);

  useEffect(() => {
    if (isOpen) {
      setSelectedBook(null);
      setRefValue('');
      setSearchMode(false);
      setSearchSubmittedQuery('');
      requestAnimationFrame(() => refInputRef.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !selectedBook && currentBookRef.current) {
      requestAnimationFrame(() => currentBookRef.current?.scrollIntoView({ block: 'center' }));
    }
  }, [isOpen, selectedBook]);

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (selectedBook) {
        setSelectedBook(null);
        requestAnimationFrame(() => refInputRef.current?.focus());
      } else {
        onClose();
      }
    }
  }, [selectedBook, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  const handleBookClick = (bookNum: number) => {
    const chapters = MAX_CHAPTERS[bookNum] ?? 1;
    if (chapters === 1) {
      onSelect(bookNum, 1);
    } else {
      setSelectedBook(bookNum);
    }
  };

  // Run a free-text search and stream results into this same dialog instead
  // of leaving the user with a passage box that silently did nothing.
  const runSearch = (query: string) => {
    setSearchMode(true);
    setSearchSubmittedQuery(query);
    useSearchStore.getState().performSearch(query); // allow-getstate: event handler - search store owned elsewhere, invoking its exported action
  };

  const handleRefSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = refValue.trim();
    if (!trimmed) return;
    const ref = parseReference(trimmed);
    if (ref) {
      onSelect(ref.book, ref.chapter, ref.verse);
      return;
    }
    if (/^\d+$/.test(trimmed)) {
      const num = parseInt(trimmed, 10);
      const book = selectedBook || currentBook;
      if (book) {
        const maxCh = MAX_CHAPTERS[book] ?? 1;
        if (num <= maxCh && num >= 1) onSelect(book, num);
      }
      // A bare number that isn't a valid chapter for the current book isn't
      // a sensible search term either - nothing more to do.
      return;
    }
    // Not a recognized passage - run the search the offer link advertises.
    runSearch(trimmed);
  };

  // Editing the input after a search invalidates the stale search-mode view.
  const handleRefChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setRefValue(value);
    if (searchMode) {
      setSearchMode(false);
      setSearchSubmittedQuery('');
    }
  };

  // Clicking a search result opens that verse via the existing onSelect mechanism.
  const handleSearchResultClick = (result: SearchResult) => {
    const { bookNumber, chapter, verse } = VerseIdHelper.parse(result.verseId);
    onSelect(bookNumber, chapter, verse);
  };

  const bookFilter = !selectedBook && !searchMode ? getBookFilterText(refValue) : '';
  const filteredOT = filterBooks(OT_BOOKS, bookFilter);
  const filteredNT = filterBooks(NT_BOOKS, bookFilter);
  const hasFilter = bookFilter.length > 0;

  // The offer is shown live as the user types, whenever the input has text
  // but no digit (a digit suggests a reference like "John 3:16" is in
  // progress rather than a free-text search).
  const trimmedRefValue = refValue.trim();
  const searchOffer = !searchMode && trimmedRefValue && !/\d/.test(trimmedRefValue) ? trimmedRefValue : null;

  return (
    <div
      className="fixed inset-0 bg-background-overlay z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-chapter-picker-title"
        className="bg-surface rounded-lg shadow-xl w-[420px] max-h-[80vh] flex flex-col"
        style={{ backgroundColor: 'var(--theme-bg-primary)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          {selectedBook ? (
            <>
              <button
                type="button"
                className="text-sm text-accent hover:underline me-3"
                onClick={() => {
                  setSelectedBook(null);
                  requestAnimationFrame(() => refInputRef.current?.focus());
                }}
              >
                <span aria-hidden="true" className="rtl-mirror">&larr;</span>{' '}
                {t('bookChapterPicker.back')}
              </button>
              <h3 id="book-chapter-picker-title" className="text-lg font-semibold flex-1">{BOOK_NAMES[selectedBook]}</h3>
            </>
          ) : (
            <h3 id="book-chapter-picker-title" className="text-lg font-semibold flex-1">{t('bookChapterPicker.goToPassage')}</h3>
          )}
          <button
            type="button"
            className="text-text-secondary hover:text-text-primary p-1"
            onClick={onClose}
            aria-label={t('bookChapterPicker.close')}
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        {/* Reference input */}
        <form onSubmit={handleRefSubmit} className="px-4 py-2 border-b border-border">
          <div className="flex items-center gap-2">
            <input
              ref={refInputRef}
              type="text"
              className="flex-1 px-3 py-2 border border-border rounded text-sm"
              style={{ backgroundColor: 'var(--theme-bg-primary)' }}
              placeholder={t('bookChapterPicker.referencePlaceholder')}
              aria-label={t('bookChapterPicker.referencePlaceholder')}
              value={refValue}
              onChange={handleRefChange}
            />
            <button
              type="submit"
              className="px-3 py-2 bg-accent text-text-on-accent rounded text-sm hover:bg-accent-hover"
            >
              {t('bookChapterPicker.go')}
            </button>
          </div>
        </form>

        {/* Search offer: shown live while the typed text doesn't look like a reference */}
        {searchOffer && (
          <div className="px-4 py-2 border-b border-border text-xs text-text-secondary">
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => runSearch(searchOffer)}
            >
              {t('bookChapterPicker.searchFor', { query: searchOffer })}
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto px-4 py-3">
          {searchMode ? (
            // Search results, streamed into this same dialog
            <>
              {isSearching && resultsForQuery !== searchSubmittedQuery && (
                <div className="text-center text-text-secondary py-8">
                  {t('bookChapterPicker.searching')}
                </div>
              )}
              {!isSearching && resultsForQuery === searchSubmittedQuery && searchResults.length === 0 && (
                <div className="text-center text-text-secondary py-8">
                  {t('bookChapterPicker.noSearchResults')}
                </div>
              )}
              {resultsForQuery === searchSubmittedQuery && searchResults.length > 0 && (
                <div className="flex flex-col gap-1" role="list" aria-label={t('bookChapterPicker.searchResultsLabel')}>
                  {searchResults.map((result, i) => (
                    <button
                      key={`${result.module}-${result.verseId}-${i}`}
                      type="button"
                      role="listitem"
                      className="text-start px-2 py-2 text-sm rounded border border-border hover:bg-background-hover transition-colors"
                      onClick={() => handleSearchResultClick(result)}
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
          ) : selectedBook ? (
            // Chapter grid
            <>
              <div id="chapter-grid-label" className="text-xs text-text-secondary mb-2">{t('bookChapterPicker.selectChapter')}</div>
              <div
                className="grid gap-1"
                role="group"
                aria-labelledby="chapter-grid-label"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))' }}
              >
                {Array.from({ length: MAX_CHAPTERS[selectedBook] ?? 1 }, (_, i) => i + 1).map(ch => {
                  const isCurrent = selectedBook === currentBook && ch === currentChapter;
                  return (
                    <button
                      key={ch}
                      type="button"
                      aria-current={isCurrent ? 'true' : undefined}
                      /* The number alone is not a name - say which chapter of
                         which book, so it reads as a passage, not a digit. */
                      aria-label={t(
                        'bookChapterPicker.chapterOption',
                        { book: BOOK_NAMES[selectedBook], chapter: ch, },
                      )}
                      className={`py-2 text-sm rounded border transition-colors ${
                        isCurrent
                          ? 'bg-accent text-text-on-accent border-accent'
                          : 'border-border hover:bg-background-hover'
                      }`}
                      onClick={() => onSelect(selectedBook, ch)}
                    >
                      {ch}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            // Book list
            <>
              {filteredOT.length > 0 && (
                <>
                  <div id="ot-book-list-label" className="text-xs font-semibold text-text-secondary mb-1 mt-1">{t('bookChapterPicker.oldTestament')}</div>
                  <div className="grid grid-cols-3 gap-1 mb-3" role="group" aria-labelledby="ot-book-list-label">
                    {filteredOT.map(num => (
                      <button
                        key={num}
                        type="button"
                        aria-current={num === currentBook ? 'true' : undefined}
                        ref={num === currentBook ? currentBookRef : undefined}
                        style={num === currentBook ? undefined : sectionButtonStyle(num)}
                        className={`text-start px-2 py-1.5 text-sm rounded transition-colors ${
                          num === currentBook
                            ? 'bg-accent/10 text-accent font-semibold'
                            : 'hover:brightness-95'
                        }`}
                        onClick={() => handleBookClick(num)}
                      >
                        {BOOK_NAMES[num]}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {filteredNT.length > 0 && (
                <>
                  <div id="nt-book-list-label" className="text-xs font-semibold text-text-secondary mb-1">{t('bookChapterPicker.newTestament')}</div>
                  <div className="grid grid-cols-3 gap-1" role="group" aria-labelledby="nt-book-list-label">
                    {filteredNT.map(num => (
                      <button
                        key={num}
                        type="button"
                        aria-current={num === currentBook ? 'true' : undefined}
                        ref={num === currentBook ? currentBookRef : undefined}
                        style={num === currentBook ? undefined : sectionButtonStyle(num)}
                        className={`text-start px-2 py-1.5 text-sm rounded transition-colors ${
                          num === currentBook
                            ? 'bg-accent/10 text-accent font-semibold'
                            : 'hover:brightness-95'
                        }`}
                        onClick={() => handleBookClick(num)}
                      >
                        {BOOK_NAMES[num]}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {hasFilter && filteredOT.length === 0 && filteredNT.length === 0 && (
                <div className="text-center text-text-secondary py-8">{t('bookChapterPicker.noMatchingBooks')}</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookChapterPicker;
