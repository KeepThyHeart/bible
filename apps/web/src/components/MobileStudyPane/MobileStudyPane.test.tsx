/**
 * Component tests for MobileStudyPane.
 *
 * Pattern: Store-connected component with multiple child components and an
 * overlay.  All stores and heavy child components are mocked; useStore is
 * mocked to call the selector immediately.
 *
 * Tests cover: basic rendering, sync banners (pinned-mismatch,
 * preview-available), topics browser overlay open/close, and StudyVerseHeader
 * integration.
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
vi.mock('../StudyPane/StudyCrossRefs', () => ({
  StudyCrossRefs: () => <div data-testid="mock-study-cross-refs" />,
}));
vi.mock('../StudyPane/StudyHome', () => ({
  StudyHome: () => <div data-testid="mock-study-home" />,
}));
vi.mock('../StudyPane/StudyTopics', () => ({
  StudyTopics: () => <div data-testid="mock-study-topics" />,
}));
vi.mock('../StudyPane/TopicsBrowser', () => ({
  TopicsBrowser: () => <div data-testid="mock-topics-browser" />,
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
}));

vi.mock('../../constants', () => ({
  formatPassageRef: (book: number, chapter: number, verse: number | null) =>
    `${book}:${chapter}${verse ? ':' + verse : ''}`,
}));

// ---- Store state holders -------------------------------------------------
let mockVerseId: number | null = 43003016;
let mockBook: number | null = 43;
let mockChapter: number | null = 3;
let mockVerse: number | null = 16;
let mockVerseHistory: Array<{ verseId: number; timestamp: number }> = [];
let mockPinned = false;
// topicsBrowserOpen is read via getter in the mock, mutated here
const mockStudyState = { topicsBrowserOpen: false };
let mockPendingTopicNav: unknown = null;
let mockVerseTopics: unknown[] = [];
let mockVerseEntities: unknown[] = [];
let mockTopicsLoading = false;
let mockSyncStatus = 'synced';

const mockStudyStoreUnpin = vi.fn();
const mockStudyStorePin = vi.fn();
const mockLoadForVerse = vi.fn();
const mockOpenTopicsBrowser = vi.fn();
const mockCloseTopicsBrowser = vi.fn();
const mockConsumePendingTopicNav = vi.fn(() => null);

vi.mock('../../stores/studyStore', () => ({
  studyStore: {
    get verseId() { return mockVerseId; },
    get book() { return mockBook; },
    get chapter() { return mockChapter; },
    get verse() { return mockVerse; },
    get verseHistory() { return mockVerseHistory; },
    get pinned() { return mockPinned; },
    get pinnedBook() { return null; },
    get pinnedChapter() { return null; },
    get pinnedVerse() { return null; },
    get topicsBrowserOpen() { return mockStudyState.topicsBrowserOpen; },
    // The component's unmount effect does `studyStore.topicsBrowserOpen = false`
    set topicsBrowserOpen(v: boolean) { mockStudyState.topicsBrowserOpen = v; },
    get pendingTopicNav() { return mockPendingTopicNav; },
    get verseTopics() { return mockVerseTopics; },
    get verseEntities() { return mockVerseEntities; },
    get topicsLoading() { return mockTopicsLoading; },
    unpin: () => mockStudyStoreUnpin(),
    pin: () => mockStudyStorePin(),
    loadForVerse: (...args: unknown[]) => mockLoadForVerse(...args),
    openTopicsBrowser: (...args: unknown[]) => mockOpenTopicsBrowser(...args),
    closeTopicsBrowser: () => mockCloseTopicsBrowser(),
    consumePendingTopicNav: () => mockConsumePendingTopicNav(),
  },
}));

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => ({
      book: mockBook,
      chapter: mockChapter,
      studyVerse: mockVerseId,
    }),
    navigateTo: vi.fn(),
    navigateToPreview: vi.fn(),
    adoptPreviewAsStudy: vi.fn(),
  },
}));

vi.mock('../../stores/commentaryStore', () => ({
  HOME_TAB_ID: 'ctab-home',
  commentaryStore: {
    loadForChapter: vi.fn(),
  },
}));

vi.mock('../../utils/syncStatus', () => ({
  getSyncStatus: () => ({
    status: mockSyncStatus,
    currentLabel: 'John 3:16',
    syncLabel: 'John 3:17',
    syncVerseId: 43003017,
  }),
}));

import { MobileStudyPane } from './MobileStudyPane';

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

describe('MobileStudyPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerseId = 43003016;
    mockBook = 43;
    mockChapter = 3;
    mockVerse = 16;
    mockVerseHistory = [];
    mockPinned = false;
    mockStudyState.topicsBrowserOpen = false;
    mockPendingTopicNav = null;
    mockVerseTopics = [];
    mockVerseEntities = [];
    mockTopicsLoading = false;
    mockSyncStatus = 'synced';
  });

  // ---- Basic rendering ---------------------------------------------------
  it('renders the mobile-study-pane container', () => {
    const { container } = render(<MobileStudyPane providers={mockProviders} />);
    expect(container.querySelector('.mobile-study-pane')).toBeTruthy();
  });

  it('renders the study title', () => {
    const { container } = render(<MobileStudyPane providers={mockProviders} />);
    expect(container.querySelector('.mobile-study-pane__title')?.textContent).toContain('mobileStudyPane.study');
  });

  it('renders the StudyVerseHeader', () => {
    const { container } = render(<MobileStudyPane providers={mockProviders} />);
    expect(container.querySelector('[data-testid="mock-study-verse-header"]')).toBeTruthy();
  });

  it('renders the Cross-References section', () => {
    const { container } = render(<MobileStudyPane providers={mockProviders} />);
    expect(container.querySelector('[data-testid="mock-study-cross-refs"]')).toBeTruthy();
    expect(container.querySelector('.mobile-study-section__header')?.textContent).toContain('mobileStudyPane.crossReferences');
  });

  it('renders the Topics section', () => {
    const { container } = render(<MobileStudyPane providers={mockProviders} />);
    expect(container.querySelector('[data-testid="mock-study-topics"]')).toBeTruthy();
    expect(container.textContent).toContain('mobileStudyPane.topics');
  });

  it('renders the Interlinear section', () => {
    const { container } = render(<MobileStudyPane providers={mockProviders} />);
    expect(container.querySelector('[data-testid="mock-study-home"]')).toBeTruthy();
    expect(container.textContent).toContain('mobileStudyPane.interlinear');
  });

  it('renders "Browse All Topics" button', () => {
    const { container } = render(<MobileStudyPane providers={mockProviders} />);
    expect(container.querySelector('.mobile-study-section__browse-link')).toBeTruthy();
  });

  // ---- Sync banners -------------------------------------------------------
  it('shows pinned-mismatch banner when sync status is pinned-mismatch', () => {
    mockSyncStatus = 'pinned-mismatch';
    const { container } = render(<MobileStudyPane providers={mockProviders} />);
    expect(container.querySelector('.commentary-pinned-banner')).toBeTruthy();
  });

  it('shows preview-available banner when sync status is preview-available', () => {
    mockSyncStatus = 'preview-available';
    const { container } = render(<MobileStudyPane providers={mockProviders} />);
    expect(container.querySelector('.commentary-selected-banner')).toBeTruthy();
  });

  it('does not show any banner when sync status is synced', () => {
    mockSyncStatus = 'synced';
    const { container } = render(<MobileStudyPane providers={mockProviders} />);
    expect(container.querySelector('.commentary-pinned-banner')).toBeNull();
    expect(container.querySelector('.commentary-selected-banner')).toBeNull();
  });

  // ---- Topics browser overlay --------------------------------------------
  it('does not render topics overlay when topicsBrowserOpen is false', () => {
    const { container } = render(<MobileStudyPane providers={mockProviders} />);
    expect(container.querySelector('.mobile-topics-overlay')).toBeNull();
  });

  it('renders topics overlay when topicsBrowserOpen is true', () => {
    mockStudyState.topicsBrowserOpen = true;
    const { container } = render(<MobileStudyPane providers={mockProviders} />);
    expect(container.querySelector('.mobile-topics-overlay')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-topics-browser"]')).toBeTruthy();
  });

  it('shows topics browser title in overlay', () => {
    mockStudyState.topicsBrowserOpen = true;
    const { container } = render(<MobileStudyPane providers={mockProviders} />);
    expect(container.textContent).toContain('mobileStudyPane.topicsBrowser');
  });

  it('calls studyStore.closeTopicsBrowser when close button is clicked', () => {
    mockStudyState.topicsBrowserOpen = true;
    const { container } = render(<MobileStudyPane providers={mockProviders} />);
    const closeBtn = container.querySelector<HTMLButtonElement>('.mobile-topics-overlay__close')!;
    fireEvent.click(closeBtn);
    expect(mockCloseTopicsBrowser).toHaveBeenCalled();
  });

  it('calls studyStore.openTopicsBrowser when "Browse All Topics" is clicked', () => {
    const { container } = render(<MobileStudyPane providers={mockProviders} />);
    const browseBtn = container.querySelector('.mobile-study-section__browse-link')!;
    fireEvent.click(browseBtn);
    expect(mockOpenTopicsBrowser).toHaveBeenCalled();
  });

  // ---- Props passthrough -------------------------------------------------
  it('accepts optional callback props without throwing', () => {
    expect(() => render(
      <MobileStudyPane
        providers={mockProviders}
        onStrongsClick={vi.fn()}
        onStrongsHover={vi.fn()}
        onStrongsLeave={vi.fn()}
        onNavigateBible={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    )).not.toThrow();
  });
});
