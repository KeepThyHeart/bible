import { create } from 'zustand';
import { dedupeSemanticResults } from '../utils/dedupeSemanticResults';
import { SearchResult, SearchOptions, SavedSearch, StrongsNumberHelper } from '@bible/core';
import type { RemoteSemantic } from '@bible/core';
import { searchAPI, dictionaryAPI, remoteSemanticAPI } from '../services/electronAPI';
import type { RemoteSemanticStatus, RemoteConsentChoice, SemanticSearchExReply, SemanticSource } from '../services/electronAPI';
import {
  resolveOpenModuleAbbreviations,
  resolveActiveBibleModule,
  resolveInstalledModuleId,
  showSearchResultsPanel,
  closeSearchResultsPanel,
} from './crossStoreBridge';
import { whenContextService } from '../services/WhenContextService';
import { useToastStore } from './useToastStore';
import { moduleAPI } from './module/moduleAPI';

// ============================================================================
// Semantic Mode Persistence
// ============================================================================

// `.v2`: the old key was also written by the (removed) automatic switch to
// Ideas search after zero keyword hits, so a stored `true` there may never
// have been the user's choice. Starting from a fresh key puts everyone back on
// keyword search until they pick Ideas themselves.
const SEMANTIC_MODE_STORAGE_KEY = 'bible.search.semanticMode.v2';

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
 *
 * ## Search tabs (task 0210)
 *
 * The desktop app can hold several search result tabs at once. Each tab is a
 * *session*: its own query, results, paging, semantic and Strong's state. The
 * session id IS the dockview panel id of the tab that shows it.
 *
 * The **active** session's fields live in the flat state below (`query`,
 * `searchResults`, ...), exactly where a single search lived before tabs
 * existed. Every other session is *parked* in `parkedSessions`. Switching tabs
 * (`activateSession`) swaps the two in one `set`. That is deliberate: the ~30
 * readers of this store (header box, count badge, highlights, study panes,
 * the Advanced dialog, when-context flags) all want "the search the reader is
 * looking at", and they get it without knowing tabs exist. Only a results pane
 * has to ask for its own session (`selectSessionView`), because two search
 * tabs can be visible side by side.
 *
 * Async work captures its session id when it starts and writes back through
 * `patchSession`, which lands the patch in the flat state when that session is
 * active, in its parked copy when it is not, and nowhere when the tab was
 * closed meanwhile. A per-session request counter drops a slower, older reply
 * that would overwrite a newer one (the stale-result guard, per tab).
 *
 * Shared state stays global: options, saved searches, indexing, semantic
 * availability, the online-search consent and the header's live suggestions.
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

/** A search tab brought back from the saved layout (its query only; results are re-run). */
export interface RestoredSearchTab {
  id: string;
  query: string;
  semantic?: boolean;
  /** The search host panel that shows it as a sub-tab ("Tab in the right pane"). */
  hostPanelId?: string;
  /** Restore it as the most recently used (the sub-tab that was selected). */
  recent?: boolean;
}

/** Book-keeping for one session that is not part of what its pane shows. */
export interface SearchSessionMeta {
  /** A dockview panel shows this session. A session without one is a search still on its way to a tab. */
  hasPanel: boolean;
  /** Monotonic use stamp; the least recently used tab is the one the cap replaces. */
  lastUsed: number;
  /**
   * "Tab in the right pane" placement (0210 follow-up): the id of the one
   * general Search panel that shows this session as a sub-tab. Absent or null
   * when the session has its own dockview tab (panel id = session id).
   */
  hostPanelId?: string | null;
  /** Creation stamp: the order of sub-tabs inside a search host panel. */
  createdAt?: number;
  /**
   * Preview-tab model: an unpinned search tab (italic title) is reused by the
   * next plain search; a pinned one is kept, and the next search opens a new tab.
   */
  pinned?: boolean;
}

export interface PerformSearchOptions {
  /** Read `&&`, `||`, `!` and parentheses as operators (Advanced Search dialog, B-017). */
  symbolOperators?: boolean;
  /** Open the results in a new search tab instead of replacing the active tab's search. */
  newTab?: boolean;
  /** Run in this session (a restored tab's re-run). Defaults to the active session. */
  sessionId?: string;
  /**
   * Focus the results tab when they arrive. Defaults to "only if the session is
   * still the active one" so a background re-run never steals focus.
   */
  reveal?: boolean;
  /** Semantic mode of a session created by `newTab` (defaults to the persisted preference). */
  semantic?: boolean;
}

interface SearchState {
  // Search query and results
  query: string;
  resultsForQuery: string; // The query that the current searchResults are for (not the live input)
  searchResults: SearchResult[];
  /**
   * The translation(s) the current keyword results were run in (B-005). The
   * results stay when the reader switches translation; the pane names these so
   * they are not mistaken for the new one.
   */
  searchedModules: string[];
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

  /**
   * Lightweight, best-effort note for the module manager's F8 keyword index
   * (task 0033 follow-up to 0027's F8): how many of the *installed* modules
   * that produced hits in the current keyword result set report a keyword
   * index that is not `ready`. `null` when nothing to say - no keyword
   * results yet, or every module involved is `ready`.
   *
   * Purely informational. The backend already degrades search gracefully for
   * a module whose keyword index is not ready, so this never blocks, retries
   * or errors the search; a lookup failure for one module is silently
   * excluded from the count rather than surfaced.
   */
  keywordIndexNotice: { pending: number; total: number } | null;

  // Live search suggestions (global: they belong to the header box)
  liveSuggestions: SearchResult[];
  isLiveSearching: boolean;
  liveSearchQuery: string; // The query that was actually searched (not the current input)

  // Semantic search state
  isSemanticMode: boolean;
  semanticResults: SemanticResult[];
  isSemanticSearching: boolean;
  semanticAvailable: boolean;
  /**
   * How many of `semanticResults` the list is currently showing.
   *
   * Semantic search *does* have a real remaining count, because the whole
   * ranked page is fetched up front (`SEMANTIC_FETCH_LIMIT`) and paged in the
   * renderer.
   */
  semanticVisibleCount: number;

  // Online meaning search (task 0190). Null status = not asked yet / not configured.
  /** Cached status of the remote option; `null` until first read. */
  remoteSemanticStatus: RemoteSemanticStatus | null;
  /** True while the first-use consent modal is showing. */
  consentDialogOpen: boolean;
  /** Where the last semantic rows came from, and the note about it. */
  semanticSource: SemanticSearchExReply['source'] | null;
  semanticNotice: SemanticSearchExReply['notice'] | null;
  semanticRateLimit: SemanticSearchExReply['rateLimit'] | null;

