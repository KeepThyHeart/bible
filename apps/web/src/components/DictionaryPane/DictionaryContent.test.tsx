/**
 * Component tests for DictionaryContent.
 *
 * Pattern: Store-connected component with two display modes.
 * dictionaryStore is mocked so tests control tab and tabState independently.
 * useStore is mocked to call the selector immediately.
 * useVersePopup, processCommentaryLinks, and linkStrongsRefs are mocked to
 * avoid provider/DOM side-effects.
 * Tests cover: null return when tab missing, entry view rendering, browse
 * view rendering, navigation buttons, search dropdown, keyboard nav.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

// ---- useStore: call selector immediately --------------------------------
vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

// ---- useVersePopup: return no-op props and no popup JSX -----------------
vi.mock('../../hooks/useVersePopup', () => ({
  useVersePopup: () => ({
    containerProps: { onClick: vi.fn(), onMouseOver: vi.fn(), onMouseOut: vi.fn() },
    popupJsx: null,
  }),
}));

// ---- CommentaryLinkProcessor: return the string unchanged ----------------
vi.mock('../../../../../packages/core/src/Services/CommentaryLinkProcessor', () => ({
  processCommentaryLinks: (html: string) => html,
}));

// ---- strongsLinks: return the string unchanged --------------------------
vi.mock('../../utils/strongsLinks', () => ({
  linkStrongsRefs: (html: string) => html,
}));

// ---- dictionaryStore mock ------------------------------------------------
import type { DictionaryTab } from '../../stores/dictionaryStore';

interface AdjacentEntry { entry_key: string; word: string; }
interface BrowseLetterInfo { letter: string; count: number; }
interface BrowseEntry { entry_key: string; word: string; }
interface TabSuggestion { entry_key: string; word: string; transliteration?: string; }
interface EntryData {
  entry_key: string; word: string; transliteration?: string; pronunciation?: string;
  part_of_speech?: string; definition?: string; etymology?: string; usage_notes?: string;
}

interface TabSearchState {
  searchQuery: string; suggestions: TabSuggestion[]; searchLoading: boolean;
  entry: EntryData | null; entryLoading: boolean;
  browseLetters: BrowseLetterInfo[] | null; browseLetter: string;
  browseEntries: BrowseEntry[]; browseOffset: number; browseTotal: number; browseLoading: boolean;
  adjacentPrev: AdjacentEntry | null; adjacentNext: AdjacentEntry | null;
}

let mockTab: DictionaryTab | undefined = undefined;
let mockTabState: TabSearchState = emptyTabState();

function emptyTabState(): TabSearchState {
  return {
    searchQuery: '', suggestions: [], searchLoading: false,
    entry: null, entryLoading: false,
    browseLetters: null, browseLetter: '', browseEntries: [],
    browseOffset: 0, browseTotal: 0, browseLoading: false,
    adjacentPrev: null, adjacentNext: null,
  };
}

const mockSetTabSearchQuery = vi.fn();
const mockLoadEntryInTab = vi.fn();
const mockClearTabSuggestions = vi.fn();
const mockNavigatePrev = vi.fn();
const mockNavigateNext = vi.fn();
const mockClearEntryInTab = vi.fn();
const mockLoadBrowseEntries = vi.fn();
const mockLoadMoreBrowseEntries = vi.fn();
const mockOpenStrongs = vi.fn();

vi.mock('../../stores/dictionaryStore', () => ({
  DICT_HOME_TAB_ID: 'dtab-home',
  dictionaryStore: {
    get tabs() { return mockTab ? [mockTab] : []; },
    getTabState: () => mockTabState,
    setTabSearchQuery: (id: string, q: string) => mockSetTabSearchQuery(id, q),
    loadEntryInTab: (id: string, key: string) => mockLoadEntryInTab(id, key),
    clearTabSuggestions: (id: string) => mockClearTabSuggestions(id),
    navigatePrev: (id: string) => mockNavigatePrev(id),
    navigateNext: (id: string) => mockNavigateNext(id),
    clearEntryInTab: (id: string) => mockClearEntryInTab(id),
    loadBrowseEntries: (id: string, letter: string) => mockLoadBrowseEntries(id, letter),
    loadMoreBrowseEntries: (id: string) => mockLoadMoreBrowseEntries(id),
    openStrongs: (num: string) => mockOpenStrongs(num),
  },
}));

const mockPerformSearch = vi.fn();
const mockSetRightPaneMode = vi.fn();
const mockExpand = vi.fn();

vi.mock('../../stores/searchStore', () => ({
  searchStore: { performSearch: (q: string) => mockPerformSearch(q) },
}));

vi.mock('../../stores/commentaryStore', () => ({
  commentaryStore: {
    setRightPaneMode: (m: string) => mockSetRightPaneMode(m),
    expand: () => mockExpand(),
  },
}));

import { DictionaryContent } from './DictionaryContent';

function makeTab(overrides: Partial<DictionaryTab> = {}): DictionaryTab {
  return {
    id: 'dtab-1',
    moduleAbbr: 'strongs',
    moduleName: "Strong's Concordance",
    ...overrides,
  };
}

function makeEntry(overrides: Partial<EntryData> = {}): EntryData {
  return {
    entry_key: 'agape',
    word: 'Agape',
    definition: 'Unconditional love',
    ...overrides,
  };
}

describe('DictionaryContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTab = undefined;
    mockTabState = emptyTabState();
  });

  // ------------------------------------------------------------------
  // Returns null when tab not found
  // ------------------------------------------------------------------
  it('renders nothing when the tab does not exist', () => {
    mockTab = undefined;
    const { container } = render(<DictionaryContent tabId="dtab-missing" />);
    expect(container.firstChild).toBeNull();
  });

  // ------------------------------------------------------------------
  // Browse view (no entry loaded)
  // ------------------------------------------------------------------
  it('renders the dictionary-content wrapper in browse mode', () => {
    mockTab = makeTab();
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    expect(container.querySelector('.dictionary-content')).toBeTruthy();
  });

  it('renders the search input in browse mode', () => {
    mockTab = makeTab();
    render(<DictionaryContent tabId="dtab-1" />);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('shows loading indicator when entryLoading is true in browse mode', () => {
    mockTab = makeTab();
    mockTabState = { ...emptyTabState(), entryLoading: true };
    render(<DictionaryContent tabId="dtab-1" />);
    expect(screen.getByText('dictionaryContent.loadingEntry')).toBeTruthy();
  });

  it('renders browse loading indicator when browseLoading is true', () => {
    mockTab = makeTab();
    mockTabState = { ...emptyTabState(), browseLoading: true };
    render(<DictionaryContent tabId="dtab-1" />);
    expect(screen.getByText('common.loading')).toBeTruthy();
  });

  it('renders the alphabet bar when browseLetters are available', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      browseLetters: [{ letter: 'A', count: 5 }, { letter: 'B', count: 3 }],
    };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    const alphaBtns = container.querySelectorAll('.dictionary-content__alphabet-btn');
    expect(alphaBtns.length).toBe(2);
    expect(alphaBtns[0].textContent).toBe('A');
    expect(alphaBtns[1].textContent).toBe('B');
  });

  it('marks the active browse letter', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      browseLetters: [{ letter: 'A', count: 5 }, { letter: 'B', count: 3 }],
      browseLetter: 'A',
    };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    const active = container.querySelector('.dictionary-content__alphabet-btn--active');
    expect(active?.textContent).toBe('A');
  });

  it('calls loadBrowseEntries when an alphabet button is clicked', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      browseLetters: [{ letter: 'G', count: 10 }],
    };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    const btn = container.querySelector('.dictionary-content__alphabet-btn') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(mockLoadBrowseEntries).toHaveBeenCalledWith('dtab-1', 'G');
  });

  it('renders browse entries list', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      browseEntries: [
        { entry_key: 'agape', word: 'Agape' },
        { entry_key: 'logos', word: 'Logos' },
      ],
    };
    render(<DictionaryContent tabId="dtab-1" />);
    expect(screen.getByText('Agape')).toBeTruthy();
    expect(screen.getByText('Logos')).toBeTruthy();
  });

  it('calls loadEntryInTab when a browse entry is clicked', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      browseEntries: [{ entry_key: 'agape', word: 'Agape' }],
    };
    render(<DictionaryContent tabId="dtab-1" />);
    const entryBtn = screen.getByText('Agape').closest('button')!;
    fireEvent.click(entryBtn);
    expect(mockLoadEntryInTab).toHaveBeenCalledWith('dtab-1', 'agape');
  });

  it('shows "Load more" button when browseOffset < browseTotal', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      browseEntries: [{ entry_key: 'agape', word: 'Agape' }],
      browseOffset: 1,
      browseTotal: 50,
    };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    expect(container.querySelector('.dictionary-content__browse-more')).toBeTruthy();
  });

  it('calls loadMoreBrowseEntries when "Load more" is clicked', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      browseEntries: [{ entry_key: 'agape', word: 'Agape' }],
      browseOffset: 1,
      browseTotal: 50,
    };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    const moreBtn = container.querySelector('.dictionary-content__browse-more') as HTMLButtonElement;
    fireEvent.click(moreBtn);
    expect(mockLoadMoreBrowseEntries).toHaveBeenCalledWith('dtab-1');
  });

  it('does not show "Load more" when browseOffset >= browseTotal', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      browseEntries: [{ entry_key: 'agape', word: 'Agape' }],
      browseOffset: 50,
      browseTotal: 50,
    };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    expect(container.querySelector('.dictionary-content__browse-more')).toBeNull();
  });

  it('shows placeholder when no browse data and not loading', () => {
    mockTab = makeTab();
    mockTabState = emptyTabState();
    render(<DictionaryContent tabId="dtab-1" />);
    expect(screen.getByText(/dictionaryContent\.browseEntriesIn/)).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Search input in browse mode
  // ------------------------------------------------------------------
  it('calls setTabSearchQuery when the search input changes', () => {
    mockTab = makeTab();
    render(<DictionaryContent tabId="dtab-1" />);
    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: 'grace' } });
    expect(mockSetTabSearchQuery).toHaveBeenCalledWith('dtab-1', 'grace');
  });

  it('shows search dropdown when suggestions are present and query is set', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      searchQuery: 'gra',
      suggestions: [{ entry_key: 'grace', word: 'Grace' }],
    };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    expect(container.querySelector('.dictionary-content__search-dropdown')).toBeTruthy();
  });

  it('calls loadEntryInTab when a suggestion is clicked in browse mode', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      searchQuery: 'gr',
      suggestions: [{ entry_key: 'grace', word: 'Grace' }],
    };
    render(<DictionaryContent tabId="dtab-1" />);
    const item = screen.getByText('Grace').closest('button')!;
    fireEvent.click(item);
    expect(mockLoadEntryInTab).toHaveBeenCalledWith('dtab-1', 'grace');
  });

  // ------------------------------------------------------------------
  // Entry view
  // ------------------------------------------------------------------
  it('renders entry view when tab has a loaded entry', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      entry: makeEntry({ word: 'Agape', definition: 'Unconditional love' }),
    };
    render(<DictionaryContent tabId="dtab-1" />);
    expect(screen.getByText('Agape')).toBeTruthy();
  });

  it('shows definition content in entry view', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      entry: makeEntry({ definition: 'Unconditional love' }),
    };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    const defEl = container.querySelector('.dictionary-pane__entry-definition');
    expect(defEl?.textContent).toContain('Unconditional love');
  });

  it('shows transliteration when present', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      entry: makeEntry({ transliteration: 'agapē' }),
    };
    render(<DictionaryContent tabId="dtab-1" />);
    expect(screen.getByText('agapē')).toBeTruthy();
  });

  it('does not show transliteration element when absent', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      entry: makeEntry({ transliteration: undefined }),
    };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    expect(container.querySelector('.dictionary-pane__entry-translit')).toBeNull();
  });

  it('shows etymology section when present', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      entry: makeEntry({ etymology: 'From Greek root' }),
    };
    render(<DictionaryContent tabId="dtab-1" />);
    expect(screen.getByText('dictionaryContent.etymology')).toBeTruthy();
    expect(screen.getByText('From Greek root')).toBeTruthy();
  });

  it('shows usage_notes section when present', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      entry: makeEntry({ usage_notes: 'Used in the NT' }),
    };
    render(<DictionaryContent tabId="dtab-1" />);
    expect(screen.getByText('dictionaryContent.usage')).toBeTruthy();
    expect(screen.getByText('Used in the NT')).toBeTruthy();
  });

  it('prev nav button is disabled when adjacentPrev is null', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      entry: makeEntry(),
      adjacentPrev: null,
    };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    const toolbarBtns = container.querySelectorAll<HTMLButtonElement>(
      '.dictionary-content__toolbar-btn',
    );
    expect(toolbarBtns[0].disabled).toBe(true);
  });

  it('prev nav button is enabled when adjacentPrev is set', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      entry: makeEntry(),
      adjacentPrev: { entry_key: 'prev', word: 'PrevWord' },
    };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    const toolbarBtns = container.querySelectorAll<HTMLButtonElement>(
      '.dictionary-content__toolbar-btn',
    );
    expect(toolbarBtns[0].disabled).toBe(false);
  });

  it('calls navigatePrev when the prev button is clicked', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      entry: makeEntry(),
      adjacentPrev: { entry_key: 'prev', word: 'PrevWord' },
    };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    const toolbarBtns = container.querySelectorAll<HTMLButtonElement>(
      '.dictionary-content__toolbar-btn',
    );
    fireEvent.click(toolbarBtns[0]);
    expect(mockNavigatePrev).toHaveBeenCalledWith('dtab-1');
  });

  it('calls navigateNext when the next button is clicked', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      entry: makeEntry(),
      adjacentNext: { entry_key: 'next', word: 'NextWord' },
    };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    const toolbarBtns = container.querySelectorAll<HTMLButtonElement>(
      '.dictionary-content__toolbar-btn',
    );
    fireEvent.click(toolbarBtns[1]);
    expect(mockNavigateNext).toHaveBeenCalledWith('dtab-1');
  });

  it('calls clearEntryInTab when the browse button is clicked', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      entry: makeEntry(),
    };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    const toolbarBtns = container.querySelectorAll<HTMLButtonElement>(
      '.dictionary-content__toolbar-btn',
    );
    // Third toolbar button is "Browse"
    fireEvent.click(toolbarBtns[2]);
    expect(mockClearEntryInTab).toHaveBeenCalledWith('dtab-1');
  });

  // ------------------------------------------------------------------
  // Bottom nav in entry view
  // ------------------------------------------------------------------
  it('shows bottom nav when adjacent entries are present', () => {
    mockTab = makeTab();
    mockTabState = {
      ...emptyTabState(),
      entry: makeEntry(),
      adjacentPrev: { entry_key: 'prev', word: 'PrevWord' },
      adjacentNext: { entry_key: 'next', word: 'NextWord' },
    };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    expect(container.querySelector('.dictionary-content__bottom-nav')).toBeTruthy();
  });

  it('does not show bottom nav when no adjacent entries', () => {
    mockTab = makeTab();
    mockTabState = { ...emptyTabState(), entry: makeEntry() };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    expect(container.querySelector('.dictionary-content__bottom-nav')).toBeNull();
  });

  // ------------------------------------------------------------------
  // "Search all occurrences" (Strong's lexicon entries only)
  // ------------------------------------------------------------------
  const searchBtn = (container: Element) =>
    container.querySelector<HTMLButtonElement>('[data-testid="dictionary-search-occurrences"]');

  it("offers a Strong's occurrence search on a Greek lexicon entry", () => {
    mockTab = makeTab({ moduleAbbr: 'strongsgreek' });
    mockTabState = { ...emptyTabState(), entry: makeEntry({ entry_key: '00025', word: 'agapao' }) };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    expect(searchBtn(container)).toBeTruthy();
  });

  it('runs the search and switches the right pane when it is clicked', () => {
    mockTab = makeTab({ moduleAbbr: 'strongsgreek' });
    mockTabState = { ...emptyTabState(), entry: makeEntry({ entry_key: '00025', word: 'agapao' }) };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    fireEvent.click(searchBtn(container)!);
    // Entry keys are zero-padded and prefixless; the G comes from the lexicon.
    expect(mockPerformSearch).toHaveBeenCalledWith('G25');
    expect(mockSetRightPaneMode).toHaveBeenCalledWith('search');
    expect(mockExpand).toHaveBeenCalled();
  });

  it('uses an H prefix for the Hebrew lexicon', () => {
    mockTab = makeTab({ moduleAbbr: 'strongshebrew' });
    mockTabState = { ...emptyTabState(), entry: makeEntry({ entry_key: '07225', word: 'reshith' }) };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    fireEvent.click(searchBtn(container)!);
    expect(mockPerformSearch).toHaveBeenCalledWith('H7225');
  });

  it('omits the button for an ordinary dictionary', () => {
    mockTab = makeTab({ moduleAbbr: 'easton' });
    mockTabState = { ...emptyTabState(), entry: makeEntry() };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    expect(searchBtn(container)).toBeNull();
  });

  it("omits the button for a Strong's-family entry whose key has no number", () => {
    mockTab = makeTab({ moduleAbbr: 'strongsgreek' });
    mockTabState = { ...emptyTabState(), entry: makeEntry({ entry_key: 'preface' }) };
    const { container } = render(<DictionaryContent tabId="dtab-1" />);
    expect(searchBtn(container)).toBeNull();
  });
});
