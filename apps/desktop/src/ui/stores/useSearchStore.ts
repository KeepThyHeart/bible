import { create } from 'zustand';
import { SearchResult, SearchOptions, SavedSearch, StrongsNumberHelper } from '@bible/core';
import { searchAPI, dictionaryAPI } from '../services/electronAPI';
import { resolveOpenModuleAbbreviations, showSearchResultsPanel } from './crossStoreBridge';
import { whenContextService } from '../services/WhenContextService';
import { useToastStore } from './useToastStore';

// ============================================================================
// Semantic Mode Persistence
// ============================================================================

const SEMANTIC_MODE_STORAGE_KEY = 'bible.search.semanticMode';

function loadPersistedSemanticMode(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    return window.localStorage.getItem(SEMANTIC_MODE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistSemanticMode(mode: boolean): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(SEMANTIC_MODE_STORAGE_KEY, mode ? 'true' : 'false');
  } catch {
    // Ignore storage errors (private mode, quota, etc.)
  }
}

// ============================================================================
// Word Family Types
// ============================================================================

export interface WordFamilyMember {
  strongsNumber: string;          // "G25"
  word?: string;                  // Original-language word
  transliteration?: string;
  gloss: string;
  relationship: 'self' | 'parent' | 'child' | 'related';
  occurrenceCount?: number;
}

export interface StrongsSearchMeta {
  strongsNumber: string;          // Display format, e.g. "G25"
  entry: { word?: string; transliteration?: string; gloss: string } | null;
  family: WordFamilyMember[];
  groupedCounts: Record<string, number>;
}

/**
 * Search Store
 *
 * Manages all search-related UI state using Zustand.
 * This store coordinates with the SearchController to perform searches
 * and manages UI state for search results, options, and dialogs.
 */

/** Semantic search result from the backend */
export interface SemanticResult {
  id: string;
  level: 'verse' | 'paragraph' | 'chapter';
  startVerseId: number;
  endVerseId: number;
  reference: string;
  text: string;
  textPreview: string;
  similarity: number;
}

interface SearchState {
  // Search query and results
  query: string;
  resultsForQuery: string; // The query that the current searchResults are for (not the live input)
  searchResults: SearchResult[];
  isSearching: boolean;
  error: string | null;

  /**
   * The `maxResults` ceiling `searchResults` were actually fetched with.
   *
   * Keyword search has no server-side total: `search:performSearch` returns a
   * capped array and nothing else, so the only honest signal that the set is
   * incomplete is "it came back full". `searchResults.length >= keywordResultLimit`
   * is therefore what drives the "Show All Matches" affordance - a heuristic
   * that can only *over*-offer (a query with exactly `limit` matches shows the
   * button once, and the re-fetch then hides it), never hide a truncated set.
   * That is also why the keyword control carries no number: there isn't one to
   * report truthfully.
   */
  keywordResultLimit: number;
  /**
   * Set once `showAllKeywordResults` has re-fetched at the "show all" ceiling,
   * so the button doesn't come back for a query that genuinely fills even that.
   */
  isShowingAllKeywordResults: boolean;

  // Live search suggestions
  liveSuggestions: SearchResult[];
  isLiveSearching: boolean;
  liveSearchQuery: string; // The query that was actually searched (not the current input)

  // Semantic search state
  isSemanticMode: boolean;
  semanticResults: SemanticResult[];
  isSemanticSearching: boolean;
  semanticAvailable: boolean;
  autoSwitchedToSemantic: boolean; // true if we auto-switched due to 0 keyword results
  /**
   * How many of `semanticResults` the list is currently showing.
   *
   * Semantic search *does* have a real remaining count, because the whole
   * ranked page is fetched up front (`SEMANTIC_FETCH_LIMIT`) and paged in the
   * renderer. `semanticResults.length - semanticVisibleCount` is therefore
   * exactly how many more rows a click will reveal - which is what the
   * "Show {n} More" label promises.
   */
  semanticVisibleCount: number;

  // Strong's word family state (populated when a Strong's-number query is searched)
  strongsMeta: StrongsSearchMeta | null;
  includeRelatedWords: boolean;
  isLoadingWordFamily: boolean;

  // Result interaction state
  /**
   * Stable ID (see `searchResultId`/`semanticResultId`) of the module abbrevs
   * the user has already explicitly retried the current zero-result query
   * against via `retrySearchInModule`. Reset whenever a brand-new top-level
   * query is issued. Lets the zero-result empty state stop re-offering a
   * translation the user already tried.
   */
  retriedModules: string[];
  /**
   * Stable ID of the last-clicked search result (keyword or semantic), so the
   * result list can mark where the user was when they return to it. Reset on
   * a brand-new top-level query.
   */
  lastClickedId: string | null;