  // Strong's word family state (populated when a Strong's-number query is searched)
  strongsMeta: StrongsSearchMeta | null;
  includeRelatedWords: boolean;
  isLoadingWordFamily: boolean;

  // Result interaction state
  /**
   * Module abbrevs the user has already explicitly retried the current
   * zero-result query against via `retrySearchInModule`. Reset whenever a
   * brand-new top-level query is issued.
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

  // --------------------------------------------------------------------------
  // Search tabs (task 0210)
  // --------------------------------------------------------------------------

  /** The session the flat fields above belong to; `null` before the first search. */
  activeSessionId: string | null;
  /** Every other session, keyed by its results panel id. */
  parkedSessions: Record<string, SearchSessionFields>;
  /** Panel and recency book-keeping for every session, active included. */
  sessionMeta: Record<string, SearchSessionMeta>;
  /** A tab restored from the saved layout whose query has not been re-run yet. */
  pendingRerun: boolean;

  /** Make a parked session the active one (a search tab was focused). */
  activateSession: (sessionId: string) => void;
  /** Drop a session (its tab closed). The most recently used remaining tab becomes active. */
  closeSession: (sessionId: string) => void;
  /**
   * A search panel was removed: drop its session, or - for a search host panel
   * ("Tab in the right pane") - every session it showed as a sub-tab.
   */
  closePanelSessions: (panelId: string) => void;
  /** Recreate tabs from a saved layout; each re-runs its query when first shown. */
  restoreSessions: (tabs: RestoredSearchTab[]) => void;
  /** Re-run a restored tab's query if it has not been run yet. */
  runPendingRerun: (sessionId: string) => Promise<void>;
  /** "Open in new search tab": run this tab's search again in a new tab. */
  openSessionInNewTab: (sessionId: string) => Promise<void>;
  /** Pin (or unpin, `pinned = false`) a search tab; omitted toggles. A pinned tab is not reused by the next search. */
  pinSession: (sessionId: string, pinned?: boolean) => void;
  /** Apply a patch to one session wherever it lives; false when the session is gone. */
  patchSession: (sessionId: string, patch: Partial<SearchSessionFields>) => boolean;

  // Actions - Search
  /**
   * Update the text in the search box.
   *
   * With search tabs, the box is a draft: typing no longer empties the active
   * tab's results (they are labelled with their own query in the tab and the
   * pane heading), so a query typed for Ctrl+Enter does not wipe the tab the
   * reader is leaving. The count badge only shows while the box still holds
   * the query the results are for.
   */
  setQuery: (query: string) => void;
  /**
   * Run a keyword search. By default it replaces the active tab's search;
   * `newTab` opens a new search tab. `symbolOperators` (set only by the
   * Advanced Search dialog, B-017) reads `&&`, `||`, `!` and parentheses as
   * boolean operators for this query; every ordinary search clears it.
   */
  performSearch: (query?: string, opts?: PerformSearchOptions) => Promise<void>;
  /** Whether the current results were run with symbol operators on (re-fetches keep it). */
  symbolOperators: boolean;
  performLiveSearch: (query: string) => Promise<void>;
  /** End the active tab's search: empties the box and its results (its tab then closes). */
  clearSearch: () => void;
  /**
   * Discard the active tab's result sets (keyword, semantic, Strong's) and hide
   * the results, leaving the query text in the search box.
   */
  clearResults: () => void;
  clearError: () => void;

