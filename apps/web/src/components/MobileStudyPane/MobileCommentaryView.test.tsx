/**
 * Component tests for MobileCommentaryView.
 *
 * Pattern: Store-connected component that composes MobileCommentary and
 * StudyVerseHeader. All stores, child components, and hooks are mocked.
 * useStore is mocked to call the selector immediately (no subscription).
 *
 * Tests cover: rendering, verse label, sync banners, back bar, and
 * commentary detail state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ---- useStore shim -------------------------------------------------------
vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

// ---- Child component mocks -----------------------------------------------
vi.mock('./StudyVerseHeader', () => ({
  StudyVerseHeader: (props: { verseLabel: string }) => (
    <div data-testid="mock-study-verse-header">{props.verseLabel}</div>
  ),
}));

vi.mock('./MobileCommentary', () => ({
  MobileCommentary: (props: { viewingModule?: { abbr: string; name: string } | null }) => (
    <div data-testid="mock-mobile-commentary">
      {props.viewingModule ? `detail:${props.viewingModule.abbr}` : 'list'}
    </div>
  ),
  MobileCommentaryDetail: () => <div data-testid="mock-commentary-detail" />,
}));

// ---- Hook mocks ----------------------------------------------------------
vi.mock('../../hooks/useVerseNavigation', () => ({
  useVerseNavigation: () => ({
    handlePrevVerse: vi.fn(),
    handleNextVerse: vi.fn(),
  }),
}));

// ---- Utility mocks -------------------------------------------------------
vi.mock('../../utils/verseId', () => ({
  parseVerseId: (id: number) => ({
    bookNumber: Math.floor(id / 1000000),
    chapter: Math.floor((id % 1000000) / 1000),
    verse: id % 1000,
  }),
  formatVerseRange: (s: number, e: number) => `${s}-${e}`,
  isTskModule: () => false,
}));

vi.mock('../../utils/syncStatus', () => ({
  getSyncStatus: () => ({ status: 'synced', currentLabel: '', syncLabel: '', syncVerseId: null }),
}));

vi.mock('../../constants', () => ({
  formatPassageRef: (book: number, chapter: number, verse: number | null) =>
    `${book}:${chapter}${verse ? ':' + verse : ''}`,
}));

// ---- Store state holders -------------------------------------------------
let mockStudyVerseId: number | null = 43003016;
let mockStudyBook: number | null = 43;
let mockStudyChapter: number | null = 3;
let mockStudyVerse: number | null = 16;
let mockVerseHistory: Array<{ verseId: number; timestamp: number }> = [];
let mockPinned = false;
let mockMobileSelectedCommentary: { abbr: string; name: string } | null = null;
let mockGetActiveTabStudyVerse: number | null = 43003016;

const mockStudyStoreUnpin = vi.fn();
const mockStudyStorePin = vi.fn();
const mockLoadForVerse = vi.fn();
const mockCommentaryLoadForChapter = vi.fn();
const mockSetMobileSelectedCommentary = vi.fn();
const mockFetchEntriesForVerse = vi.fn().mockResolvedValue([]);
const mockPrefetchAllEntries = vi.fn().mockResolvedValue([]);
const mockBibleNavigateTo = vi.fn();
const mockAdoptPreviewAsStudy = vi.fn();

vi.mock('../../stores/studyStore', () => ({
  studyStore: {
    get verseId() { return mockStudyVerseId; },
    get book() { return mockStudyBook; },
    get chapter() { return mockStudyChapter; },
    get verse() { return mockStudyVerse; },
    get verseHistory() { return mockVerseHistory; },
    get pinned() { return mockPinned; },
    get pinnedBook() { return null; },
    get pinnedChapter() { return null; },
    get pinnedVerse() { return null; },
    unpin: () => mockStudyStoreUnpin(),
    pin: () => mockStudyStorePin(),
    loadForVerse: (...args: unknown[]) => mockLoadForVerse(...args),
  },
}));

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => ({
      book: mockStudyBook,
      chapter: mockStudyChapter,
      studyVerse: mockGetActiveTabStudyVerse,
    }),
    navigateTo: (...args: unknown[]) => mockBibleNavigateTo(...args),
    adoptPreviewAsStudy: (id: number) => mockAdoptPreviewAsStudy(id),
  },
}));

vi.mock('../../stores/commentaryStore', () => ({
  HOME_TAB_ID: 'ctab-home',
  commentaryStore: {
    get mobileSelectedCommentary() { return mockMobileSelectedCommentary; },
    setMobileSelectedCommentary: (detail: unknown, verseId: unknown) =>
      mockSetMobileSelectedCommentary(detail, verseId),
    loadForChapter: (...args: unknown[]) => mockCommentaryLoadForChapter(...args),
    fetchEntriesForVerse: (...args: unknown[]) => mockFetchEntriesForVerse(...args),
    prefetchAllEntries: (...args: unknown[]) => mockPrefetchAllEntries(...args),
  },
}));

import { MobileCommentaryView } from './MobileCommentaryView';

/**
 * Every child that would touch a provider is mocked above, so this only has to
 * satisfy the type — nothing dereferences a member.
 *
 * Listing the keys by hand let the object drift from `IDataProviders`: it
 * carried a `dictionary` key that is not on the interface at all, and omitted
 * `search`, `modules` and `studyOverview`'s neighbours `strongs`. Nothing
 * noticed, because test files were excluded from the type-check.
 */
