import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { BOOK_ALIASES, MAX_CHAPTERS } from '../../constants';
import { getAllBookNames, getLocalizedBookName } from '../../utils/bookNames';
import { bibleStore } from '../../stores/bibleStore';
import { searchStore } from '../../stores/searchStore';
import { useStore } from '../../hooks/useStore';
import { SearchResultItem } from '../Search/SearchResultItem';
import { TranslationDialog } from './TranslationDialog';
import { parseVerseId } from '../../utils/verseId';
import { getBibleSection } from '@bible/core/browser';
import type { BookTopic, SearchResultData } from '../../types';

interface BookChapterPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (book: number, chapter: number, verse?: number, endVerse?: number) => void;
  currentBook?: number | null;
  currentChapter?: number | null;
  /**
   * Translation the chosen passage will open in. Shown under the reference box
   * so "which version am I about to read?" is answerable without closing the
   * dialog — and, with `onChangeTranslation`, changeable right here.
   */
  moduleAbbr?: string;
  onChangeTranslation?: (abbreviation: string) => void;
}

const OT_BOOKS = Array.from({ length: 39 }, (_, i) => i + 1);
const NT_BOOKS = Array.from({ length: 27 }, (_, i) => i + 40);

// Books with only one chapter — "Jude 5" means "Jude 1:5", not "Jude chapter 5"
const SINGLE_CHAPTER_BOOKS = new Set([31, 57, 63, 64, 65]); // Obadiah, Philemon, 2 John, 3 John, Jude

function parseReference(input: string): { book: number; chapter: number; verse?: number; endVerse?: number } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const normalized = normalizeRomanPrefix(trimmed.toLowerCase());

  // Build list of [abbreviation, bookNumber] pairs from i18n book names and BOOK_ALIASES
  const candidates: [string, number][] = [];
  for (const [numStr, name] of Object.entries(getAllBookNames())) {
    const bookNum = parseInt(numStr, 10);
    const lowerName = name.toLowerCase();
    candidates.push([lowerName, bookNum]);
    candidates.push([lowerName.substring(0, 3), bookNum]);
    if (/^\d/.test(lowerName)) candidates.push([lowerName.replace(' ', ''), bookNum]);
  }
  for (const [alias, bookNum] of Object.entries(BOOK_ALIASES)) {
    candidates.push([alias.toLowerCase(), bookNum]);
  }
  // Sort longest-first so longer matches take priority
  candidates.sort((a, b) => b[0].length - a[0].length);

  // Exact prefix match against known abbreviations/names
  for (const [abbr, bookNum] of candidates) {
    if (normalized.startsWith(abbr)) {
      const rest = normalized.substring(abbr.length).trim();
      // Groups: 1 = chapter (or verse in a single-chapter book), 2 = end of a
      // bare range ("Jude 5-7"), 3 = verse, 4 = end verse ("John 3:16-18").
      const match = rest.match(/^(\d+)(?:\s*[-–—]\s*(\d+))?(?::(\d+)(?:\s*[-–—]\s*(\d+))?)?$/);
      if (match) {
        let chapter = parseInt(match[1], 10);
        let verse = match[3] ? parseInt(match[3], 10) : undefined;
        let endVerse = match[4] ? parseInt(match[4], 10) : undefined;
        // Single-chapter books: "Jude 5" means verse 5, not chapter 5 — and
        // "Jude 5-7" is a verse range in chapter 1.
        if (SINGLE_CHAPTER_BOOKS.has(bookNum) && verse === undefined) {
          verse = chapter;
          chapter = 1;
          endVerse = match[2] ? parseInt(match[2], 10) : undefined;
        } else if (match[2] && verse === undefined) {
          // "John 3-5" is a chapter range; we only select verses, so land on
          // the first chapter rather than failing to parse.
          return { book: bookNum, chapter, verse: undefined, endVerse: undefined };
        }
        return { book: bookNum, chapter, verse, endVerse };
      }
      if (!rest) return { book: bookNum, chapter: 1 };
    }
  }

  // Partial book name matching: allow "chron 2" to match "chronicles"
  // Extract book text portion and trailing chapter:verse
  const partialMatch = normalized.match(/^(\d?\s*[a-zA-Z]+)\s+(\d+)(?::(\d+)(?:\s*[-–—]\s*(\d+))?)?$/);
  if (partialMatch) {
    const bookPart = partialMatch[1].replace(/\s+/g, ' ').trim();
    let chapter = parseInt(partialMatch[2], 10);
    let verse = partialMatch[3] ? parseInt(partialMatch[3], 10) : undefined;
    const endVerse = partialMatch[4] ? parseInt(partialMatch[4], 10) : undefined;
    // Check if any full book name or alias starts with the typed book portion
    for (const [abbr, bookNum] of candidates) {
      if (abbr.startsWith(bookPart) && abbr.length > bookPart.length) {
        // Single-chapter books: "Jude 5" means verse 5, not chapter 5
        if (SINGLE_CHAPTER_BOOKS.has(bookNum) && verse === undefined) {
          verse = chapter;
          chapter = 1;
        }
        return { book: bookNum, chapter, verse, endVerse };
      }
    }
  }

  return null;
}

