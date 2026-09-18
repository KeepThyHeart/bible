/**
 * Component tests for SearchResultsPanel.
 *
 * Pattern: Store-connected component with multiple states.
 * searchStore, bibleStore, commentaryStore, and offlineStore are mocked.
 * useStore is mocked to call the selector immediately (no subscription).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && 'count' in opts) return `${key}:${opts.count}`;
      return key;
    },
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ---- Store mock ----------------------------------------------------------
vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

// ---- Child mock ----------------------------------------------------------
vi.mock('./SearchResultItem', () => ({
  SearchResultItem: ({ result, resultId }: { result: { verseId: number; module: string; type: string }; resultId?: string }) => (
    <div
      data-testid="search-result-item"
      data-verse-id={result.verseId}
      data-type={result.type}
      data-result-id={resultId}
    />
  ),
}));

// The chart is exercised in SearchDistributionChart.test.tsx; here it stands in
// as a probe for what the panel hands it and for the panel's own click wiring.
vi.mock('./SearchDistributionChart', () => ({
  SearchDistributionChart: ({ results, bookCounts, mode, truncated, onSelectBook }: {
    results: { verseId: number }[];
    bookCounts?: Record<number, number>;
    mode: string;
    truncated: boolean;
    onSelectBook: (bookNumber: number, first?: unknown) => void;
  }) => (
    <button
      type="button"
      data-testid="search-distribution"
      data-mode={mode}
      data-truncated={String(truncated)}
      data-count={results.length}
      data-book-counts={bookCounts ? JSON.stringify(bookCounts) : ''}
      // Stands in for a click on the bar of the last result's book. `mockClickBook`
      // overrides which book, for the cases where the point is a book the loaded
      // page does not reach.
      onClick={() => {
        const last = results[results.length - 1];
        const book = mockClickBook ?? (last ? Math.floor(last.verseId / 1000000) : 0);
        onSelectBook(book, mockClickBook === null ? last : undefined);
      }}
    />
  ),
}));

/** Book the stub chart reports as clicked; null means "the last result's book". */
let mockClickBook: number | null = null;

vi.mock('../../utils/verseId', () => ({
  parseVerseId: (id: number) => ({
    bookNumber: Math.floor(id / 1000000),
    chapter: Math.floor((id % 1000000) / 1000),
    verse: id % 1000,
  }),
}));

// ---- Store state ---------------------------------------------------------
import type { SearchResultData } from '../../types';

let mockResults: SearchResultData[] = [];
let mockLoading = false;
let mockQuery = '';
let mockTotalResults = 0;
let mockSearchType: 'keyword' | 'semantic' = 'keyword';
let mockSearchedModule = 'KJV';
let mockKeywordMatchCount = 0;
let mockCanLoadMore = false;
let mockLoadingMore = false;
let mockStrongsMode = false;
let mockStrongsEntry: { strongsNumber: string; word: string; transliteration: string; gloss: string } | null = null;
let mockWordFamily: { strongsNumber: string; word: string; transliteration: string; gloss: string }[] = [];
let mockIncludeRelated = false;
let mockGroupedCounts: Record<string, number> = {};
let mockStrongsRemaining = 0;
let mockBookCounts: Record<number, number> = {};
let mockKeywordRemaining = 0;
let mockLastClickedId: string | null = null;
let mockResultsTruncated = false;
let mockIsOnline = true;

const mockClose = vi.fn();
const mockPerformSearch = vi.fn();
const mockSetSearchType = vi.fn();
const mockWarmupSemanticSearch = vi.fn(() => Promise.resolve());
const mockLoadMoreSemantic = vi.fn();
const mockLoadMoreStrongs = vi.fn();
const mockLoadAllStrongs = vi.fn();
const mockLoadAllKeyword = vi.fn(() => Promise.resolve());
const mockSwitchToKeywordResults = vi.fn();
const mockSetLastClickedId = vi.fn();
const mockToggleIncludeRelated = vi.fn();

