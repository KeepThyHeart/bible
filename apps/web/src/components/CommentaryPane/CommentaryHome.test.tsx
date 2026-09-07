/**
 * Component tests for CommentaryHome.
 *
 * Pattern: Store-connected component with accordion modules list.
 * commentaryStore, bibleStore, and moduleStore are mocked.
 * useStore is mocked to call the selector immediately (no subscription).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import type { CommentaryHomeData } from '../../types';

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
vi.mock('./DigestDisclaimer', () => ({
  DigestDisclaimer: () => <div data-testid="mock-digest-disclaimer" />,
}));

vi.mock('../../hooks/useVersePopup', () => ({
  useVersePopup: () => ({ containerProps: {}, popupJsx: null }),
}));

// ---- External utility mocks ----------------------------------------------
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
}));

vi.mock('../../moduleDescriptions', () => ({
  isDigestModule: () => false,
  DIGEST_DISPLAY_NAME: 'Digest',
  DIGEST_DISCLAIMER: 'Auto-generated content',
}));

// Use a mutable container object so vi.mock hoisting can access it
const state = {
  homeData: null as CommentaryHomeData | null,
  homeLoading: false,
  syncedBook: 43 as number | null,
  syncedChapter: 3 as number | null,
  liveHighlightedVerse: 43003016 as number | null,
  tabs: [] as { id: string; moduleAbbr: string; moduleName: string; temporary?: boolean }[],
  pinned: false,
  pinnedVerse: null as number | null,
  pinnedBook: null as number | null,
  pinnedChapter: null as number | null,
  mutedModules: new Set<string>(),
  promotedModules: new Set<string>(),
};

const mocks = {
  loadHomeData: vi.fn(),
  // Rest parameter, not `() =>`: the store method is forwarded as
  // `(...args: unknown[]) => mocks.fetchModuleEntries(...args)`, and an
  // argument-less implementation narrows the mock to zero arity.
  fetchModuleEntries: vi.fn((..._args: unknown[]) => Promise.resolve([])),
  addTab: vi.fn(),
  toggleMuted: vi.fn(),
  togglePromoted: vi.fn(),
};

vi.mock('../../stores/commentaryStore', () => ({
  commentaryStore: {
    get homeData() { return state.homeData; },
    get homeLoading() { return state.homeLoading; },
    get syncedBook() { return state.syncedBook; },
    get syncedChapter() { return state.syncedChapter; },
    get tabs() { return state.tabs; },
    get pinned() { return state.pinned; },
    get pinnedVerse() { return state.pinnedVerse; },
    get pinnedBook() { return state.pinnedBook; },
    get pinnedChapter() { return state.pinnedChapter; },
    get mutedModules() { return state.mutedModules; },
    get promotedModules() { return state.promotedModules; },
    loadHomeData: (...args: unknown[]) => mocks.loadHomeData(...args),
    fetchModuleEntries: (...args: unknown[]) => mocks.fetchModuleEntries(...args),
    addTab: (...args: unknown[]) => mocks.addTab(...args),
    toggleMuted: (...args: unknown[]) => mocks.toggleMuted(...args),
    togglePromoted: (...args: unknown[]) => mocks.togglePromoted(...args),
    getContentFormat: () => 'html',
  },
}));

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => ({ studyVerse: state.liveHighlightedVerse }),
    getFirstVisibleVerseId: () => null,
    adoptPreviewAsStudy: vi.fn(),
  },
}));

vi.mock('../../stores/moduleStore', () => ({
  moduleStore: {
    getBookName: () => 'John',
  },
  getCommentaryPopularity: () => ({}),
}));

// ---- Component import (after mocks) -------------------------------------
import { CommentaryHome } from './CommentaryHome';

// ---- Helpers -------------------------------------------------------------
function makeHomeData(overrides: Partial<CommentaryHomeData> = {}): CommentaryHomeData {
  return {
    verseModules: [
      { moduleAbbr: 'MHC', moduleName: 'Matthew Henry Commentary', wordCount: 500 },
      { moduleAbbr: 'JFB', moduleName: 'Jamieson-Fausset-Brown', wordCount: 300 },
    ],
    chapterModules: [],
    passageModules: [],
    ...overrides,
  };
}

describe('CommentaryHome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.homeData = makeHomeData();
    state.homeLoading = false;
    state.syncedBook = 43;
    state.syncedChapter = 3;
    state.liveHighlightedVerse = 43003016;
    state.tabs = [];
    state.pinned = false;
    state.pinnedVerse = null;
    state.pinnedBook = null;
    state.pinnedChapter = null;
    state.mutedModules = new Set();
    state.promotedModules = new Set();
  });

  // ------------------------------------------------------------------
  // Empty / loading / no-sync states
  // ------------------------------------------------------------------
  it('shows empty state when no book/chapter is synced', () => {
    state.syncedBook = null;
    state.syncedChapter = null;
    const { container } = render(<CommentaryHome />);
    expect(container.querySelector('.commentary-content--empty')).toBeTruthy();
  });

  it('shows loading state when homeLoading is true', () => {
    state.homeLoading = true;
    state.homeData = null;
    const { container } = render(<CommentaryHome />);
    expect(container.querySelector('.commentary-content--loading')).toBeTruthy();
  });

  it('shows empty state when homeData is null', () => {
    state.homeData = null;
    const { container } = render(<CommentaryHome />);
    expect(container.querySelector('.commentary-content--empty')).toBeTruthy();
  });

  it('shows empty state when no verse, passage or chapter modules', () => {
    state.homeData = makeHomeData({ verseModules: [], passageModules: [], chapterModules: [] });
    state.homeLoading = false;
    const { container } = render(<CommentaryHome />);
    expect(container.querySelector('.commentary-content--empty')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Chapter-level commentaries
  //
  // Both the server and the client-side overview have always computed
  // `chapterModules`, and nothing rendered it — so a chapter-level commentary
  // like Matthew Henry was simply missing from the Overview while the tab
  // bar's "+" picker offered it and it opened fine as its own tab.
  // ------------------------------------------------------------------
  it('renders commentaries that cover the chapter but not the selected verse', () => {
    state.homeData = makeHomeData({
      verseModules: [],
      passageModules: [],
      chapterModules: [{ moduleAbbr: 'MHC', moduleName: 'Matthew Henry Commentary', wordCount: 4000 }],
    });
    const { container } = render(<CommentaryHome />);
    expect(container.querySelector('.commentary-content--empty')).toBeNull();
    expect(container.textContent).toContain('MHC');
  });

  it('does not render a chapter section when there are no chapter modules', () => {
    state.homeData = makeHomeData({ chapterModules: [] });
    const { container } = render(<CommentaryHome />);
    const titles = Array.from(container.querySelectorAll('.commentary-home__section-title'))
      .map(el => el.textContent ?? '');
    expect(titles.some(tt => tt.includes('Commentary on John 3'))).toBe(false);
  });

  it('hides a muted chapter-level commentary', () => {
    state.mutedModules = new Set(['MHC']);
    state.homeData = makeHomeData({
      verseModules: [{ moduleAbbr: 'JFB', moduleName: 'Jamieson-Fausset-Brown', wordCount: 300 }],
      chapterModules: [{ moduleAbbr: 'MHC', moduleName: 'Matthew Henry Commentary', wordCount: 4000 }],
    });
    const { container } = render(<CommentaryHome />);
    const visible = container.querySelectorAll('.commentary-home__section:not(.commentary-home__section--muted) .commentary-home__item-module');
    expect(Array.from(visible).map(el => el.textContent)).not.toContain('MHC');
  });

  // ------------------------------------------------------------------
  // Module list rendering
  // ------------------------------------------------------------------
  it('renders the commentary home container', () => {
    const { container } = render(<CommentaryHome />);
    expect(container.querySelector('.commentary-home')).toBeTruthy();
  });

  it('renders module items for each verse module', () => {
    const { container } = render(<CommentaryHome />);
    const items = container.querySelectorAll('.commentary-home__list-item');
    expect(items.length).toBe(2);
  });

  it('renders module abbreviations', () => {
    render(<CommentaryHome />);
    expect(screen.getByText('MHC')).toBeTruthy();
    expect(screen.getByText('JFB')).toBeTruthy();
  });

  it('shows word count bars', () => {
    const { container } = render(<CommentaryHome />);
    const bars = container.querySelectorAll('.commentary-home__item-bar');
    expect(bars.length).toBeGreaterThan(0);
  });

  // ------------------------------------------------------------------
  // Filter input
  // ------------------------------------------------------------------
  it('renders the filter input', () => {
    const { container } = render(<CommentaryHome />);
    expect(container.querySelector('.commentary-home__filter-input')).toBeTruthy();
  });

  it('filters modules when typing in the filter input', () => {
    const { container } = render(<CommentaryHome />);
    const input = container.querySelector<HTMLInputElement>('.commentary-home__filter-input')!;
    fireEvent.input(input, { target: { value: 'MHC' } });
    const items = container.querySelectorAll('.commentary-home__list-item');
    expect(items.length).toBe(1);
    expect(screen.getByText('MHC')).toBeTruthy();
  });

  it('shows no-match message when filter has no results', () => {
    const { container } = render(<CommentaryHome />);
    const input = container.querySelector<HTMLInputElement>('.commentary-home__filter-input')!;
    fireEvent.input(input, { target: { value: 'ZZZNOMATCH' } });
    expect(container.querySelector('.commentary-content--empty')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Sort button
  // ------------------------------------------------------------------
  it('renders the sort button', () => {
    const { container } = render(<CommentaryHome />);
    expect(container.querySelector('.commentary-home__sort-btn')).toBeTruthy();
  });

  it('opens the sort menu when the sort button is clicked', () => {
    const { container } = render(<CommentaryHome />);
    fireEvent.click(container.querySelector('.commentary-home__sort-btn')!);
    expect(container.querySelector('.commentary-home__sort-menu')).toBeTruthy();
  });

  it('changes sort mode when a sort option is clicked', () => {
    const { container } = render(<CommentaryHome />);
    fireEvent.click(container.querySelector('.commentary-home__sort-btn')!);
    const alphaOption = Array.from(container.querySelectorAll<HTMLElement>('.commentary-home__sort-option'))
      .find(b => b.textContent?.includes('A-Z'));
    if (alphaOption) {
      fireEvent.click(alphaOption);
      // Menu should close
      expect(container.querySelector('.commentary-home__sort-menu')).toBeNull();
    }
  });

  // ------------------------------------------------------------------
  // Expand / collapse accordion
  // ------------------------------------------------------------------
  it('does not show expanded content initially', () => {
    const { container } = render(<CommentaryHome />);
    expect(container.querySelector('.commentary-home__inline-content')).toBeNull();
  });

  it('shows chevron-right icon when collapsed', () => {
    const { container } = render(<CommentaryHome />);
    expect(container.querySelector('.fa-chevron-right')).toBeTruthy();
  });

  it('calls fetchModuleEntries when a module item is clicked', async () => {
    const { container } = render(<CommentaryHome />);
    const item = container.querySelector<HTMLElement>('.commentary-home__list-item')!;
    fireEvent.click(item);
    expect(mocks.fetchModuleEntries).toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Muted modules
  // ------------------------------------------------------------------
  it('hides muted modules from the main list', () => {
    state.mutedModules = new Set(['MHC']);
    const { container } = render(<CommentaryHome />);
    const items = container.querySelectorAll('.commentary-home__list-item');
    // Only JFB should be visible in main list
    expect(items.length).toBe(1);
  });

  it('shows muted section when there are muted modules', () => {
    state.mutedModules = new Set(['MHC']);
    const { container } = render(<CommentaryHome />);
    expect(container.querySelector('.commentary-home__section--muted')).toBeTruthy();
  });

  it('toggles showing muted modules when the muted section header is clicked', () => {
    state.mutedModules = new Set(['MHC']);
    const { container } = render(<CommentaryHome />);
    const mutedHeader = container.querySelector<HTMLElement>(
      '.commentary-home__section-title--muted'
    )!;
    fireEvent.click(mutedHeader);
    // After click, muted items should be visible
    const allItems = container.querySelectorAll('.commentary-home__list-item');
    expect(allItems.length).toBeGreaterThan(1);
  });

  // ------------------------------------------------------------------
  // Star (promote) button
  // ------------------------------------------------------------------
  it('calls togglePromoted when the star icon is clicked', () => {
    const { container } = render(<CommentaryHome />);
    const starIcon = container.querySelector<HTMLElement>('.commentary-home__item-star')!;
    fireEvent.click(starIcon);
    expect(mocks.togglePromoted).toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Passage modules section
  // ------------------------------------------------------------------
  it('renders the passage section when there are passage modules', () => {
    state.homeData = makeHomeData({
      passageModules: [{ moduleAbbr: 'PSGMOD', moduleName: 'Passage Module', wordCount: 100 }],
    });
    const { container } = render(<CommentaryHome />);
    expect(screen.getByText('Commentary on Passage')).toBeTruthy();
  });
});
