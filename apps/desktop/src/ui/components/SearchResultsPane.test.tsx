import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import SearchResultsPane from './SearchResultsPane';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { IntlMessageFormat } from 'intl-messageformat';
import enUi from '../../../locales/en/ui.json';

// Mock stores
const mockSearchStore: Record<string, any> = {};
vi.mock('../stores/useSearchStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/useSearchStore')>('../stores/useSearchStore');
  return {
    // Real identity helpers - the component compares their output against
    // `lastClickedId`, so the fake IDs in these tests need the real format.
    searchResultId: actual.searchResultId,
    semanticResultId: actual.semanticResultId,
    useSearchStore: (selector?: (s: any) => any) => (selector ? selector(mockSearchStore) : mockSearchStore),
  };
});

// Empty by default so the retry-in-translation affordance stays hidden unless
// a test opts in via mockBiblePanels.set(...).
let mockBiblePanels = new Map<string, any>();
// One stable spy rather than a fresh `vi.fn()` per selector call, so a test can
// assert that something did *not* navigate.
const mockNavigateToVerse = vi.fn().mockResolvedValue(undefined);
vi.mock('../stores/useBibleStore', () => ({
  DEFAULT_PANEL_ID: 'default',
  useBibleStore: (selector: (s: any) => any) =>
    selector({
      navigateToVerseInPrimary: mockNavigateToVerse,
      panels: mockBiblePanels,
    }),
}));

vi.mock('../utils/sanitize', () => ({
  sanitizeHtml: (html: string) => html,
}));

// The full-entry affordance routes through the shared dictionary navigation,
// which reaches the layout store and dockview. The pane's contract is that it
// calls it with the right number, not what dockview then does.
const mockOpenStrongsInDictionary = vi.fn();
vi.mock('./bible/openStrongsInDictionary', () => ({
  openStrongsInDictionary: (strongsNumber: string) => mockOpenStrongsInDictionary(strongsNumber),
}));

// The result-count summaries are ICU plurals owned by the catalog, so the stub
// resolves against the real `en` catalog and formats it - a stub that echoed the
// key back would silently accept a component that never passed `count` at all.
const catalog = enUi as Record<string, string>;

function stubT(key: string, params?: Record<string, unknown>): string {
  const message = catalog[key];
  if (message === undefined) return `[${key}]`;
  if (!message.includes('{')) return message;
  return String(new IntlMessageFormat(message, 'en').format(params ?? {}));
}

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: { t: stubT, currentLocale: 'en' as const, onDidChangeLocale: () => ({ dispose: vi.fn() }), resolve: (v: unknown) => String(v), loadCatalog: vi.fn(), setLocale: vi.fn() } as unknown as AppServices['i18n'],
  };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(<ContextProvider services={createMockServices()}>{ui}</ContextProvider>);
}

const defaultSearchState = {
  resultsForQuery: '',
  searchResults: [],
  isSearching: false,
  error: null,
  clearResults: vi.fn(),
  keywordResultLimit: 200,
  isShowingAllKeywordResults: false,
  showAllKeywordResults: vi.fn(),
  semanticVisibleCount: 30,
  showMoreSemanticResults: vi.fn(),
  isSemanticMode: false,
  semanticResults: [],
  isSemanticSearching: false,
  semanticAvailable: false,
  toggleSemanticMode: vi.fn(),
  autoSwitchedToSemantic: false,
  retriedModules: [],
  retrySearchInModule: vi.fn(),
  lastClickedId: null,
  setLastClickedId: vi.fn(),
};

