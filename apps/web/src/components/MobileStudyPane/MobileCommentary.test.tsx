/**
 * Component tests for MobileCommentary and MobileCommentaryDetail.
 *
 * Pattern: Store-connected component with complex multi-store dependencies.
 * All stores (commentaryStore, bibleStore, studyStore, offlineStore) and
 * side-effect hooks (useVersePopup) are mocked. useStore is mocked to call
 * the selector immediately. Child components with heavy deps are also mocked.
 *
 * Tests cover: card list rendering, filter, star/mute actions, module detail
 * navigation, loading/offline/empty states, and MobileCommentaryDetail.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && 'verse' in opts) return `${key}:${opts.verse}`;
      return key;
    },
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ---- useStore shim -------------------------------------------------------
vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

// ---- useVersePopup mock --------------------------------------------------
vi.mock('../../hooks/useVersePopup', () => ({
  useVersePopup: () => ({
    containerProps: { onClick: vi.fn(), onMouseOver: vi.fn(), onMouseOut: vi.fn() },
    popupJsx: null,
  }),
}));

// ---- Child component mocks -----------------------------------------------
vi.mock('../CommentaryPane/DigestDisclaimer', () => ({
  DigestDisclaimer: () => <div data-testid="mock-digest-disclaimer" />,
}));
vi.mock('../CommentaryPane/CommentaryContent', () => ({
  CommentaryAbout: () => <div data-testid="mock-commentary-about" />,
}));

// ---- Module descriptions -------------------------------------------------
vi.mock('../../moduleDescriptions', () => ({
  isDigestModule: (abbr: string) => abbr === 'SYNTHESIS',
  getDigestDisplayName: () => 'Combined Summary',
  getDigestDisclaimer: () => 'Auto-generated',
}));

// ---- Utility mocks -------------------------------------------------------
vi.mock('../../utils/verseId', () => ({
  parseVerseId: (id: number) => ({
    bookNumber: Math.floor(id / 1000000),
    chapter: Math.floor((id % 1000000) / 1000),
    verse: id % 1000,
  }),
  formatVerseRange: (start: number, end: number) => `${start}-${end}`,
  isTskModule: () => false,
}));
vi.mock('../../utils/commentaryEntries', () => ({
  filterCommentaryEntries: (_entries: unknown[], _verse: unknown) => ({
    verse: [],
    passage: [],
  }),
}));
vi.mock('../../utils/markdownRenderer', () => ({
  renderMarkdownToHtml: (s: string) => s,
}));
vi.mock('../../../../../packages/core/src/Services/CommentaryLinkProcessor', () => ({
  processCommentaryLinks: (html: string) => html,
}));

// ---- Store state holders -------------------------------------------------
let mockHomeData: {
  verseModules?: { moduleAbbr: string; moduleName: string; wordCount: number }[];
  passageModules?: { moduleAbbr: string; moduleName: string; wordCount: number }[];
  chapterModules?: { moduleAbbr: string; moduleName: string; wordCount: number }[];
} | null = null;
let mockHomeLoading = false;
let mockIsOnline = true;
let mockPromoted: Set<string> = new Set();
let mockMuted: Set<string> = new Set();
let mockSyncedBook: number | null = 43;
let mockSyncedChapter: number | null = 3;
let mockStudyVerseId: number | null = 43003016;
let mockStudyBook: number | null = 43;
let mockStudyChapter: number | null = 3;
let mockMobileSelectedCommentary: { abbr: string; name: string } | null = null;

const mockTogglePromoted = vi.fn();
const mockToggleMuted = vi.fn();
const mockLoadHomeData = vi.fn();
const mockPrefetchAllEntries = vi.fn();
const mockFetchModuleEntries = vi.fn().mockResolvedValue([]);
const mockSetOverrideVerse = vi.fn();
const mockAdoptPreviewAsStudy = vi.fn();
const mockScrollToVerse = vi.fn();

vi.mock('../../stores/commentaryStore', () => ({
  HOME_TAB_ID: 'ctab-home',
  commentaryStore: {
    get homeData() { return mockHomeData; },
    get homeLoading() { return mockHomeLoading; },
    get promotedModules() { return mockPromoted; },
    get mutedModules() { return mockMuted; },
    get syncedBook() { return mockSyncedBook; },
    get syncedChapter() { return mockSyncedChapter; },
    get contentFormatByModule() { return new Map(); },
    get entriesByTab() { return new Map(); },
    togglePromoted: (abbr: string) => mockTogglePromoted(abbr),
    toggleMuted: (abbr: string) => mockToggleMuted(abbr),
    loadHomeData: (...args: unknown[]) => mockLoadHomeData(...args),
    prefetchAllEntries: (...args: unknown[]) => mockPrefetchAllEntries(...args),
    fetchModuleEntries: (...args: unknown[]) => mockFetchModuleEntries(...args),
    setOverrideVerse: (id: number) => mockSetOverrideVerse(id),
    get mobileSelectedCommentary() { return mockMobileSelectedCommentary; },
    setMobileSelectedCommentary: vi.fn(),
  },
}));

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => ({
      book: 43,
      chapter: 3,
      studyVerse: 43003016,
    }),
    adoptPreviewAsStudy: (id: number) => mockAdoptPreviewAsStudy(id),
    scrollToVerse: (id: number) => mockScrollToVerse(id),
  },
}));

vi.mock('../../stores/studyStore', () => ({
  studyStore: {
    get verseId() { return mockStudyVerseId; },
    get book() { return mockStudyBook; },
    get chapter() { return mockStudyChapter; },
  },
}));

vi.mock('../../stores/offlineStore', () => ({
  offlineStore: {
    get isOnline() { return mockIsOnline; },
  },
}));

import { MobileCommentary, MobileCommentaryDetail } from './MobileCommentary';

// ---- Helpers -------------------------------------------------------------
function makeModule(abbr: string, name = abbr + ' Commentary', wordCount = 500) {
  return { moduleAbbr: abbr, moduleName: name, wordCount };
}

describe('MobileCommentary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHomeData = null;
    mockHomeLoading = false;
    mockIsOnline = true;
    mockPromoted = new Set();
    mockMuted = new Set();
    mockSyncedBook = 43;
    mockSyncedChapter = 3;
    mockStudyVerseId = 43003016;
    mockStudyBook = 43;
    mockStudyChapter = 3;
    mockMobileSelectedCommentary = null;
    mockFetchModuleEntries.mockResolvedValue([]);
    mockLoadHomeData.mockResolvedValue(undefined);
    mockPrefetchAllEntries.mockResolvedValue(undefined);
  });

  // ---- Basic rendering ---------------------------------------------------
  it('renders the filter bar', () => {
    const { container } = render(<MobileCommentary />);
    expect(container.querySelector('.mobile-commentary__filter-bar')).toBeTruthy();
    expect(container.querySelector('.mobile-commentary__filter-input')).toBeTruthy();
  });

  it('shows loading state when homeLoading is true and no cards', () => {
    mockHomeLoading = true;
    render(<MobileCommentary />);
    expect(screen.getByText('mobileCommentary.loading')).toBeTruthy();
  });

  it('shows offline notice when offline and no cards', () => {
    mockIsOnline = false;
    render(<MobileCommentary />);
    expect(screen.getByText('mobileCommentary.offlineNotice')).toBeTruthy();
  });

  it('shows no-available message when online, not loading, and no cards', () => {
    render(<MobileCommentary />);
    expect(screen.getByText('mobileCommentary.noAvailable')).toBeTruthy();
  });

  // ---- Card rendering ----------------------------------------------------
  it('renders commentary cards when homeData has modules', () => {
    mockHomeData = {
      verseModules: [makeModule('MHC')],
      passageModules: [makeModule('Barnes')],
      chapterModules: [],
    };
    const { container } = render(<MobileCommentary />);
    expect(container.querySelectorAll('.mobile-commentary__card').length).toBeGreaterThanOrEqual(2);
  });

  it('shows module abbreviation in card header', () => {
    mockHomeData = { verseModules: [makeModule('MHC', 'Matthew Henry Commentary')], passageModules: [], chapterModules: [] };
    render(<MobileCommentary />);
    expect(screen.getByText('MHC')).toBeTruthy();
  });

  it('shows word count when wordCount > 0', () => {
    mockHomeData = { verseModules: [makeModule('MHC', 'MHC', 1234)], passageModules: [], chapterModules: [] };
    const { container } = render(<MobileCommentary />);
    // Word count should be rendered with toLocaleString
    expect(container.querySelector('.mobile-commentary__card-words')).toBeTruthy();
  });

  it('uses DIGEST_DISPLAY_NAME for the SYNTHESIS module', () => {
    mockHomeData = { verseModules: [makeModule('SYNTHESIS')], passageModules: [], chapterModules: [] };
    render(<MobileCommentary />);
    expect(screen.getByText('Combined Summary')).toBeTruthy();
  });

  // ---- Section labels ----------------------------------------------------
  it('renders starred section when promoted modules exist', () => {
    mockPromoted = new Set(['MHC']);
    mockHomeData = { verseModules: [makeModule('MHC')], passageModules: [], chapterModules: [] };
    render(<MobileCommentary />);
    expect(screen.getByText('mobileCommentary.starred')).toBeTruthy();
  });

  it('renders muted section when muted modules exist', () => {
    mockMuted = new Set(['Barnes']);
    mockHomeData = { passageModules: [makeModule('Barnes')], verseModules: [], chapterModules: [] };
    render(<MobileCommentary />);
    expect(screen.getByText('mobileCommentary.muted')).toBeTruthy();
  });

  // ---- Filter ------------------------------------------------------------
  it('shows clear button when filter text is entered', () => {
    mockHomeData = { verseModules: [makeModule('MHC')], passageModules: [], chapterModules: [] };
    const { container } = render(<MobileCommentary />);
    const input = container.querySelector<HTMLInputElement>('.mobile-commentary__filter-input')!;
    fireEvent.input(input, { target: { value: 'MHC' } });
    expect(container.querySelector('.mobile-commentary__filter-clear')).toBeTruthy();
  });

  it('clears the filter when clear button is clicked', () => {
    mockHomeData = { verseModules: [makeModule('MHC')], passageModules: [], chapterModules: [] };
    const { container } = render(<MobileCommentary />);
    const input = container.querySelector<HTMLInputElement>('.mobile-commentary__filter-input')!;
    fireEvent.input(input, { target: { value: 'MHC' } });
    const clearBtn = container.querySelector('.mobile-commentary__filter-clear')!;
    fireEvent.click(clearBtn);
    // Input should be cleared
    expect((container.querySelector('.mobile-commentary__filter-input') as HTMLInputElement).value).toBe('');
  });

  it('shows no-matching message when filter has no results', () => {
    mockHomeData = { verseModules: [makeModule('MHC')], passageModules: [], chapterModules: [] };
    const { container } = render(<MobileCommentary />);
    const input = container.querySelector<HTMLInputElement>('.mobile-commentary__filter-input')!;
    fireEvent.input(input, { target: { value: 'ZZZNOMATCH' } });
    expect(screen.getByText('mobileCommentary.noMatching')).toBeTruthy();
  });

  // ---- Star/Mute actions -------------------------------------------------
  it('calls commentaryStore.togglePromoted when star button is clicked', () => {
    mockHomeData = { verseModules: [makeModule('MHC')], passageModules: [], chapterModules: [] };
    const { container } = render(<MobileCommentary />);
    const starBtn = container.querySelector<HTMLButtonElement>(
      '[title="mobileCommentary.star"]',
    )!;
    expect(starBtn).toBeTruthy();
    fireEvent.click(starBtn);
    expect(mockTogglePromoted).toHaveBeenCalledWith('MHC');
  });

  it('calls commentaryStore.toggleMuted when mute button is clicked', () => {
    mockHomeData = { verseModules: [makeModule('MHC')], passageModules: [], chapterModules: [] };
    const { container } = render(<MobileCommentary />);
    const muteBtn = container.querySelector<HTMLButtonElement>(
      '[title="mobileCommentary.mute"]',
    )!;
    expect(muteBtn).toBeTruthy();
    fireEvent.click(muteBtn);
    expect(mockToggleMuted).toHaveBeenCalledWith('MHC');
  });

  // ---- Detail view navigation -------------------------------------------
  it('renders MobileCommentaryDetail when viewingModule is set', () => {
    const { container } = render(
      <MobileCommentary viewingModule={{ abbr: 'MHC', name: 'MHC Commentary' }} />,
    );
    expect(container.querySelector('.mobile-commentary-detail')).toBeTruthy();
    expect(container.querySelector('.mobile-commentary')).toBeNull();
  });

  it('calls onViewModule when a card is clicked', () => {
    mockHomeData = { verseModules: [makeModule('MHC')], passageModules: [], chapterModules: [] };
    const onViewModule = vi.fn();
    const { container } = render(<MobileCommentary onViewModule={onViewModule} />);
    const card = container.querySelector<HTMLButtonElement>('.mobile-commentary__card')!;
    fireEvent.click(card);
    expect(onViewModule).toHaveBeenCalledWith({ abbr: 'MHC', name: expect.any(String) });
  });
});

describe('MobileCommentaryDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsOnline = true;
    mockSyncedBook = 43;
    mockSyncedChapter = 3;
    mockStudyVerseId = 43003016;
    mockStudyBook = 43;
    mockStudyChapter = 3;
    mockFetchModuleEntries.mockResolvedValue([]);
    mockLoadHomeData.mockResolvedValue(undefined);
    mockPrefetchAllEntries.mockResolvedValue(undefined);
  });

  it('renders the detail container', () => {
    const { container } = render(<MobileCommentaryDetail moduleAbbr="MHC" />);
    expect(container.querySelector('.mobile-commentary-detail')).toBeTruthy();
  });

  it('shows loading spinner initially', () => {
    const { container } = render(<MobileCommentaryDetail moduleAbbr="MHC" />);
    expect(container.querySelector('.fa-spinner')).toBeTruthy();
  });

  it('shows offline notice when offline and no entries', async () => {
    mockIsOnline = false;
    mockFetchModuleEntries.mockResolvedValue([]);
    const { container } = render(<MobileCommentaryDetail moduleAbbr="MHC" />);
    // After async load, loading becomes false and empty state is shown
    await vi.waitFor(() => {
      expect(container.querySelector('.mobile-commentary-detail__loading')).toBeNull();
    });
    expect(screen.getByText('mobileCommentary.offlineNotice')).toBeTruthy();
  });

  it('shows no-commentary message when online and entries are empty', async () => {
    mockFetchModuleEntries.mockResolvedValue([]);
    const { container } = render(<MobileCommentaryDetail moduleAbbr="MHC" />);
    await vi.waitFor(() => {
      expect(container.querySelector('.mobile-commentary-detail__loading')).toBeNull();
    });
    expect(screen.getByText('mobileCommentary.noCommentary')).toBeTruthy();
  });
});