  // UI state
  isResultsVisible: boolean;
  isAdvancedDialogOpen: boolean;
  isIndexing: boolean;
  indexingProgress: {
    module: string;
    current: number;
    total: number;
    bookName: string;
  } | null;

  // Search options (persisted)
  searchOptions: SearchOptions;

  // Saved searches
  savedSearches: SavedSearch[];
  isLoadingSavedSearches: boolean;

  // Actions - Search
  setQuery: (query: string) => void;
  performSearch: (query?: string) => Promise<void>;
  performLiveSearch: (query: string) => Promise<void>;
  clearSearch: () => void;
  /**
   * Discard every result set (keyword, semantic, Strong's) and hide the results
   * pane, leaving the query text in the search box.
   *
   * Narrower than `clearSearch`, which also empties the input. Closing the
   * results pane should not retype the user's query away - but it must not
   * leave the results behind either, because "results exist" is what the
   * search bar's count badge reports.
   */
  clearResults: () => void;
  clearError: () => void;

  // Actions - Semantic Search
  toggleSemanticMode: () => void;
  setSemanticMode: (mode: boolean) => void;
  performSemanticSearch: (query?: string) => Promise<void>;
  checkSemanticAvailability: () => Promise<void>;

  // Actions - Result paging
  /**
   * Re-run the current keyword query without the ordinary result ceiling, so
   * the list holds every match. Leaves `lastClickedId`/`retriedModules` alone -
   * this is the same query, not a new one.
   */
  showAllKeywordResults: () => Promise<void>;
  /** Reveal every semantic result already fetched but not yet shown. */
  showMoreSemanticResults: () => void;

  // Actions - Strong's word family
  toggleIncludeRelatedWords: () => Promise<void>;
  searchStrongsNumber: (strongsNumber: string) => Promise<void>;

  // Actions - Result interaction
  /**
   * Re-run the current keyword query, scoped to a single, specific Bible
   * module. Used by the zero-results empty state to offer a retry in another
   * translation the user has open. Explicitly registers the module with the
   * search service (via the `allOpenModules` scope machinery) so it works
   * even if that translation has never been searched in this session.
   */
  retrySearchInModule: (moduleAbbr: string) => Promise<void>;
  setLastClickedId: (id: string | null) => void;

  // Actions - Results
  //
  // There is deliberately no `setResultsVisible`. Hiding the pane while its
  // results stay in the store would leave the search bar's count badge
  // advertising a search nothing on screen can show; `clearResults` above is
  // the supported way to close the results.
  //
  // There is also no distribution-graph visibility flag. The result
  // distribution sparkline is part of the results pane and is always shown
  // above the list.

  // Actions - Search Options
  setSearchOptions: (options: Partial<SearchOptions>) => void;
  resetSearchOptions: () => void;

  // Actions - Advanced Dialog
  openAdvancedDialog: () => void;
  closeAdvancedDialog: () => void;

  // Actions - Saved Searches
  loadSavedSearches: () => Promise<void>;
  saveCurrentSearch: (name: string) => Promise<void>;
  loadSavedSearch: (searchId: number) => Promise<void>;
  deleteSavedSearch: (searchId: number) => Promise<void>;

  // Actions - Indexing
  buildIndex: (modules: string[]) => Promise<void>;
}

/** The ceiling an ordinary keyword search is fetched with. */
export const KEYWORD_DEFAULT_MAX_RESULTS = 200;

/**
 * The ceiling "Show All Matches" re-fetches with. Not `Infinity`: the backend
 * passes `maxResults` straight to a SQL `LIMIT`, and a whole-Bible common word
 * ("the") has tens of thousands of hits that nobody scrolls. High enough that
 * every realistic query comes back complete, low enough to stay a bounded IPC
 * payload.
 */
export const KEYWORD_SHOW_ALL_MAX_RESULTS = 5000;

/**
 * How many ranked semantic hits are fetched per query.
 *
 * Fetched up front rather than page-by-page on purpose: the similarity pass
 * already scores every embedding in the index before slicing, so a larger slice
 * costs only the reference/verse formatting of the extra rows - and holding the
 * full ranked page is the only way to state a *true* remaining count in the
 * "Show {n} More" label before the user clicks it.
 */
export const SEMANTIC_FETCH_LIMIT = 150;

/** How many semantic hits are shown before the user asks for the rest. */
export const SEMANTIC_INITIAL_VISIBLE = 30;

const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  scope: 'currentModule',
  caseSensitive: false,
  wholeWord: false,
  fuzzyDistance: 2,
  proximityDistance: 0,
  maxResults: KEYWORD_DEFAULT_MAX_RESULTS,
  includeContext: false,
  autoFuzzy: true,
};

