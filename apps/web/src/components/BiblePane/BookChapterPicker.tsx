import { useState, useEffect, useMemo, useRef } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { BookChapterPicker as SharedBookChapterPicker } from '@bible/ui';
import type { BookChapterPickerLabels } from '@bible/ui';
import { localizedBookAliases } from '../../constants';
import { getLocalizedBookName } from '../../utils/bookNames';
import { bibleStore } from '../../stores/bibleStore';
import { searchStore } from '../../stores/searchStore';
import { useStore } from '../../hooks/useStore';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useLocalizer } from '../../hooks/useLocalizer';
import { SearchResultItem } from '../Search/SearchResultItem';
import { TranslationDialog } from './TranslationDialog';
import { parseVerseId } from '../../utils/verseId';
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

/** Topics of the chosen book, listed under its chapter grid (web-only extra, loaded from the bible store). */
function BookTopics({ book, onSelect }: { book: number; onSelect: BookChapterPickerProps['onSelect'] }) {
  const { t } = useTranslation();
  const [topics, setTopics] = useState<BookTopic[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    let cancelled = false;
    bibleStore.getBookTopics(book)
      .then(data => {
        if (cancelled) return;
        setTopics(data.topics);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setTopics([]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [book]);

  if (loading) {
    return (
      <div class="book-chapter-picker__topics-loading">
        <i class="fa-solid fa-spinner fa-spin" /> Loading topics...
      </div>
    );
  }
  if (topics.length === 0) return null;
  return (
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
            onClick={() => onSelect(book, topic.chapter, topic.verse)}
          >
            <span class="book-chapter-picker__topic-title">{topic.title}</span>
            <span class="book-chapter-picker__topic-ref">{ref}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Picking a book swaps the book grid for the chapter grid, which removes the button that had focus (focus
 * falls to <body>). Mounted beside the chapter grid, this moves focus onto it: the current chapter, else the first.
 */
function FocusChapterGrid({ dialogRef }: { dialogRef: { current: HTMLElement | null } }) {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== dialog && dialog.contains(active) && active.isConnected) return;
    const cell = dialog.querySelector<HTMLElement>('.kth-picker__cell--chapter[aria-current="true"]')
      ?? dialog.querySelector<HTMLElement>('.kth-picker__cell--chapter');
    cell?.focus({ preventScroll: true });
  }, []);
  return null;
}

/** Results of a search run from inside the picker; subscribes to the global search store. */
function PickerSearchResults({ query, onSelect }: { query: string; onSelect: BookChapterPickerProps['onSelect'] }) {
  const { t } = useTranslation();
  const searchResults = useStore(searchStore, () => searchStore.results) as SearchResultData[];
  const searchLoading = useStore(searchStore, () => searchStore.loading);
  const searchStoreQuery = useStore(searchStore, () => searchStore.query);

  // Clicking a search result opens the verse in a new tab via the existing onSelect mechanism
  const handleClick = (result: SearchResultData) => {
    const { bookNumber, chapter, verse } = parseVerseId(result.verseId);
    onSelect(bookNumber, chapter, verse);
  };

  return (
    <>
      {searchLoading && searchStoreQuery === query && (
        <div class="book-chapter-picker__search-loading">
          <i class="fa-solid fa-spinner fa-spin" /> Searching...
        </div>
      )}
      {!searchLoading && searchResults.length === 0 && searchStoreQuery === query && (
        <div class="book-chapter-picker__search-empty">{t('bookChapterPicker.noResults')}</div>
      )}
      {searchResults.length > 0 && searchStoreQuery === query && (
        <div class="book-chapter-picker__search-list">
          {searchResults.map((result, i) => (
            <SearchResultItem
              key={i}
              result={result}
              onClick={handleClick}
              onCtrlClick={handleClick}
            />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * After a passage is picked the dialog closes and focus returns to its opener. When the opener was
 * not focusable (at phone width, the chapter heading) or has gone, focus would fall to <body>: land
 * on the reader's main heading instead (the same target HomeScreen uses after "Read Bible").
 */
function focusReaderIfFocusLost() {
  let tries = 0;
  const attempt = () => {
    // Still open (the parent kept it up, or has not re-rendered yet): wait a few frames.
    if (document.querySelector('.book-chapter-picker__overlay') && ++tries < 10) {
      requestAnimationFrame(attempt);
      return;
    }
    const ae = document.activeElement;
    if (ae && ae !== document.body && ae.isConnected) return;
    const heading = document.querySelector<HTMLElement>('.bible-pane > h1');
    if (!heading) return;
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  };
  requestAnimationFrame(attempt);
}

function PickerDialog({ onClose, onSelect: onSelectProp, currentBook, currentChapter, moduleAbbr, onChangeTranslation }: Omit<BookChapterPickerProps, 'isOpen'>) {
  const { t } = useTranslation();
  const localizer = useLocalizer();
  const onSelect: BookChapterPickerProps['onSelect'] = (...args) => {
    onSelectProp(...args);
    focusReaderIfFocusLost();
  };
  const bookAliases = useMemo(() => localizedBookAliases(localizer), [localizer]);
  const [showTranslationDialog, setShowTranslationDialog] = useState(false);
  // Mounted only while open: focus returns to whatever opened it when it unmounts (B-156).
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(true, dialogRef);
  // Focus the reference input on desktop-class screens only: on phones it would pop the keyboard.
  const [autoFocusInput] = useState(() => window.innerWidth > 768 && !('ontouchstart' in window));
  const isMobileView = window.innerWidth <= 768 || 'ontouchstart' in window;

  const labels: Partial<BookChapterPickerLabels> = {
    title: t('bookChapterPicker.goToPassage'),
    back: t('bookChapterPicker.back'),
    close: t('common.close'),
    go: t('bibleContent.go'),
    referencePlaceholder: t('bookChapterPicker.typeAReferenceOrSearch'),
    oldTestament: t('bookChapterPicker.oldTestament'),
    newTestament: t('bookChapterPicker.newTestament'),
    noMatchingBooks: t('bookChapterPicker.noMatchingBooks'),
    selectChapter: t('bookChapterPicker.selectAChapter'),
    searchFor: (query: string) => t('bookChapterPicker.searchFor', { query }),
    chapterOption: (book: string, chapter: number) => t('bookChapterPicker.chapterOption', { book, chapter }),
  };

  return (
    <div class="book-chapter-picker__overlay" onClick={onClose}>
      <div class="book-chapter-picker" ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('bookChapterPicker.goToPassage')} onClick={(e) => e.stopPropagation()}>
        <SharedBookChapterPicker
          current={{ book: currentBook ?? null, chapter: currentChapter }}
          onPick={onSelect}
          onClose={onClose}
          bookName={getLocalizedBookName}
          bookAliases={bookAliases}
          labels={labels}
          icons={{
            back: <i class="fa-solid fa-chevron-left kth-rtl-mirror" />,
            close: <i class="fa-solid fa-xmark" />,
            go: <i class="fa-solid fa-arrow-right kth-rtl-mirror" />,
          }}
          // Web keeps ranges/single-chapter references, the filled current book, and phone-sized short names.
          referenceSyntax="extended"
          currentBookAppearance="solid"
          compact={isMobileView}
          shortBookName={(n) => t(String(n), { ns: 'booksShort' })}
          autoFocusInput={autoFocusInput}
          // The translation dialog owns Escape while it is up; without this one keypress would close it
          // *and* step this picker back a level.
          escapeSuspended={showTranslationDialog}
          search={{
            onSearch: (query) => {
              const activeModule = bibleStore.getActiveTab()?.moduleAbbr;
              searchStore.performSearch(query, undefined, activeModule ? [activeModule] : undefined);
            },
            results: (query) => <PickerSearchResults query={query} onSelect={onSelect} />,
          }}
          afterReference={(
            <>
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
            </>
          )}
          chapterExtras={(book) => (
            <>
              <BookTopics book={book} onSelect={onSelect} />
              <FocusChapterGrid dialogRef={dialogRef} />
            </>
          )}
        />
      </div>
    </div>
  );
}

/**
 * Web "go to passage" dialog: this file owns the modal frame (overlay, size, phone full-screen), the app
 * data (localized names, i18n labels, search store, topics, translation selector); the picker itself is
 * `@bible/ui`. Mounted only while open, so every open starts on the book list with an empty box.
 */
export function BookChapterPicker({ isOpen, ...rest }: BookChapterPickerProps) {
  if (!isOpen) return null;
  return <PickerDialog {...rest} />;
}