/** Normalize Roman numeral prefixes (i, ii, iii) to Arabic digits */
function normalizeRomanPrefix(input: string): string {
  return input
    .replace(/^iii\b\s*/i, '3 ')
    .replace(/^ii\b\s*/i, '2 ')
    .replace(/^i\b\s*/i, '1 ');
}

/** Filter book numbers by matching input text against book names/abbreviations/aliases */
function filterBooks(books: number[], filter: string): number[] {
  if (!filter) return books;
  const lower = normalizeRomanPrefix(filter.toLowerCase());
  // Build a reverse lookup: bookNumber -> set of alias strings
  const aliasesByBook = new Map<number, string[]>();
  for (const [alias, bookNum] of Object.entries(BOOK_ALIASES)) {
    const list = aliasesByBook.get(bookNum) ?? [];
    list.push(alias.toLowerCase());
    aliasesByBook.set(bookNum, list);
  }
  const bookNames = getAllBookNames();
  return books.filter(num => {
    const name = bookNames[num]?.toLowerCase() ?? '';
    // Match start of name, 3-letter abbreviation, or numbered book without space
    if (name.startsWith(lower)) return true;
    if (name.substring(0, 3).startsWith(lower)) return true;
    if (/^\d/.test(name) && name.replace(' ', '').startsWith(lower)) return true;
    // Match aliases
    const aliases = aliasesByBook.get(num);
    if (aliases?.some(a => a.startsWith(lower))) return true;
    // Fuzzy: check if all characters of the filter appear in order in the name
    if (fuzzyMatch(name, lower)) return true;
    return false;
  });
}

/** Check if all characters of the filter appear in order within the text */
function fuzzyMatch(text: string, filter: string): boolean {
  let ti = 0;
  for (let fi = 0; fi < filter.length; fi++) {
    const idx = text.indexOf(filter[fi], ti);
    if (idx === -1) return false;
    ti = idx + 1;
  }
  return true;
}

