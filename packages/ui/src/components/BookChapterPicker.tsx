/**
 * BookChapterPicker: the body of the "go to passage" dialog, shared by the desktop and web apps and
 * (later) extension panels.
 *
 * Owns: the book grid by testament (with type-ahead filtering), the chapter grid, the typed-reference
 * box (parse and jump, or offer a free-text search), Escape stepping back from chapters to books and then
 * closing, focus handling, and the accessibility roles/labels.
 *
 * Does NOT own (the app wrapper supplies these): the overlay/dialog frame and its size and position,
 * every string (labels are props), book names and aliases (from the app's locale), search execution and
 * result rendering, the translation selector, topics and any other app-only extras (slots).
 *
 * Mount it only while the dialog is open: a fresh mount is a fresh state (book list, empty input).
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { NT_BOOKS, OT_BOOKS, getBibleSection } from '@bible/core/browser';
import { chapterCount, filterBooks, getBookFilterText, parseReference } from './bookReference';
import type { ReferenceSyntax } from './bookReference';

export type { ReferenceSyntax } from './bookReference';

/** Every visible or spoken string. The app supplies these already localized; English defaults are provided. */
export interface BookChapterPickerLabels {
  /** Heading on the book list ("Go to Passage"). */
  title: string;
  back: string;
  close: string;
  go: string;
  /** Placeholder and accessible name of the reference input. */
  referencePlaceholder: string;
  oldTestament: string;
  newTestament: string;
  noMatchingBooks: string;
  /** Caption above the chapter grid. */
  selectChapter: string;
  /** Text of the "search for what I typed" link. */
  searchFor: (query: string) => string;
  /** Accessible name of a chapter cell, e.g. "Genesis chapter 3". */
  chapterOption: (bookName: string, chapter: number) => string;
}

export const DEFAULT_BOOK_CHAPTER_PICKER_LABELS: BookChapterPickerLabels = {
  title: 'Go to Passage',
  back: 'Back',
  close: 'Close',
  go: 'Go',
  referencePlaceholder: 'Type a reference or search... (e.g. John 3:16, love)',
  oldTestament: 'Old Testament',
  newTestament: 'New Testament',
  noMatchingBooks: 'No matching books',
  selectChapter: 'Select a chapter',
  searchFor: (query) => `Search for "${query}"`,
  chapterOption: (bookName, chapter) => `${bookName} chapter ${chapter}`,
};

export interface BookChapterPickerSearch {
  /** Run a free-text search (the user chose the offer link, or submitted text that is not a passage). */
  onSearch: (query: string) => void;
  /**
   * The results area while in search mode, for the query last submitted. Return an element (a component
   * that subscribes to the app's search state), not hook calls: this callback runs conditionally.
   */
  results: (submittedQuery: string) => ReactNode;
}

export interface BookChapterPickerProps {
  /** The passage currently open, highlighted in the grids. */
  current?: { book: number | null; chapter?: number | null } | null;
  /**
   * A passage was chosen. `verse`/`endVerse` are present only for typed references (and, from the app's own
   * search results or extras, whatever the app passes). Book grid and chapter grid call it with two arguments.
   */
  onPick: (book: number, chapter: number, verse?: number, endVerse?: number) => void;
  /** Escape at the book list and the close button. The close button is omitted when this is absent. */
  onClose?: () => void;
  /** Localized book name. */
  bookName: (book: number) => string;
  /** Alternate spellings and abbreviations to book number, for typed references and filtering. */
  bookAliases?: Readonly<Record<string, number>>;
  labels?: Partial<BookChapterPickerLabels>;
  /** Text direction of the picker subtree; omit to inherit from the document. */
  dir?: 'ltr' | 'rtl';
  /** Id for the title element, so the app's dialog frame can point `aria-labelledby` at it. */
  titleId?: string;

  /** Typed-reference dialect. Product difference kept as an option: web 'extended', desktop 'basic'. */
  referenceSyntax?: ReferenceSyntax;
  /** How the current book looks in the book grid: filled accent ('solid', web) or soft accent tint ('soft', desktop). */
  currentBookAppearance?: 'solid' | 'soft';
  /** Inline style per book cell (section tint). Not called for the current book. */
  cellStyle?: (book: number) => CSSProperties | undefined;
  /** Compact grid of short names while no filter is typed (web on phones). Needs `shortBookName`. */
  compact?: boolean;
  shortBookName?: (book: number) => string;
  /** Focus the reference input on mount (default true; web skips it on touch/narrow screens). */
  autoFocusInput?: boolean;
  /** While true, Escape is ignored (an app-owned nested dialog handles it). */
  escapeSuspended?: boolean;
  /** Icons for the back, close and go buttons; text glyphs are used when omitted. */
  icons?: { back?: ReactNode; close?: ReactNode; go?: ReactNode };