describe('SearchResultsPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mockSearchStore, { ...defaultSearchState });
    mockBiblePanels = new Map();
  });

  it('renders the search results pane', () => {
    Object.assign(mockSearchStore, { ...defaultSearchState, resultsForQuery: 'love' });
    renderWithProviders(<SearchResultsPane />);
    expect(screen.getByText(/Search Results for/)).toBeInTheDocument();
  });

  // The panel is part of the saved layout, so it comes back on the next launch
  // with no query behind it. That state must not read as "0 results for ''".
  it('shows an idle prompt, not a zero-result heading, when no search has run', () => {
    renderWithProviders(<SearchResultsPane />);
    expect(screen.getByTestId('search-results-idle')).toBeInTheDocument();
    expect(screen.queryByText(/Search Results for/)).not.toBeInTheDocument();
    expect(screen.queryByText('0 results found')).not.toBeInTheDocument();
  });

  it('shows loading spinner when searching', () => {
    Object.assign(mockSearchStore, { ...defaultSearchState, isSearching: true });
    renderWithProviders(<SearchResultsPane />);
    expect(screen.getByText('Searching...')).toBeInTheDocument();
  });

  it('shows semantic searching message', () => {
    Object.assign(mockSearchStore, { ...defaultSearchState, isSemanticSearching: true, isSemanticMode: true });
    renderWithProviders(<SearchResultsPane />);
    expect(screen.getByText('Searching semantically...')).toBeInTheDocument();
  });

  it('shows error state', () => {
    Object.assign(mockSearchStore, { ...defaultSearchState, error: 'Something went wrong' });
    renderWithProviders(<SearchResultsPane />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('shows empty state for keyword search with no results', () => {
    Object.assign(mockSearchStore, { ...defaultSearchState, resultsForQuery: 'test query', searchResults: [] });
    renderWithProviders(<SearchResultsPane />);
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('renders keyword search results', () => {
    Object.assign(mockSearchStore, {
      ...defaultSearchState,
      resultsForQuery: 'love',
      searchResults: [
        { verseId: 43003016, reference: 'John 3:16', text: 'For God so loved the world', type: 'exact', module: 'KJV' },
        { verseId: 46013004, reference: '1 Cor 13:4', text: 'Love is patient, love is kind', type: 'exact', module: 'KJV' },
      ],
    });
    renderWithProviders(<SearchResultsPane />);
    expect(screen.getByText('2 results found')).toBeInTheDocument();
    expect(screen.getByText('John 3:16')).toBeInTheDocument();
    expect(screen.getByText('1 Cor 13:4')).toBeInTheDocument();
  });

  it('shows result count as singular', () => {
    Object.assign(mockSearchStore, {
      ...defaultSearchState,
      resultsForQuery: 'love',
      searchResults: [
        { verseId: 43003016, reference: 'John 3:16', text: 'For God so loved the world', type: 'exact', module: 'KJV' },
      ],
    });
    renderWithProviders(<SearchResultsPane />);
    expect(screen.getByText('1 result found')).toBeInTheDocument();
  });

  it('shows fuzzy match badge for fuzzy results', () => {
    Object.assign(mockSearchStore, {
      ...defaultSearchState,
      resultsForQuery: 'lov',
      searchResults: [
        { verseId: 43003016, reference: 'John 3:16', text: 'For God so loved the world', type: 'fuzzy', module: 'KJV' },
      ],
    });
    renderWithProviders(<SearchResultsPane />);
    expect(screen.getByText('Fuzzy')).toBeInTheDocument();
  });

  it('shows semantic toggle when semantic is available', () => {
    Object.assign(mockSearchStore, {
      ...defaultSearchState,
      resultsForQuery: 'love',
      searchResults: [{ verseId: 43003016, reference: 'John 3:16', text: 'Text', type: 'exact', module: 'KJV' }],
      semanticAvailable: true,
    });
    renderWithProviders(<SearchResultsPane />);
    expect(screen.getByText('Semantic Search')).toBeInTheDocument();
  });

  it('renders semantic results when in semantic mode', () => {
    Object.assign(mockSearchStore, {
      ...defaultSearchState,
      resultsForQuery: 'God loves humanity',
      isSemanticMode: true,
      semanticResults: [
        { id: '1', reference: 'John 3:16', text: 'For God so loved the world', startVerseId: 43003016, similarity: 0.92, level: 'verse', textPreview: '' },
      ],
    });
    renderWithProviders(<SearchResultsPane />);
    expect(screen.getByText('1 semantic match found')).toBeInTheDocument();
    expect(screen.getByText('92% match')).toBeInTheDocument();
  });

  // Not `setResultsVisible(false)`: hiding the pane left `searchResults`
  // populated, and the search bar's count badge is derived from that array, so
  // closing the results left a badge advertising results nothing could show.
  it('clears the results when the close button is clicked', async () => {
    const user = userEvent.setup();
    const mockClearResults = vi.fn();
    Object.assign(mockSearchStore, { ...defaultSearchState, clearResults: mockClearResults });
    renderWithProviders(<SearchResultsPane />);
    const closeBtn = screen.getByTitle('Close Search Results');
    await user.click(closeBtn);
    expect(mockClearResults).toHaveBeenCalled();
  });

  it('shows auto-switch notice when auto-switched to semantic', () => {
    Object.assign(mockSearchStore, {
      ...defaultSearchState,
      isSemanticMode: true,
      autoSwitchedToSemantic: true,
      resultsForQuery: 'test',
      semanticResults: [
        { id: '1', reference: 'John 3:16', text: 'Text', startVerseId: 43003016, similarity: 0.85, level: 'verse', textPreview: '' },
      ],
    });
    renderWithProviders(<SearchResultsPane />);
    expect(screen.getByText(/No keyword matches found/)).toBeInTheDocument();
  });

  // ==========================================================================
  // Task 1: retry the search in another open translation on zero results
  // ==========================================================================

  describe('retry in other open translation (zero keyword results)', () => {
    function panelWith(abbreviation: string, tabId = abbreviation): any {
      return { openTabs: [{ tabId, abbreviation }], activeTabIndex: 0 };
    }

    it('offers the other open translations, excluding the active one', () => {
      mockBiblePanels = new Map([
        ['default', panelWith('KJV')],
        ['panel-2', panelWith('ESV')],
        ['panel-3', panelWith('NIV')],
      ]);
      Object.assign(mockSearchStore, { ...defaultSearchState, resultsForQuery: 'agape' });
      renderWithProviders(<SearchResultsPane />);

      expect(screen.getByText('Try in ESV')).toBeInTheDocument();
      expect(screen.getByText('Try in NIV')).toBeInTheDocument();
      expect(screen.queryByText('Try in KJV')).not.toBeInTheDocument();
    });

    it('renders nothing extra when no other translation is open', () => {
      mockBiblePanels = new Map([['default', panelWith('KJV')]]);
      Object.assign(mockSearchStore, { ...defaultSearchState, resultsForQuery: 'agape' });
      renderWithProviders(<SearchResultsPane />);

      expect(screen.queryByTestId('retry-other-translations')).not.toBeInTheDocument();
    });

    it('renders nothing extra when no Bible panel is open at all', () => {
      mockBiblePanels = new Map();
      Object.assign(mockSearchStore, { ...defaultSearchState, resultsForQuery: 'agape' });
      renderWithProviders(<SearchResultsPane />);

      expect(screen.queryByTestId('retry-other-translations')).not.toBeInTheDocument();
    });

    it('calls retrySearchInModule with the clicked translation', async () => {
      const user = userEvent.setup();
      mockBiblePanels = new Map([
        ['default', panelWith('KJV')],
        ['panel-2', panelWith('ESV')],
      ]);
      const mockRetry = vi.fn();
      Object.assign(mockSearchStore, { ...defaultSearchState, resultsForQuery: 'agape', retrySearchInModule: mockRetry });
      renderWithProviders(<SearchResultsPane />);

      await user.click(screen.getByText('Try in ESV'));
      expect(mockRetry).toHaveBeenCalledWith('ESV');
    });

    it('excludes translations already retried for this query', () => {
      mockBiblePanels = new Map([
        ['default', panelWith('KJV')],
        ['panel-2', panelWith('ESV')],
        ['panel-3', panelWith('NIV')],
      ]);
      Object.assign(mockSearchStore, { ...defaultSearchState, resultsForQuery: 'agape', retriedModules: ['ESV'] });
      renderWithProviders(<SearchResultsPane />);

      expect(screen.getByText('Try in NIV')).toBeInTheDocument();
      expect(screen.queryByText('Try in ESV')).not.toBeInTheDocument();
    });

    it('does not offer a retry for a duplicate translation open in two panels', () => {
      mockBiblePanels = new Map([
        ['default', panelWith('KJV')],
        ['panel-2', panelWith('ESV')],
        ['panel-3', panelWith('ESV', 'tab-esv-2')],
      ]);
      Object.assign(mockSearchStore, { ...defaultSearchState, resultsForQuery: 'agape' });
      renderWithProviders(<SearchResultsPane />);

      expect(screen.getAllByText('Try in ESV')).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Task 2: mark the last-clicked search result
  // ==========================================================================

  describe('last-clicked result marker', () => {
    const keywordResults = [
      { verseId: 43003016, reference: 'John 3:16', text: 'For God so loved the world', type: 'exact', module: 'KJV' },
      { verseId: 46013004, reference: '1 Cor 13:4', text: 'Love is patient, love is kind', type: 'exact', module: 'KJV' },
    ];

    const semanticResultsFixture = [
      { id: '1', reference: 'John 3:16', text: 'For God so loved the world', startVerseId: 43003016, similarity: 0.92, level: 'verse', textPreview: '' },
      { id: '2', reference: 'Rom 5:8', text: 'God commendeth his love', startVerseId: 45005008, similarity: 0.8, level: 'verse', textPreview: '' },
    ];

    it('does not mark any keyword result when nothing has been clicked', () => {
      Object.assign(mockSearchStore, { ...defaultSearchState, resultsForQuery: 'love', searchResults: keywordResults });
      renderWithProviders(<SearchResultsPane />);
      expect(screen.queryByTestId('last-clicked-marker')).not.toBeInTheDocument();
    });

    it('marks only the previously-clicked keyword result', () => {
      // Must match the real `searchResultId` format: keyword|module|type|verseId|endId
      Object.assign(mockSearchStore, {
        ...defaultSearchState,
        resultsForQuery: 'love',
        searchResults: keywordResults,
        lastClickedId: 'keyword|KJV|exact|43003016|43003016',
      });
      renderWithProviders(<SearchResultsPane />);

      const rows = screen.getAllByTestId('search-result');
      expect(rows[0]).toHaveAttribute('data-last-clicked', 'true');
      expect(rows[1]).not.toHaveAttribute('data-last-clicked');
      expect(screen.getByTestId('last-clicked-marker')).toBeInTheDocument();
    });

    it('calls setLastClickedId with the clicked keyword result id', async () => {
      const user = userEvent.setup();
      const mockSetLastClickedId = vi.fn();
      Object.assign(mockSearchStore, {
        ...defaultSearchState,
        resultsForQuery: 'love',
        searchResults: keywordResults,
        setLastClickedId: mockSetLastClickedId,
      });
      renderWithProviders(<SearchResultsPane />);

      await user.click(screen.getAllByTestId('search-result')[1]);
      expect(mockSetLastClickedId).toHaveBeenCalledWith('keyword|KJV|exact|46013004|46013004');
    });

    it('marks only the previously-clicked semantic result', () => {
      Object.assign(mockSearchStore, {
        ...defaultSearchState,
        isSemanticMode: true,
        resultsForQuery: 'love',
        semanticResults: semanticResultsFixture,
        lastClickedId: 'semantic|2',
      });
      renderWithProviders(<SearchResultsPane />);

      const rows = screen.getAllByTestId('semantic-result');
      expect(rows[0]).not.toHaveAttribute('data-last-clicked');
      expect(rows[1]).toHaveAttribute('data-last-clicked', 'true');
    });

    it('calls setLastClickedId with the clicked semantic result id', async () => {
      const user = userEvent.setup();
      const mockSetLastClickedId = vi.fn();
      Object.assign(mockSearchStore, {
        ...defaultSearchState,
        isSemanticMode: true,
        resultsForQuery: 'love',
        semanticResults: semanticResultsFixture,
        setLastClickedId: mockSetLastClickedId,
      });
      renderWithProviders(<SearchResultsPane />);

      await user.click(screen.getAllByTestId('semantic-result')[0]);
      expect(mockSetLastClickedId).toHaveBeenCalledWith('semantic|1');
    });
  });

  // ==========================================================================
  // Truncated result sets: "Show All Matches" / "Show N More"
  // ==========================================================================
  //
  // The two modes know different things about their own completeness, and the
  // affordances differ accordingly - keyword search has no server-side total
  // (a full page is the only evidence of truncation, so the label carries no
  // number), while the semantic page is held in the store and its remaining
  // count is exact.
  describe('show-more affordance', () => {
    function keywordResults(count: number, offset = 0) {
      return Array.from({ length: count }, (_, i) => ({
        verseId: 43003000 + offset + i,
        reference: `John 3:${offset + i + 1}`,
        text: 'For God so loved the world',
        type: 'exact',
        module: 'KJV',
      }));
    }

    function semanticResults(count: number) {
      return Array.from({ length: count }, (_, i) => ({
        id: String(i + 1),
        reference: `John 3:${i + 1}`,
        text: 'For God so loved the world',
        startVerseId: 43003001 + i,
        similarity: 0.9,
        level: 'verse',
        textPreview: '',
      }));
    }

    function rerenderPane(view: ReturnType<typeof renderWithProviders>) {
      view.rerender(
        <ContextProvider services={createMockServices()}>
          <SearchResultsPane />
        </ContextProvider>,
      );
    }

    it('does not offer "Show All Matches" for a complete keyword result set', () => {
      Object.assign(mockSearchStore, {
        ...defaultSearchState,
        resultsForQuery: 'love',
        searchResults: keywordResults(5),
        keywordResultLimit: 200,
      });
      renderWithProviders(<SearchResultsPane />);
      expect(screen.queryByTestId('show-all-matches')).not.toBeInTheDocument();
    });

    it('offers "Show All Matches" once the keyword result set comes back full', () => {
      Object.assign(mockSearchStore, {
        ...defaultSearchState,
        resultsForQuery: 'love',
        searchResults: keywordResults(10),
        keywordResultLimit: 10,
      });
      renderWithProviders(<SearchResultsPane />);
      expect(screen.getByTestId('show-all-matches')).toHaveTextContent('Show All Matches');
    });

    it('does not re-offer "Show All Matches" after the uncapped re-fetch', () => {
      // Even a query that fills the show-all ceiling: a button that cannot
      // produce anything further is worse than quietly capping.
      Object.assign(mockSearchStore, {
        ...defaultSearchState,
        resultsForQuery: 'the',
        searchResults: keywordResults(10),
        keywordResultLimit: 10,
        isShowingAllKeywordResults: true,
      });
      renderWithProviders(<SearchResultsPane />);
      expect(screen.queryByTestId('show-all-matches')).not.toBeInTheDocument();
    });

    it('loads and appends the rest of the keyword results when clicked', async () => {
      const user = userEvent.setup();
      const showAll = vi.fn();
      Object.assign(mockSearchStore, {
        ...defaultSearchState,
        resultsForQuery: 'love',
        searchResults: keywordResults(10),
        keywordResultLimit: 10,
        showAllKeywordResults: showAll,
      });
      const view = renderWithProviders(<SearchResultsPane />);
      expect(screen.getAllByTestId('search-result')).toHaveLength(10);

      await user.click(screen.getByTestId('show-all-matches'));
      expect(showAll).toHaveBeenCalledTimes(1);

      // What the store does in response, replayed by hand: the mocked store is
      // not reactive, so the test supplies the fuller set the real action fetches.
      Object.assign(mockSearchStore, {
        searchResults: keywordResults(24),
        keywordResultLimit: 5000,
        isShowingAllKeywordResults: true,
      });
      rerenderPane(view);

      expect(screen.getAllByTestId('search-result')).toHaveLength(24);
      expect(screen.queryByTestId('show-all-matches')).not.toBeInTheDocument();
      // Twice: the visible header summary, and the sr-only live region that
      // tells a screen-reader user the list grew under them.
      expect(screen.getAllByText('24 results found')).toHaveLength(2);
    });

    it('does not offer "Show N More" when every semantic result is shown', () => {
      Object.assign(mockSearchStore, {
        ...defaultSearchState,
        resultsForQuery: 'God loves the world',
        isSemanticMode: true,
        semanticResults: semanticResults(4),
        semanticVisibleCount: 30,
      });
      renderWithProviders(<SearchResultsPane />);
      expect(screen.queryByTestId('show-more-semantic-results')).not.toBeInTheDocument();
    });

    it('offers "Show N More" with the real remaining semantic count', () => {
      Object.assign(mockSearchStore, {
        ...defaultSearchState,
        resultsForQuery: 'God loves the world',
        isSemanticMode: true,
        semanticResults: semanticResults(11),
        semanticVisibleCount: 4,
      });
      renderWithProviders(<SearchResultsPane />);
      expect(screen.getAllByTestId('semantic-result')).toHaveLength(4);
      expect(screen.getByTestId('show-more-semantic-results')).toHaveTextContent('Show 7 More');
    });

    it('appends the remaining semantic results when clicked', async () => {
      const user = userEvent.setup();
      const showMore = vi.fn();
      Object.assign(mockSearchStore, {
        ...defaultSearchState,
        resultsForQuery: 'God loves the world',
        isSemanticMode: true,
        semanticResults: semanticResults(11),
        semanticVisibleCount: 4,
        showMoreSemanticResults: showMore,
      });
      const view = renderWithProviders(<SearchResultsPane />);

      await user.click(screen.getByTestId('show-more-semantic-results'));
      expect(showMore).toHaveBeenCalledTimes(1);

      Object.assign(mockSearchStore, { semanticVisibleCount: 11 });
      rerenderPane(view);

      expect(screen.getAllByTestId('semantic-result')).toHaveLength(11);
      expect(screen.queryByTestId('show-more-semantic-results')).not.toBeInTheDocument();
    });

    it('announces the new list length after expanding', async () => {
      const user = userEvent.setup();
      Object.assign(mockSearchStore, {
        ...defaultSearchState,
        resultsForQuery: 'God loves the world',
        isSemanticMode: true,
        semanticResults: semanticResults(11),
        semanticVisibleCount: 4,
      });
      const view = renderWithProviders(<SearchResultsPane />);

      // The always-mounted live region starts empty: the list has not changed
      // under the user yet, and an announcement here would be noise.
      const live = view.container.querySelector('.sr-only[role="status"]');
      expect(live).toHaveTextContent('');

      await user.click(screen.getByTestId('show-more-semantic-results'));
      Object.assign(mockSearchStore, { semanticVisibleCount: 11 });
      rerenderPane(view);

      expect(view.container.querySelector('.sr-only[role="status"]'))
        .toHaveTextContent('11 semantic matches found');
    });
  });

  // A Strong's gloss is the KJV usage list parsed out of the lexicon entry.
  // It is a few words for most entries and 564 characters for G1722 (ev), so a
  // header that printed it whole turned into a paragraph.
  describe("Strong's word-family header", () => {
    const LONG_GLOSS =
      'about, after, against, + almost, X altogether, among, X as, at, before, ' +
      'between, (here-)by (+ all means), for (... sake of), + give self wholly to, ' +
      '(here-)in(-to, -wardly), X mightily, (because) of, (up-)on, (open-)ly';

    function strongsState(gloss: string, strongsNumber = 'G1722') {
      return {
        ...defaultSearchState,
        resultsForQuery: strongsNumber,
        searchResults: [],
        strongsMeta: {
          strongsNumber,
          entry: { word: 'εν', transliteration: 'en', gloss },
          family: [{ strongsNumber, word: 'εν', transliteration: 'en', gloss, relationship: 'self' }],
          groupedCounts: {},
        },
        includeRelatedWords: false,
        toggleIncludeRelatedWords: vi.fn(),
        searchStrongsNumber: vi.fn(),
      };
    }

    it('shows a short gloss in full, with no full-entry link', () => {
      Object.assign(mockSearchStore, strongsState('(be-)love(-ed). Compare 5368', 'G25'));
      renderWithProviders(<SearchResultsPane />);

      expect(screen.getByTestId('strongs-gloss')).toHaveTextContent('(be-)love(-ed). Compare 5368');
      expect(screen.queryByTestId('strongs-full-entry')).not.toBeInTheDocument();
    });

    it('truncates a long gloss at a word boundary and offers the full entry', () => {
      Object.assign(mockSearchStore, strongsState(LONG_GLOSS));
      renderWithProviders(<SearchResultsPane />);

      const rendered = screen.getByTestId('strongs-gloss').textContent ?? '';
      expect(rendered).toContain('about, after, against');
      expect(rendered).toContain('…');
      // Nothing near the end of the gloss survives the cut, and no word is split.
      expect(rendered).not.toContain('(open-)ly');
      expect(rendered.length).toBeLessThan(LONG_GLOSS.length);
      expect(screen.getByTestId('strongs-full-entry')).toBeInTheDocument();
    });

    it('opens the truncated entry in the Dictionary pane', async () => {
      const user = userEvent.setup();
      Object.assign(mockSearchStore, strongsState(LONG_GLOSS));
      renderWithProviders(<SearchResultsPane />);

      await user.click(screen.getByTestId('strongs-full-entry'));
      expect(mockOpenStrongsInDictionary).toHaveBeenCalledWith('G1722');
    });
  });

  // ==========================================================================
  // Distribution sparkline + the approximate-match boundary
  // ==========================================================================

  describe('result distribution and the approximate-match boundary', () => {
    const kw = (verseId: number, reference: string, type: 'exact' | 'fuzzy' | 'stem' = 'exact') => ({
      verseId,
      reference,
      text: 'text',
      type,
      module: 'KJV',
      matches: [],
      score: 1,
    });

    it('mounts the distribution chart above the keyword results', () => {
      Object.assign(mockSearchStore, {
        ...defaultSearchState,
        resultsForQuery: 'love',
        searchResults: [kw(43003016, 'John 3:16'), kw(1001001, 'Gen 1:1')],
      });
      renderWithProviders(<SearchResultsPane />);

      const chart = screen.getByTestId('search-distribution');
      expect(chart).toBeInTheDocument();
      expect(screen.getAllByTestId('distribution-bar')).toHaveLength(66);
      // First thing in the scroll area, so it scrolls away with the results
      // rather than being pinned above them.
      expect(
        chart.compareDocumentPosition(screen.getByTestId('search-results')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('mounts the chart over the semantic results too', () => {
      Object.assign(mockSearchStore, {
        ...defaultSearchState,
        resultsForQuery: 'God loves the world',
        isSemanticMode: true,
        semanticResults: [
          { id: '1', reference: 'John 3:16', text: 'text', startVerseId: 43003016, similarity: 0.9, level: 'verse', textPreview: '' },
        ],
      });
      renderWithProviders(<SearchResultsPane />);
      expect(screen.getByTestId('search-distribution')).toBeInTheDocument();
    });

    it('inserts exactly one labelled divider before the approximate matches', () => {
      Object.assign(mockSearchStore, {
        ...defaultSearchState,
        resultsForQuery: 'lov',
        searchResults: [
          kw(43003016, 'John 3:16'),
          kw(1001001, 'Gen 1:1', 'fuzzy'),
          kw(2001001, 'Exod 1:1', 'fuzzy'),
        ],
      });
      renderWithProviders(<SearchResultsPane />);

      expect(screen.getAllByTestId('fuzzy-divider')).toHaveLength(1);
      expect(screen.getByTestId('fuzzy-divider')).toHaveTextContent('Approximate matches');
      expect(screen.getByTestId('fuzzy-divider')).toHaveTextContent('not counted in the chart above');

      // The two fuzzy rows are below it, styled apart; the exact one is not.
      const rows = screen.getAllByTestId('search-result');
      expect(rows).toHaveLength(3);
      expect(rows.filter(r => r.dataset.approximate === 'true')).toHaveLength(2);
      // The per-row badge stays - it names which word matched.
      expect(screen.getAllByText('Fuzzy')).toHaveLength(2);
    });

    it('groups the fuzzy rows even when the ranker interleaves them with stem rows', () => {
      // `rankResults` sorts exact-vs-not-exact, so `stem` and `fuzzy` share the
      // second tier and interleave there by verse ID. The pane must not trust
      // that ordering to be the boundary.
      Object.assign(mockSearchStore, {
        ...defaultSearchState,
        resultsForQuery: 'lov',
        searchResults: [
          kw(43003016, 'John 3:16'),
          kw(1001001, 'Gen 1:1', 'fuzzy'),
          kw(2001001, 'Exod 1:1', 'stem'),
          kw(3001001, 'Lev 1:1', 'fuzzy'),
        ],
      });
      renderWithProviders(<SearchResultsPane />);

      expect(screen.getAllByTestId('fuzzy-divider')).toHaveLength(1);
      const order = screen.getAllByTestId('search-result').map(r => r.dataset.approximate ?? 'false');
      expect(order).toEqual(['false', 'false', 'true', 'true']);
    });

    it('shows no divider when nothing was approximate', () => {
      Object.assign(mockSearchStore, {
        ...defaultSearchState,
        resultsForQuery: 'love',
        searchResults: [kw(43003016, 'John 3:16')],
      });
      renderWithProviders(<SearchResultsPane />);
      expect(screen.queryByTestId('fuzzy-divider')).not.toBeInTheDocument();
    });

    it("selects and scrolls to a book's first match when its bar is clicked, without navigating", async () => {
      const user = userEvent.setup();
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;

      const setLastClickedId = vi.fn();
      Object.assign(mockSearchStore, {
        ...defaultSearchState,
        resultsForQuery: 'love',
        searchResults: [
          kw(1001001, 'Gen 1:1'),
          kw(43003016, 'John 3:16'),
          kw(43003017, 'John 3:17'),
        ],
        setLastClickedId,
      });
      renderWithProviders(<SearchResultsPane />);

      const john = screen
        .getAllByTestId('distribution-bar')
        .find(el => el.dataset.book === '43')!;
      await user.click(john);

      // The *first* John row, not the last, and by the same ID the last-clicked
      // marker uses.
      expect(setLastClickedId).toHaveBeenCalledWith('keyword|KJV|exact|43003016|43003016');
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
      // A bar must never move the Bible pane: a mis-click costs nothing.
      expect(mockNavigateToVerse).not.toHaveBeenCalled();
    });
  });
});