export function BookChapterPicker({ isOpen, onClose, onSelect, currentBook, currentChapter, moduleAbbr, onChangeTranslation }: BookChapterPickerProps) {
  const { t } = useTranslation();
  const [selectedBook, setSelectedBook] = useState<number | null>(null);
  const [refValue, setRefValue] = useState('');
  const refInputRef = useRef<HTMLInputElement>(null);
  const chapterGridRef = useRef<HTMLDivElement>(null);
  const [topics, setTopics] = useState<BookTopic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);

  // Search-mode state: when the user opts to search the typed text instead of treating
  // it as a passage reference, results stream into the picker via the global search store.
  const [searchMode, setSearchMode] = useState(false);
  const [searchSubmittedQuery, setSearchSubmittedQuery] = useState('');

  // The offer link is shown live as the user types, whenever the input has text but no
  // digit (a digit suggests they're typing a reference like "John 3:16" or a chapter number).
  const searchOffer = useMemo(() => {
    if (searchMode) return null;
    const trimmed = refValue.trim();
    if (!trimmed) return null;
    if (/\d/.test(trimmed)) return null;
    return trimmed;
  }, [refValue, searchMode]);

  // Subscribe to global search store while in search mode so results stream in.
  const searchResults = useStore(searchStore, () => searchStore.results) as SearchResultData[];
  const searchLoading = useStore(searchStore, () => searchStore.loading);
  const searchStoreQuery = useStore(searchStore, () => searchStore.query);

  // Reset to book view and focus input when opened (desktop only — mobile avoids keyboard pop-up)
  useEffect(() => {
    if (isOpen) {
      setSelectedBook(null);
      setRefValue('');
      setTopics([]);
      setSearchMode(false);
      setSearchSubmittedQuery('');
      const isDesktop = window.innerWidth > 768 && !('ontouchstart' in window);
      if (isDesktop) {
        requestAnimationFrame(() => {
          refInputRef.current?.focus();
        });
      }
    }
  }, [isOpen]);

  // Load topics when a book is selected
  useEffect(() => {
    if (!selectedBook) {
      setTopics([]);
      return;
    }
    setTopicsLoading(true);
    bibleStore.getBookTopics(selectedBook)
      .then(data => {
        setTopics(data.topics);
        setTopicsLoading(false);
      })
      .catch(() => {
        setTopics([]);
        setTopicsLoading(false);
      });
  }, [selectedBook]);

  // Scroll the current book into view when the picker opens
  const [showTranslationDialog, setShowTranslationDialog] = useState(false);

  const currentBookRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isOpen && !selectedBook && currentBookRef.current) {
      requestAnimationFrame(() => {
        currentBookRef.current?.scrollIntoView({ block: 'center' });
      });
    }
  }, [isOpen, selectedBook]);

  // Escape steps back to the book list, then closes. Attached for the
  // component's life with the state read from a ref — see useEscapeKey for why
  // an open-triggered listener is not live for the picker's first frames.
  const escapeStateRef = useRef({ isOpen, selectedBook, onClose, showTranslationDialog });
  escapeStateRef.current = { isOpen, selectedBook, onClose, showTranslationDialog };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const state = escapeStateRef.current;
      if (!state.isOpen) return;
      // The translation dialog owns Escape while it is up; without this the
      // single keypress closes it *and* steps this picker back a level.
      if (state.showTranslationDialog) return;
      e.preventDefault();
      if (state.selectedBook) {
        setSelectedBook(null);
        requestAnimationFrame(() => refInputRef.current?.focus());
      } else {
        state.onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!isOpen) return null;

  const handleBookClick = (bookNum: number) => {
    const chapters = MAX_CHAPTERS[bookNum] ?? 1;
    if (chapters === 1) {
      onSelect(bookNum, 1);
    } else {
      setSelectedBook(bookNum);
    }
  };

  const handleChapterClick = (chapter: number) => {
    if (selectedBook) {
      onSelect(selectedBook, chapter);
    }
  };

  // Run a free-text search and display results inline within the picker.
  const runSearch = (query: string) => {
    setSearchMode(true);
    setSearchSubmittedQuery(query);
    const activeModule = bibleStore.getActiveTab()?.moduleAbbr;
    const modules = activeModule ? [activeModule] : undefined;
    searchStore.performSearch(query, undefined, modules);
  };

  const handleRefSubmit = (e: Event) => {
    e.preventDefault();
    const trimmed = refValue.trim();
    if (!trimmed) return;

    // Pure number: treat as chapter for the selected book or current book
    if (/^\d+$/.test(trimmed)) {
      const num = parseInt(trimmed, 10);
      const book = selectedBook || currentBook;
      if (book) {
        const maxCh = MAX_CHAPTERS[book] ?? 1;
        if (num >= 1 && num <= maxCh) {
          onSelect(book, num);
          return;
        }
      }
      return;
    }

    // The local parseReference handles i18n book names, aliases, and common
    // reference formats. (Importing ReferenceParser from @bible/core is not
    // viable in client-side Rollup builds — see notes in offline/bibleWorker.ts.)
    const local = parseReference(trimmed);
    if (local) {
      onSelect(local.book, local.chapter, local.verse, local.endVerse);
      return;
    }

    // Not a recognized passage — run the search the offer link advertises.
    runSearch(trimmed);
  };

  // Clear stale search-mode state when the user edits the input again
  const handleRefInput = (e: Event) => {
    const v = (e.target as HTMLInputElement).value;
    setRefValue(v);
    if (searchMode) {
      setSearchMode(false);
      setSearchSubmittedQuery('');
    }
  };

  // Clicking a search result opens the verse in a new tab via the existing onSelect mechanism
  const handleSearchResultClick = (result: SearchResultData) => {
    const { bookNumber, chapter, verse } = parseVerseId(result.verseId);
    onSelect(bookNumber, chapter, verse);
  };

  // Determine the book filter text: only use refValue for filtering when we're on the book list
  // and the text doesn't look like a full reference (no numbers after the book name)
  const bookFilter = !selectedBook ? getBookFilterText(refValue) : '';
  const filteredOT = filterBooks(OT_BOOKS, bookFilter);
  const filteredNT = filterBooks(NT_BOOKS, bookFilter);
  const hasFilter = bookFilter.length > 0;

  const isMobileView = typeof window !== 'undefined' && (window.innerWidth <= 768 || 'ontouchstart' in window);

  const renderBookList = () => (
    <div class={`book-chapter-picker__books ${isMobileView && !hasFilter ? 'book-chapter-picker__books--compact' : ''}`}>
      {filteredOT.length > 0 && (
        <>
          <div class="book-chapter-picker__section-label">{t('bookChapterPicker.oldTestament')}</div>
          <div class={`book-chapter-picker__book-grid ${isMobileView && !hasFilter ? 'book-chapter-picker__book-grid--compact' : ''}`}>
            {filteredOT.map(num => (
              <button
                key={num}
                ref={num === currentBook ? currentBookRef : undefined}
                class={`book-chapter-picker__book-btn book-chapter-picker__book-btn--${getBibleSection(num)} ${num === currentBook ? 'book-chapter-picker__book-btn--current' : ''}`}
                onClick={() => handleBookClick(num)}
                title={getLocalizedBookName(num)}
              >
                {isMobileView && !hasFilter ? t(String(num), { ns: 'booksShort' }) : getLocalizedBookName(num)}
              </button>
            ))}
          </div>
        </>
      )}
      {filteredNT.length > 0 && (
        <>
          <div class="book-chapter-picker__section-label">{t('bookChapterPicker.newTestament')}</div>
          <div class={`book-chapter-picker__book-grid ${isMobileView && !hasFilter ? 'book-chapter-picker__book-grid--compact' : ''}`}>
            {filteredNT.map(num => (
              <button
                key={num}
                ref={num === currentBook ? currentBookRef : undefined}
                class={`book-chapter-picker__book-btn book-chapter-picker__book-btn--${getBibleSection(num)} ${num === currentBook ? 'book-chapter-picker__book-btn--current' : ''}`}
                onClick={() => handleBookClick(num)}
                title={getLocalizedBookName(num)}
              >
                {isMobileView && !hasFilter ? t(String(num), { ns: 'booksShort' }) : getLocalizedBookName(num)}
              </button>
            ))}
          </div>
        </>
      )}
      {hasFilter && filteredOT.length === 0 && filteredNT.length === 0 && (
        <div class="book-chapter-picker__no-match">{t('bookChapterPicker.noMatchingBooks')}</div>
      )}
    </div>
  );

  const renderChapterGrid = () => {
    if (!selectedBook) return null;
    const chapters = MAX_CHAPTERS[selectedBook] ?? 1;
    return (
      <div class="book-chapter-picker__chapters" ref={chapterGridRef}>
        <div class="book-chapter-picker__chapter-label">{t('bookChapterPicker.selectAChapter')}</div>
        <div class="book-chapter-picker__chapter-grid">
          {Array.from({ length: chapters }, (_, i) => i + 1).map(ch => (
            <button
              key={ch}
              class={`book-chapter-picker__chapter-btn ${selectedBook === currentBook && ch === currentChapter ? 'book-chapter-picker__chapter-btn--current' : ''}`}
              onClick={() => handleChapterClick(ch)}
            >
              {ch}
            </button>
          ))}
        </div>
        {/* Topics section */}
        {topicsLoading && (
          <div class="book-chapter-picker__topics-loading">
            <i class="fa-solid fa-spinner fa-spin" /> Loading topics...
          </div>
        )}
        {!topicsLoading && topics.length > 0 && (
          <div class="book-chapter-picker__topics">
            <div class="book-chapter-picker__topics-label">{t('bookChapterPicker.topics')}</div>
            {topics.map((topic, idx) => {
              const ref = topic.chapter === topic.endChapter
                ? `${topic.chapter}:${topic.verse}–${topic.endVerse}`
                : `${topic.chapter}:${topic.verse}–${topic.endChapter}:${topic.endVerse}`;
              return (
                <button
                  key={idx}
                  class="book-chapter-picker__topic-btn"
                  onClick={() => onSelect(selectedBook, topic.chapter, topic.verse)}
                >
                  <span class="book-chapter-picker__topic-title">{topic.title}</span>
                  <span class="book-chapter-picker__topic-ref">{ref}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div class="book-chapter-picker__overlay" onClick={onClose}>
      <div class="book-chapter-picker" onClick={(e) => e.stopPropagation()}>
        <div class="book-chapter-picker__header">
          {selectedBook ? (
            <>
              <button class="book-chapter-picker__back-btn" onClick={() => {
                setSelectedBook(null);
                requestAnimationFrame(() => refInputRef.current?.focus());
              }}>
                <i class="fa-solid fa-chevron-left" /> Back
              </button>
              <h3>{getLocalizedBookName(selectedBook)}</h3>
            </>
          ) : (
            <h3>{t('bookChapterPicker.goToPassage')}</h3>
          )}
          <button class="book-chapter-picker__close-btn" onClick={onClose}>
            <i class="fa-solid fa-xmark" />
          </button>
        </div>
        <form class="book-chapter-picker__ref-form" onSubmit={handleRefSubmit} action="javascript:void(0)">
          <input
            ref={refInputRef}
            type="text"
            placeholder={t('bookChapterPicker.typeAReferenceOrSearch')}
            value={refValue}
            onInput={handleRefInput}
            class="book-chapter-picker__ref-input"
          />
          <button type="submit" class="book-chapter-picker__ref-go">
            <i class="fa-solid fa-arrow-right" />
          </button>
        </form>
        {moduleAbbr && (
          <div class="book-chapter-picker__translation">
            <span class="book-chapter-picker__translation-abbr">{moduleAbbr}</span>
            {onChangeTranslation && (
              <button
                type="button"
                class="book-chapter-picker__translation-link"
                onClick={() => setShowTranslationDialog(true)}
              >
                {t('bibleToolbar.selectTranslation')}
              </button>
            )}
          </div>
        )}
        {onChangeTranslation && (
          <TranslationDialog
            isOpen={showTranslationDialog}
            onClose={() => setShowTranslationDialog(false)}
            currentAbbr={moduleAbbr ?? ''}
            onSelect={(abbr) => {
              onChangeTranslation(abbr);
              setShowTranslationDialog(false);
            }}
          />
        )}
        {searchOffer && !searchMode && (
          <div class="book-chapter-picker__search-offer">
            <button
              type="button"
              class="book-chapter-picker__search-offer-link"
              onClick={() => runSearch(searchOffer)}
            >
              {t('bookChapterPicker.searchFor', { query: searchOffer })}
            </button>
          </div>
        )}
        {searchMode ? (
          <div class="book-chapter-picker__search-results">
            {searchLoading && searchStoreQuery === searchSubmittedQuery && (
              <div class="book-chapter-picker__search-loading">
                <i class="fa-solid fa-spinner fa-spin" /> Searching...
              </div>
            )}
            {!searchLoading && searchResults.length === 0 && searchStoreQuery === searchSubmittedQuery && (
              <div class="book-chapter-picker__search-empty">{t('bookChapterPicker.noResults')}</div>
            )}
            {searchResults.length > 0 && searchStoreQuery === searchSubmittedQuery && (
              <div class="book-chapter-picker__search-list">
                {searchResults.map((result, i) => (
                  <SearchResultItem
                    key={i}
                    result={result}
                    onClick={handleSearchResultClick}
                    onCtrlClick={handleSearchResultClick}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          selectedBook ? renderChapterGrid() : renderBookList()
        )}
      </div>
    </div>
  );
}

/** Extract the book-name portion of the input for filtering (exclude trailing chapter:verse) */
function getBookFilterText(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  // Pure number: don't filter books (it's a chapter number)
  if (/^\d+$/.test(trimmed)) return '';
  // If the input has digits after letters (like "John 3" or "Gen 1:2"), extract just the book name
  const match = trimmed.match(/^(\d?\s*[a-zA-Z]+)\s*\d/);
  if (match) {
    return match[1].trim();
  }
  // Pure text input - use as book filter
  return trimmed;
}