import type { IDataProviders } from '../../providers/interfaces';

const mockProviders = {} as IDataProviders;

describe('MobileCommentaryView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStudyVerseId = 43003016;
    mockStudyBook = 43;
    mockStudyChapter = 3;
    mockStudyVerse = 16;
    mockVerseHistory = [];
    mockPinned = false;
    mockMobileSelectedCommentary = null;
    mockGetActiveTabStudyVerse = 43003016;
  });

  it('renders the commentary pane container', () => {
    const { container } = render(<MobileCommentaryView providers={mockProviders} />);
    expect(container.querySelector('.mobile-study-pane--commentary')).toBeTruthy();
  });

  it('renders the commentary title', () => {
    render(<MobileCommentaryView providers={mockProviders} />);
    expect(screen.getByText('commentaryPane.commentary')).toBeTruthy();
  });

  it('renders StudyVerseHeader with verse label', () => {
    render(<MobileCommentaryView providers={mockProviders} />);
    const header = screen.getByTestId('mock-study-verse-header');
    expect(header).toBeTruthy();
  });

  it('renders MobileCommentary in list mode when no detail is selected', () => {
    render(<MobileCommentaryView providers={mockProviders} />);
    expect(screen.getByText('list')).toBeTruthy();
  });

  it('renders MobileCommentary in detail mode when commentary detail is selected', () => {
    mockMobileSelectedCommentary = { abbr: 'MHC', name: 'MHC Commentary' };
    render(<MobileCommentaryView providers={mockProviders} />);
    expect(screen.getByText('detail:MHC')).toBeTruthy();
  });

  it('shows "see all commentaries" link when commentaryDetail is set', () => {
    mockMobileSelectedCommentary = { abbr: 'MHC', name: 'MHC Commentary' };
    render(<MobileCommentaryView providers={mockProviders} />);
    expect(screen.getByText(/commentaryPane.seeAllCommentaries/)).toBeTruthy();
  });

  it('shows back bar with module name when commentaryDetail is set', () => {
    mockMobileSelectedCommentary = { abbr: 'MHC', name: 'MHC Commentary' };
    render(<MobileCommentaryView providers={mockProviders} />);
    expect(screen.getByText('MHC Commentary')).toBeTruthy();
  });

  it('calls setMobileSelectedCommentary(null) when back button is clicked', () => {
    mockMobileSelectedCommentary = { abbr: 'MHC', name: 'MHC Commentary' };
    const { container } = render(<MobileCommentaryView providers={mockProviders} />);
    const backBtn = container.querySelector('.mobile-commentary-detail__back-title')!;
    fireEvent.click(backBtn);
    expect(mockSetMobileSelectedCommentary).toHaveBeenCalledWith(null, mockStudyVerseId);
  });

  it('calls setMobileSelectedCommentary(null) when "see all" link is clicked', () => {
    mockMobileSelectedCommentary = { abbr: 'MHC', name: 'MHC Commentary' };
    const { container } = render(<MobileCommentaryView providers={mockProviders} />);
    const seeAllLink = container.querySelector('.mobile-commentary-detail__see-all')!;
    fireEvent.click(seeAllLink);
    expect(mockSetMobileSelectedCommentary).toHaveBeenCalledWith(null, mockStudyVerseId);
  });

  it('accepts an onNavigateBible callback prop without error', () => {
    const onNavigateBible = vi.fn();
    expect(() => render(
      <MobileCommentaryView providers={mockProviders} onNavigateBible={onNavigateBible} />,
    )).not.toThrow();
  });

  it('accepts an onOpenSettings callback prop without error', () => {
    const onOpenSettings = vi.fn();
    expect(() => render(
      <MobileCommentaryView providers={mockProviders} onOpenSettings={onOpenSettings} />,
    )).not.toThrow();
  });
});
