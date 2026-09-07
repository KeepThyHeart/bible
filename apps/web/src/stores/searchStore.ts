import { Store } from './Store';
import { bibleStore } from './bibleStore';
import { parseReference } from '../components/Header';
import { formatPassageRef } from '../constants';
import type { ISearchProvider } from '../providers/interfaces';
import type { SearchResultData, WordFamilyMemberData } from '../types';
import type { SemanticInitProgress } from '../search/BrowserSearchProxy';

/** UI state for the one-time browser semantic-search initialization (download + load). */
export interface SemanticInitState {
  status: 'idle' | 'initializing' | 'ready' | 'error';
  /** Which phase: metadata → vectors → model. */
  stage: 'metadata' | 'vectors' | 'model' | 'ready' | 'error' | '';
  detail: string;
  loaded?: number;
  total?: number;
  /** Fraction complete for the current stage (0..1), if known. */
  percent?: number;
}

/** Regex to detect Strong's numbers: "G25", "H7225", "strongs:G25" */
const STRONGS_PATTERN = /^(?:strongs:)?[GH]\d+$/i;

/**
 * How many keyword results to ask the server for.
 *
 * The endpoint has no offset and no total-count of its own — `total` in the
 * response is just `results.length` — so this constant is the *only* thing that
 * tells the client whether the list it is holding is the whole match set or a
 * truncated view of it. `GET /api/search/keyword` defaults to 50 and hard-caps
 * at 100; asking explicitly keeps the number here rather than implied by the
 * server's default, so `results.length >= KEYWORD_PAGE_SIZE` is a reliable
 * "there may well be more" (see `resultsTruncated`).
 */
const KEYWORD_PAGE_SIZE = 50;

/** How many occurrences a Strong's search asks for per page. */
const STRONGS_PAGE_SIZE = 100;

/**
 * Ceiling for "Load All", matching the server's own cap (MAX_STRONGS_RESULTS in
 * server/routes/searchRoutes.ts). Asking for more just gets clamped there.
 */
const STRONGS_MAX_RESULTS = 5000;

/**
 * The server reports the true, unclamped occurrence count alongside the capped
 * page. It is optional on `StrongsSearchResult` because a browser client can be
 * talking to an older server that does not send it, so fall back to `total`.
 */
function readTotalAvailable(result: { results: unknown[]; total: number; totalAvailable?: number }): number {
  return typeof result.totalAvailable === 'number' ? result.totalAvailable : result.total;
}

/** Options the Strong's search endpoint accepts, including the page cap. */
interface StrongsSearchOptions {
  includeRelated: boolean;
  modules?: string[];
  maxResults: number;
}

/** Compute verse ID from parsed reference */
function refToVerseId(book: number, chapter: number, verse?: number): number {
  return book * 1000000 + chapter * 1000 + (verse || 1);
}

class SearchStore extends Store {
  private search: ISearchProvider | null = null;
  query = '';
  results: SearchResultData[] = [];
  searchType: 'keyword' | 'semantic' = 'keyword';
  loading = false;
  totalResults = 0;
  isOpen = false;
  /**
   * Bumped once per launched search. The UI keys "reveal the results panel" off
   * this counter rather than off `isOpen`, because `isOpen` is already true once
   * the user has wandered off to the Commentary or Dictionary tab without
   * closing the results — the false→true edge never fires again and pressing
   * Enter in the search box looks like it did nothing.
   */
  searchSeq = 0;
  /** Verse ID detected from a reference in the search query (shown first in results) */
  detectedRefVerseId: number | null = null;
  /** The module abbreviation that was searched (for keyword searches) */
  searchedModule = '';
  /** For semantic searches: number of keyword matches found in parallel */
  keywordMatchCount = 0;
  /** Modules used for the parallel keyword search (needed to switch) */
  private lastKeywordModules: string[] = [];
  /** Translation the current semantic results were hydrated in; see loadMoreSemantic. */
  private lastSemanticModules: string[] = [];
  /**
   * Whether the last keyword search came back full — i.e. it filled the page we
   * asked for, so the Bible may hold matches that are not in `results`. Only
   * meaningful in keyword mode; semantic and Strong's have their own signals
   * (`canLoadMore`, `strongsTotalAvailable`). See `resultsTruncated`.
   */
  keywordCapped = false;
  /** Whether more semantic results can be loaded */
  canLoadMore = false;
  loadingMore = false;
  /** Current semantic page size (how many have been requested so far) */
  private semanticPageSize = 20;