vi.mock('../../stores/searchStore', () => ({
  searchStore: {
    get results() { return mockResults; },
    get loading() { return mockLoading; },
    get query() { return mockQuery; },
    get totalResults() { return mockTotalResults; },
    get searchType() { return mockSearchType; },
    get searchedModule() { return mockSearchedModule; },
    get keywordMatchCount() { return mockKeywordMatchCount; },
    get canLoadMore() { return mockCanLoadMore; },
    get loadingMore() { return mockLoadingMore; },
    get strongsMode() { return mockStrongsMode; },
    get strongsEntry() { return mockStrongsEntry; },
    get wordFamily() { return mockWordFamily; },
    get includeRelated() { return mockIncludeRelated; },
    get groupedCounts() { return mockGroupedCounts; },
    get strongsRemaining() { return mockStrongsRemaining; },
    get bookCounts() { return mockBookCounts; },
    get keywordRemaining() { return mockKeywordRemaining; },
    get lastClickedId() { return mockLastClickedId; },
    get resultsTruncated() { return mockResultsTruncated; },
    close: () => mockClose(),
    performSearch: (...args: unknown[]) => mockPerformSearch(...args),
    setSearchType: (...args: unknown[]) => mockSetSearchType(...args),
    warmupSemanticSearch: () => mockWarmupSemanticSearch(),
    loadMoreSemantic: () => mockLoadMoreSemantic(),
    loadMoreStrongs: () => mockLoadMoreStrongs(),
    loadAllStrongs: () => mockLoadAllStrongs(),
    loadAllKeyword: () => mockLoadAllKeyword(),
    switchToKeywordResults: () => mockSwitchToKeywordResults(),
    setLastClickedId: (...args: unknown[]) => mockSetLastClickedId(...args),
    toggleIncludeRelated: () => mockToggleIncludeRelated(),
  },
  searchResultId: (r: SearchResultData) => `${r.verseId}-${r.module}`,
}));

const mockNavigateToPreview = vi.fn();
const mockAddTabWithPassage = vi.fn();
const mockSetActiveTab = vi.fn();

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    get tabs() { return [{ id: 'tab-1', moduleAbbr: 'KJV' }]; },
    get activeTabId() { return 'tab-1'; },
    getActiveTab: () => ({ moduleAbbr: 'KJV' }),
    getActiveModule: () => 'KJV',
    navigateToPreview: (...args: unknown[]) => mockNavigateToPreview(...args),
    addTabWithPassage: (...args: unknown[]) => mockAddTabWithPassage(...args),
    setActiveTab: (...args: unknown[]) => mockSetActiveTab(...args),
  },
}));

const mockSetRightPaneMode = vi.fn();
vi.mock('../../stores/commentaryStore', () => ({
  commentaryStore: {
    setRightPaneMode: (...args: unknown[]) => mockSetRightPaneMode(...args),
  },
}));

vi.mock('../../stores/offlineStore', () => ({
  offlineStore: {
    get isOnline() { return mockIsOnline; },
  },
}));

import { SearchResultsPanel } from './SearchResultsPanel';