/**
 * Build the request options for a keyword search of `query` at a given ceiling.
 *
 * Shared by `performSearch` and `showAllKeywordResults` so the "show all"
 * re-fetch cannot silently drift from the original query's scope, module list
 * or Strong's word-family setting - which would make the fuller result set a
 * different search rather than more of the same one.
 */
function buildKeywordRequestOptions(
  state: Pick<SearchState, 'searchOptions' | 'includeRelatedWords'>,
  query: string,
  maxResults: number,
): SearchOptions {
  let options: SearchOptions = { ...state.searchOptions, maxResults };
  if (state.searchOptions.scope === 'allOpenModules') {
    options = { ...options, modules: resolveOpenModuleAbbreviations() };
  }
  if (StrongsNumberHelper.isStrongsNumber(query.trim())) {
    options = { ...options, includeRelatedWords: state.includeRelatedWords };
  }
  return options;
}

/**
 * The comparable form of a search string.
 *
 * The input can carry a leading `?` (the explicit "search, don't navigate"
 * prefix) and surrounding whitespace, while `resultsForQuery` holds the
 * stripped text that was actually searched. Comparing the two raw would report
 * "`?grace`" and "`grace`" as different queries and throw away results the user
 * has not touched.
 */
export function normalizeSearchQuery(input: string): string {
  const trimmed = input.trim();
  return (trimmed.startsWith('?') ? trimmed.slice(1) : trimmed).trim();
}

/**
 * The state patch that empties every result set the panes and the count badge
 * read from, without touching the query text, the results-pane visibility flag
 * or the persisted semantic-mode preference.
 *
 * Shared by `clearResults` and `setQuery` so a stale result set cannot survive
 * in one code path and not the other - the count badge on the search bar is
 * derived from these arrays, and any array left populated is a badge that lies.
 */
function emptyResultsPatch(): Partial<SearchState> {
  return {
    resultsForQuery: '',
    searchResults: [],
    keywordResultLimit: KEYWORD_DEFAULT_MAX_RESULTS,
    isShowingAllKeywordResults: false,
    semanticResults: [],
    semanticVisibleCount: SEMANTIC_INITIAL_VISIBLE,
    autoSwitchedToSemantic: false,
    strongsMeta: null,
    includeRelatedWords: false,
    retriedModules: [],
    lastClickedId: null,
  };
}

