/**
 * Component tests for ChapterNav.
 *
 * Pattern: Store-connected component — bibleStore and moduleStore are mocked
 * so tests control exactly what getActiveTab() and getBookByNumber() return.
 * useStore is mocked to call the selector immediately (no subscription).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// Control what the active tab looks like in each test
let mockActiveTab: { book: number | null; chapter: number | null } | undefined = {
  book: 43,
  chapter: 3,
};

vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

const mockNavigateTo = vi.fn();
const mockGetBookByNumber = vi.fn((n: number) => ({ book_number: n, book_name: 'John', chapter_count: 21 }));
const mockGetBookName = vi.fn((_n: number) => 'John');

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => mockActiveTab,
    navigateTo: (...args: unknown[]) => mockNavigateTo(...args),
  },
}));

vi.mock('../../stores/moduleStore', () => ({
  moduleStore: {
    getBookByNumber: (n: number) => mockGetBookByNumber(n),
    getBookName: (n: number) => mockGetBookName(n),
  },
}));

import { ChapterNav } from './ChapterNav';

describe('ChapterNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveTab = { book: 43, chapter: 3 };
    mockGetBookByNumber.mockImplementation((n: number) => ({
      book_number: n,
      book_name: 'John',
      chapter_count: 21,
    }));
    mockGetBookName.mockReturnValue('John');
  });

  it('renders nothing when there is no active tab', () => {
    mockActiveTab = undefined;
    const { container } = render(<ChapterNav />);
    expect(container.querySelector('.chapter-nav')).toBeNull();
  });

  it('renders nothing when tab has no book', () => {
    mockActiveTab = { book: null, chapter: 3 };
    const { container } = render(<ChapterNav />);
    expect(container.querySelector('.chapter-nav')).toBeNull();
  });

  it('renders nothing when tab has no chapter', () => {
    mockActiveTab = { book: 43, chapter: null };
    const { container } = render(<ChapterNav />);
    expect(container.querySelector('.chapter-nav')).toBeNull();
  });

  it('renders the chapter nav with prev/next buttons', () => {
    const { container } = render(<ChapterNav />);
    expect(container.querySelector('.chapter-nav')).toBeTruthy();
    const buttons = container.querySelectorAll('.chapter-nav__btn');
    expect(buttons.length).toBe(2);
  });

  it('shows book name and chapter number in label', () => {
    mockGetBookName.mockReturnValue('John');
    render(<ChapterNav />);
    expect(screen.getByText('John 3')).toBeTruthy();
  });

  it('shows only book name for single-chapter books (Jude = book 65)', () => {
    mockActiveTab = { book: 65, chapter: 1 };
    mockGetBookName.mockReturnValue('Jude');
    mockGetBookByNumber.mockReturnValue({ book_number: 65, book_name: 'Jude', chapter_count: 1 });
    render(<ChapterNav />);
    // Single-chapter book: label is just the book name
    expect(screen.getByText('Jude')).toBeTruthy();
  });

  it('prev button is enabled when not at Genesis 1', () => {
    const { container } = render(<ChapterNav />);
    const [prevBtn] = container.querySelectorAll<HTMLButtonElement>('.chapter-nav__btn');
    expect(prevBtn.disabled).toBe(false);
  });

  it('prev button is disabled at Genesis 1', () => {
    mockActiveTab = { book: 1, chapter: 1 };
    mockGetBookName.mockReturnValue('Genesis');
    mockGetBookByNumber.mockReturnValue({ book_number: 1, book_name: 'Genesis', chapter_count: 50 });
    const { container } = render(<ChapterNav />);
    const [prevBtn] = container.querySelectorAll<HTMLButtonElement>('.chapter-nav__btn');
    expect(prevBtn.disabled).toBe(true);
  });

  it('next button is disabled at Revelation 22', () => {
    mockActiveTab = { book: 66, chapter: 22 };
    mockGetBookName.mockReturnValue('Revelation');
    mockGetBookByNumber.mockReturnValue({ book_number: 66, book_name: 'Revelation', chapter_count: 22 });
    const { container } = render(<ChapterNav />);
    const buttons = container.querySelectorAll<HTMLButtonElement>('.chapter-nav__btn');
    const nextBtn = buttons[1];
    expect(nextBtn.disabled).toBe(true);
  });

  it('next button is enabled when not at the last chapter', () => {
    const { container } = render(<ChapterNav />);
    const buttons = container.querySelectorAll<HTMLButtonElement>('.chapter-nav__btn');
    const nextBtn = buttons[1];
    expect(nextBtn.disabled).toBe(false);
  });

  it('calls navigateTo with prev chapter when prev button is clicked (mid-book)', () => {
    mockActiveTab = { book: 43, chapter: 5 };
    const { container } = render(<ChapterNav />);
    const [prevBtn] = container.querySelectorAll<HTMLButtonElement>('.chapter-nav__btn');
    fireEvent.click(prevBtn);
    expect(mockNavigateTo).toHaveBeenCalledWith(43, 4, undefined, { replace: true });
  });

  it('calls navigateTo with next chapter when next button is clicked', () => {
    mockActiveTab = { book: 43, chapter: 3 };
    const { container } = render(<ChapterNav />);
    const buttons = container.querySelectorAll<HTMLButtonElement>('.chapter-nav__btn');
    fireEvent.click(buttons[1]);
    expect(mockNavigateTo).toHaveBeenCalledWith(43, 4, undefined, { replace: true });
  });

  it('navigates to last chapter of previous book when at chapter 1', () => {
    mockActiveTab = { book: 43, chapter: 1 };
    // Prev book is Luke (42), 24 chapters
    mockGetBookByNumber.mockImplementation((n: number) => {
      if (n === 42) return { book_number: 42, book_name: 'Luke', chapter_count: 24 };
      return { book_number: n, book_name: 'John', chapter_count: 21 };
    });
    const { container } = render(<ChapterNav />);
    const [prevBtn] = container.querySelectorAll<HTMLButtonElement>('.chapter-nav__btn');
    fireEvent.click(prevBtn);
    expect(mockNavigateTo).toHaveBeenCalledWith(42, 24, undefined, { replace: true });
  });

  it('navigates to book+1 chapter 1 when at last chapter of a book', () => {
    mockActiveTab = { book: 43, chapter: 21 };
    mockGetBookByNumber.mockReturnValue({ book_number: 43, book_name: 'John', chapter_count: 21 });
    const { container } = render(<ChapterNav />);
    const buttons = container.querySelectorAll<HTMLButtonElement>('.chapter-nav__btn');
    fireEvent.click(buttons[1]);
    expect(mockNavigateTo).toHaveBeenCalledWith(44, 1, undefined, { replace: true });
  });
});