  // Strong's search state
  /** Whether current results are from a Strong's number search */
  strongsMode = false;
  /** Strong's entry info for the searched number */
  strongsEntry: { strongsNumber: string; word: string; transliteration: string; gloss: string } | null = null;
  /** Related word family members */
  wordFamily: WordFamilyMemberData[] = [];
  /** Whether to include word family in search */
  includeRelated = false;
  /** Occurrence counts per Strong's number */
  groupedCounts: Record<string, number> = {};
  /**
   * Total occurrences the server holds for the current Strong's search, which is
   * usually far more than the page we asked for — drives "Load All".
   */
  strongsTotalAvailable = 0;
  /** How many Strong's occurrences have been requested so far */
  private strongsPageSize = STRONGS_PAGE_SIZE;
  /** Modules for the current Strong's search, so paging re-uses the same scope */
  private strongsModules: string[] | undefined = undefined;

  /**
   * Progress of the one-time semantic-search setup (browser mode only). Drives the
   * loading popup shown on the first semantic search while the model + index download.
   */
  semanticInit: SemanticInitState = { status: 'idle', stage: '', detail: '' };

  /**
   * Stable ID of the last-clicked search result, so the user can see where
   * they were when they return to the results list. Composed from
   * verseId + module + type — see resultId() helper below.
   */
  lastClickedId: string | null = null;

  /**
   * Stable ID of the last-clicked verse reference in a verse-ref list
   * (cross-refs, topic verses). Tracked here rather than in a study store
   * so all verse-ref lists across the app share a single "where was I" mark.
   */
  lastClickedVerseRefId: string | null = null;

  setLastClickedId(id: string | null): void {
    this.lastClickedId = id;
    this.notify();
  }

  setLastClickedVerseRefId(id: string | null): void {
    this.lastClickedVerseRefId = id;
    this.notify();
  }

  init(search: ISearchProvider): void {
    this.search = search;

    // Browser-side provider exposes progress for its one-time init (model + index
    // download). Wire it into store state so the loading popup can render it.
    const maybeProgress = search as Partial<{ setProgressCallback(cb: (p: SemanticInitProgress) => void): void }>;
    if (typeof maybeProgress.setProgressCallback === 'function') {
      maybeProgress.setProgressCallback((p) => {
        if (p.stage === 'ready') {
          this.semanticInit = { status: 'ready', stage: 'ready', detail: '' };
        } else if (p.stage === 'error') {
          this.semanticInit = { status: 'error', stage: 'error', detail: p.detail };
        } else {
          // A fresh init cycle is starting — un-dismiss so the popup shows again.
          if (this.semanticInit.status !== 'initializing') {
            this.semanticInitDismissed = false;
          }
          this.semanticInit = {
            status: 'initializing',
            stage: p.stage,
            detail: p.detail,
            loaded: p.loaded,
            total: p.total,
            percent: p.percent,
          };
        }
        this.notify();
      });
    }
  }

  /** True when the user manually closed the popup for the current init cycle. */
  semanticInitDismissed = false;

  /** Hide the semantic-init popup. If it's still downloading, work continues in the worker. */
  dismissSemanticInit(): void {
    this.semanticInitDismissed = true;
    if (this.semanticInit.status === 'error') {
      this.semanticInit = { status: 'idle', stage: '', detail: '' };
    }
    this.notify();
  }

  async warmupSemanticSearch(): Promise<void> {
    if (!this.search) return;
    return this.search.warmupSemanticSearch();
  }