export const useSearchStore = create<SearchState>((set, get) => ({
  // Initial state
  query: '',
  resultsForQuery: '',
  searchResults: [],
  isSearching: false,
  error: null,
  keywordResultLimit: KEYWORD_DEFAULT_MAX_RESULTS,
  isShowingAllKeywordResults: false,

  liveSuggestions: [],
  isLiveSearching: false,
  liveSearchQuery: '',

  isSemanticMode: loadPersistedSemanticMode(),
  semanticResults: [],
  isSemanticSearching: false,
  semanticAvailable: false,
  autoSwitchedToSemantic: false,
  semanticVisibleCount: SEMANTIC_INITIAL_VISIBLE,

  strongsMeta: null,
  includeRelatedWords: false,
  isLoadingWordFamily: false,

  retriedModules: [],
  lastClickedId: null,

  isResultsVisible: false,
  isAdvancedDialogOpen: false,
  isIndexing: false,
  indexingProgress: null,

  searchOptions: DEFAULT_SEARCH_OPTIONS,

  savedSearches: [],
  isLoadingSavedSearches: false,

  // ========================================================================
  // Search Actions
  // ========================================================================

  /**
   * Update the text in the search box.
   *
   * Editing the text invalidates whatever the previous text produced: the
   * results on screen (and the count badge above them) answer a question the
   * user has already moved on from. They are dropped as soon as the two
   * diverge, and come back when the new query is actually run.
   *
   * The visibility flag is left alone on purpose - typing should not close a
   * pane the user opened; it only empties it.
   */
  setQuery: (query: string) => {
    const state = get();
    const hasResults =
      state.searchResults.length > 0 || state.semanticResults.length > 0;
    if (
      hasResults &&
      normalizeSearchQuery(query) !== normalizeSearchQuery(state.resultsForQuery)
    ) {
      set({ query, ...emptyResultsPatch() });
      return;
    }
    set({ query });
  },

  performSearch: async (query?: string) => {
    const queryToSearch = query || get().query;

    if (!queryToSearch.trim()) {
      set({ error: 'Please enter a search query' });
      return;
    }

    set({
      isSearching: true,
      error: null,
      query: queryToSearch,
      // A brand-new top-level query invalidates any "already tried this
      // translation" / "last visited result" bookkeeping from the previous one.
      retriedModules: [],
      lastClickedId: null,
    });

    // Detect Strong's-number query
    const isStrongs = StrongsNumberHelper.isStrongsNumber(queryToSearch.trim());
    if (!isStrongs) {
      // Clear any previous Strong's meta when a non-Strong's search starts
      set({ strongsMeta: null, includeRelatedWords: false });
    }

    try {
      // Scope resolution (`allOpenModules` -> concrete module list) and the
      // Strong's `includeRelatedWords` flag both live in this helper so
      // `showAllKeywordResults` re-issues the *same* search, just uncapped.
      const requestedLimit = get().searchOptions.maxResults ?? KEYWORD_DEFAULT_MAX_RESULTS;
      const searchOptions = buildKeywordRequestOptions(get(), queryToSearch, requestedLimit);

      const results = await searchAPI.performSearch(queryToSearch, searchOptions);

      // Reset proximity distance after search completes (per user requirement)
      set({
        searchResults: results,
        resultsForQuery: queryToSearch,
        isResultsVisible: true,
        isSearching: false,
        keywordResultLimit: requestedLimit,
        isShowingAllKeywordResults: false,
        semanticVisibleCount: SEMANTIC_INITIAL_VISIBLE,
        // Only reset semantic mode on a fresh query if it was auto-switched
        // (a user-selected mode should persist across searches).
        isSemanticMode: get().autoSwitchedToSemantic ? false : get().isSemanticMode,
        autoSwitchedToSemantic: false,
        semanticResults: [],
        searchOptions: {
          ...get().searchOptions,
          proximityDistance: 0,
        },
      });

      // Persist mode change if we cleared auto-switch
      persistSemanticMode(get().isSemanticMode);

      // Surface the results pane. Opens a `search` dockview panel below the
      // active Bible pane the first time, and merely focuses it thereafter -
      // wherever the user has since dragged it to. See
      // `useLayoutStore.openSearchResultsPanel`.
      showSearchResultsPanel();

      // If a Strong's number was searched, kick off the word-family fetch
      // (fire-and-forget - updates strongsMeta when ready).
      if (isStrongs) {
        loadWordFamily(queryToSearch.trim(), results).then(meta => {
          if (meta) set({ strongsMeta: meta });
        }).catch(err => console.error('Word family load failed:', err));
      }

      // If user is in semantic mode, run semantic search as well
      if (get().isSemanticMode && get().semanticAvailable && !isStrongs) {
        get().performSemanticSearch(queryToSearch);
      } else if (results.length === 0 && get().semanticAvailable && !isStrongs) {
        // Auto-switch to semantic search if no keyword results found
        set({ isSemanticMode: true, autoSwitchedToSemantic: true });
        persistSemanticMode(true);
        get().performSemanticSearch(queryToSearch);
      }
    } catch (error) {
      // Create a user-friendly error message
      let errorMessage = 'Search failed';
      if (error instanceof Error) {
        // Check for common FTS5 syntax errors and provide helpful messages
        if (error.message.includes('fts5: syntax error')) {
          errorMessage = 'Invalid search query. Special characters like * may need to be removed or the query rephrased.';
        } else if (error.message.includes('Search failed:')) {
          // Extract just the user-relevant part
          const cleanMessage = error.message.replace(/Search failed:\s*/i, '').replace(/Query failed:\s*/i, '');
          // If it still contains SQL or technical details, use generic message
          if (cleanMessage.includes('SQL:') || cleanMessage.includes('fts5:')) {
            errorMessage = 'Invalid search query. Please check your search terms and try again.';
          } else {
            errorMessage = cleanMessage;
          }
        } else {
          errorMessage = error.message;
        }
      }
      set({
        error: errorMessage,
        isSearching: false,
      });
    }
  },

  performLiveSearch: async (query: string) => {
    // Don't search if query is too short
    if (!query.trim() || query.trim().length < 3) {
      set({ liveSuggestions: [], isLiveSearching: false, liveSearchQuery: '' });
      return;
    }

    set({ isLiveSearching: true, liveSearchQuery: query });

    try {
      // Perform search with limited results (max 10 for suggestions)
      const baseOptions = get().searchOptions;
      let searchOptions: any = {
        ...baseOptions,
        maxResults: 10,
        autoFuzzy: false, // Disable auto-fuzzy for live suggestions
      };

      // If scope is allOpenModules, gather the currently open module
      // abbreviations via the cross-store bridge (resolved by storeSync.ts).
      if (baseOptions.scope === 'allOpenModules') {
        searchOptions = {
          ...searchOptions,
          openModules: resolveOpenModuleAbbreviations(),
        };
      }

      const results = await searchAPI.performSearch(query, searchOptions);

      set({
        liveSuggestions: results,
        isLiveSearching: false,
      });
    } catch (error) {
      console.error('Live search failed:', error);
      useToastStore.getState().addToast('Search failed. Please try again.', 'error');
      set({
        liveSuggestions: [],
        isLiveSearching: false,
      });
    }
  },

  clearSearch: () => {
    set({
      query: '',
      resultsForQuery: '',
      searchResults: [],
      liveSuggestions: [],
      liveSearchQuery: '',
      isResultsVisible: false,
      error: null,
      keywordResultLimit: KEYWORD_DEFAULT_MAX_RESULTS,
      isShowingAllKeywordResults: false,
      // Keep persisted semantic mode selection when clearing; only reset auto-switch.
      autoSwitchedToSemantic: false,
      semanticResults: [],
      semanticVisibleCount: SEMANTIC_INITIAL_VISIBLE,
      strongsMeta: null,
      includeRelatedWords: false,
      retriedModules: [],
      lastClickedId: null,
    });
  },

  clearResults: () => {
    set({ ...emptyResultsPatch(), isResultsVisible: false, error: null });
  },

  clearError: () => {
    set({ error: null });
  },

  // ========================================================================
  // Semantic Search Actions
  // ========================================================================

  checkSemanticAvailability: async () => {
    try {
      const available = await searchAPI.semanticAvailable();
      set({ semanticAvailable: available });
    } catch (error) {
      console.error('Failed to check semantic availability:', error);
      set({ semanticAvailable: false });
    }
  },

  toggleSemanticMode: () => {
    const { isSemanticMode, resultsForQuery } = get();
    if (isSemanticMode) {
      // Switching back to keyword mode
      set({ isSemanticMode: false, autoSwitchedToSemantic: false });
      persistSemanticMode(false);
    } else {
      // Switching to semantic mode - trigger semantic search
      set({ isSemanticMode: true, autoSwitchedToSemantic: false });
      persistSemanticMode(true);
      if (resultsForQuery) {
        get().performSemanticSearch(resultsForQuery);
      }
    }
  },

  setSemanticMode: (mode: boolean) => {
    if (get().isSemanticMode === mode) return;
    set({ isSemanticMode: mode, autoSwitchedToSemantic: false });
    persistSemanticMode(mode);
    const { resultsForQuery, semanticAvailable } = get();
    if (mode && resultsForQuery && semanticAvailable) {
      get().performSemanticSearch(resultsForQuery);
    }
  },

  // ========================================================================
  // Strong's Word Family Actions
  // ========================================================================

  toggleIncludeRelatedWords: async () => {
    const next = !get().includeRelatedWords;
    set({ includeRelatedWords: next });
    // Re-run the current Strong's search with the new setting.
    const { resultsForQuery } = get();
    if (resultsForQuery && StrongsNumberHelper.isStrongsNumber(resultsForQuery)) {
      await get().performSearch(resultsForQuery);
    }
  },

  searchStrongsNumber: async (strongsNumber: string) => {
    const display = StrongsNumberHelper.toDisplayFormat(strongsNumber);
    if (!display) return;
    set({ query: display });
    await get().performSearch(display);
  },

  performSemanticSearch: async (query?: string) => {
    const queryToSearch = query || get().query;

    if (!queryToSearch.trim()) {
      return;
    }

    set({ isSemanticSearching: true });

    try {
      const results = await searchAPI.semanticSearch(queryToSearch, {
        maxResults: SEMANTIC_FETCH_LIMIT,
        levels: ['verse', 'paragraph'],
      });

      set({
        semanticResults: results,
        semanticVisibleCount: SEMANTIC_INITIAL_VISIBLE,
        isSemanticSearching: false,
      });

      // A semantic search can be run on its own (the brain toggle, or the
      // auto-switch after zero keyword hits), so it has to surface the pane too.
      showSearchResultsPanel();
    } catch (error) {
      console.error('Semantic search failed:', error);
      set({
        semanticResults: [],
        semanticVisibleCount: SEMANTIC_INITIAL_VISIBLE,
        isSemanticSearching: false,
      });
    }
  },

  // ========================================================================
  // Result Paging Actions
  // ========================================================================

  showAllKeywordResults: async () => {
    const { resultsForQuery, query, isSearching, isShowingAllKeywordResults } = get();
    const queryToSearch = resultsForQuery || query;
    if (!queryToSearch.trim() || isSearching || isShowingAllKeywordResults) return;

    set({ isSearching: true, error: null });

    try {
      const searchOptions = buildKeywordRequestOptions(
        get(),
        queryToSearch,
        KEYWORD_SHOW_ALL_MAX_RESULTS,
      );
      const results = await searchAPI.performSearch(queryToSearch, searchOptions);

      set({
        searchResults: results,
        resultsForQuery: queryToSearch,
        keywordResultLimit: KEYWORD_SHOW_ALL_MAX_RESULTS,
        // Sticky even if the query somehow fills the "show all" ceiling too:
        // re-offering a button that cannot produce anything more is worse than
        // quietly capping.
        isShowingAllKeywordResults: true,
        isSearching: false,
      });
    } catch (error) {
      console.error('Show-all search failed:', error);
      set({
        error: error instanceof Error ? error.message : 'Search failed',
        isSearching: false,
      });
    }
  },

  showMoreSemanticResults: () => {
    set(state => ({ semanticVisibleCount: state.semanticResults.length }));
  },

  // ========================================================================
  // Result Interaction Actions
  // ========================================================================

  retrySearchInModule: async (moduleAbbr: string) => {
    const queryToSearch = get().resultsForQuery || get().query;
    if (!queryToSearch.trim()) return;

    set({ isSearching: true, error: null });

    try {
      // `scope: 'allOpenModules'` + `openModules` (rather than `modules`) is
      // deliberate: it's the one path the main-process handler uses to
      // register a module with the search service on demand (see
      // `search:performSearch` in searchHandlers.ts), so this works even for
      // a translation that has never been searched yet this session.
      const requestedLimit = get().searchOptions.maxResults ?? KEYWORD_DEFAULT_MAX_RESULTS;
      const searchOptions = {
        ...get().searchOptions,
        maxResults: requestedLimit,
        scope: 'allOpenModules',
        openModules: [moduleAbbr],
      };

      const results = await searchAPI.performSearch(queryToSearch, searchOptions);

      set((state) => ({
        searchResults: results,
        resultsForQuery: queryToSearch,
        query: queryToSearch,
        isResultsVisible: true,
        isSearching: false,
        keywordResultLimit: requestedLimit,
        isShowingAllKeywordResults: false,
        isSemanticMode: false,
        autoSwitchedToSemantic: false,
        semanticResults: [],
        semanticVisibleCount: SEMANTIC_INITIAL_VISIBLE,
        retriedModules: state.retriedModules.includes(moduleAbbr)
          ? state.retriedModules
          : [...state.retriedModules, moduleAbbr],
      }));
    } catch (error) {
      console.error('Retry search in module failed:', error);
      set({
        error: error instanceof Error ? error.message : 'Search failed',
        isSearching: false,
      });
    }
  },

  setLastClickedId: (id: string | null) => {
    set({ lastClickedId: id });
  },

  // ========================================================================
  // Search Options Actions
  // ========================================================================

  setSearchOptions: (options: Partial<SearchOptions>) => {
    set((state) => ({
      searchOptions: {
        ...state.searchOptions,
        ...options,
      },
    }));
  },

  resetSearchOptions: () => {
    set({ searchOptions: DEFAULT_SEARCH_OPTIONS });
  },

  // ========================================================================
  // Advanced Dialog Actions
  // ========================================================================

  openAdvancedDialog: () => {
    set({ isAdvancedDialogOpen: true });
  },

  closeAdvancedDialog: () => {
    set({ isAdvancedDialogOpen: false });
  },

  // ========================================================================
  // Saved Searches Actions
  // ========================================================================

  loadSavedSearches: async () => {
    set({ isLoadingSavedSearches: true });

    try {
      const savedSearches = await searchAPI.getSavedSearches();

      set({
        savedSearches,
        isLoadingSavedSearches: false,
      });
    } catch (error) {
      console.error('Failed to load saved searches:', error);
      set({ isLoadingSavedSearches: false });
    }
  },

  saveCurrentSearch: async (name: string) => {
    try {
      const { query, searchOptions } = get();
      const parsed = { searchType: 'multi-word' }; // Simplified - would parse the query

      await searchAPI.saveSearch(
        name,
        query,
        parsed.searchType,
        { scope: searchOptions.scope || 'currentModule' },
        searchOptions
      );

      // Reload saved searches
      await get().loadSavedSearches();
    } catch (error) {
      console.error('Failed to save search:', error);
      throw error;
    }
  },

  loadSavedSearch: async (searchId: number) => {
    try {
      const savedSearch = await searchAPI.loadSavedSearch(searchId);

      if (savedSearch) {
        // Update search options
        set({
          query: savedSearch.query,
          searchOptions: savedSearch.options,
        });

        // Perform the search
        await get().performSearch();
      }
    } catch (error) {
      console.error('Failed to load saved search:', error);
      throw error;
    }
  },

  deleteSavedSearch: async (searchId: number) => {
    try {
      await searchAPI.deleteSavedSearch(searchId);

      // Reload saved searches
      await get().loadSavedSearches();
    } catch (error) {
      console.error('Failed to delete saved search:', error);
      throw error;
    }
  },

  // (the app does not record what users search for)

  // ========================================================================
  // Indexing Actions
  // ========================================================================

  buildIndex: async (modules: string[]) => {
    set({
      isIndexing: true,
      indexingProgress: null,
    });

    try {
      await searchAPI.buildIndex(modules, (progress) => {
        set({ indexingProgress: progress });
      });

      set({
        isIndexing: false,
        indexingProgress: null,
      });
    } catch (error) {
      console.error('Failed to build index:', error);
      set({
        isIndexing: false,
        indexingProgress: null,
      });
      throw error;
    }
  },
}));