  // Actions - Semantic Search
  toggleSemanticMode: () => void;
  setSemanticMode: (mode: boolean) => void;
  performSemanticSearch: (query?: string, opts?: { sessionId?: string; reveal?: boolean }) => Promise<void>;
  checkSemanticAvailability: () => Promise<void>;
  /** Read (and cache) the remote option's status. Never throws; failure means "not configured". */
  refreshRemoteSemanticStatus: () => Promise<RemoteSemanticStatus | null>;
  /** The consent modal's answer: records it, closes the modal and releases the waiting search(es). */
  answerRemoteConsent: (choice: ConsentDialogAnswer) => Promise<void>;
  /** Preferences toggle: 'declined' withdraws, 'reset' re-enables (asks again on next use). */
  setRemoteSemanticConsent: (decision: RemoteConsentChoice | 'reset') => Promise<void>;
  /** Preferences > Search: online / offline (installed pack) / off. */
  setSemanticSource: (source: SemanticSource) => Promise<void>;

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
   * translation the user has open.
   */
  retrySearchInModule: (moduleAbbr: string) => Promise<void>;
  setLastClickedId: (id: string | null) => void;

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

/**
 * The fields one search tab owns. The active tab's live in the flat state;
 * every other tab's are a `SearchSessionFields` object in `parkedSessions`.
 */
export const SESSION_FIELD_KEYS = [
  'query',
  'resultsForQuery',
  'searchResults',
  'searchedModules',
  'isSearching',
  'error',
  'keywordResultLimit',
  'isShowingAllKeywordResults',
  'keywordIndexNotice',
  'isSemanticMode',
  'semanticResults',
  'isSemanticSearching',
  'semanticVisibleCount',
  'semanticSource',
  'semanticNotice',
  'semanticRateLimit',
  'strongsMeta',
  'includeRelatedWords',
  'isLoadingWordFamily',
  'retriedModules',
  'lastClickedId',
  'isResultsVisible',
  'symbolOperators',
  'pendingRerun',
] as const satisfies readonly (keyof SearchState)[];

export type SessionFieldKey = (typeof SESSION_FIELD_KEYS)[number];
export type SearchSessionFields = Pick<SearchState, SessionFieldKey>;

/** Most search tabs open at once; opening another replaces the least recently used one. */
export const MAX_SEARCH_TABS = 8;

/**
 * Searches parked behind the open consent modal; all released by
 * `answerRemoteConsent` with whether to go ahead (false after "Not now").
 */
let consentWaiters: Array<(proceed: boolean) => void> = [];

/**
 * The consent modal's three answers. `granted` and `declined` are persisted by
 * the main process; `notNow` is not recorded anywhere - it only cancels the
 * Ideas search that asked, and the next one asks again.
 */
export type ConsentDialogAnswer = RemoteConsentChoice | 'notNow';

/**
 * Whether the search-type menu offers Ideas search. Wider than
 * `semanticAvailable` (which says a search would get an answer right now): a
 * build with the online service keeps Ideas selectable after the user said
 * "Don't use the online service" with no local pack installed, so they can
 * still pick it and be asked again. Only switching meaning search off in
 * Preferences (source `off`) removes it.
 */
export function isIdeasSelectable(s: Pick<SearchState, 'semanticAvailable' | 'remoteSemanticStatus'>): boolean {
  if (s.semanticAvailable) return true;
  const st = s.remoteSemanticStatus;
  return !!st?.configured && (st.source ?? 'online') !== 'off';
}

/**
 * Does this semantic search have to ask first? First use of the online
 * service (consent unset, source online), or the user explicitly picking
 * Ideas again after "Don't use the online service" when nothing local can
 * answer (asking is then the only way it can work).
 */
function needsConsentPrompt(status: RemoteSemanticStatus | null, semanticAvailable: boolean): boolean {
  if (!status?.configured) return false;
  const source = status.source ?? 'online';
  if (source === 'off') return false;
  if (status.consent === 'unset') return source === 'online';
  return status.consent === 'declined' && !semanticAvailable;
}

/** The ceiling an ordinary keyword search is fetched with. */
export const KEYWORD_DEFAULT_MAX_RESULTS = 200;

/**
 * The ceiling "Show All Matches" re-fetches with. Not `Infinity`: the backend
 * passes `maxResults` straight to a SQL `LIMIT`, and a whole-Bible common word
 * ("the") has tens of thousands of hits that nobody scrolls.
 */
export const KEYWORD_SHOW_ALL_MAX_RESULTS = 5000;

/** How many ranked semantic hits are fetched per query (paged in the renderer). */
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
 * or Strong's word-family setting.
 */
function buildKeywordRequestOptions(
  state: { searchOptions: SearchOptions; includeRelatedWords: boolean; symbolOperators?: boolean },
  query: string,
  maxResults: number,
): SearchOptions {
  let options: SearchOptions = { ...state.searchOptions, maxResults };
  if (state.symbolOperators) options = { ...options, symbolOperators: true };
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
 * stripped text that was actually searched.
 */
export function normalizeSearchQuery(input: string): string {
  const trimmed = input.trim();
  return (trimmed.startsWith('?') ? trimmed.slice(1) : trimmed).trim();
}

/**
 * The state patch that empties every result set the panes and the count badge
 * read from, without touching the query text, the results-pane visibility flag
 * or the semantic-mode preference.
 */
function emptyResultsPatch(): Partial<SearchState> {
  return {
    resultsForQuery: '',
    searchResults: [],
    searchedModules: [],
    keywordResultLimit: KEYWORD_DEFAULT_MAX_RESULTS,
    isShowingAllKeywordResults: false,
    keywordIndexNotice: null,
    semanticResults: [],
    semanticVisibleCount: SEMANTIC_INITIAL_VISIBLE,
    strongsMeta: null,
    includeRelatedWords: false,
    retriedModules: [],
    lastClickedId: null,
  };
}

/** A brand-new, empty session. */
export function freshSessionFields(isSemanticMode = false): SearchSessionFields {
  return {
    query: '',
    resultsForQuery: '',
    searchResults: [],
    searchedModules: [],
    isSearching: false,
    error: null,
    keywordResultLimit: KEYWORD_DEFAULT_MAX_RESULTS,
    isShowingAllKeywordResults: false,
    keywordIndexNotice: null,
    isSemanticMode,
    semanticResults: [],
    isSemanticSearching: false,
    semanticVisibleCount: SEMANTIC_INITIAL_VISIBLE,
    semanticSource: null,
    semanticNotice: null,
    semanticRateLimit: null,
    strongsMeta: null,
    includeRelatedWords: false,
    isLoadingWordFamily: false,
    retriedModules: [],
    lastClickedId: null,
    isResultsVisible: false,
    symbolOperators: false,
    pendingRerun: false,
  };
}

/** The session fields out of a full state (or any object holding them). */
export function pickSessionFields(source: SearchSessionFields): SearchSessionFields {
  const out = {} as Record<SessionFieldKey, unknown>;
  for (const key of SESSION_FIELD_KEYS) out[key] = source[key];
  return out as SearchSessionFields;
}

/** Stable empty view for a pane whose session does not exist (closed, or never created). */
const EMPTY_SESSION_VIEW: SearchSessionFields = Object.freeze(freshSessionFields(false)) as SearchSessionFields;

/**
 * What a results pane shows: its own session.
 *
 * Returns the state object itself for the active session (or when no session
 * id is given - the detached window and tests, which only ever show the active
 * search), the parked copy otherwise, and a stable empty view for an unknown id.
 */
export function selectSessionView(state: SearchState, sessionId?: string | null): SearchSessionFields {
  if (!sessionId || sessionId === state.activeSessionId) return state;
  const parked = state.parkedSessions[sessionId];
  if (parked) return parked;
  // A pane bound to no session while none exists at all (tests, a panel opened
  // outside the search store) shows the flat state, as before tabs.
  if (state.activeSessionId === null && Object.keys(state.parkedSessions).length === 0) return state;
  return EMPTY_SESSION_VIEW;
}

/**
 * The query a search tab is titled with: what its results are for, or - while
 * the first run is still on its way, or a restored tab has not re-run yet -
 * the query being searched (or that failed). Empty when the tab has nothing to name.
 */
export function sessionTitleQuery(view: SearchSessionFields): string {
  if (view.resultsForQuery.trim()) return view.resultsForQuery.trim();
  if (view.isSearching || view.isSemanticSearching || view.pendingRerun || view.error) return normalizeSearchQuery(view.query);
  return '';
}

/** Whether a session still has a search behind it (the empty-pane rule, per tab). */
export function sessionHasSearch(view: SearchSessionFields | undefined | null): boolean {
  if (!view) return false;
  return (
    view.resultsForQuery.trim().length > 0 ||
    view.query.trim().length > 0 ||
    view.isSearching ||
    view.isSemanticSearching ||
    view.pendingRerun
  );
}

/**
 * The sessions a search host panel shows as sub-tabs, in the order they were
 * opened ("Tab in the right pane", 0210 follow-up).
 */
export function hostedSessionIds(
  state: Pick<SearchState, 'sessionMeta'>,
  hostPanelId: string,
): string[] {
  return Object.entries(state.sessionMeta)
    .filter(([, meta]) => meta.hostPanelId === hostPanelId)
    .sort(([, a], [, b]) => (a.createdAt ?? a.lastUsed) - (b.createdAt ?? b.lastUsed))
    .map(([id]) => id);
}

/** The sub-tab a host panel shows: the active session if it lives there, else its most recently used one. */
export function selectedHostedSessionId(
  state: Pick<SearchState, 'sessionMeta' | 'activeSessionId'>,
  hostPanelId: string,
): string | null {
  const ids = hostedSessionIds(state, hostPanelId);
  if (ids.length === 0) return null;
  if (state.activeSessionId && ids.includes(state.activeSessionId)) return state.activeSessionId;
  return ids.reduce((a, b) =>
    (state.sessionMeta[a]?.lastUsed ?? 0) >= (state.sessionMeta[b]?.lastUsed ?? 0) ? a : b,
  );
}

// ----------------------------------------------------------------------------
// Session ids, recency and request counters
// ----------------------------------------------------------------------------

let sessionCounter = 0;
let useClock = 0;

/** A new session id, which becomes the id of the dockview panel that shows it. */
export function newSearchSessionId(): string {
  sessionCounter += 1;
  return `search_${Date.now()}-${sessionCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function nextUseStamp(): number {
  useClock += 1;
  return useClock;
}

function newMeta(): SearchSessionMeta {
  const stamp = nextUseStamp();
  return { hasPanel: false, lastUsed: stamp, createdAt: stamp, hostPanelId: null };
}

type RequestChannel = 'keyword' | 'semantic';
const requestCounters = new Map<string, number>();

/** Start a request on a session's channel; only the latest one may write its results. */
function beginRequest(sessionId: string, channel: RequestChannel): number {
  const key = `${sessionId}|${channel}`;
  const next = (requestCounters.get(key) ?? 0) + 1;
  requestCounters.set(key, next);
  return next;
}

function isLatestRequest(sessionId: string, channel: RequestChannel, ticket: number): boolean {
  return requestCounters.get(`${sessionId}|${channel}`) === ticket;
}

function forgetRequests(sessionId: string): void {
  requestCounters.delete(`${sessionId}|keyword`);
  requestCounters.delete(`${sessionId}|semantic`);
}

/**
 * A keyword search that waits its turn.
 *
 * The main process runs a single `SearchController` that rejects a second
 * search while one is in flight ("Search already in progress"). With one
 * search box that was rare; with search tabs it is ordinary - two restored
 * tabs re-running side by side, a Ctrl+Enter while another tab is still
 * searching, live suggestions while a tab re-runs. A busy reply is retried
 * shortly instead of failing the tab.
 */
const SEARCH_BUSY_RETRY_MS = 60;
const SEARCH_BUSY_MAX_WAIT_MS = 20_000;
async function runKeywordSearch(query: string, options: Parameters<typeof searchAPI.performSearch>[1]): Promise<SearchResult[]> {
  const started = Date.now();
  for (;;) {
    try {
      return await searchAPI.performSearch(query, options);
    } catch (error) {
      const busy = error instanceof Error && /already in progress/i.test(error.message);
      if (!busy || Date.now() - started > SEARCH_BUSY_MAX_WAIT_MS) throw error;
      await new Promise((resolve) => setTimeout(resolve, SEARCH_BUSY_RETRY_MS));
    }
  }
}

/** Where a new tab should be placed: next to the tab that was active when it was asked for. */
const placementHints = new Map<string, string>();

/**
 * Refresh `keywordIndexNotice` for the modules that produced hits in `results`
 * (task 0033). Fire-and-forget from the search actions below; writes only to
 * the session the search ran in, and only if that search is still the latest.
 */
async function refreshKeywordIndexNotice(results: SearchResult[], sessionId: string, ticket: number): Promise<void> {
  const write = (notice: SearchState['keywordIndexNotice']): void => {
    if (!isLatestRequest(sessionId, 'keyword', ticket)) return;
    useSearchStore.getState().patchSession(sessionId, { keywordIndexNotice: notice });
  };

  const abbreviations = Array.from(
    new Set(results.map((r) => r.module).filter((m): m is string => !!m))
  );

  const moduleIds = abbreviations
    .map(resolveInstalledModuleId)
    .filter((id): id is number => typeof id === 'number');

  if (moduleIds.length === 0) {
    write(null);
    return;
  }

  const outcomes = await Promise.allSettled(
    moduleIds.map((id) => moduleAPI.getKeywordIndexStatus(id))
  );

  let pending = 0;
  let known = 0;
  for (const outcome of outcomes) {
    if (outcome.status !== 'fulfilled') continue;
    known += 1;
    if (outcome.value.state !== 'ready') pending += 1;
  }

  write(pending > 0 ? { pending, total: known } : null);
}

/** A user-friendly message for a failed keyword search. */
function keywordErrorMessage(error: unknown): string {
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
  return errorMessage;
}

export const useSearchStore = create<SearchState>((set, get) => {
  // --------------------------------------------------------------------------
  // Session helpers
  // --------------------------------------------------------------------------

  const sessionExists = (sessionId: string): boolean => {
    const s = get();
    return sessionId === s.activeSessionId || Object.prototype.hasOwnProperty.call(s.parkedSessions, sessionId);
  };

  /** A session's current fields, wherever it lives; null when it is gone. */
  const readSession = (sessionId: string): SearchSessionFields | null => {
    const s = get();
    if (sessionId === s.activeSessionId) return s;
    return s.parkedSessions[sessionId] ?? null;
  };

  const patchSession = (sessionId: string, patch: Partial<SearchSessionFields>): boolean => {
    const s = get();
    if (sessionId === s.activeSessionId) {
      set(patch);
      return true;
    }
    const current = s.parkedSessions[sessionId];
    if (!current) return false;
    set({ parkedSessions: { ...s.parkedSessions, [sessionId]: { ...current, ...patch } } });
    return true;
  };

  /**
   * The fields a session is parked with. A draft typed into the box and then
   * abandoned by switching tabs is dropped, so coming back shows the tab's own
   * query again rather than half a sentence typed for some other search.
   */
  const settledForParking = (fields: SearchSessionFields): SearchSessionFields => {
    const parked = pickSessionFields(fields);
    if (
      parked.resultsForQuery.trim() &&
      !parked.isSearching &&
      normalizeSearchQuery(parked.query) !== normalizeSearchQuery(parked.resultsForQuery)
    ) {
      parked.query = parked.resultsForQuery;
    }
    return parked;
  };

  /**
   * Park the active session into `parked`/`meta` (mutating the copies passed
   * in). A session with no tab and nothing running has nowhere to come back
   * to, so it is dropped instead.
   */
  const parkActiveInto = (
    s: SearchState,
    parked: Record<string, SearchSessionFields>,
    meta: Record<string, SearchSessionMeta>,
  ): void => {
    const id = s.activeSessionId;
    if (!id) return;
    const fields = settledForParking(s);
    if (meta[id]?.hasPanel || fields.isSearching || fields.isSemanticSearching) {
      parked[id] = fields;
    } else {
      delete meta[id];
      forgetRequests(id);
      placementHints.delete(id);
    }
  };

  /**
   * Make sure there is an active session, adopting the flat state into a new
   * one when there is none yet (the very first search, or after the last tab
   * closed). Returns its id.
   */
  const ensureActiveSession = (): string => {
    const s = get();
    if (s.activeSessionId) return s.activeSessionId;
    const id = newSearchSessionId();
    set({
      activeSessionId: id,
      sessionMeta: { ...s.sessionMeta, [id]: newMeta() },
    });
    return id;
  };

  /** A plain search reuses the active (preview) tab; an explicit new tab, or a pinned active tab, opens another. */
  const shouldOpenNewTab = (opts: PerformSearchOptions): boolean => {
    const s = get();
    if (!s.activeSessionId) return false;
    return !!opts.newTab || !!s.sessionMeta[s.activeSessionId]?.pinned;
  };

  /** Start a new session for a new tab and make it active. */
  const startNewTabSession = (semantic: boolean | undefined): string => {
    const s = get();
    const parked = { ...s.parkedSessions };
    const meta = { ...s.sessionMeta };
    const previous = s.activeSessionId;
    parkActiveInto(s, parked, meta);
    const id = newSearchSessionId();
    meta[id] = newMeta();
    if (previous && parked[previous]) placementHints.set(id, previous);
    set({
      ...freshSessionFields(semantic ?? loadPersistedSemanticMode()),
      activeSessionId: id,
      parkedSessions: parked,
      sessionMeta: meta,
    });
    evictOverCap(id);
    return id;
  };

  /** Keep at most `MAX_SEARCH_TABS` sessions: close the least recently used parked one(s). */
  const evictOverCap = (keepId: string): void => {
    for (;;) {
      const s = get();
      const parkedIds = Object.keys(s.parkedSessions).filter((id) => id !== keepId);
      const total = parkedIds.length + (s.activeSessionId ? 1 : 0);
      if (total <= MAX_SEARCH_TABS || parkedIds.length === 0) return;
      const lru = parkedIds.reduce((a, b) =>
        (s.sessionMeta[a]?.lastUsed ?? 0) <= (s.sessionMeta[b]?.lastUsed ?? 0) ? a : b,
      );
      // Closing the panel disposes the session (panelDisposal -> closeSession);
      // closing the session directly as well covers a panel-less one and tests.
      closeSearchResultsPanel(lru);
      get().closeSession(lru);
    }
  };

  /** Surface a session's results tab once they arrive. */
  const revealSession = (sessionId: string, reveal: boolean | undefined): void => {
    const isActive = sessionId === get().activeSessionId;
    const shownIn = showSearchResultsPanel(sessionId, {
      reveal: reveal ?? isActive,
      nearSessionId: placementHints.get(sessionId) ?? null,
    });
    if (shownIn) {
      placementHints.delete(sessionId);
      const hostPanelId = shownIn === sessionId ? null : shownIn;
      // Read the meta fresh: showing the tab can activate another session, and
      // a session dropped meanwhile must not come back as a meta-only ghost.
      if (!sessionExists(sessionId)) return;
      const meta = get().sessionMeta[sessionId];
      if (meta && (!meta.hasPanel || (meta.hostPanelId ?? null) !== hostPanelId)) {
        set((st) => ({ sessionMeta: { ...st.sessionMeta, [sessionId]: { ...st.sessionMeta[sessionId], hasPanel: true, hostPanelId } } }));
      }
    }
  };

  /** A search that failed in a parked tab that never got a panel has nowhere to show: drop it. */
  const dropIfStranded = (sessionId: string): void => {
    const s = get();
    if (sessionId !== s.activeSessionId && s.parkedSessions[sessionId] && !s.sessionMeta[sessionId]?.hasPanel) {
      get().closeSession(sessionId);
    }
  };

  return {
  // Initial state
  query: '',
  resultsForQuery: '',
  searchResults: [],
  searchedModules: [],
  isSearching: false,
  error: null,
  keywordResultLimit: KEYWORD_DEFAULT_MAX_RESULTS,
  isShowingAllKeywordResults: false,
  keywordIndexNotice: null,

  liveSuggestions: [],
  isLiveSearching: false,
  liveSearchQuery: '',

  isSemanticMode: loadPersistedSemanticMode(),
  semanticResults: [],
  isSemanticSearching: false,
  semanticAvailable: false,
  semanticVisibleCount: SEMANTIC_INITIAL_VISIBLE,
  remoteSemanticStatus: null,
  consentDialogOpen: false,
  semanticSource: null,
  semanticNotice: null,
  semanticRateLimit: null,

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
  symbolOperators: false,

  savedSearches: [],
  isLoadingSavedSearches: false,

  activeSessionId: null,
  parkedSessions: {},
  sessionMeta: {},
  pendingRerun: false,

  // ========================================================================
  // Search tabs
  // ========================================================================

  patchSession,

  activateSession: (sessionId: string) => {
    const s = get();
    if (sessionId === s.activeSessionId) {
      const meta = s.sessionMeta[sessionId];
      if (meta) set({ sessionMeta: { ...s.sessionMeta, [sessionId]: { ...meta, lastUsed: nextUseStamp() } } });
      return;
    }
    const target = s.parkedSessions[sessionId];
    if (!target) return;
    const parked = { ...s.parkedSessions };
    delete parked[sessionId];
    const meta = { ...s.sessionMeta };
    parkActiveInto(s, parked, meta);
    meta[sessionId] = { ...meta[sessionId], hasPanel: meta[sessionId]?.hasPanel ?? true, lastUsed: nextUseStamp() };
    set({
      ...target,
      // A tab parked in meaning mode while meaning search was switched off comes back in keyword mode.
      isSemanticMode: target.isSemanticMode && (s.semanticAvailable || target.semanticResults.length > 0),
      activeSessionId: sessionId,
      parkedSessions: parked,
      sessionMeta: meta,
      liveSuggestions: [],
      liveSearchQuery: '',
    });
  },

  closeSession: (sessionId: string) => {
    const s = get();
    forgetRequests(sessionId);
    placementHints.delete(sessionId);

    if (sessionId !== s.activeSessionId) {
      if (!Object.prototype.hasOwnProperty.call(s.parkedSessions, sessionId)) {
        // A results panel no session knows about. Before tabs, closing the
        // one results panel discarded the search; keep that for a panel that
        // was opened without a session (only possible when none exists).
        if (s.activeSessionId === null) get().clearResults();
        return;
      }
      const parked = { ...s.parkedSessions };
      delete parked[sessionId];
      const meta = { ...s.sessionMeta };
      delete meta[sessionId];
      set({ parkedSessions: parked, sessionMeta: meta });
      return;
    }

    const meta = { ...s.sessionMeta };
    const closedHost = meta[sessionId]?.hostPanelId ?? null;
    delete meta[sessionId];
    const candidates = Object.keys(s.parkedSessions)
      .filter((id) => meta[id]?.hasPanel)
      .sort((a, b) => (meta[b]?.lastUsed ?? 0) - (meta[a]?.lastUsed ?? 0));
    // A closed sub-tab hands over to a sibling in the same Search tab first,
    // so the active search stays the one on screen.
    const next = (closedHost ? candidates.find((id) => meta[id]?.hostPanelId === closedHost) : undefined) ?? candidates[0];

    if (next) {
      const parked = { ...s.parkedSessions };
      const target = parked[next];
      delete parked[next];
      meta[next] = { ...meta[next], lastUsed: nextUseStamp() };
      set({ ...target, activeSessionId: next, parkedSessions: parked, sessionMeta: meta });
      return;
    }

    // The last tab closed: back to "no search", keeping the text in the box
    // (closing the results must not retype the user's query away).
    set({
      ...emptyResultsPatch(),
      isResultsVisible: false,
      isSearching: false,
      isSemanticSearching: false,
      isLoadingWordFamily: false,
      error: null,
      semanticSource: null,
      semanticNotice: null,
      semanticRateLimit: null,
      pendingRerun: false,
      activeSessionId: null,
      sessionMeta: meta,
    });
  },

  closePanelSessions: (panelId: string) => {
    const hosted = hostedSessionIds(get(), panelId);
    if (hosted.length === 0) {
      get().closeSession(panelId);
      return;
    }
    for (const id of hosted) get().closeSession(id);
  },

  restoreSessions: (tabs: RestoredSearchTab[]) => {
    const s = get();
    const parked = { ...s.parkedSessions };
    const meta = { ...s.sessionMeta };
    for (const tab of tabs) {
      const query = tab.query.trim();
      if (!query || sessionExists(tab.id) || parked[tab.id]) continue;
      parked[tab.id] = { ...freshSessionFields(!!tab.semantic), query, pendingRerun: true };
      // A tab that survived a restart was kept on purpose: it is pinned.
      meta[tab.id] = { ...newMeta(), hasPanel: true, hostPanelId: tab.hostPanelId ?? null, pinned: true };
    }
    for (const tab of tabs) {
      if (tab.recent && meta[tab.id]) meta[tab.id] = { ...meta[tab.id], lastUsed: nextUseStamp() };
    }
    set({ parkedSessions: parked, sessionMeta: meta });
  },

  runPendingRerun: async (sessionId: string) => {
    const session = readSession(sessionId);
    if (!session?.pendingRerun) return;
    const query = session.query;
    patchSession(sessionId, { pendingRerun: false });
    // The first restored tab shown becomes the active search, so the header,
    // highlights and badge follow it as they would after a search.
    if (!get().activeSessionId) get().activateSession(sessionId);
    await get().performSearch(query, { sessionId, reveal: false });
  },

  pinSession: (sessionId: string, pinned?: boolean) => {
    set((st) => {
      const meta = st.sessionMeta[sessionId];
      if (!meta) return st;
      return { sessionMeta: { ...st.sessionMeta, [sessionId]: { ...meta, pinned: pinned ?? !meta.pinned } } };
    });
  },

  openSessionInNewTab: async (sessionId: string) => {
    const session = readSession(sessionId);
    if (!session) return;
    const query = sessionTitleQuery(session) || normalizeSearchQuery(session.query);
    if (!query) return;
    await get().performSearch(query, {
      newTab: true,
      symbolOperators: session.symbolOperators,
      semantic: session.isSemanticMode,
    });
  },

  // ========================================================================
  // Search Actions
  // ========================================================================

  setQuery: (query: string) => {
    set({ query });
  },

  performSearch: async (query?: string, opts: PerformSearchOptions = {}) => {
    const explicitSession = opts.sessionId && sessionExists(opts.sessionId) ? opts.sessionId : null;
    const fallbackQuery = explicitSession ? readSession(explicitSession)?.query ?? '' : get().query;
    const queryToSearch = query || fallbackQuery;

    if (!queryToSearch.trim()) {
      set({ error: 'Please enter a search query' });
      return;
    }

    // A pinned active tab is kept, but a plain search should not pile up preview tabs:
    // reuse the most recently used unpinned search tab if one exists (activate it).
    if (!explicitSession && !opts.newTab) {
      const st = get();
      if (st.activeSessionId && st.sessionMeta[st.activeSessionId]?.pinned) {
        const reusable = Object.keys(st.parkedSessions)
          .filter((id) => !st.sessionMeta[id]?.pinned)
          .sort((a, b) => (st.sessionMeta[b]?.lastUsed ?? 0) - (st.sessionMeta[a]?.lastUsed ?? 0))[0];
        if (reusable) get().activateSession(reusable);
      }
    }
    const sessionId = explicitSession
      ?? (shouldOpenNewTab(opts) ? startNewTabSession(opts.semantic) : ensureActiveSession());
    const ticket = beginRequest(sessionId, 'keyword');

    patchSession(sessionId, {
      isSearching: true,
      error: null,
      query: queryToSearch,
      symbolOperators: !!opts.symbolOperators,
      pendingRerun: false,
      // A brand-new top-level query invalidates any "already tried this
      // translation" / "last visited result" bookkeeping from the previous one.
      retriedModules: [],
      lastClickedId: null,
    });

    // Detect Strong's-number query
    const isStrongs = StrongsNumberHelper.isStrongsNumber(queryToSearch.trim());
    if (!isStrongs) {
      // Clear any previous Strong's meta when a non-Strong's search starts
      patchSession(sessionId, { strongsMeta: null, includeRelatedWords: false });
    }

    try {
      const session = readSession(sessionId) ?? freshSessionFields();
      const requestedLimit = get().searchOptions.maxResults ?? KEYWORD_DEFAULT_MAX_RESULTS;
      const searchOptions = buildKeywordRequestOptions(
        { searchOptions: get().searchOptions, includeRelatedWords: session.includeRelatedWords, symbolOperators: session.symbolOperators },
        queryToSearch,
        requestedLimit,
      );

      const searchedModules = searchOptions.modules && searchOptions.modules.length > 0
        ? [...searchOptions.modules]
        : (resolveActiveBibleModule() ? [resolveActiveBibleModule() as string] : []);
      const results = await runKeywordSearch(queryToSearch, searchOptions);

      // Stale-result guard: a newer search in this tab, or the tab closing, wins.
      if (!isLatestRequest(sessionId, 'keyword', ticket)) return;
      const current = readSession(sessionId);
      if (!current) return;

      // The search type is only ever what the user picked (the search-type
      // menu or the results pane's suggestion); a search never changes it.
      const nextSemanticMode = current.isSemanticMode;
      patchSession(sessionId, {
        searchResults: results,
        searchedModules,
        resultsForQuery: queryToSearch,
        isResultsVisible: true,
        isSearching: false,
        keywordResultLimit: requestedLimit,
        isShowingAllKeywordResults: false,
        semanticVisibleCount: SEMANTIC_INITIAL_VISIBLE,
        semanticResults: [],
        semanticNotice: null,
      });
      // Reset proximity distance after search completes (per user requirement)
      set((st) => ({ searchOptions: { ...st.searchOptions, proximityDistance: 0 } }));

      // Surface the results tab: a new tab is placed by the layout store's
      // rules (see `useLayoutStore.openSearchResultsPanel`); an existing one is
      // focused wherever the user has since dragged it.
      revealSession(sessionId, opts.reveal);

      // Best-effort keyword-index status note (task 0033) - fire-and-forget.
      void refreshKeywordIndexNotice(results, sessionId, ticket);

      // If a Strong's number was searched, kick off the word-family fetch
      // (fire-and-forget - updates strongsMeta when ready).
      if (isStrongs) {
        loadWordFamily(queryToSearch.trim(), results).then(meta => {
          if (meta && isLatestRequest(sessionId, 'keyword', ticket)) patchSession(sessionId, { strongsMeta: meta });
        }).catch(err => console.error('Word family load failed:', err));
      }

      // Ideas search runs only when the user put this tab in Ideas mode. Zero
      // (or few) keyword hits never switch it on by themselves: the results
      // pane offers it instead (its no-results suggestion).
      if (nextSemanticMode && isIdeasSelectable(get()) && !isStrongs) {
        void get().performSemanticSearch(queryToSearch, { sessionId, reveal: opts.reveal });
      }
    } catch (error) {
      if (!isLatestRequest(sessionId, 'keyword', ticket)) return;
      patchSession(sessionId, {
        error: keywordErrorMessage(error),
        isSearching: false,
      });
      dropIfStranded(sessionId);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      const results = await runKeywordSearch(query, searchOptions);

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
    const active = get().activeSessionId;
    if (active) {
      // Whatever the tab was still fetching must not land after it was cleared.
      forgetRequests(active);
    }
    set({
      query: '',
      resultsForQuery: '',
      searchResults: [],
      searchedModules: [],
      liveSuggestions: [],
      liveSearchQuery: '',
      isResultsVisible: false,
      isSearching: false,
      isSemanticSearching: false,
      error: null,
      keywordResultLimit: KEYWORD_DEFAULT_MAX_RESULTS,
      isShowingAllKeywordResults: false,
      keywordIndexNotice: null,
      // Keep persisted semantic mode selection when clearing; only reset auto-switch.
      semanticResults: [],
      semanticVisibleCount: SEMANTIC_INITIAL_VISIBLE,
      strongsMeta: null,
      includeRelatedWords: false,
      retriedModules: [],
      lastClickedId: null,
      pendingRerun: false,
    });
  },

  clearResults: () => {
    set({ ...emptyResultsPatch(), isResultsVisible: false, error: null, pendingRerun: false });
  },

  clearError: () => {
    set({ error: null });
  },

  // ========================================================================
  // Semantic Search Actions
  // ========================================================================

  checkSemanticAvailability: async () => {
    // Also (re)reads the online option's status; harmless when it is not configured.
    await get().refreshRemoteSemanticStatus();
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
      set({ isSemanticMode: false });
      persistSemanticMode(false);
    } else {
      // Switching to semantic mode - trigger semantic search
      set({ isSemanticMode: true });
      persistSemanticMode(true);
      if (resultsForQuery && isIdeasSelectable(get())) {
        void get().performSemanticSearch(resultsForQuery);
      }
    }
  },

  setSemanticMode: (mode: boolean) => {
    if (get().isSemanticMode === mode) return;
    set({ isSemanticMode: mode });
    persistSemanticMode(mode);
    const { resultsForQuery } = get();
    if (mode && resultsForQuery && isIdeasSelectable(get())) {
      void get().performSemanticSearch(resultsForQuery);
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

  refreshRemoteSemanticStatus: async () => {
    try {
      const status = await remoteSemanticAPI.getStatus();
      set({ remoteSemanticStatus: status });
      // Drives the Preferences > Search section; absent entirely when not configured.
      whenContextService.set('remoteSemanticConfigured', status.configured === true);
      return status;
    } catch {
      // Older/absent bridge: behave exactly as before the option existed.
      set({ remoteSemanticStatus: null });
      return null;
    }
  },

  answerRemoteConsent: async (choice) => {
    // "Not now" is deliberately not recorded: it means "not this time", so the
    // next Ideas search asks again and nothing switches to the local pack.
    const persist = choice !== 'notNow';
    if (persist) {
      try {
        const status = await remoteSemanticAPI.setConsent(choice);
        set({ remoteSemanticStatus: status });
      } catch (error) {
        console.error('Failed to record meaning-search consent:', error);
      }
    }
    set({ consentDialogOpen: false });
    const waiters = consentWaiters;
    consentWaiters = [];
    waiters.forEach((resolve) => resolve(persist));
    if (persist) void get().checkSemanticAvailability();
  },

  setRemoteSemanticConsent: async (decision) => {
    try {
      const status = await remoteSemanticAPI.setConsent(decision);
      set({ remoteSemanticStatus: status });
    } catch (error) {
      console.error('Failed to update meaning-search consent:', error);
    }
    await get().checkSemanticAvailability();
  },

  setSemanticSource: async (source) => {
    try {
      const status = await remoteSemanticAPI.setSource(source);
      set({ remoteSemanticStatus: status });
    } catch (error) {
      console.error('Failed to update the meaning-search source:', error);
    }
    await get().checkSemanticAvailability();
    // Turned off (or nothing left to answer): leave semantic mode so the
    // search bar is not stuck on a mode that no longer exists.
    if (!isIdeasSelectable(get()) && get().isSemanticMode) {
      set({ isSemanticMode: false, semanticResults: [], semanticNotice: null });
    }
  },

  performSemanticSearch: async (query?: string, opts: { sessionId?: string; reveal?: boolean } = {}) => {
    const sessionId = opts.sessionId && sessionExists(opts.sessionId) ? opts.sessionId : ensureActiveSession();
    const queryToSearch = query || readSession(sessionId)?.query || '';

    if (!queryToSearch.trim()) {
      return;
    }

    const ticket = beginRequest(sessionId, 'semantic');
    patchSession(sessionId, { isSemanticSearching: true });

    try {
      // Consent: nothing is searched (or sent) until the user answers.
      // Concurrent searches share one modal.
      const status = get().remoteSemanticStatus ?? (await get().refreshRemoteSemanticStatus());
      if (needsConsentPrompt(status, get().semanticAvailable)) {
        const proceed = await new Promise<boolean>((resolve) => {
          consentWaiters.push(resolve);
          if (!get().consentDialogOpen) set({ consentDialogOpen: true });
        });
        if (!proceed) {
          // "Not now": this Ideas search does not run. Back to the keyword
          // results the tab already has; no notice, nothing recorded.
          if (!isLatestRequest(sessionId, 'semantic', ticket)) return;
          patchSession(sessionId, {
            isSemanticMode: false,
            semanticResults: [],
            semanticSource: null,
            semanticNotice: null,
            semanticRateLimit: null,
            isSemanticSearching: false,
          });
          if (sessionId === get().activeSessionId) persistSemanticMode(false);
          return;
        }
      }

      const reply = await searchAPI.semanticSearchEx(queryToSearch, {
        maxResults: SEMANTIC_FETCH_LIMIT,
        levels: ['verse', 'paragraph'],
      });

      if (!isLatestRequest(sessionId, 'semantic', ticket)) return;
      const written = patchSession(sessionId, {
        semanticResults: dedupeSemanticResults(reply.results),
        semanticSource: reply.source,
        semanticNotice: reply.notice ?? null,
        semanticRateLimit: reply.rateLimit ?? null,
        semanticVisibleCount: SEMANTIC_INITIAL_VISIBLE,
        isSemanticSearching: false,
      });
      if (!written) return;

      // A semantic search can be run on its own (the search-type menu, or the
      // results pane's Ideas suggestion), so it has to surface the pane too.
      revealSession(sessionId, opts.reveal);
    } catch (error) {
      console.error('Semantic search failed:', error);
      if (!isLatestRequest(sessionId, 'semantic', ticket)) return;
      // With the online service configured, "nothing answered" means the user is
      // on keyword search: leave semantic mode (not persisted) and say why.
      const st = get().remoteSemanticStatus;
      const fallbackNotice: RemoteSemantic.SemanticNotice | null = st?.configured && st.source !== 'off'
        ? (st.consent === 'declined' ? { kind: 'declined' } : { kind: 'unavailable' })
        : null;
      patchSession(sessionId, {
        semanticResults: [],
        semanticSource: null,
        semanticNotice: fallbackNotice,
        ...(fallbackNotice ? { isSemanticMode: false } : {}),
        semanticRateLimit: null,
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

    const sessionId = ensureActiveSession();
    const ticket = beginRequest(sessionId, 'keyword');
    patchSession(sessionId, { isSearching: true, error: null });

    try {
      const session = readSession(sessionId) ?? freshSessionFields();
      const searchOptions = buildKeywordRequestOptions(
        { searchOptions: get().searchOptions, includeRelatedWords: session.includeRelatedWords, symbolOperators: session.symbolOperators },
        queryToSearch,
        KEYWORD_SHOW_ALL_MAX_RESULTS,
      );
      const results = await runKeywordSearch(queryToSearch, searchOptions);
      if (!isLatestRequest(sessionId, 'keyword', ticket)) return;

      patchSession(sessionId, {
        searchResults: results,
        resultsForQuery: queryToSearch,
        keywordResultLimit: KEYWORD_SHOW_ALL_MAX_RESULTS,
        // Sticky even if the query somehow fills the "show all" ceiling too:
        // re-offering a button that cannot produce anything more is worse than
        // quietly capping.
        isShowingAllKeywordResults: true,
        isSearching: false,
      });

      void refreshKeywordIndexNotice(results, sessionId, ticket);
    } catch (error) {
      console.error('Show-all search failed:', error);
      if (!isLatestRequest(sessionId, 'keyword', ticket)) return;
      patchSession(sessionId, {
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

    const sessionId = ensureActiveSession();
    const ticket = beginRequest(sessionId, 'keyword');
    patchSession(sessionId, { isSearching: true, error: null });

    try {
      // `scope: 'allOpenModules'` + `openModules` (rather than `modules`) is
      // deliberate: it's the one path the main-process handler uses to
      // register a module with the search service on demand (see
      // `search:performSearch` in searchHandlers.ts), so this works even for
      // a translation that has never been searched yet this session.
      const requestedLimit = get().searchOptions.maxResults ?? KEYWORD_DEFAULT_MAX_RESULTS;
      const session = readSession(sessionId) ?? freshSessionFields();
      const searchOptions = {
        ...get().searchOptions,
        ...(session.symbolOperators ? { symbolOperators: true } : {}),
        maxResults: requestedLimit,
        scope: 'allOpenModules',
        openModules: [moduleAbbr],
      };

      const results = await runKeywordSearch(queryToSearch, searchOptions);
      if (!isLatestRequest(sessionId, 'keyword', ticket)) return;
      const current = readSession(sessionId);
      if (!current) return;

      patchSession(sessionId, {
        searchResults: results,
        searchedModules: [moduleAbbr],
        resultsForQuery: queryToSearch,
        query: queryToSearch,
        isResultsVisible: true,
        isSearching: false,
        keywordResultLimit: requestedLimit,
        isShowingAllKeywordResults: false,
        isSemanticMode: false,
        semanticResults: [],
        semanticVisibleCount: SEMANTIC_INITIAL_VISIBLE,
        retriedModules: current.retriedModules.includes(moduleAbbr)
          ? current.retriedModules
          : [...current.retriedModules, moduleAbbr],
      });

      void refreshKeywordIndexNotice(results, sessionId, ticket);
    } catch (error) {
      console.error('Retry search in module failed:', error);
      if (!isLatestRequest(sessionId, 'keyword', ticket)) return;
      patchSession(sessionId, {
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
  };
});

/** Test hook: forget session ids, recency stamps, request counters and placement hints. */
export function resetSearchSessionBookkeepingForTests(): void {
  requestCounters.clear();
  placementHints.clear();
}

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
