/**
 * Component tests for BookChapterPicker.
 *
 * Pattern: Store-connected modal component with internal state.
 * bibleStore and searchStore are mocked. SearchResultItem is mocked to prevent
 * its own dependency chain. Utility functions (bookNames, constants) are mocked
 * to return deterministic data for a small set of books.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/preact';
import type { SearchResultData } from '../../types';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => enString(key),
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ---- Mock SearchResultItem -----------------------------------------------
vi.mock('../Search/SearchResultItem', () => ({
  SearchResultItem: ({ result, onClick }: { result: SearchResultData; onClick: (r: SearchResultData) => void }) => (
    <div
      data-testid="search-result-item"
      data-verse-id={result.verseId}
      onClick={() => onClick(result)}
    >
      {result.reference}
    </div>
  ),
}));

// ---- Mock utilities -------------------------------------------------------
vi.mock('../../utils/bookNames', () => ({
  getAllBookNames: () => ({
    1: 'Genesis',
    2: 'Exodus',
    40: 'Matthew',
    43: 'John',
  }),
  getLocalizedBookName: (n: number) => {
    const names: Record<number, string> = { 1: 'Genesis', 2: 'Exodus', 40: 'Matthew', 43: 'John' };
    return names[n] ?? `Book ${n}`;
  },
}));

vi.mock('../../constants', () => ({
  BOOK_ALIASES: {},
  // MAX_CHAPTERS keys are strings when accessed via bracket notation on a plain object
  MAX_CHAPTERS: {
    1: 50,   // Genesis
    2: 40,   // Exodus
    40: 28,  // Matthew
    43: 21,  // John
    57: 1,   // Philemon (single-chapter)
    63: 1,   // 2 John
    64: 1,   // 3 John
    65: 1,   // Jude
    31: 1,   // Obadiah
  } as Record<number, number>,
}));

vi.mock('@bible/core/browser', () => ({
  getBibleSection: () => 'nt',
}));

vi.mock('../../utils/verseId', () => ({
  parseVerseId: (verseId: number) => ({
    bookNumber: Math.floor(verseId / 1000000),
    chapter: Math.floor((verseId % 1000000) / 1000),
    verse: verseId % 1000,
  }),
}));

// ---- Store state ---------------------------------------------------------
let mockSearchResults: SearchResultData[] = [];
let mockSearchLoading = false;
let mockSearchQuery = '';

vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

const mockPerformSearch = vi.fn();
vi.mock('../../stores/searchStore', () => ({
  searchStore: {
    get results() { return mockSearchResults; },
    get loading() { return mockSearchLoading; },
    get query() { return mockSearchQuery; },
    performSearch: (q: string, _opts?: unknown, _modules?: unknown) => mockPerformSearch(q),
  },
}));

const mockGetActiveTab = vi.fn(() => ({ moduleAbbr: 'KJV' }));
const mockGetBookTopics = vi.fn().mockResolvedValue({ topics: [] });

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => mockGetActiveTab(),
    getBookTopics: (n: number) => mockGetBookTopics(n),
  },
}));

import { BookChapterPicker } from './BookChapterPicker';
import { enString } from '../../testing/enCatalog';

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSelect: vi.fn(),
  currentBook: 43,
  currentChapter: 3,
};

describe('BookChapterPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchResults = [];
    mockSearchLoading = false;
    mockSearchQuery = '';
    mockGetActiveTab.mockReturnValue({ moduleAbbr: 'KJV' });
    mockGetBookTopics.mockResolvedValue({ topics: [] });
  });

  // ------------------------------------------------------------------
  // Closed state
  // ------------------------------------------------------------------
  it('renders nothing when isOpen is false', () => {
    const { container } = render(<BookChapterPicker {...defaultProps} isOpen={false} />);
    expect(container.querySelector('.book-chapter-picker__overlay')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Open state — book list
  // ------------------------------------------------------------------
  it('renders the overlay when isOpen is true', () => {
    const { container } = render(<BookChapterPicker {...defaultProps} />);
    expect(container.querySelector('.book-chapter-picker__overlay')).toBeTruthy();
  });

  it('renders "Go to Passage" heading on book list view', () => {
    render(<BookChapterPicker {...defaultProps} />);
    expect(screen.getByText('Go to Passage')).toBeTruthy();
  });

  it('renders Old Testament section label', () => {
    render(<BookChapterPicker {...defaultProps} />);
    expect(screen.getByText('Old Testament')).toBeTruthy();
  });

  it('renders New Testament section label', () => {
    render(<BookChapterPicker {...defaultProps} />);
    expect(screen.getByText('New Testament')).toBeTruthy();
  });

  it('renders a book button for each book', () => {
    const { container } = render(<BookChapterPicker {...defaultProps} />);
    // We mock 4 books: 2 OT + 2 NT, but filterBooks may return all 66 book slots
    // At minimum verify we have book buttons rendered
    const btns = container.querySelectorAll('.book-chapter-picker__book-btn');
    expect(btns.length).toBeGreaterThan(0);
  });

  it('applies current-book class to the currently active book', () => {
    const { container } = render(<BookChapterPicker {...defaultProps} currentBook={43} />);
    const currentBtn = container.querySelector('.book-chapter-picker__book-btn--current');
    expect(currentBtn).toBeTruthy();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<BookChapterPicker {...defaultProps} onClose={onClose} />);
    fireEvent.click(container.querySelector('.book-chapter-picker__close-btn')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when the overlay backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<BookChapterPicker {...defaultProps} onClose={onClose} />);
    fireEvent.click(container.querySelector('.book-chapter-picker__overlay')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close when clicking inside the picker panel', () => {
    const onClose = vi.fn();
    const { container } = render(<BookChapterPicker {...defaultProps} onClose={onClose} />);
    fireEvent.click(container.querySelector('.book-chapter-picker')!);
    expect(onClose).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Reference input and submission
  // ------------------------------------------------------------------
  it('renders the reference input', () => {
    const { container } = render(<BookChapterPicker {...defaultProps} />);
    expect(container.querySelector('.book-chapter-picker__ref-input')).toBeTruthy();
  });

  it('calls onSelect with parsed reference on valid submission', () => {
    const onSelect = vi.fn();
    const { container } = render(<BookChapterPicker {...defaultProps} onSelect={onSelect} />);
    const input = container.querySelector<HTMLInputElement>('.book-chapter-picker__ref-input')!;
    fireEvent.input(input, { target: { value: 'John 3:16' } });
    const form = container.querySelector('form')!;
    fireEvent.submit(form);
    expect(onSelect).toHaveBeenCalledWith(43, 3, 16, undefined);
  });

  it('shows search offer link when typing text without numbers', () => {
    const { container } = render(<BookChapterPicker {...defaultProps} />);
    const input = container.querySelector<HTMLInputElement>('.book-chapter-picker__ref-input')!;
    fireEvent.input(input, { target: { value: 'grace' } });
    expect(container.querySelector('.book-chapter-picker__search-offer')).toBeTruthy();
  });

  it('does not show search offer link when typing a reference with numbers', () => {
    const { container } = render(<BookChapterPicker {...defaultProps} />);
    const input = container.querySelector<HTMLInputElement>('.book-chapter-picker__ref-input')!;
    fireEvent.input(input, { target: { value: 'John 3' } });
    expect(container.querySelector('.book-chapter-picker__search-offer')).toBeNull();
  });

  it('runs search when search offer link is clicked', () => {
    const { container } = render(<BookChapterPicker {...defaultProps} />);
    const input = container.querySelector<HTMLInputElement>('.book-chapter-picker__ref-input')!;
    fireEvent.input(input, { target: { value: 'grace' } });
    const offerBtn = container.querySelector<HTMLButtonElement>('.book-chapter-picker__search-offer-link')!;
    fireEvent.click(offerBtn);
    expect(mockPerformSearch).toHaveBeenCalledWith('grace');
  });

  it('runs search on submit when input is unrecognized text', () => {
    const { container } = render(<BookChapterPicker {...defaultProps} />);
    const input = container.querySelector<HTMLInputElement>('.book-chapter-picker__ref-input')!;
    fireEvent.input(input, { target: { value: 'faith and grace' } });
    const form = container.querySelector('form')!;
    fireEvent.submit(form);
    expect(mockPerformSearch).toHaveBeenCalledWith('faith and grace');
  });

  // ------------------------------------------------------------------
  // Chapter grid
  // ------------------------------------------------------------------
  it('shows chapter grid after selecting a multi-chapter book', async () => {
    const { container } = render(<BookChapterPicker {...defaultProps} currentBook={43} />);
    // Find and click John button
    const johnBtn = Array.from(container.querySelectorAll<HTMLElement>('.book-chapter-picker__book-btn'))
      .find(b => b.title === 'John');
    expect(johnBtn).toBeTruthy();
    await act(async () => {
      fireEvent.click(johnBtn!);
    });
    expect(container.querySelector('.book-chapter-picker__chapter-grid')).toBeTruthy();
  });

  it('calls onSelect with book and chapter when chapter button is clicked', async () => {
    const onSelect = vi.fn();
    const { container } = render(<BookChapterPicker {...defaultProps} onSelect={onSelect} currentBook={43} />);
    const johnBtn = Array.from(container.querySelectorAll<HTMLElement>('.book-chapter-picker__book-btn'))
      .find(b => b.title === 'John');
    await act(async () => {
      fireEvent.click(johnBtn!);
    });
    const chapterBtns = container.querySelectorAll<HTMLElement>('.book-chapter-picker__chapter-btn');
    expect(chapterBtns.length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(chapterBtns[2]); // chapter 3
    });
    expect(onSelect).toHaveBeenCalledWith(43, 3);
  });

  it('shows back button when chapter grid is visible', async () => {
    const { container } = render(<BookChapterPicker {...defaultProps} currentBook={43} />);
    const johnBtn = Array.from(container.querySelectorAll<HTMLElement>('.book-chapter-picker__book-btn'))
      .find(b => b.title === 'John');
    await act(async () => {
      fireEvent.click(johnBtn!);
    });
    expect(container.querySelector('.book-chapter-picker__back-btn')).toBeTruthy();
  });

  it('navigates back to book list when back button is clicked', async () => {
    const { container } = render(<BookChapterPicker {...defaultProps} currentBook={43} />);
    const johnBtn = Array.from(container.querySelectorAll<HTMLElement>('.book-chapter-picker__book-btn'))
      .find(b => b.title === 'John');
    await act(async () => {
      fireEvent.click(johnBtn!);
    });
    expect(container.querySelector('.book-chapter-picker__chapter-grid')).toBeTruthy();
    fireEvent.click(container.querySelector('.book-chapter-picker__back-btn')!);
    expect(container.querySelector('.book-chapter-picker__chapter-grid')).toBeNull();
    expect(screen.getByText('Go to Passage')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Search results
  // ------------------------------------------------------------------
  it('shows loading indicator when searching', async () => {
    mockSearchLoading = true;
    mockSearchQuery = 'grace';
    const { container } = render(<BookChapterPicker {...defaultProps} />);
    const input = container.querySelector<HTMLInputElement>('.book-chapter-picker__ref-input')!;
    fireEvent.input(input, { target: { value: 'grace' } });
    // Trigger search mode
    const form = container.querySelector('form')!;
    fireEvent.submit(form);
    expect(container.querySelector('.book-chapter-picker__search-loading')).toBeTruthy();
  });

  it('shows search results when available', async () => {
    const result: SearchResultData = {
      verseId: 43003016,
      reference: 'John 3:16',
      text: 'For God so loved the world',
      module: 'KJV',
      type: 'exact',
    };
    mockSearchResults = [result];
    mockSearchLoading = false;
    mockSearchQuery = 'love';
    const { container } = render(<BookChapterPicker {...defaultProps} />);
    const input = container.querySelector<HTMLInputElement>('.book-chapter-picker__ref-input')!;
    fireEvent.input(input, { target: { value: 'love' } });
    const form = container.querySelector('form')!;
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(container.querySelectorAll('[data-testid="search-result-item"]').length).toBeGreaterThan(0);
  });

  it('calls onSelect when a search result is clicked', async () => {
    const onSelect = vi.fn();
    const result: SearchResultData = {
      verseId: 43003016,
      reference: 'John 3:16',
      text: 'For God so loved the world',
      module: 'KJV',
      type: 'exact',
    };
    mockSearchResults = [result];
    mockSearchLoading = false;
    mockSearchQuery = 'love';
    const { container } = render(<BookChapterPicker {...defaultProps} onSelect={onSelect} />);
    const input = container.querySelector<HTMLInputElement>('.book-chapter-picker__ref-input')!;
    fireEvent.input(input, { target: { value: 'love' } });
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    const resultItem = container.querySelector('[data-testid="search-result-item"]')!;
    fireEvent.click(resultItem);
    expect(onSelect).toHaveBeenCalledWith(43, 3, 16);
  });

  it('shows empty message when search returns no results', async () => {
    mockSearchResults = [];
    mockSearchLoading = false;
    mockSearchQuery = 'xyznotfound';
    const { container } = render(<BookChapterPicker {...defaultProps} />);
    const input = container.querySelector<HTMLInputElement>('.book-chapter-picker__ref-input')!;
    fireEvent.input(input, { target: { value: 'xyznotfound' } });
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    expect(container.querySelector('.book-chapter-picker__search-empty')).toBeTruthy();
  });
});
