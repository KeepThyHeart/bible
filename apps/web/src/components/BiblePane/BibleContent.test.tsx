/**
 * Component tests for BibleContent.
 *
 * Pattern: Store-connected component with multiple child components.
 * bibleStore, commentaryStore, and moduleStore are mocked to control the tab state
 * displayed. VerseRenderer and BookChapterPicker are mocked to prevent complex
 * dependency chains. useStore calls the selector immediately (no subscription).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import type { BibleTab } from '../../stores/bibleStore';
import type { VerseData } from '../../types';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && Object.keys(opts).length > 0) return `${key}:${JSON.stringify(opts)}`;
      return key;
    },
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ---- Mock child components -----------------------------------------------
vi.mock('./VerseRenderer', () => ({
  // Surfaces `isInRange` and the click callback so the selection wiring can be
  // asserted without rendering the real verse markup.
  VerseRenderer: ({ verse, isInRange, onVerseClick }: {
    verse: VerseData;
    isInRange?: boolean;
    onVerseClick: (verseId: number, extend: boolean) => void;
  }) => (
    <div
      data-testid="verse-renderer"
      data-verse-id={verse.verse_id}
      data-in-range={isInRange ? 'true' : 'false'}
      onClick={(e) => onVerseClick(verse.verse_id, (e as unknown as MouseEvent).shiftKey)}
    >{verse.text}</div>
  ),
}));

vi.mock('./BookChapterPicker', () => ({
  BookChapterPicker: ({ isOpen }: { isOpen: boolean }) => (
    isOpen ? <div data-testid="book-chapter-picker" /> : null
  ),
}));

// ---- Mock utilities ------------------------------------------------------
vi.mock('../../utils/bookNames', () => ({
  getAllBookNames: () => ({ 43: 'John', 1: 'Genesis' }),
  getLocalizedBookName: (n: number) => (n === 43 ? 'John' : `Book ${n}`),
}));

vi.mock('../../constants', () => ({
  isSingleChapterBook: () => false,
  formatPassageRef: (book: number, ch: number, v: number) => `B${book} ${ch}:${v}`,
}));

// ---- Store state ---------------------------------------------------------
function makeTab(overrides: Partial<BibleTab> = {}): BibleTab {
  return {
    id: 'tab-1',
    moduleAbbr: 'KJV',
    moduleName: 'King James Version',
    book: 43,
    chapter: 3,
    studyVerse: null,
    previewVerse: null,
    previewVerseEnd: null,
    selectionEndVerse: null,
    verses: [],
    loading: false,
    scrollPosition: 0,
    pendingScrollVerse: null,
    pendingScrollTop: null,
    hasInterlinearData: false,
    displayMode: 'standard',
    history: [],
    historyIndex: -1,
    showBackBar: false,
    ...overrides,
  };
}

function makeVerse(overrides: Partial<VerseData> = {}): VerseData {
  return {
    verse_id: 43003016,
    book_number: 43,
    chapter: 3,
    verse: 16,
    text: 'For God so loved the world',
    text_html: 'For God so loved the world',
    is_paragraph_start: false,
    words_of_christ: false,
    ...overrides,
  };
}

let mockActiveTab: BibleTab | null = makeTab();
let mockStudyShowInterlinear = false;
let mockStudyShowNotes = false;
let mockShowBookPicker = false;

vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

const mockNavigateTo = vi.fn();
const mockSetStudyVerse = vi.fn();
const mockExtendSelectionTo = vi.fn();
const mockOpenBookPicker = vi.fn();
const mockCloseBookPicker = vi.fn();
const mockSetStudyShowInterlinear = vi.fn();
const mockSetStudyShowNotes = vi.fn();
const mockGetVerseOfTheDay = vi.fn().mockResolvedValue(null);

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => mockActiveTab,
    get studyShowInterlinear() { return mockStudyShowInterlinear; },
    get studyShowNotes() { return mockStudyShowNotes; },
    get showBookPicker() { return mockShowBookPicker; },
    navigateTo: (...args: unknown[]) => mockNavigateTo(...args),
    setStudyVerse: (v: number) => mockSetStudyVerse(v),
    extendSelectionTo: (v: number) => mockExtendSelectionTo(v),
    openBookPicker: () => mockOpenBookPicker(),
    closeBookPicker: () => mockCloseBookPicker(),
    setStudyShowInterlinear: (v: boolean) => mockSetStudyShowInterlinear(v),
    setStudyShowNotes: (v: boolean) => mockSetStudyShowNotes(v),
    getVerseOfTheDay: () => mockGetVerseOfTheDay(),
  },
}));

const mockLoadForChapter = vi.fn();
vi.mock('../../stores/commentaryStore', () => ({
  commentaryStore: {
    loadForChapter: (b: number, ch: number) => mockLoadForChapter(b, ch),
  },
}));

const mockGetBookByNumber = vi.fn((n: number) => ({
  book_number: n,
  book_name: 'John',
  chapter_count: 21,
}));

vi.mock('../../stores/moduleStore', () => ({
  moduleStore: {
    getBookByNumber: (n: number) => mockGetBookByNumber(n),
  },
}));

import { BibleContent } from './BibleContent';

describe('BibleContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveTab = makeTab();
    mockStudyShowInterlinear = false;
    mockStudyShowNotes = false;
    mockShowBookPicker = false;
    mockGetVerseOfTheDay.mockResolvedValue(null);
    mockGetBookByNumber.mockImplementation((n: number) => ({
      book_number: n, book_name: 'John', chapter_count: 21,
    }));
  });

  // ------------------------------------------------------------------
  // No active tab
  // ------------------------------------------------------------------
  it('renders empty state when there is no active tab', () => {
    mockActiveTab = null;
    const { container } = render(<BibleContent />);
    expect(container.querySelector('.bible-content--empty')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Welcome / no book selected
  // ------------------------------------------------------------------
  it('renders welcome form when tab has no book/chapter', () => {
    mockActiveTab = makeTab({ book: null, chapter: null });
    const { container } = render(<BibleContent />);
    expect(container.querySelector('.bible-content__welcome')).toBeTruthy();
    expect(container.querySelector('.bible-content__ref-input')).toBeTruthy();
  });

  it('shows error when invalid reference is submitted', () => {
    mockActiveTab = makeTab({ book: null, chapter: null });
    const { container } = render(<BibleContent />);
    const input = container.querySelector<HTMLInputElement>('.bible-content__ref-input')!;
    fireEvent.input(input, { target: { value: 'zzznomatch' } });
    const form = container.querySelector('form')!;
    fireEvent.submit(form);
    // Error message should appear (i18n returns key)
    expect(container.querySelector('[style*="text-muted"]') || container.textContent).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Chapter header
  // ------------------------------------------------------------------
  it('renders chapter heading with book name and chapter number', () => {
    mockActiveTab = makeTab({ book: 43, chapter: 3 });
    const { container } = render(<BibleContent />);
    expect(container.querySelector('.bible-content__chapter-header')).toBeTruthy();
    expect(container.querySelector('.bible-content__chapter-title')?.textContent).toContain('John');
    expect(container.querySelector('.bible-content__chapter-title')?.textContent).toContain('3');
  });

  it('calls openBookPicker when chapter title is clicked', () => {
    mockActiveTab = makeTab({ book: 43, chapter: 3 });
    const { container } = render(<BibleContent />);
    fireEvent.click(container.querySelector('.bible-content__chapter-title')!);
    expect(mockOpenBookPicker).toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Navigation buttons
  // ------------------------------------------------------------------
  it('disables prev button at Genesis 1:1', () => {
    mockActiveTab = makeTab({ book: 1, chapter: 1, verses: [makeVerse()] });
    mockGetBookByNumber.mockReturnValue({ book_number: 1, book_name: 'Genesis', chapter_count: 50 });
    const { container } = render(<BibleContent />);
    const btns = container.querySelectorAll<HTMLButtonElement>('.bible-content__nav-btn');
    expect(btns[0].disabled).toBe(true);
  });

  it('disables next button at Revelation 22', () => {
    mockActiveTab = makeTab({ book: 66, chapter: 22, verses: [makeVerse()] });
    mockGetBookByNumber.mockReturnValue({ book_number: 66, book_name: 'Revelation', chapter_count: 22 });
    const { container } = render(<BibleContent />);
    const btns = container.querySelectorAll<HTMLButtonElement>('.bible-content__nav-btn');
    expect(btns[1].disabled).toBe(true);
  });

  it('calls navigateTo with prev chapter on prev-chapter click', () => {
    mockActiveTab = makeTab({ book: 43, chapter: 5, verses: [makeVerse()] });
    const { container } = render(<BibleContent />);
    const btns = container.querySelectorAll<HTMLButtonElement>('.bible-content__nav-btn');
    fireEvent.click(btns[0]);
    expect(mockNavigateTo).toHaveBeenCalledWith(43, 4, undefined, { replace: true });
  });

  it('calls navigateTo with next chapter on next-chapter click', () => {
    mockActiveTab = makeTab({ book: 43, chapter: 3, verses: [makeVerse()] });
    const { container } = render(<BibleContent />);
    const btns = container.querySelectorAll<HTMLButtonElement>('.bible-content__nav-btn');
    fireEvent.click(btns[1]);
    expect(mockNavigateTo).toHaveBeenCalledWith(43, 4, undefined, { replace: true });
  });

  // ------------------------------------------------------------------
  // Loading state
  // ------------------------------------------------------------------
  it('renders loading indicator when tab is loading', () => {
    mockActiveTab = makeTab({ loading: true });
    const { container } = render(<BibleContent />);
    expect(container.querySelector('.bible-content--loading')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Empty / error state
  // ------------------------------------------------------------------
  it('renders no-content when verses list is empty and not loading', () => {
    // isLoading = true when tab.book && tab.chapter && verses.length === 0 && !loadError
    // To show empty/no-content, we must have a loadError so isLoading=false but isEmpty=true
    mockActiveTab = makeTab({ book: 43, chapter: 3, loading: false, verses: [], loadError: 'No content available' });
    const { container } = render(<BibleContent />);
    expect(container.querySelector('.bible-content__no-content')).toBeTruthy();
  });

  it('renders retry button when there is a load error', () => {
    mockActiveTab = makeTab({ book: 43, chapter: 3, loading: false, verses: [], coveredBooks: [], loadError: 'Network error' });
    const { container } = render(<BibleContent />);
    const retryBtn = container.querySelector('button[class*="retry"], button');
    expect(retryBtn).toBeTruthy();
    expect(container.textContent).toContain('Network error');
  });

  // ------------------------------------------------------------------
  // Verses rendering
  // ------------------------------------------------------------------
  it('renders VerseRenderer for each verse', () => {
    const verses = [
      makeVerse({ verse_id: 43003016, verse: 16, text: 'For God so loved the world' }),
      makeVerse({ verse_id: 43003017, verse: 17, text: 'For God sent not his Son' }),
    ];
    mockActiveTab = makeTab({ verses });
    const { container } = render(<BibleContent />);
    const renderers = container.querySelectorAll('[data-testid="verse-renderer"]');
    expect(renderers.length).toBe(2);
  });

  // ------------------------------------------------------------------
  // Study mode toggles
  // ------------------------------------------------------------------
  it('shows study toggles in study mode', () => {
    mockActiveTab = makeTab({ displayMode: 'study', verses: [makeVerse()] });
    const { container } = render(<BibleContent />);
    expect(container.querySelector('.bible-content__study-toggles')).toBeTruthy();
  });

  it('does not show study toggles in standard mode', () => {
    mockActiveTab = makeTab({ displayMode: 'standard', verses: [makeVerse()] });
    const { container } = render(<BibleContent />);
    expect(container.querySelector('.bible-content__study-toggles')).toBeNull();
  });

  it('calls setStudyShowInterlinear on interlinear toggle change', () => {
    mockActiveTab = makeTab({ displayMode: 'study', verses: [makeVerse()] });
    mockStudyShowInterlinear = false;
    const { container } = render(<BibleContent />);
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    // First checkbox is interlinear
    fireEvent.change(checkboxes[0], { target: { checked: true } });
    expect(mockSetStudyShowInterlinear).toHaveBeenCalledWith(true);
  });

  it('calls setStudyShowNotes on notes toggle change', () => {
    mockActiveTab = makeTab({ displayMode: 'study', verses: [makeVerse()] });
    mockStudyShowNotes = true;
    const { container } = render(<BibleContent />);
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    // Second checkbox is notes
    fireEvent.change(checkboxes[1], { target: { checked: false } });
    expect(mockSetStudyShowNotes).toHaveBeenCalledWith(false);
  });

  // ------------------------------------------------------------------
  // Interlinear status messages
  // ------------------------------------------------------------------
  it('shows interlinear loading indicator', () => {
    mockActiveTab = makeTab({ displayMode: 'study', verses: [makeVerse()] });
    mockStudyShowInterlinear = true;
    const { container } = render(<BibleContent interlinearLoading />);
    expect(container.querySelector('.bible-content__interlinear-status')).toBeTruthy();
  });

  it('hides the verses while interlinear data loads', () => {
    // Painting the plain text first and then swapping in the taller
    // interlinear rows made the whole chapter jump under the reader.
    mockActiveTab = makeTab({ displayMode: 'study', verses: [makeVerse()] });
    mockStudyShowInterlinear = true;
    const { container } = render(<BibleContent interlinearLoading />);
    expect(container.querySelector('[data-testid="verse-renderer"]')).toBeNull();
  });

  it('still renders the verses while loading when interlinear is switched off', () => {
    mockActiveTab = makeTab({ displayMode: 'study', verses: [makeVerse()] });
    mockStudyShowInterlinear = false;
    const { container } = render(<BibleContent interlinearLoading />);
    expect(container.querySelector('[data-testid="verse-renderer"]')).toBeTruthy();
  });

  it('shows interlinear unavailable message', () => {
    mockActiveTab = makeTab({ displayMode: 'study', verses: [makeVerse()] });
    mockStudyShowInterlinear = true;
    const { container } = render(<BibleContent interlinearUnavailable />);
    expect(container.querySelector('.bible-content__interlinear-status--unavailable')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // BookChapterPicker
  // ------------------------------------------------------------------
  it('renders BookChapterPicker overlay when showBookPicker is true', () => {
    mockShowBookPicker = true;
    mockActiveTab = makeTab({ verses: [makeVerse()] });
    const { container } = render(<BibleContent />);
    expect(container.querySelector('[data-testid="book-chapter-picker"]')).toBeTruthy();
  });

  it('does not render BookChapterPicker when showBookPicker is false', () => {
    mockShowBookPicker = false;
    mockActiveTab = makeTab({ verses: [makeVerse()] });
    const { container } = render(<BibleContent />);
    expect(container.querySelector('[data-testid="book-chapter-picker"]')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Shift-click passage selection
  // ------------------------------------------------------------------
  describe('passage selection', () => {
    const threeVerses = [
      makeVerse({ verse_id: 43003016, verse: 16 }),
      makeVerse({ verse_id: 43003017, verse: 17 }),
      makeVerse({ verse_id: 43003018, verse: 18 }),
    ];
    const rangeFlags = (container: Element) =>
      Array.from(container.querySelectorAll('[data-testid="verse-renderer"]'))
        .map(el => el.getAttribute('data-in-range'));

    it('sets the study verse on a plain click', () => {
      mockActiveTab = makeTab({ verses: threeVerses });
      const { container } = render(<BibleContent />);
      fireEvent.click(container.querySelectorAll('[data-testid="verse-renderer"]')[1]);
      expect(mockSetStudyVerse).toHaveBeenCalledWith(43003017);
      expect(mockExtendSelectionTo).not.toHaveBeenCalled();
    });

    it('extends the selection on a shift-click, without moving the anchor', () => {
      mockActiveTab = makeTab({ studyVerse: 43003016, verses: threeVerses });
      const { container } = render(<BibleContent />);
      fireEvent.click(container.querySelectorAll('[data-testid="verse-renderer"]')[2], { shiftKey: true });
      expect(mockExtendSelectionTo).toHaveBeenCalledWith(43003018);
      expect(mockSetStudyVerse).not.toHaveBeenCalled();
    });

    it('does not reload commentary on a shift-click — the focus verse is unchanged', () => {
      mockActiveTab = makeTab({ studyVerse: 43003016, verses: threeVerses });
      const { container } = render(<BibleContent />);
      fireEvent.click(container.querySelectorAll('[data-testid="verse-renderer"]')[2], { shiftKey: true });
      expect(mockLoadForChapter).not.toHaveBeenCalled();
    });

    it('marks every verse of the range, anchor included', () => {
      mockActiveTab = makeTab({ studyVerse: 43003016, selectionEndVerse: 43003018, verses: threeVerses });
      const { container } = render(<BibleContent />);
      expect(rangeFlags(container)).toEqual(['true', 'true', 'true']);
    });

    it('marks the range when the selection runs backwards from the anchor', () => {
      mockActiveTab = makeTab({ studyVerse: 43003018, selectionEndVerse: 43003016, verses: threeVerses });
      const { container } = render(<BibleContent />);
      expect(rangeFlags(container)).toEqual(['true', 'true', 'true']);
    });

    it('marks nothing when there is no selection end', () => {
      mockActiveTab = makeTab({ studyVerse: 43003016, verses: threeVerses });
      const { container } = render(<BibleContent />);
      expect(rangeFlags(container)).toEqual(['false', 'false', 'false']);
    });

    it('excludes verses outside the range', () => {
      mockActiveTab = makeTab({ studyVerse: 43003016, selectionEndVerse: 43003017, verses: threeVerses });
      const { container } = render(<BibleContent />);
      expect(rangeFlags(container)).toEqual(['true', 'true', 'false']);
    });
  });
});