  async performSearch(query: string, type?: 'keyword' | 'semantic', modules?: string[]): Promise<void> {
    if (!this.search || !query.trim()) return;

    // Auto-detect Strong's numbers
    if (STRONGS_PATTERN.test(query.trim())) {
      return this.performStrongsSearch(query.trim(), modules);
    }

    this.query = query;
    this.searchType = type ?? this.searchType;
    this.searchSeq++;
    this.loading = true;
    this.results = [];
    this.totalResults = 0;
    this.isOpen = true;
    this.searchedModule = (this.searchType === 'keyword' && modules && modules.length > 0) ? modules[0] : '';
    this.keywordMatchCount = 0;
    this.lastKeywordModules = modules ?? [];
    // Kept so "load more" hydrates its extra page from the same translation as
    // the first one, rather than silently falling back to KJV halfway down.
    this.lastSemanticModules = modules ?? [];
    this.canLoadMore = false;
    this.keywordCapped = false;
    this.loadingMore = false;
    this.semanticPageSize = 20;
    this.strongsMode = false;
    this.strongsEntry = null;
    this.wordFamily = [];
    this.groupedCounts = {};
    this.strongsTotalAvailable = 0;
    this.lastClickedId = null;

    // Detect verse reference in query (e.g., "John 3:16", "John 3")
    const ref = parseReference(query);
    this.detectedRefVerseId = ref ? refToVerseId(ref.book, ref.chapter, ref.verse) : null;

    this.notify();

    try {
      if (this.searchType === 'semantic') {
        // Run semantic and keyword searches in parallel
        const [semanticResult, keywordResult] = await Promise.all([
          // `modules` is the reader's active translation. Semantic matching is
          // on KJV-derived embeddings regardless; this is what the matched
          // verses get *rendered* in, so a result no longer says KJV while the
          // reader is in another translation.
          this.search.semanticSearch(query, { pageSize: this.semanticPageSize, modules }),
          modules && modules.length > 0
            ? this.search.keywordSearch(query, modules).catch(() => ({ results: [], total: 0 }))
            : Promise.resolve({ results: [], total: 0 }),
        ]);

        this.results = semanticResult.results;
        this.totalResults = semanticResult.total;
        this.keywordMatchCount = keywordResult.total;
        // If we got a full page, there may be more
        this.canLoadMore = semanticResult.results.length >= this.semanticPageSize;
      } else {
        const resultSet = await this.search.keywordSearch(query, modules ?? [], { pageSize: KEYWORD_PAGE_SIZE });
        this.results = resultSet.results;
        this.totalResults = resultSet.total;
        // A full page means the cap may have cut the list short. It cannot
        // distinguish "exactly 50 matches exist" from "the 51st was dropped",
        // which is why the chart's caption says "loaded so far" rather than
        // claiming a Bible-wide tally.
        this.keywordCapped = resultSet.results.length >= KEYWORD_PAGE_SIZE;
      }

      // Promote detected reference verse to top of results
      if (this.detectedRefVerseId) {
        this.promoteDetectedRef();
      }

      this.loading = false;
      this.notify();
    } catch (error) {
      console.error('Search failed:', error);
      this.results = [];
      this.totalResults = 0;
      this.loading = false;
      this.notify();
    }
  }