// ============================================================================
// Result Identity Helpers
// ============================================================================
//
// Stable IDs for "last clicked" tracking. Namespaced by result kind so a
// keyword result and a semantic result can never collide even though both
// lists share the same `lastClickedId` field.

/** Stable ID for a keyword `SearchResult`. Includes the range end so an
 * overlapping multi-verse result doesn't collide with a single-verse one. */
export function searchResultId(result: SearchResult): string {
  const endId = result.verseIds && result.verseIds.length > 0
    ? result.verseIds[result.verseIds.length - 1]
    : result.verseId;
  return `keyword|${result.module}|${result.type}|${result.verseId}|${endId}`;
}

/** Stable ID for a `SemanticResult`. */
export function semanticResultId(result: SemanticResult): string {
  return `semantic|${result.id}`;
}

// ============================================================================
// Word Family Loader
// ============================================================================
//
// Word-family data is derived on the frontend by:
//   1) Finding an installed Strong's dictionary (Greek or Hebrew).
//   2) Loading the primary entry via `dictionary:getEntryByKey`.
//   3) Parsing its definition for cross-references ("from N", "see GREEK for N",
//      "Compare N").
//   4) Loading each related entry by key.
//   5) Counting occurrences of each Strong's number in the current search
//      result set (grouping matches by the strongs_number metadata).
//
// This mirrors the core WordFamilyService logic but runs client-side to avoid
// adding new IPC channels. Results are cached implicitly by the store.

