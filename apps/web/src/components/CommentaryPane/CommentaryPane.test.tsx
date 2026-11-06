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
const mockScrollToVerse = vi.fn();
let mockTabVerses: { verse_id: number }[] = [];
let mockTabBook: number | null | undefined;
let mockTabChapter: number | null | undefined;
const mockKeepTab = vi.fn();
const mockSyncCommentaryToSelection = vi.fn();

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
    // A mounted Commentary view is what tells the store a chapter change is
    // worth spending requests on.
    viewMounted: vi.fn(),
  },
}));

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => ({
      book: mockTabBook === undefined ? mockSyncedBook : mockTabBook,
      chapter: mockTabChapter === undefined ? mockSyncedChapter : mockTabChapter,
      studyVerse: mockStudyVerse,
      previewVerse: mockPreviewVerse,
      verses: mockTabVerses,
    }),
    scrollToVerse: (id: number) => mockScrollToVerse(id),
    adoptPreviewAsStudy: (id: number) => mockAdoptPreviewAsStudy(id),
    navigateTo: (...args: unknown[]) => mockNavigateTo(...args),
    syncCommentaryToSelection: () => mockSyncCommentaryToSelection(),
  },
}));

// W-050: the header must use the UI-localized book name (same formatter as the Bible pane), not the
// Bible module's own (English) book_name that moduleStore.getBookName prefers.
let mockLocalizedBook = 'John';
vi.mock('../../utils/bookNames', () => ({
  getLocalizedBookName: (n: number) => (n === 43 ? mockLocalizedBook : `Book${n}`),
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


// The text-size popover has its own tests; here it only has to be present and wired.
vi.mock('../common/TextSizeButton', async () => {
  const { h } = await import('preact');
  return {
    TextSizeButton: ({ target, className, onMoreOptions }: { target: string; className?: string; onMoreOptions?: () => void }) =>
      h('button', { class: className, 'data-testid': `text-size-btn-${target}`, onClick: () => onMoreOptions?.() }, 'size'),
  };
});

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

  // ---- Syncing to the Bible tab's selected verse on open -------------------
  // Opening the pane after a Bible tab switch used to show "Select a verse"
  // because nothing told the commentary the selection had moved.
  it('syncs the commentary to the Bible selection when it opens', () => {
    render(<CommentaryPane />);
    expect(mockSyncCommentaryToSelection).toHaveBeenCalledTimes(1);
  });

  it('does not sync while collapsed', () => {
    mockCollapsed = true;
    render(<CommentaryPane />);
    expect(mockSyncCommentaryToSelection).not.toHaveBeenCalled();
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

  it('W-050: the passage header uses the localized book name, not the module\'s English one', () => {
    mockLocalizedBook = 'יוחנן';
    try {
      const { container } = render(<CommentaryPane />);
      const label = container.querySelector('.commentary-passage-header__label')?.textContent ?? '';
      expect(label).toContain('יוחנן');
      expect(label).not.toContain('John');
    } finally {
      mockLocalizedBook = 'John';
    }
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

  describe('verse navigation across chapters', () => {
    const chapterOf = (book: number, chapter: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({ verse_id: book * 1000000 + chapter * 1000 + i + 1 }));
    const clickNav = async (i: number) => {
      const { container } = render(<CommentaryPane />);
      fireEvent.click(container.querySelectorAll<HTMLButtonElement>('.commentary-passage-header__nav')[i]);
      await Promise.resolve(); await Promise.resolve();
    };

    beforeEach(() => {
      mockSetOverrideVerse.mockClear(); mockAdoptPreviewAsStudy.mockClear();
      mockNavigateTo.mockClear(); mockScrollToVerse.mockClear();
      mockTabVerses = chapterOf(43, 3, 36);
    });

    it('Next on the last verse of a chapter goes to verse 1 of the next chapter', async () => {
      mockStudyVerse = 43003036;
      await clickNav(1);
      expect(mockNavigateTo).toHaveBeenCalledWith(43, 4);
      expect(mockSetOverrideVerse).toHaveBeenCalledWith(43004001);
      expect(mockAdoptPreviewAsStudy).toHaveBeenCalledWith(43004001);
      expect(mockScrollToVerse).toHaveBeenCalledWith(43004001);
    });

    it('Next on the last verse of a book\'s last chapter goes to the next book', async () => {
      mockSyncedBook = 43; mockSyncedChapter = 22; mockStudyVerse = 43022025;
      mockTabVerses = chapterOf(43, 22, 25);
      await clickNav(1);
      expect(mockNavigateTo).toHaveBeenCalledWith(44, 1);
      expect(mockSetOverrideVerse).toHaveBeenCalledWith(44001001);
    });

    it('Next inside a chapter stays in it and scrolls to the verse', async () => {
      mockStudyVerse = 43003016;
      await clickNav(1);
      expect(mockNavigateTo).not.toHaveBeenCalled();
      expect(mockSetOverrideVerse).toHaveBeenCalledWith(43003017);
      expect(mockScrollToVerse).toHaveBeenCalledWith(43003017);
    });

    it('Previous from a first verse lands on the previous chapter\'s last verse and scrolls to it', async () => {
      mockStudyVerse = 43003001;
      mockNavigateTo.mockImplementationOnce(async () => { mockTabVerses = chapterOf(43, 2, 25); });
      await clickNav(0);
      expect(mockNavigateTo).toHaveBeenCalledWith(43, 2);
      expect(mockSetOverrideVerse).toHaveBeenCalledWith(43002025);
      expect(mockAdoptPreviewAsStudy).toHaveBeenCalledWith(43002025);
      expect(mockScrollToVerse).toHaveBeenCalledWith(43002025);
    });
  });

  // ---- Settings button ---------------------------------------------------
  it('renders the text-size button, with or without a Settings handler', () => {
    const { container, unmount } = render(<CommentaryPane onOpenSettings={vi.fn()} />);
    expect(container.querySelector('[data-testid="text-size-btn-study"]')).toBeTruthy();
    unmount();
    const second = render(<CommentaryPane />);
    expect(second.container.querySelector('[data-testid="text-size-btn-study"]')).toBeTruthy();
  });

  it('opens Settings at "commentary-font" from the text-size popover\'s more-options link', () => {
    const onOpenSettings = vi.fn();
    const { container } = render(<CommentaryPane onOpenSettings={onOpenSettings} />);
    fireEvent.click(container.querySelector('[data-testid="text-size-btn-study"]')!);
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