  /**
   * Perform a Strong's number search with word family resolution.
   */
  async performStrongsSearch(number: string, modules?: string[]): Promise<void> {
    if (!this.search) return;

    // Strip optional strongs: prefix for display
    const displayNum = number.replace(/^strongs:/i, '').toUpperCase();

    this.query = displayNum;
    this.searchSeq++;
    this.loading = true;
    this.results = [];
    this.totalResults = 0;
    this.isOpen = true;
    this.strongsMode = true;
    this.strongsEntry = null;
    this.wordFamily = [];
    this.groupedCounts = {};
    this.searchedModule = '';
    this.keywordMatchCount = 0;
    this.canLoadMore = false;
    this.loadingMore = false;
    this.strongsTotalAvailable = 0;
    this.strongsPageSize = STRONGS_PAGE_SIZE;
    this.strongsModules = modules;
    this.lastClickedId = null;
    this.notify();

    const seq = this.searchSeq;

    try {
      const result = await this.search.strongsSearch(displayNum, this.strongsOptions(this.strongsPageSize));
      // A newer search (or a re-search from "include related") started while this
      // one was in flight — its results are the ones on screen now.
      if (seq !== this.searchSeq) return;

      this.strongsEntry = result.entry;
      this.wordFamily = result.wordFamily;
      this.groupedCounts = result.groupedCounts;
      this.results = result.results;
      this.totalResults = result.total;
      this.strongsTotalAvailable = readTotalAvailable(result);
      this.canLoadMore = result.results.length < this.strongsTotalAvailable;
      this.loading = false;
      this.notify();
    } catch (error) {
      console.error('Strong\'s search failed:', error);
      if (seq !== this.searchSeq) return;
      this.results = [];
      this.totalResults = 0;
      this.loading = false;
      this.notify();
    }
  }

  /**
   * Whether `results` is a truncated view of what the search could return.
   *
   * Each mode reports it differently, because each endpoint bounds itself
   * differently:
   *  - Strong's knows the true occurrence count (`strongsTotalAvailable`);
   *  - semantic asks for a page and infers more from a full one (`canLoadMore`);
   *  - keyword has neither, so it compares against the page size we asked for.
   *
   * The distribution chart uses this to say plainly that it counted the loaded
   * results rather than the Bible.
   */
  get resultsTruncated(): boolean {
    if (this.strongsMode) return this.results.length < this.strongsTotalAvailable;
    if (this.searchType === 'semantic') return this.canLoadMore;
    return this.keywordCapped;
  }

  /** Occurrences still unfetched for the current Strong's search. */
  get strongsRemaining(): number {
    return Math.max(0, this.strongsTotalAvailable - this.results.length);
  }

  /** Load one more page of Strong's occurrences. */
  async loadMoreStrongs(): Promise<void> {
    return this.fetchStrongsPage(this.strongsPageSize + STRONGS_PAGE_SIZE);
  }

  /** Load every remaining occurrence for the current Strong's search. */
  async loadAllStrongs(): Promise<void> {
    return this.fetchStrongsPage(STRONGS_MAX_RESULTS);
  }

  /**
   * Re-request the Strong's list at a larger cap. The endpoint has no offset —
   * like semantic paging, a bigger page simply replaces the list.
   */
  private async fetchStrongsPage(pageSize: number): Promise<void> {
    if (!this.search || !this.strongsMode || !this.canLoadMore || this.loadingMore) return;

    this.loadingMore = true;
    this.notify();

    const seq = this.searchSeq;
    const requested = Math.min(pageSize, STRONGS_MAX_RESULTS);
    const previousCount = this.results.length;

    try {
      const result = await this.search.strongsSearch(this.query, this.strongsOptions(requested));
      // Dropped on the floor if the user has since launched another search.
      if (seq !== this.searchSeq) return;

      this.strongsPageSize = requested;
      this.results = result.results;
      this.totalResults = result.total;
      this.strongsTotalAvailable = readTotalAvailable(result);
      // A page that came back no larger than the last one means the request hit a
      // ceiling somewhere (or the cap never reached the server); stop offering a
      // button that cannot deliver anything more.
      this.canLoadMore = result.results.length > previousCount
        && result.results.length < this.strongsTotalAvailable;
      this.loadingMore = false;
      this.notify();
    } catch (error) {
      console.error('Load more Strong\'s results failed:', error);
      if (seq !== this.searchSeq) return;
      this.loadingMore = false;
      this.canLoadMore = false;
      this.notify();
    }
  }

  /** Build the provider options for a Strong's request at a given cap. */
  private strongsOptions(maxResults: number): StrongsSearchOptions {
    return {
      includeRelated: this.includeRelated,
      modules: this.strongsModules,
      maxResults,
    };
  }

  /**
   * Toggle "include related words" and re-search.
   */
  toggleIncludeRelated(): void {
    this.includeRelated = !this.includeRelated;
    if (this.strongsMode && this.query) {
      this.performStrongsSearch(this.query, this.strongsModules);
    }
  }

