/**
 * Component tests for CommentaryContent.
 *
 * Pattern: Store-connected component with multiple conditional rendering branches.
 * commentaryStore, bibleStore, moduleStore, and settingsStore are mocked.
 * useStore is mocked to call the selector immediately (no subscription).
 * State is kept in a mutable container to avoid vi.mock hoisting TDZ issues.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import type { CommentaryEntryData } from '../../types';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ---- Store mock ----------------------------------------------------------
vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

// ---- Child mocks ---------------------------------------------------------
vi.mock('./CommentaryHome', () => ({
  CommentaryHome: () => <div data-testid="mock-commentary-home" />,
}));

vi.mock('./DigestDisclaimer', () => ({
  DigestDisclaimer: () => <div data-testid="mock-digest-disclaimer" />,
}));

vi.mock('../../hooks/useVersePopup', () => ({
  useVersePopup: () => ({ containerProps: {}, popupJsx: null }),
}));

vi.mock('../../../../../packages/core/src/Services/CommentaryLinkProcessor', () => ({
  processCommentaryLinks: (html: string) => html,
}));

vi.mock('../../utils/markdownRenderer', () => ({
  renderMarkdownToHtml: (md: string) => md,
}));

vi.mock('../../utils/verseId', () => ({
  parseVerseId: (id: number) => ({
    bookNumber: Math.floor(id / 1000000),
    chapter: Math.floor((id % 1000000) / 1000),
    verse: id % 1000,
  }),
  formatVerseRange: (start: number) => `v${start % 1000}`,
  isTskModule: () => false,
}));

vi.mock('../../utils/commentaryEntries', () => ({
  filterCommentaryEntries: (_entries: CommentaryEntryData[], _verse: number | null) => ({
    verse: [],
    passage: [],
  }),
}));

vi.mock('../../moduleDescriptions', () => ({
  isDigestModule: () => false,
  DIGEST_DISCLAIMER: 'Auto-generated',
  getModuleDisclaimer: () => undefined,
}));

// Use mutable container objects to avoid vi.mock hoisting TDZ issues
const state = {
  entries: [] as CommentaryEntryData[],
  loading: false,
  syncedBook: 43 as number | null,
  syncedChapter: 3 as number | null,
  tabs: [] as { id: string; moduleAbbr: string; moduleName: string; temporary?: boolean; pinned?: boolean; pinnedBook?: number | null; pinnedChapter?: number | null; pinnedVerse?: number | null }[],
  activeTabId: 'ctab-home',
  liveHighlightedVerse: 43003016 as number | null,
  pinned: false,
  pinnedVerse: null as number | null,
  overrideVerse: null as number | null,
  showCommentaryOverview: true,
};

vi.mock('../../stores/commentaryStore', () => ({
  HOME_TAB_ID: 'ctab-home',
  commentaryStore: {
    get entries() { return state.entries; },
    get loading() { return state.loading; },
    get syncedBook() { return state.syncedBook; },
    get syncedChapter() { return state.syncedChapter; },
    get tabs() { return state.tabs; },
    get activeTabId() { return state.activeTabId; },
    get pinned() { return state.pinned; },
    get pinnedVerse() { return state.pinnedVerse; },
    get overrideVerse() { return state.overrideVerse; },
    get chapterVersesCache() { return new Map<string, number[]>(); },
    setOverrideVerse: vi.fn(),
    loadChapterVerses: vi.fn(),
    getContentFormat: () => 'html',
    setActiveTab: vi.fn(),
    unpin: vi.fn(),
    loadForChapter: vi.fn(),
    openTemporaryTab: vi.fn(),
    loadHomeData: vi.fn(),
    homeData: null,
    getModuleInfo: vi.fn(() => Promise.resolve(null)),
  },
}));

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => ({ studyVerse: state.liveHighlightedVerse, book: 43, chapter: 3, previewVerse: null }),
    getFirstVisibleVerseId: () => null,
    adoptPreviewAsStudy: vi.fn(),
    scrollToVerse: vi.fn(),
    setActiveTab: vi.fn(),
  },
}));

vi.mock('../../stores/moduleStore', () => ({
  moduleStore: {
    getBookName: () => 'John',
  },
}));

vi.mock('../../stores/settingsStore', () => ({
  settingsStore: {
    get showCommentaryOverview() { return state.showCommentaryOverview; },
  },
}));

// ---- Component import (after mocks) -------------------------------------
import { CommentaryContent, CommentaryAbout } from './CommentaryContent';
import { commentaryStore } from '../../stores/commentaryStore';

describe('CommentaryContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.entries = [];
    state.loading = false;
    state.syncedBook = 43;
    state.syncedChapter = 3;
    state.tabs = [];
    state.activeTabId = 'ctab-home';
    state.liveHighlightedVerse = 43003016;
    state.pinned = false;
    state.pinnedVerse = null;
    state.overrideVerse = null;
    state.showCommentaryOverview = true;
  });

  // ------------------------------------------------------------------
  // Home tab rendering
  // ------------------------------------------------------------------
  it('renders the CommentaryHome when home tab is active and overview is enabled', () => {
    render(<CommentaryContent />);
    expect(screen.getByTestId('mock-commentary-home')).toBeTruthy();
  });

  it('does not render CommentaryHome when overview is disabled', () => {
    state.showCommentaryOverview = false;
    state.tabs = [];
    render(<CommentaryContent />);
    // No home mock
    expect(screen.queryByTestId('mock-commentary-home')).toBeNull();
  });

  // ------------------------------------------------------------------
  // No tabs selected state
  // ------------------------------------------------------------------
  it('shows empty state when no non-home tabs are present', () => {
    state.activeTabId = 'ctab-other';
    state.tabs = [];
    const { container } = render(<CommentaryContent />);
    expect(container.querySelector('.commentary-content--empty')).toBeTruthy();
  });

  it('shows "noSelected" message when no tabs are added', () => {
    state.activeTabId = 'ctab-other';
    state.tabs = [];
    render(<CommentaryContent />);
    expect(screen.getByText('commentaryContent.noSelected')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Loading state
  // ------------------------------------------------------------------
  it('shows loading spinner when loading is true', () => {
    state.activeTabId = 'ctab-other';
    state.tabs = [{ id: 'ctab-other', moduleAbbr: 'MHC', moduleName: 'Matthew Henry' }];
    state.loading = true;
    const { container } = render(<CommentaryContent />);
    expect(container.querySelector('.commentary-content--loading')).toBeTruthy();
  });

  it('shows loading text when loading', () => {
    state.activeTabId = 'ctab-other';
    state.tabs = [{ id: 'ctab-other', moduleAbbr: 'MHC', moduleName: 'Matthew Henry' }];
    state.loading = true;
    render(<CommentaryContent />);
    expect(screen.getByText('commentaryContent.loading')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // No passage synced
  // ------------------------------------------------------------------
  it('shows navigate-to-passage message when no book/chapter is synced', () => {
    state.activeTabId = 'ctab-other';
    state.tabs = [{ id: 'ctab-other', moduleAbbr: 'MHC', moduleName: 'Matthew Henry' }];
    state.syncedBook = null;
    state.syncedChapter = null;
    render(<CommentaryContent />);
    expect(screen.getByText('commentaryContent.navigateToPassage')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // No verse selected / select prompt
  // ------------------------------------------------------------------
  it('shows select-verse prompt when entries are empty and no verse highlighted', () => {
    state.activeTabId = 'ctab-other';
    state.tabs = [{ id: 'ctab-other', moduleAbbr: 'MHC', moduleName: 'Matthew Henry' }];
    state.liveHighlightedVerse = null;
    render(<CommentaryContent />);
    expect(screen.getByText('commentaryContent.selectVerseToSeeCommentary')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Empty verse state (verse highlighted but no content)
  // ------------------------------------------------------------------
  it('shows no-commentary message when entries are empty but verse is highlighted', () => {
    state.activeTabId = 'ctab-other';
    state.tabs = [{ id: 'ctab-other', moduleAbbr: 'MHC', moduleName: 'Matthew Henry' }];
    state.liveHighlightedVerse = 43003016;
    render(<CommentaryContent />);
    // CommentaryEmptyVerse shows "noCommentary"
    expect(screen.getByText(/commentaryContent\.noCommentary/)).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Content wrapper is rendered
  // ------------------------------------------------------------------
  it('renders the commentary content wrapper', () => {
    state.activeTabId = 'ctab-other';
    state.tabs = [{ id: 'ctab-other', moduleAbbr: 'MHC', moduleName: 'Matthew Henry' }];
    const { container } = render(<CommentaryContent />);
    expect(container.querySelector('.commentary-content')).toBeTruthy();
  });
});

describe('CommentaryAbout', () => {
  const baseInfo = {
    abbreviation: 'MHC', fullName: 'Matthew Henry', author: null, yearPublished: null, version: null,
    languageCode: 'en', copyright: 'Public domain', description: null, publisher: null, createdDate: null,
  };

  it('shows copyright, license, attribution and source on separate lines', async () => {
    vi.mocked(commentaryStore.getModuleInfo).mockResolvedValueOnce({
      ...baseInfo,
      licenseSpdx: 'PD',
      licenseUrl: 'https://example.com/pd',
      sourceUrl: 'https://crosswire.org/sword/',
      attribution: 'Converted from the SWORD module "MHC" (version 1), distributed by the CrossWire Bible Society (crosswire.org).',
    });
    render(<CommentaryAbout moduleAbbr="MHC" />);
    fireEvent.click(screen.getByText('commentaryContent.about'));
    await waitFor(() => expect(screen.getByText('commentaryContent.aboutCopyright')).toBeTruthy());
    expect(screen.getByText('Public domain')).toBeTruthy();
    expect(screen.getByText('commentaryContent.aboutLicense')).toBeTruthy();
    expect(screen.getByText('PD').closest('a')?.getAttribute('href')).toBe('https://example.com/pd');
    expect(screen.getByTestId('commentary-about-attribution').textContent).toContain('CrossWire Bible Society');
    expect(screen.getByText('https://crosswire.org/sword/').closest('a')).toBeTruthy();
  });

  it('omits license, attribution and source when the module has none', async () => {
    vi.mocked(commentaryStore.getModuleInfo).mockResolvedValueOnce({ ...baseInfo, licenseSpdx: null, licenseUrl: null, sourceUrl: null, attribution: null });
    render(<CommentaryAbout moduleAbbr="MHC" />);
    fireEvent.click(screen.getByText('commentaryContent.about'));
    await waitFor(() => expect(screen.getByText('commentaryContent.aboutCopyright')).toBeTruthy());
    expect(screen.queryByText('commentaryContent.aboutLicense')).toBeNull();
    expect(screen.queryByTestId('commentary-about-attribution')).toBeNull();
    expect(screen.queryByText('commentaryContent.aboutSource')).toBeNull();
  });
});