const STRONGS_DICT_CACHE: { greek: string | null; hebrew: string | null; loaded: boolean } = {
  greek: null,
  hebrew: null,
  loaded: false,
};

async function resolveStrongsDictionaries(): Promise<{ greek: string | null; hebrew: string | null }> {
  if (STRONGS_DICT_CACHE.loaded) {
    return { greek: STRONGS_DICT_CACHE.greek, hebrew: STRONGS_DICT_CACHE.hebrew };
  }
  try {
    const dicts = await dictionaryAPI.getAvailableDictionaries();
    let greek: string | null = null;
    let hebrew: string | null = null;
    for (const d of dicts) {
      const type = (d.dictionary_type || '').toLowerCase();
      const abbr = d.abbreviation;
      if (!abbr) continue;
      // Prefer strongs_greek/strongshebrew style dictionaries; fall back to lexicon types.
      if (!greek && (type === 'greek_lexicon' || /strong.*greek|greek.*strong/i.test(abbr))) {
        greek = abbr;
      }
      if (!hebrew && (type === 'hebrew_lexicon' || /strong.*hebrew|hebrew.*strong/i.test(abbr))) {
        hebrew = abbr;
      }
    }
    STRONGS_DICT_CACHE.greek = greek;
    STRONGS_DICT_CACHE.hebrew = hebrew;
    STRONGS_DICT_CACHE.loaded = true;
    return { greek, hebrew };
  } catch (err) {
    console.error('Failed to resolve Strong\'s dictionaries:', err);
    return { greek: null, hebrew: null };
  }
}