  /** Without this there is no search offer and unrecognized text does nothing. */
  search?: BookChapterPickerSearch;
  /** Rendered under the reference box (web: the translation selector). */
  afterReference?: ReactNode;
  /** Rendered under the chapter grid for the chosen book (web: topics). */
  chapterExtras?: (book: number) => ReactNode;
}

const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' ');

export function BookChapterPicker({
  current,
  onPick,
  onClose,
  bookName,
  bookAliases,
  labels: labelOverrides,
  dir,
  titleId,
  referenceSyntax = 'extended',
  currentBookAppearance = 'solid',
  cellStyle,
  compact = false,
  shortBookName,
  autoFocusInput = true,
  escapeSuspended = false,
  icons,
  search,
  afterReference,
  chapterExtras,
}: BookChapterPickerProps) {
  const labels: BookChapterPickerLabels = { ...DEFAULT_BOOK_CHAPTER_PICKER_LABELS, ...labelOverrides };
  const uid = useId();
  const [selectedBook, setSelectedBook] = useState<number | null>(null);
  const [refValue, setRefValue] = useState('');
  const [searchMode, setSearchMode] = useState(false);
  const [submittedQuery, setSubmittedQuery] = useState('');
  const refInputRef = useRef<HTMLInputElement>(null);
  const currentBookRef = useRef<HTMLButtonElement>(null);

  const currentBook = current?.book ?? null;
  const currentChapter = current?.chapter ?? null;

  const focusInput = () => {
    requestAnimationFrame(() => refInputRef.current?.focus());
  };

  useEffect(() => {
    if (autoFocusInput) focusInput();
    // Mount only: later focus moves are explicit (back, Escape).
  }, []);

  // Scroll the current book into view on the book list.
  useEffect(() => {
    if (selectedBook || searchMode || !currentBookRef.current) return;
    requestAnimationFrame(() => currentBookRef.current?.scrollIntoView?.({ block: 'center' }));
  }, [selectedBook, searchMode]);

  // Escape steps back to the book list, then closes. Registered for the component's life (layout effect,
  // so it is live before the first frame) with state read from a ref.
  const escapeRef = useRef({ selectedBook, onClose, escapeSuspended });
  escapeRef.current = { selectedBook, onClose, escapeSuspended };
  useLayoutEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const state = escapeRef.current;
      if (state.escapeSuspended) return;
      e.preventDefault();
      if (state.selectedBook) {
        setSelectedBook(null);
        focusInput();
      } else {
        state.onClose?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const lookup = { bookName, bookAliases };

  const pickBook = (book: number) => {
    if (chapterCount(book) === 1) onPick(book, 1);
    else setSelectedBook(book);
  };

  const runSearch = (query: string) => {
    if (!search) return;
    setSearchMode(true);
    setSubmittedQuery(query);
    search.onSearch(query);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = refValue.trim();
    if (!trimmed) return;

    // A bare number is a chapter of the open (or current) book, never a search.
    if (/^\d+$/.test(trimmed)) {
      const num = parseInt(trimmed, 10);
      const book = selectedBook || currentBook;
      if (book && num >= 1 && num <= chapterCount(book)) onPick(book, num);
      return;
    }

    const ref = parseReference(trimmed, { ...lookup, syntax: referenceSyntax });
    if (ref) {
      onPick(ref.book, ref.chapter, ref.verse, ref.endVerse);
      return;
    }
    runSearch(trimmed);
  };

  const handleInput = (value: string) => {
    setRefValue(value);
    if (searchMode) {
      setSearchMode(false);
      setSubmittedQuery('');
    }
  };

  const goBack = () => {
    setSelectedBook(null);
    focusInput();
  };

  const bookFilter = !selectedBook && !searchMode ? getBookFilterText(refValue) : '';
  const hasFilter = bookFilter.length > 0;
  const filteredOT = filterBooks(OT_BOOKS, bookFilter, lookup);
  const filteredNT = filterBooks(NT_BOOKS, bookFilter, lookup);
  const useCompact = compact && !hasFilter && !!shortBookName;

  // Offer a search while the text has no digit (a digit suggests a reference in progress).
  const trimmedRef = refValue.trim();
  const searchOffer = search && !searchMode && trimmedRef && !/\d/.test(trimmedRef) ? trimmedRef : null;

  const renderBook = (num: number) => {
    const isCurrent = num === currentBook;
    const name = bookName(num);
    return (
      <button
        key={num}
        type="button"
        ref={isCurrent ? currentBookRef : undefined}
        title={name}
        data-section={getBibleSection(num)}
        aria-current={isCurrent ? 'true' : undefined}
        style={isCurrent ? undefined : cellStyle?.(num)}
        className={cx(
          'kth-picker__cell',
          'kth-picker__cell--book',
          useCompact && 'kth-picker__cell--compact',
          isCurrent && (currentBookAppearance === 'soft' ? 'kth-picker__cell--current' : 'kth-picker__cell--active'),
        )}
        onClick={() => pickBook(num)}
      >
        {useCompact ? shortBookName!(num) : name}
      </button>
    );
  };

  const renderTestament = (books: number[], label: string, labelId: string) =>
    books.length > 0 && (
      <>
        <div id={labelId} className="kth-picker__section-label">{label}</div>
        <div
          role="group"
          aria-labelledby={labelId}
          className={cx('kth-picker__grid', 'kth-picker__grid--books', useCompact && 'kth-picker__grid--compact')}
        >
          {books.map(renderBook)}
        </div>
      </>
    );

  const renderChapters = (book: number) => {
    const labelId = `${uid}-chapters`;
    const name = bookName(book);
    return (
      <div className="kth-picker__body kth-picker__chapters">
        <div id={labelId} className="kth-picker__label">{labels.selectChapter}</div>
        <div role="group" aria-labelledby={labelId} className="kth-picker__grid">
          {Array.from({ length: chapterCount(book) }, (_, i) => i + 1).map((ch) => {
            const isCurrent = book === currentBook && ch === currentChapter;
            return (
              <button
                key={ch}
                type="button"
                aria-current={isCurrent ? 'true' : undefined}
                aria-label={labels.chapterOption(name, ch)}
                className={cx('kth-picker__cell', 'kth-picker__cell--chapter', isCurrent && 'kth-picker__cell--active')}
                onClick={() => onPick(book, ch)}
              >
                {ch}
              </button>
            );
          })}
        </div>
        {chapterExtras?.(book)}
      </div>
    );
  };

  return (
    <div className="kth-picker" dir={dir}>
      <div className="kth-picker__header">
        {selectedBook ? (
          <>
            <button type="button" className="kth-btn kth-btn--sm" onClick={goBack}>
              {icons?.back}
              {icons?.back ? ' ' : null}
              {labels.back}
            </button>
            <h3 id={titleId} className="kth-picker__title">{bookName(selectedBook)}</h3>
          </>
        ) : (
          <h3 id={titleId} className="kth-picker__title">{labels.title}</h3>
        )}
        {onClose && (
          <button
            type="button"
            className="kth-btn kth-btn--ghost kth-btn--sm"
            aria-label={labels.close}
            onClick={onClose}
          >
            {icons?.close ?? <span aria-hidden="true">&times;</span>}
          </button>
        )}
      </div>

      <form className="kth-picker__form" onSubmit={handleSubmit}>
        <input
          ref={refInputRef}
          type="text"
          className="kth-input kth-picker__input"
          placeholder={labels.referencePlaceholder}
          aria-label={labels.referencePlaceholder}
          value={refValue}
          onChange={(e) => handleInput(e.currentTarget.value)}
        />
        <button type="submit" className="kth-btn kth-btn--primary" aria-label={icons?.go ? labels.go : undefined}>
          {icons?.go ?? labels.go}
        </button>
      </form>

      {afterReference}

      {searchOffer && (
        <div className="kth-picker__offer">
          <button type="button" className="kth-picker__offer-link" onClick={() => runSearch(searchOffer)}>
            {labels.searchFor(searchOffer)}
          </button>
        </div>
      )}

      {searchMode && search ? (
        <div className="kth-picker__body kth-picker__results">{search.results(submittedQuery)}</div>
      ) : selectedBook ? (
        renderChapters(selectedBook)
      ) : (
        <div className="kth-picker__body kth-picker__books">
          {renderTestament(filteredOT, labels.oldTestament, `${uid}-ot`)}
          {renderTestament(filteredNT, labels.newTestament, `${uid}-nt`)}
          {hasFilter && filteredOT.length === 0 && filteredNT.length === 0 && (
            <div className="kth-picker__status">{labels.noMatchingBooks}</div>
          )}
        </div>
      )}
    </div>
  );
}