describe('SearchResultsPanel', () => {
  const onNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockResults = [];
    mockLoading = false;
    mockQuery = '';
    mockTotalResults = 0;
    mockSearchType = 'keyword';
    mockSearchedModule = 'KJV';
    mockKeywordMatchCount = 0;
    mockCanLoadMore = false;
    mockLoadingMore = false;
    mockStrongsMode = false;
    mockStrongsEntry = null;
    mockWordFamily = [];
    mockIncludeRelated = false;
    mockGroupedCounts = {};
    mockStrongsRemaining = 0;
    mockBookCounts = {};
    mockKeywordRemaining = 0;
    mockClickBook = null;
    mockLastClickedId = null;
    mockResultsTruncated = false;
    mockIsOnline = true;
  });

  // ------------------------------------------------------------------
  // Basic rendering
  // ------------------------------------------------------------------
  it('renders the search panel container', () => {
    const { container } = render(<SearchResultsPanel />);
    expect(container.querySelector('.search-panel-inline')).toBeTruthy();
  });

  it('renders the mobile search bar', () => {
    const { container } = render(<SearchResultsPanel />);
    expect(container.querySelector('.search-panel-inline__mobile-bar')).toBeTruthy();
  });

  it('renders mobile keyword and ideas type buttons', () => {
    const { container } = render(<SearchResultsPanel />);
    const typeBtns = container.querySelectorAll('.search-panel-inline__type-btn');
    expect(typeBtns.length).toBe(2);
  });

  // ------------------------------------------------------------------
  // Empty / loading states
  // ------------------------------------------------------------------
  it('shows "enter search term" message when query is empty', () => {
    render(<SearchResultsPanel />);
    expect(screen.getByText('search.enterSearchTerm')).toBeTruthy();
  });

  it('shows loading indicator when searching', () => {
    mockLoading = true;
    mockQuery = 'love';
    const { container } = render(<SearchResultsPanel />);
    expect(container.querySelector('.search-panel-inline__loading')).toBeTruthy();
  });

  it('shows no-results message when query exists but results are empty (online, no searched module)', () => {
    mockQuery = 'zzznomatch';
    mockSearchedModule = '';
    mockIsOnline = true;
    render(<SearchResultsPanel />);
    expect(screen.getByText('search.noResults')).toBeTruthy();
  });

  it('shows no-keyword-results message when keyword search finds nothing', () => {
    mockQuery = 'zzznomatch';
    mockSearchedModule = 'KJV';
    mockSearchType = 'keyword';
    mockIsOnline = true;
    render(<SearchResultsPanel />);
    expect(screen.getByText('search.noKeywordResults')).toBeTruthy();
  });

  it('shows offline notice when offline and no results', () => {
    mockQuery = 'love';
    mockIsOnline = false;
    render(<SearchResultsPanel />);
    expect(screen.getByText('search.offlineNotice')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Query header
  // ------------------------------------------------------------------
  it('renders the query header when a query is active', () => {
    mockQuery = 'faith';
    mockTotalResults = 5;
    const { container } = render(<SearchResultsPanel />);
    expect(container.querySelector('.search-panel-inline__header')).toBeTruthy();
  });

  it('renders close button in the query header', () => {
    mockQuery = 'faith';
    const { container } = render(<SearchResultsPanel />);
    expect(container.querySelector('.search-panel-inline__close')).toBeTruthy();
  });

  it('calls searchStore.close and sets right pane mode when close button is clicked', () => {
    mockQuery = 'faith';
    const { container } = render(<SearchResultsPanel />);
    const closeBtn = container.querySelector<HTMLElement>('.search-panel-inline__close')!;
    fireEvent.click(closeBtn);
    expect(mockClose).toHaveBeenCalled();
    expect(mockSetRightPaneMode).toHaveBeenCalledWith('commentary');
  });

  // ------------------------------------------------------------------
  // Results list
  // ------------------------------------------------------------------
  it('renders a search result item for each result', () => {
    mockQuery = 'love';
    // `bookNumber`/`chapter`/`verse` are not on `SearchResultData` and
    // `reference`/`type` are required — `SearchResultItem` renders `reference`,
    // so these rows used to draw with an undefined heading.
    mockResults = [
      { verseId: 43003016, reference: 'John 3:16', module: 'KJV', type: 'exact', text: 'For God so loved...' },
      { verseId: 43003017, reference: 'John 3:17', module: 'KJV', type: 'exact', text: 'For God did not...' },
    ];
    const { container } = render(<SearchResultsPanel onNavigate={onNavigate} />);
    const items = container.querySelectorAll('[data-testid="search-result-item"]');
    expect(items.length).toBe(2);
  });

  // ------------------------------------------------------------------
  // Load more button (semantic)
  // ------------------------------------------------------------------
  it('shows the load-more button when canLoadMore is true and search type is semantic', () => {
    mockSearchType = 'semantic';
    mockCanLoadMore = true;
    mockQuery = 'love';
    const { container } = render(<SearchResultsPanel />);
    expect(container.querySelector('.search-panel-inline__load-more-btn')).toBeTruthy();
  });

  it('calls loadMoreSemantic when the load-more button is clicked', () => {
    mockSearchType = 'semantic';
    mockCanLoadMore = true;
    mockQuery = 'love';
    const { container } = render(<SearchResultsPanel />);
    const loadMoreBtn = container.querySelector<HTMLElement>('.search-panel-inline__load-more-btn')!;
    fireEvent.click(loadMoreBtn);
    expect(mockLoadMoreSemantic).toHaveBeenCalled();
  });

  it('does not show the load-more button for keyword searches', () => {
    mockSearchType = 'keyword';
    mockCanLoadMore = true;
    mockQuery = 'love';
    const { container } = render(<SearchResultsPanel />);
    expect(container.querySelector('.search-panel-inline__load-more-btn')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Load more / load all (Strong's)
  // ------------------------------------------------------------------
  it('shows the load-more button for a Strong’s search', () => {
    mockSearchType = 'keyword';
    mockStrongsMode = true;
    mockCanLoadMore = true;
    mockStrongsRemaining = 540;
    mockQuery = 'G25';
    const { container } = render(<SearchResultsPanel />);
    const btns = container.querySelectorAll('.search-panel-inline__load-more-btn');
    expect(btns.length).toBe(2);
  });

  it('calls loadMoreStrongs when the load-more button is clicked in Strong’s mode', () => {
    mockStrongsMode = true;
    mockCanLoadMore = true;
    mockStrongsRemaining = 540;
    mockQuery = 'G25';
    const { container } = render(<SearchResultsPanel />);
    const btns = container.querySelectorAll<HTMLElement>('.search-panel-inline__load-more-btn');
    fireEvent.click(btns[0]);
    expect(mockLoadMoreStrongs).toHaveBeenCalled();
    expect(mockLoadMoreSemantic).not.toHaveBeenCalled();
  });

  it('labels the load-all button with the remaining count and calls loadAllStrongs', () => {
    mockStrongsMode = true;
    mockCanLoadMore = true;
    mockStrongsRemaining = 540;
    mockQuery = 'G25';
    const { container } = render(<SearchResultsPanel />);
    const loadAll = container.querySelectorAll<HTMLElement>('.search-panel-inline__load-more-btn')[1];
    expect(loadAll.textContent).toBe('search.loadAll:540');
    fireEvent.click(loadAll);
    expect(mockLoadAllStrongs).toHaveBeenCalled();
  });

  it('omits the load-all button when nothing is left to load', () => {
    mockStrongsMode = true;
    mockCanLoadMore = true;
    mockStrongsRemaining = 0;
    mockQuery = 'G25';
    const { container } = render(<SearchResultsPanel />);
    expect(container.querySelectorAll('.search-panel-inline__load-more-btn').length).toBe(1);
  });

  // ------------------------------------------------------------------
  // Strong's gloss length
  //
  // The gloss is the KJV usage list parsed out of the lexicon entry: a few
  // words for most entries, 564 characters for G1722 (the preposition ev).
  // The header is a one-line summary, so a long one is cut and the reader is
  // pointed at the full entry.
  // ------------------------------------------------------------------
  const LONG_GLOSS = 'about, after, against, almost, altogether, among, as, at, '
    + 'before, between, by, for, in, mightily, of, on, openly, outwardly, one, quickly';

  function strongsHeaderState(gloss: string, strongsNumber = 'G1722'): void {
    mockStrongsMode = true;
    mockQuery = strongsNumber;
    mockStrongsEntry = { strongsNumber, word: 'ev', transliteration: 'en', gloss };
  }

  it('shows a short gloss in full, with no full-entry affordance', () => {
    strongsHeaderState('(be-)love(-ed). Compare 5368', 'G25');
    const { container } = render(<SearchResultsPanel onOpenStrongsEntry={vi.fn()} />);

    expect(container.querySelector('.strongs-search-header__gloss')?.textContent)
      .toContain('(be-)love(-ed). Compare 5368');
    expect(screen.queryByTestId('strongs-full-entry')).toBeNull();
  });

  it('truncates a long gloss at a word boundary and offers the full entry', () => {
    strongsHeaderState(LONG_GLOSS);
    const { container } = render(<SearchResultsPanel onOpenStrongsEntry={vi.fn()} />);

    const text = container.querySelector('.strongs-search-header__gloss')?.textContent ?? '';
    expect(text).toContain('about, after, against');
    expect(text).toContain('…');
    expect(text).not.toContain('quickly');
    expect(screen.getByTestId('strongs-full-entry')).toBeTruthy();
  });

  it('hands the Strong’s number to the layout’s full-entry route', () => {
    const openEntry = vi.fn();
    strongsHeaderState(LONG_GLOSS);
    render(<SearchResultsPanel onOpenStrongsEntry={openEntry} />);

    fireEvent.click(screen.getByTestId('strongs-full-entry'));
    expect(openEntry).toHaveBeenCalledWith('G1722');
  });

  it('offers no full-entry affordance when the layout supplies no route', () => {
    strongsHeaderState(LONG_GLOSS);
    render(<SearchResultsPanel />);
    expect(screen.queryByTestId('strongs-full-entry')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Keyword match banner (semantic with keyword hits)
  // ------------------------------------------------------------------
  it('shows keyword-match banner when semantic search has keyword matches', () => {
    mockSearchType = 'semantic';
    mockKeywordMatchCount = 3;
    mockQuery = 'love';
    mockResults = [
      { verseId: 43003016, reference: 'John 3:16', module: 'KJV', type: 'exact', text: '...' },
    ];
    const { container } = render(<SearchResultsPanel />);
    expect(container.querySelector('.search-panel-inline__keyword-banner')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Search type toggle buttons
  // ------------------------------------------------------------------
  it('calls setSearchType("keyword") when keyword button is clicked', () => {
    const { container } = render(<SearchResultsPanel />);
    const kwBtn = container.querySelector<HTMLElement>('.search-panel-inline__type-btn:first-child')!;
    fireEvent.click(kwBtn);
    expect(mockSetSearchType).toHaveBeenCalledWith('keyword');
  });

  it('calls setSearchType("semantic") and warmup when Ideas button is clicked', () => {
    const { container } = render(<SearchResultsPanel />);
    const ideasBtn = container.querySelectorAll<HTMLElement>('.search-panel-inline__type-btn')[1];
    fireEvent.click(ideasBtn);
    expect(mockSetSearchType).toHaveBeenCalledWith('semantic');
    expect(mockWarmupSemanticSearch).toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Mobile search form submission
  // ------------------------------------------------------------------
  it('calls performSearch when mobile form is submitted', () => {
    const { container } = render(<SearchResultsPanel />);
    const input = container.querySelector<HTMLInputElement>('.search-panel-inline__mobile-input')!;
    fireEvent.input(input, { target: { value: 'faith' } });
    const form = container.querySelector<HTMLFormElement>('.search-panel-inline__mobile-form')!;
    fireEvent.submit(form);
    expect(mockPerformSearch).toHaveBeenCalledWith('faith', undefined, expect.any(Array));
  });

  it('does not call performSearch when mobile form is submitted with empty input', () => {
    const { container } = render(<SearchResultsPanel />);
    const form = container.querySelector<HTMLFormElement>('.search-panel-inline__mobile-form')!;
    fireEvent.submit(form);
    expect(mockPerformSearch).not.toHaveBeenCalled();
  });
  // ------------------------------------------------------------------
  // Distribution chart
  // ------------------------------------------------------------------
  it('mounts the distribution chart above the results', () => {
    mockQuery = 'love';
    mockResults = [
      { verseId: 43003016, reference: 'John 3:16', module: 'KJV', type: 'exact', text: '...' },
    ];
    const { container } = render(<SearchResultsPanel />);
    const chart = screen.getByTestId('search-distribution');
    expect(chart).toBeTruthy();
    expect(chart.dataset.mode).toBe('keyword');
    // First thing in the scroll area, so it scrolls away with the results
    // rather than sticking to the top of the panel.
    const results = container.querySelector('.search-panel-inline__results')!;
    expect(results.firstElementChild).toBe(chart);
  });

  it('does not mount the chart while a search is still running', () => {
    mockQuery = 'love';
    mockLoading = true;
    mockResults = [];
    render(<SearchResultsPanel />);
    expect(screen.queryByTestId('search-distribution')).toBeNull();
  });

  it('tells the chart which search produced the results', () => {
    mockQuery = 'love';
    mockSearchType = 'semantic';
    mockResults = [
      { verseId: 43003016, reference: 'John 3:16', module: 'KJV', type: 'verse', text: '...' },
    ];
    render(<SearchResultsPanel />);
    expect(screen.getByTestId('search-distribution').dataset.mode).toBe('semantic');
  });

  it('passes the truncation flag from the store through to the chart caption', () => {
    mockQuery = 'love';
    mockResultsTruncated = true;
    mockResults = [
      { verseId: 43003016, reference: 'John 3:16', module: 'KJV', type: 'exact', text: '...' },
    ];
    render(<SearchResultsPanel />);
    expect(screen.getByTestId('search-distribution').dataset.truncated).toBe('true');
  });

  it('selects and scrolls to the row a chart bar points at, without navigating', () => {
    mockQuery = 'love';
    mockResults = [
      { verseId: 43003016, reference: 'John 3:16', module: 'KJV', type: 'exact', text: '...' },
      { verseId: 19023001, reference: 'Psalm 23:1', module: 'KJV', type: 'exact', text: '...' },
    ];
    const scrolls: unknown[] = [];
    // happy-dom has no layout, so scrollIntoView is a stub either way; recording
    // it is what proves the panel found the right row.
    Element.prototype.scrollIntoView = function (arg?: unknown) { scrolls.push([this, arg]); };

    render(<SearchResultsPanel onNavigate={onNavigate} />);
    // The stub chart reports the last result, standing in for a bar click.
    fireEvent.click(screen.getByTestId('search-distribution'));

    expect(mockSetLastClickedId).toHaveBeenCalledWith('19023001-KJV');
    expect(scrolls.length).toBe(1);
    expect((scrolls[0] as [Element, unknown])[0].getAttribute('data-result-id')).toBe('19023001-KJV');
    // Centred, so the verses either side of the match are visible with it.
    expect((scrolls[0] as [Element, unknown])[1]).toEqual({ block: 'center' });
    // A mis-click must cost nothing: no Bible navigation, no pane switch.
    expect(mockNavigateToPreview).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('hands the chart the whole search\'s counts, and nothing when it has none', () => {
    mockQuery = 'love';
    mockResults = [
      { verseId: 1001001, reference: 'Gen 1:1', module: 'KJV', type: 'exact', text: '...' },
    ];
    mockBookCounts = { 1: 12, 19: 120 };
    const { rerender } = render(<SearchResultsPanel />);
    expect(screen.getByTestId('search-distribution').dataset.bookCounts).toBe('{"1":12,"19":120}');

    // Semantic and Strong's have no server counts; the chart is told nothing
    // rather than told zero, so it goes back to counting its own rows.
    mockBookCounts = {};
    rerender(<SearchResultsPanel />);
    expect(screen.getByTestId('search-distribution').dataset.bookCounts).toBe('');
  });

  it('loads the rest of the results before selecting a book the page never reached', async () => {
    // The bar says Psalms has 40 matches; the loaded page is all Genesis. The
    // click has to produce the match it is counting, not silently do nothing.
    mockQuery = 'love';
    mockResults = [
      { verseId: 1001001, reference: 'Gen 1:1', module: 'KJV', type: 'exact', text: '...' },
    ];
    mockBookCounts = { 1: 1, 19: 40 };
    mockClickBook = 19;
    const psalm = { verseId: 19023001, reference: 'Psalm 23:1', module: 'KJV', type: 'exact' as const, text: '...' };
    mockLoadAllKeyword.mockImplementation(async () => { mockResults = [...mockResults, psalm]; });

    render(<SearchResultsPanel />);
    fireEvent.click(screen.getByTestId('search-distribution'));

    await waitFor(() => expect(mockLoadAllKeyword).toHaveBeenCalledTimes(1));
    // ...and the newly-arrived row is the one selected.
    await waitFor(() => expect(mockSetLastClickedId).toHaveBeenCalledWith('19023001-KJV'));
  });

  it('does not re-fetch when the clicked book is already fully loaded', async () => {
    mockQuery = 'love';
    mockResults = [
      { verseId: 1001001, reference: 'Gen 1:1', module: 'KJV', type: 'exact', text: '...' },
    ];
    mockBookCounts = { 1: 1 };

    render(<SearchResultsPanel />);
    fireEvent.click(screen.getByTestId('search-distribution'));

    await waitFor(() => expect(mockSetLastClickedId).toHaveBeenCalledWith('1001001-KJV'));
    expect(mockLoadAllKeyword).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Loading the rest of a keyword search
  // ------------------------------------------------------------------
  it('offers the remaining keyword matches, and asks for them all at once', () => {
    mockQuery = 'love';
    mockResults = [
      { verseId: 1001001, reference: 'Gen 1:1', module: 'KJV', type: 'exact', text: '...' },
    ];
    mockKeywordRemaining = 392;

    render(<SearchResultsPanel />);
    const loadAll = screen.getByTestId('keyword-load-all');
    expect(loadAll.textContent).toBe('search.loadAll:392');
    fireEvent.click(loadAll);
    expect(mockLoadAllKeyword).toHaveBeenCalledTimes(1);
  });

  it('offers nothing more to load once the whole keyword search is on screen', () => {
    mockQuery = 'love';
    mockResults = [
      { verseId: 1001001, reference: 'Gen 1:1', module: 'KJV', type: 'exact', text: '...' },
    ];
    mockKeywordRemaining = 0;

    render(<SearchResultsPanel />);
    expect(screen.queryByTestId('keyword-load-all')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Approximate (fuzzy) matches
  // ------------------------------------------------------------------
  it('groups fuzzy results below one labelled divider', () => {
    mockQuery = 'love';
    // Deliberately interleaved: the panel partitions the list itself rather
    // than trusting the server to have sorted the fuzzy ones to the end.
    mockResults = [
      { verseId: 43003016, reference: 'John 3:16', module: 'KJV', type: 'fuzzy', text: '...' },
      { verseId: 43003017, reference: 'John 3:17', module: 'KJV', type: 'exact', text: '...' },
      { verseId: 43003018, reference: 'John 3:18', module: 'KJV', type: 'fuzzy', text: '...' },
      { verseId: 43003019, reference: 'John 3:19', module: 'KJV', type: 'stem', text: '...' },
    ];
    const { container } = render(<SearchResultsPanel />);

    expect(container.querySelectorAll('[data-testid="search-fuzzy-divider"]').length).toBe(1);

    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="search-result-item"]'));
    expect(rows.map(r => r.dataset.type)).toEqual(['exact', 'stem', 'fuzzy', 'fuzzy']);
  });

  it('shows no divider when nothing matched approximately', () => {
    mockQuery = 'love';
    mockResults = [
      { verseId: 43003016, reference: 'John 3:16', module: 'KJV', type: 'exact', text: '...' },
    ];
    const { container } = render(<SearchResultsPanel />);
    expect(container.querySelector('[data-testid="search-fuzzy-divider"]')).toBeNull();
  });
});