interface DefinitionParseResult {
  word?: string;
  transliteration?: string;
  gloss: string;
  derivedFrom?: number;
  seeRefs: number[];
  compareRefs: number[];
}

function parseStrongsDefinition(def: string, prefix: 'G' | 'H'): DefinitionParseResult {
  const result: DefinitionParseResult = { gloss: '', seeRefs: [], compareRefs: [] };

  // Header: "25 ἀγαπάω ajgapavw agapao {ag-ap-ah'-o}"
  const headerMatch = def.match(/^(\d+)\s+(\S+)\s+\S+\s+(\S+)\s*\{([^}]*)\}/);
  if (headerMatch) {
    result.word = headerMatch[2];
    result.transliteration = headerMatch[3];
  }

  // Gloss: text after ":--"
  const glossSep = def.indexOf(':--');
  if (glossSep >= 0) {
    const glossPart = def.substring(glossSep + 3).trim();
    result.gloss = glossPart
      .replace(/\s*see\s+(?:GREEK|HEBREW)\s+for\s+\d+\s*/gi, '')
      .replace(/\s*\.\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // "from <N>"
  const fromMatch = def.match(/\bfrom\s+(\d+)\s*[;,]/);
  if (fromMatch) {
    result.derivedFrom = parseInt(fromMatch[1], 10);
  }

  // "see GREEK/HEBREW for <N>"
  const lang = prefix === 'G' ? 'GREEK' : 'HEBREW';
  const seeRegex = new RegExp(`see\\s+${lang}\\s+for\\s+0*(\\d+)`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = seeRegex.exec(def)) !== null) {
    const n = parseInt(m[1], 10);
    if (n !== result.derivedFrom && !result.seeRefs.includes(n)) {
      result.seeRefs.push(n);
    }
  }

  // "Compare <N>"
  const cmpRegex = /\bCompare\s+(\d+)\b/gi;
  while ((m = cmpRegex.exec(def)) !== null) {
    const n = parseInt(m[1], 10);
    if (!result.compareRefs.includes(n)) result.compareRefs.push(n);
  }

  return result;
}