  /** Move the detected reference verse to the front of results, or create a placeholder */
  private promoteDetectedRef(): void {
    if (!this.detectedRefVerseId) return;
    const idx = this.results.findIndex(r => r.verseId === this.detectedRefVerseId);
    if (idx > 0) {
      // Move existing result to front
      const [item] = this.results.splice(idx, 1);
      this.results.unshift(item);
    } else if (idx === -1) {
      // Not in results — create a synthetic entry (text will be filled by the panel)
      const vid = this.detectedRefVerseId;
      const book = Math.floor(vid / 1000000);
      const chapter = Math.floor((vid % 1000000) / 1000);
      const verse = vid % 1000;
      const reference = formatPassageRef(book, chapter, verse || 1);
      this.results.unshift({
        verseId: vid,
        reference,
        text: '(exact reference match)',
        module: bibleStore.getActiveTab()?.moduleAbbr || '',
        type: 'reference',
      });
      this.totalResults += 1;
    }
    // idx === 0 means it's already first — nothing to do
  }

  async loadMoreSemantic(): Promise<void> {
    if (!this.search || !this.canLoadMore || this.loadingMore || this.searchType !== 'semantic') return;

    this.loadingMore = true;
    this.notify();

    try {
      this.semanticPageSize += 20;
      const resultSet = await this.search.semanticSearch(this.query, {
        pageSize: this.semanticPageSize,
        modules: this.lastSemanticModules,
      });

      this.results = resultSet.results;
      this.totalResults = resultSet.total;
      // If we got fewer than requested, no more to load
      this.canLoadMore = resultSet.results.length >= this.semanticPageSize;
      this.loadingMore = false;
      this.notify();
    } catch (error) {
      console.error('Load more failed:', error);
      this.loadingMore = false;
      this.canLoadMore = false;
      this.notify();
    }
  }

  /** Switch from semantic results to keyword results view */
  switchToKeywordResults(modules?: string[]): void {
    this.performSearch(this.query, 'keyword', modules ?? this.lastKeywordModules);
  }

  close(): void {
    this.isOpen = false;
    this.notify();
  }

  open(): void {
    this.isOpen = true;
    this.notify();
  }

  setSearchType(type: 'keyword' | 'semantic'): void {
    if (this.searchType === type) return;
    this.searchType = type;
    this.notify();

    // Re-query with the new search type if there's an active query
    if (this.query) {
      this.isOpen = true;
      // Both modes want the reader's translation now: keyword searches its
      // text, semantic renders its matches in it. Previously only keyword was
      // given one, which is why toggling to semantic dropped back to KJV text.
      const remembered = this.lastKeywordModules.length > 0
        ? this.lastKeywordModules
        : this.lastSemanticModules;
      const active = bibleStore.getActiveTab()?.moduleAbbr;
      const modules = remembered.length > 0 ? remembered : (active ? [active] : undefined);
      this.performSearch(this.query, type, modules);
    }
  }

  clear(): void {
    this.query = '';
    this.results = [];
    this.totalResults = 0;
    this.isOpen = false;
    this.searchedModule = '';
    this.detectedRefVerseId = null;
    this.strongsMode = false;
    this.strongsEntry = null;
    this.wordFamily = [];
    this.includeRelated = false;
    this.groupedCounts = {};
    this.strongsTotalAvailable = 0;
    this.strongsPageSize = STRONGS_PAGE_SIZE;
    this.strongsModules = undefined;
    this.canLoadMore = false;
    this.keywordCapped = false;
    this.lastClickedId = null;
    this.notify();
  }
}

/** Build a stable ID for a search result. Includes the range end so overlapping
 * passage/verse results (semantic mode) don't collide and highlight together. */
export function searchResultId(result: SearchResultData): string {
  return `${result.module}|${result.type}|${result.verseId}|${result.endVerseId ?? result.verseId}`;
}

export const searchStore = new SearchStore();
