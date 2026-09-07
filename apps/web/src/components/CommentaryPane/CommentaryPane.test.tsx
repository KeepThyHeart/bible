/**
 * Component tests for CommentaryPane.
 *
 * Pattern: Complex store-connected component. commentaryStore, bibleStore,
 * moduleStore, settingsStore are mocked; child components (CommentaryTabBar,
 * CommentaryContent) are mocked to prevent transitive deep dependencies.
 * useStore is mocked to call the selector immediately.
 *
 * Tests cover: collapsed state, normal rendering, passage header, pin button,
 * verse nav, settings button, sync banners, "add to tabs" bar, and
 * scroll position persistence hooks.
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
vi.mock('./CommentaryTabBar', () => ({
  CommentaryTabBar: () => <div data-testid="mock-commentary-tab-bar" />,
}));
vi.mock('./CommentaryContent', () => ({
  CommentaryContent: () => <div data-testid="mock-commentary-content" />,
}));

// ---- Hook mocks ----------------------------------------------------------
vi.mock('../../hooks/useVerseText', () => ({
  useVerseText: (_verseId: unknown) => '',
}));

// ---- Utility mocks -------------------------------------------------------
vi.mock('../../utils/verseId', () => ({
  parseVerseId: (id: number) => ({
    bookNumber: Math.floor(id / 1000000),
    chapter: Math.floor((id % 1000000) / 1000),
    verse: id % 1000,
  }),
}));

vi.mock('../../utils/syncStatus', () => ({
  getSyncStatus: () => ({
    status: mockSyncStatus,
    currentLabel: 'John 3:16',
    syncLabel: 'John 3:17',
    syncVerseId: 43003017,
  }),
}));

vi.mock('../../constants', () => ({
  formatPassageRef: (book: number, chapter: number, verse: number | null, bookName?: string) =>
    bookName
      ? `${bookName} ${chapter}${verse ? ':' + verse : ''}`
      : `${book}:${chapter}${verse ? ':' + verse : ''}`,
  MAX_CHAPTERS: Array(67).fill(22) as number[],
}));

// ---- Store state holders -------------------------------------------------
let mockCollapsed = false;
let mockSyncedBook: number | null = 43;
let mockSyncedChapter: number | null = 3;
let mockPinned = false;
let mockStudyVerse: number | null = 43003016;
let mockPreviewVerse: number | null = null;
let mockTabs: { id: string; moduleAbbr: string; moduleName: string; temporary?: boolean }[] = [
  { id: 'ctab-home', moduleAbbr: 'home', moduleName: 'Home' },
];
let mockActiveTabId = 'ctab-home';
let mockPinnedVerse: number | null = null;
let mockPinnedBook: number | null = null;
let mockPinnedChapter: number | null = null;
let mockSyncStatus = 'synced';

const mockToggleCollapsed = vi.fn();
const mockTogglePin = vi.fn();
const mockSetOverrideVerse = vi.fn();
const mockAdoptPreviewAsStudy = vi.fn();
const mockLoadForChapter = vi.fn();
const mockNavigateTo = vi.fn().mockResolvedValue(undefined);
const mockKeepTab = vi.fn();

vi.mock('../../stores/commentaryStore', () => ({
  HOME_TAB_ID: 'ctab-home',
  commentaryStore: {
    get collapsed() { return mockCollapsed; },
    get syncedBook() { return mockSyncedBook; },
    get syncedChapter() { return mockSyncedChapter; },
    get pinned() { return mockPinned; },
    get pinnedVerse() { return mockPinnedVerse; },
    get pinnedBook() { return mockPinnedBook; },
    get pinnedChapter() { return mockPinnedChapter; },
    get tabs() { return mockTabs; },
    get activeTabId() { return mockActiveTabId; },
    toggleCollapsed: () => mockToggleCollapsed(),
    togglePin: (v: unknown) => mockTogglePin(v),
    setOverrideVerse: (id: number) => mockSetOverrideVerse(id),
    loadForChapter: (...args: unknown[]) => mockLoadForChapter(...args),
    unpin: vi.fn(),
    keepTab: (id: string) => mockKeepTab(id),
  },
}));

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => ({
      book: mockSyncedBook,
      chapter: mockSyncedChapter,
      studyVerse: mockStudyVerse,
      previewVerse: mockPreviewVerse,
      verses: [],
    }),
    adoptPreviewAsStudy: (id: number) => mockAdoptPreviewAsStudy(id),
    navigateTo: (...args: unknown[]) => mockNavigateTo(...args),
  },
}));

vi.mock('../../stores/moduleStore', () => ({
  moduleStore: {
    getBookName: (n: number) => n === 43 ? 'John' : `Book${n}`,
  },
}));

vi.mock('../../stores/settingsStore', () => ({
  settingsStore: {
    swipeCommentaryVerseThresholdPx: 100,
  },
}));

import { CommentaryPane } from './CommentaryPane';

describe('CommentaryPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollapsed = false;
    mockSyncedBook = 43;
    mockSyncedChapter = 3;
    mockPinned = false;
    mockStudyVerse = 43003016;
    mockPreviewVerse = null;
    mockTabs = [{ id: 'ctab-home', moduleAbbr: 'home', moduleName: 'Home' }];
    mockActiveTabId = 'ctab-home';
    mockPinnedVerse = null;
    mockPinnedBook = null;
    mockPinnedChapter = null;
    mockSyncStatus = 'synced';
  });

  // ---- Collapsed state ---------------------------------------------------
  it('renders collapsed state when collapsed is true', () => {
    mockCollapsed = true;
    const { container } = render(<CommentaryPane />);
    expect(container.querySelector('.commentary-pane--collapsed')).toBeTruthy();
    expect(container.querySelector('.commentary-pane__expand-btn')).toBeTruthy();
  });

  it('calls toggleCollapsed when the expand button is clicked', () => {
    mockCollapsed = true;
    const { container } = render(<CommentaryPane />);
    fireEvent.click(container.querySelector('.commentary-pane__expand-btn')!);
    expect(mockToggleCollapsed).toHaveBeenCalled();
  });

  it('does not render full pane content when collapsed', () => {
    mockCollapsed = true;
    const { container } = render(<CommentaryPane />);
    expect(container.querySelector('.commentary-pane__scroll')).toBeNull();
    expect(container.querySelector('.commentary-pane__title')).toBeNull();
  });

  // ---- Normal rendering --------------------------------------------------
  it('renders the commentary title', () => {
    const { container } = render(<CommentaryPane />);
    expect(container.querySelector('.commentary-pane__title')?.textContent).toContain('commentaryPane.commentary');
  });

  it('renders CommentaryTabBar by default', () => {
    const { container } = render(<CommentaryPane />);
    expect(container.querySelector('[data-testid="mock-commentary-tab-bar"]')).toBeTruthy();
  });

  it('does not render CommentaryTabBar when hideTabBar is true', () => {
    const { container } = render(<CommentaryPane hideTabBar />);
    expect(container.querySelector('[data-testid="mock-commentary-tab-bar"]')).toBeNull();
  });

  it('renders CommentaryContent', () => {
    const { container } = render(<CommentaryPane />);
    expect(container.querySelector('[data-testid="mock-commentary-content"]')).toBeTruthy();
  });

  // ---- Passage header ----------------------------------------------------
  it('renders the passage label in the header', () => {
    const { container } = render(<CommentaryPane />);
    // formatPassageRef is mocked — passage will contain "John" and chapter "3"
    expect(container.querySelector('.commentary-passage-header__label')?.textContent).toContain('John');
  });

  it('shows "no passage selected" when synced book/chapter are null', () => {
    mockSyncedBook = null;
    mockSyncedChapter = null;
    mockStudyVerse = null;
    const { container } = render(<CommentaryPane />);
    expect(container.querySelector('.commentary-passage-header__label')?.textContent).toContain('commentaryPane.noPassageSelected');
  });

  // ---- Pin button --------------------------------------------------------
  it('renders the pin button', () => {
    const { container } = render(<CommentaryPane />);
    expect(container.querySelector('.commentary-passage-header__pin')).toBeTruthy();
  });

  it('calls commentaryStore.togglePin when pin button is clicked', () => {
    const { container } = render(<CommentaryPane />);
    const pinBtn = container.querySelector<HTMLButtonElement>('.commentary-passage-header__pin')!;
    fireEvent.click(pinBtn);
    expect(mockTogglePin).toHaveBeenCalled();
  });

  it('pin button has --active class when pinned', () => {
    mockPinned = true;
    mockPinnedBook = 43;
    mockPinnedChapter = 3;
    mockPinnedVerse = 16;
    const { container } = render(<CommentaryPane />);
    const pinBtn = container.querySelector('.commentary-passage-header__pin')!;
    expect(pinBtn.classList.contains('commentary-passage-header__pin--active')).toBe(true);
  });

  // ---- Verse navigation buttons -----------------------------------------
  it('shows verse nav buttons when a study verse is set', () => {
    const { container } = render(<CommentaryPane />);
    expect(container.querySelectorAll('.commentary-passage-header__nav').length).toBeGreaterThanOrEqual(2);
  });

  it('does not show verse nav buttons when studyVerse is null', () => {
    mockStudyVerse = null;
    const { container } = render(<CommentaryPane />);
    expect(container.querySelectorAll('.commentary-passage-header__nav').length).toBe(0);
  });

  it('calls setOverrideVerse and adoptPreviewAsStudy when prev-verse nav is clicked', () => {
    const { container } = render(<CommentaryPane />);
    const navBtns = container.querySelectorAll<HTMLButtonElement>('.commentary-passage-header__nav');
    fireEvent.click(navBtns[0]); // prev verse
    // navigateCommentaryVerse(-1): verse 16-1=15 → new id
    expect(mockSetOverrideVerse).toHaveBeenCalled();
    expect(mockAdoptPreviewAsStudy).toHaveBeenCalled();
  });

  it('calls setOverrideVerse and adoptPreviewAsStudy when next-verse nav is clicked', () => {
    const { container } = render(<CommentaryPane />);
    const navBtns = container.querySelectorAll<HTMLButtonElement>('.commentary-passage-header__nav');
    fireEvent.click(navBtns[1]); // next verse
    expect(mockSetOverrideVerse).toHaveBeenCalled();
    expect(mockAdoptPreviewAsStudy).toHaveBeenCalled();
  });

  // ---- Settings button ---------------------------------------------------
  it('renders the settings (Aa) button when onOpenSettings is provided', () => {
    const onOpenSettings = vi.fn();
    const { container } = render(<CommentaryPane onOpenSettings={onOpenSettings} />);
    expect(container.querySelector('.commentary-passage-header__settings')).toBeTruthy();
    expect(container.querySelector('.commentary-passage-header__settings')?.textContent).toBe('Aa');
  });

  it('does not render the settings button when onOpenSettings is not provided', () => {
    const { container } = render(<CommentaryPane />);
    expect(container.querySelector('.commentary-passage-header__settings')).toBeNull();
  });

  it('calls onOpenSettings with "commentary-font" when Aa button is clicked', () => {
    const onOpenSettings = vi.fn();
    const { container } = render(<CommentaryPane onOpenSettings={onOpenSettings} />);
    fireEvent.click(container.querySelector('.commentary-passage-header__settings')!);
    expect(onOpenSettings).toHaveBeenCalledWith('commentary-font');
  });

  // ---- Sync banners ------------------------------------------------------
  it('shows pinned-mismatch banner', () => {
    mockSyncStatus = 'pinned-mismatch';
    const { container } = render(<CommentaryPane />);
    expect(container.querySelector('.commentary-pinned-banner')).toBeTruthy();
  });

  it('shows preview-available banner', () => {
    mockSyncStatus = 'preview-available';
    const { container } = render(<CommentaryPane />);
    expect(container.querySelector('.commentary-selected-banner')).toBeTruthy();
  });

  it('does not show any banner when synced', () => {
    mockSyncStatus = 'synced';
    const { container } = render(<CommentaryPane />);
    expect(container.querySelector('.commentary-pinned-banner')).toBeNull();
    expect(container.querySelector('.commentary-selected-banner')).toBeNull();
  });

  // ---- "Add to tabs" bar -------------------------------------------------
  it('shows "add to tabs" bar for temporary tabs', () => {
    mockTabs = [{ id: 'ctab-home', moduleAbbr: 'MHC', moduleName: 'MHC', temporary: true }];
    mockActiveTabId = 'ctab-home';
    const { container } = render(<CommentaryPane />);
    expect(container.querySelector('.commentary-nav-bar__add')).toBeTruthy();
    expect(container.querySelector('.commentary-nav-bar__add')?.textContent).toContain('commentaryPane.addToTabs');
  });

  it('calls commentaryStore.keepTab when "add to tabs" button is clicked', () => {
    mockTabs = [{ id: 'ctab-tmp', moduleAbbr: 'MHC', moduleName: 'MHC', temporary: true }];
    mockActiveTabId = 'ctab-tmp';
    const { container } = render(<CommentaryPane />);
    fireEvent.click(container.querySelector('.commentary-nav-bar__add')!);
    expect(mockKeepTab).toHaveBeenCalledWith('ctab-tmp');
  });

  it('does not show "add to tabs" bar for non-temporary tabs', () => {
    mockTabs = [{ id: 'ctab-home', moduleAbbr: 'MHC', moduleName: 'MHC', temporary: false }];
    mockActiveTabId = 'ctab-home';
    const { container } = render(<CommentaryPane />);
    expect(container.querySelector('.commentary-nav-bar__add')).toBeNull();
  });
});