function paddedKey(n: number): string {
  return String(n).padStart(5, '0');
}

async function loadWordFamily(query: string, results: SearchResult[]): Promise<StrongsSearchMeta | null> {
  const parsed = StrongsNumberHelper.parse(query);
  if (!parsed) return null;
  const display = StrongsNumberHelper.toDisplayFormat(query);
  if (!display) return null;

  const { greek, hebrew } = await resolveStrongsDictionaries();
  const dictAbbr = parsed.prefix === 'G' ? greek : hebrew;

  // Even without a dictionary, we can still return an entry with counts from results.
  const family: WordFamilyMember[] = [];
  let primaryEntry: DefinitionParseResult | null = null;

  if (dictAbbr) {
    try {
      const primary = await dictionaryAPI.getEntryByKey(dictAbbr, paddedKey(parsed.number));
      if (primary && primary.definition) {
        primaryEntry = parseStrongsDefinition(primary.definition, parsed.prefix);
        family.push({
          strongsNumber: display,
          word: primaryEntry.word,
          transliteration: primaryEntry.transliteration,
          gloss: primaryEntry.gloss,
          relationship: 'self',
        });

        const relatedNums = new Set<number>();
        if (primaryEntry.derivedFrom) relatedNums.add(primaryEntry.derivedFrom);
        for (const n of primaryEntry.seeRefs) relatedNums.add(n);
        for (const n of primaryEntry.compareRefs) relatedNums.add(n);
        relatedNums.delete(parsed.number);

        // Load related entries in parallel
        const relatedResults = await Promise.all(
          Array.from(relatedNums).map(async n => {
            try {
              const entry = await dictionaryAPI.getEntryByKey(dictAbbr, paddedKey(n));
              if (!entry || !entry.definition) return null;
              const info = parseStrongsDefinition(entry.definition, parsed.prefix);
              const isChild = primaryEntry?.derivedFrom !== n; // child if the related number is not the parent
              const relationship: WordFamilyMember['relationship'] =
                primaryEntry?.derivedFrom === n ? 'parent' :
                isChild && primaryEntry?.seeRefs.includes(n) ? 'related' :
                'related';
              return {
                strongsNumber: `${parsed.prefix}${n}`,
                word: info.word,
                transliteration: info.transliteration,
                gloss: info.gloss,
                relationship,
              } as WordFamilyMember;
            } catch {
              return null;
            }
          })
        );
        for (const r of relatedResults) {
          if (r) family.push(r);
        }
      }
    } catch (err) {
      console.error('Failed to load Strong\'s entry:', err);
    }
  }

  // Compute per-Strong's occurrence counts from the current results.
  // Each SearchResult carries match info; for Strong's searches the returned
  // results have `matches[].term` set to the matched Strong's number.
  const groupedCounts: Record<string, number> = {};
  for (const r of results) {
    if (!r.matches) continue;
    for (const m of r.matches) {
      const norm = StrongsNumberHelper.toDisplayFormat(m.term);
      if (!norm) continue;
      groupedCounts[norm] = (groupedCounts[norm] ?? 0) + 1;
    }
  }
  // If matches don't include Strong's numbers (older search results), fall
  // back to a single count for the primary number.
  if (Object.keys(groupedCounts).length === 0) {
    groupedCounts[display] = results.length;
  }

  // Attach counts onto family members
  for (const m of family) {
    if (groupedCounts[m.strongsNumber] !== undefined) {
      m.occurrenceCount = groupedCounts[m.strongsNumber];
    }
  }

  return {
    strongsNumber: display,
    entry: primaryEntry ? {
      word: primaryEntry.word,
      transliteration: primaryEntry.transliteration,
      gloss: primaryEntry.gloss,
    } : null,
    family,
    groupedCounts,
  };
}

// Publish search-related state into WhenContextService.
// searchActive: true if a search is running OR results are being shown.
// searchHasResults: true if keyword or semantic results are non-empty.
function publishSearchWhenContext(state: SearchState): void {
  const active =
    state.isSearching ||
    state.isSemanticSearching ||
    state.isResultsVisible;
  const hasResults =
    state.searchResults.length > 0 || state.semanticResults.length > 0;
  whenContextService.set('searchActive', active);
  whenContextService.set('searchHasResults', hasResults);
}

publishSearchWhenContext(useSearchStore.getState());
useSearchStore.subscribe(publishSearchWhenContext);
