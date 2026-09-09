import { Store } from './Store';
import { eventBus } from '../events/eventBus';
import type { ICommentaryDataProvider, CommentaryAvailability, IStudyOverviewProvider } from '../providers/interfaces';
import type { CommentaryModuleInfoData } from '../types';
import type { CommentaryEntryData, CommentaryHomeData, ChapterOverviewData } from '../types';
import { DIGEST_MODULE_ABBR, getDigestDisplayName, isDigestModule } from '../moduleDescriptions';

/** A request for the Topics pane to open a specific topic. */
export interface PendingTopicNav {
  topicId: number;
  module: string;
  topicName: string;
  sourceName?: string;
  /** Bumped on every request, so a repeat of the same topic is still observable. */
  token: number;
}

export interface CommentaryTab {
  id: string;
  moduleAbbr: string;
  moduleName: string;
  temporary?: boolean;
  /** Per-tab pin state — each tab can be independently pinned to a passage */
  pinned?: boolean;
  pinnedBook?: number | null;
  pinnedChapter?: number | null;
  pinnedVerse?: number | null;
}

export const HOME_TAB_ID = 'ctab-home';

/**
 * Right-pane ids the desktop tab strip always has a tab for. 'search' is not
 * here because its tab exists only while `searchStore.isOpen` — DesktopApp
 * admits it separately.
 *
 * Anything that can reach `rightPaneMode` — `pane:show`, the verse context
 * menu, a plugin — has to name one of these, or the pane renders with no active
 * tab and no content. `paneModes.test.ts` holds the callers to it.
 */
export const RENDERABLE_PANE_MODES = ['study', 'commentary', 'topics', 'dictionary'] as const;

/**
 * Right-pane ids that survive a reload. 'search' is deliberately excluded:
 * search results are not persisted, so the Search tab does not exist on a cold
 * start and restoring it leaves the pane with no active tab and no content.
 */
export const RESTORABLE_PANE_MODES = new Set<string>(RENDERABLE_PANE_MODES);

/**
 * Budgets for the speculative chapter prefetch, in words of commentary text.
 *
 * Word counts come free with the chapter overview and track payload size
 * closely enough to decide with: measured on John 3, Barnes is ~10k words
 * (74 KB), Synthesis ~22k (136 KB), Clarke ~7k (50 KB) — while Matthew Henry is
 * ~327k (2.1 MB) and Luther ~144k (845 KB). A 60k total with a 25k per-module
 * cap admits the whole cheap tail and excludes exactly the modules that made
 * chapter navigation expensive.
 *
 * These bound *speculative* fetching only. A module the reader actually opens
 * is always fetched, whatever its size.
 */
const PREFETCH_WORD_BUDGET = 60_000;
const PREFETCH_MODULE_WORD_CAP = 25_000;

/**
 * The name a commentary tab should carry.
 *
 * Every caller that omitted a name fell back to the raw abbreviation, and the
 * digest's abbreviation is "SYNTHESIS" — a build detail no reader should see.
 * Resolving it here rather than at each render site means the tab label, its
 * tooltip, the empty-verse message and the restored session all agree, instead
 * of each guarding (or not) on its own.
 */
function resolveTabName(moduleAbbr: string, moduleName?: string | null): string {
  if (isDigestModule(moduleAbbr)) return getDigestDisplayName();
  return moduleName ?? moduleAbbr;
}

let tabCounter = 0;

class CommentaryStore extends Store {
  private provider: ICommentaryDataProvider | null = null;
  private studyOverviewProvider: IStudyOverviewProvider | null = null;
  tabs: CommentaryTab[] = [];
  activeTabId = '';
  entries: CommentaryEntryData[] = [];
  entriesByTab: Map<string, CommentaryEntryData[]> = new Map();
  collapsed = false;
  syncedBook: number | null = null;
  syncedChapter: number | null = null;

  /**
   * Content requests in flight, counted per module.
   *
   * This replaces a single store-wide `loading` boolean, which any tab could
   * raise and only the *active* tab's response was allowed to lower. Switch
   * tabs while a fetch is out and the response arrived for the wrong module,
   * declined to clear the flag, and the pane spun for good.
   *
   * Counted rather than flagged because a chapter change can start a second
   * request for a module while the first is still out: the abandoned response
   * must retire its own claim and not the fresh one's.
   */
  private _inFlightByModule: Map<string, number> = new Map();

  /** Is a content request out for this module right now? */
  isModuleLoading(moduleAbbr: string): boolean {
    return (this._inFlightByModule.get(moduleAbbr) ?? 0) > 0;
  }

  private _beginLoad(moduleAbbr: string): void {
    this._inFlightByModule.set(moduleAbbr, (this._inFlightByModule.get(moduleAbbr) ?? 0) + 1);
  }

  private _endLoad(moduleAbbr: string): void {
    const remaining = (this._inFlightByModule.get(moduleAbbr) ?? 1) - 1;
    if (remaining > 0) this._inFlightByModule.set(moduleAbbr, remaining);
    else this._inFlightByModule.delete(moduleAbbr);
  }

  /**
   * Is the *visible* tab still waiting for its first content?
   *
   * Derived from the per-module register rather than stored, so a request can
   * only ever clear the spinner it raised. Both halves are needed: a request
   * for this tab's own module is out, *and* there is nothing on screen to read
   * meanwhile. Without the second half the full-chapter upgrade that runs
   * behind an already-painted per-verse result would blank the pane a second
   * time; without the first, an empty result mid-fetch reads as "No commentary
   * for this verse".
   *
   * The Home tab is excluded; it runs its own homeLoading/homeData cycle.
   */
  get loading(): boolean {
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (!tab || tab.id === HOME_TAB_ID) return false;
    if (!this.isModuleLoading(tab.moduleAbbr)) return false;
    return this.entries.length === 0;
  }

  /** Is the active tab pinned? (computed from per-tab state) */
  get pinned(): boolean {
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    return tab?.pinned ?? false;
  }

  /** The active tab's pinned book (computed from per-tab state) */
  get pinnedBook(): number | null {
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    return tab?.pinnedBook ?? null;
  }

  /** The active tab's pinned chapter (computed from per-tab state) */
  get pinnedChapter(): number | null {
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    return tab?.pinnedChapter ?? null;
  }

  /** The active tab's pinned verse (computed from per-tab state) */
  get pinnedVerse(): number | null {
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    return tab?.pinnedVerse ?? null;
  }

  // Right pane mode
  rightPaneMode = 'commentary';

  // Pending topic navigation (set when navigating from StudyTopics → TopicsPane)
  /**
   * A topic the Topics pane should open next.
   *
   * `token` is what makes a *repeat* request observable. Reading this during
   * render and clearing it as a side effect silently drops a request raised
   * while the Topics pane is already mounted (no remount, so nothing ever reads
   * it) — clicking a topic in the Study pane with Topics already open appears
   * to do nothing. Consumers watch the token and clear it from an effect; see
   * TopicsPane / TopicsBrowser.
   */
  pendingTopicNav: PendingTopicNav | null = null;
  private _topicNavToken = 0;

  // Generation counter to detect stale async completions in _loadChapter
  private _loadGeneration = 0;

  // Availability cache for the module picker dialog
  availability: CommentaryAvailability = {};
  availabilityLoading = false;

  // Home tab data
  homeData: CommentaryHomeData | null = null;
  homeLoading = false;
  private homeDataKey = '';  // cache key: "book-chapter-verse"

  // Chapter verses cache for individual commentary tabs (moduleAbbr -> verse numbers)
  chapterVersesCache: Map<string, number[]> = new Map();
  chapterVersesLoading = false;

  // Content format per module (moduleAbbr -> format)
  contentFormatByModule: Map<string, string> = new Map();

  // Chapter overview cache (lightweight metadata: word counts, no content)
  chapterOverviewCache: Map<string, ChapterOverviewData> = new Map();
  private _chapterOverviewKey = '';
  private _chapterOverviewPromise: Promise<void> | null = null;

  // Override verse for commentary-only navigation (doesn't change Bible pane selection)
  overrideVerse: number | null = null;

  // Muted and promoted commentary modules
  mutedModules: Set<string> = new Set();
  promotedModules: Set<string> = new Set();

  // Mobile: persist selected commentary detail across tab switches
  mobileSelectedCommentary: { abbr: string; name: string } | null = null;
  // Mobile: verse ID at the time the commentary was selected (for scroll position restoration)
  mobileSelectedVerseId: number | null = null;

  init(provider: ICommentaryDataProvider, studyOverview?: IStudyOverviewProvider): void {
    this.provider = provider;
    this.studyOverviewProvider = studyOverview ?? null;
    this.restoreSession();
    // Ensure home tab always exists as the first tab
    if (!this.tabs.find(t => t.id === HOME_TAB_ID)) {
      this.tabs.unshift({ id: HOME_TAB_ID, moduleAbbr: '__home__', moduleName: 'Overview' });
    }
    if (this.tabs.length <= 1) {
      this.addTab(DIGEST_MODULE_ABBR, getDigestDisplayName());
    }
    // Auto-promote Digest unless the user has explicitly muted it
    if (!this.mutedModules.has(DIGEST_MODULE_ABBR)) {
      this.promotedModules.add(DIGEST_MODULE_ABBR);
    }
    // Default to home tab if no active tab, or if activeTabId doesn't match any tab
    if (!this.activeTabId || !this.tabs.find(t => t.id === this.activeTabId)) {
      this.activeTabId = this.tabs.length > 1 ? this.tabs[1].id : HOME_TAB_ID;
    }
    this.notify();

    // Subscribe to event bus for decoupled communication
    eventBus.on('commentary:load-chapter', ({ book, chapter }) => {
      this.loadForChapter(book, chapter);
    });
    eventBus.on('pane:show', ({ paneId }) => {
      this.setRightPaneMode(paneId);
    });
    eventBus.on('pane:expand', () => {
      this.expand();
    });
  }

  get isHomeTabActive(): boolean {
    return this.activeTabId === HOME_TAB_ID;
  }

  async getModuleInfo(moduleAbbr: string): Promise<CommentaryModuleInfoData | null> {
    if (!this.provider) return null;
    return this.provider.getModuleInfo(moduleAbbr);
  }

  /** Check if a tab has entries matching a specific verse */
  tabHasContentForVerse(tabId: string, verseId: number): boolean {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return false;
    const tabEntries = this.entriesByTab.get(tab.moduleAbbr);
    if (!tabEntries) return false;
    return tabEntries.some(entry =>
      entry.verse_id_start <= verseId &&
      (entry.verse_id_end ? entry.verse_id_end >= verseId : entry.verse_id_start === verseId)
    );
  }

  /** Fetch availability of all commentary modules for the current passage */
  async fetchAvailability(book: number, chapter: number, verse?: number): Promise<void> {
    if (!this.provider) return;
    this.availabilityLoading = true;
    this.notify();
    try {
      this.availability = await this.provider.getAvailability(book, chapter, verse);
    } catch {
      this.availability = {};
    }
    this.availabilityLoading = false;
    this.notify();
  }

  /** Fetch commentary entries for a specific module (used for inline preview on home screen).
   *  If a verseId is provided and cache is cold, loads per-verse immediately for fast display
   *  and kicks off a background full-chapter load for smooth verse navigation.
   */
  async fetchModuleEntries(moduleAbbr: string, book: number, chapter: number, verseId?: number): Promise<CommentaryEntryData[]> {
    if (!this.provider) return [];

    // Return cached entries if available (could be per-verse seed or full chapter)
    const cached = this.entriesByTab.get(moduleAbbr);
    if (cached) return cached;

    // If we have a verse, use per-verse endpoint for immediate display
    if (verseId) {
      const verseEntries = await this.fetchEntriesForVerse(moduleAbbr, verseId);
      // Then warm the rest of the chapter in the background so stepping to the
      // next verse is instant — but only when this module is small enough that
      // the speculative half of the work is worth it. For a module like Matthew
      // Henry this single line was pulling ~2 MB to save a request the reader
      // may never make; there, per-verse fetches on navigation are the better
      // trade. The reader still gets the verse they asked for either way.
      if (this.isCheapEnoughToWarm(moduleAbbr, book, chapter)) {
        void this.provider.getCommentary(moduleAbbr, book, chapter).then(data => {
          this.entriesByTab.set(moduleAbbr, data.entries);
          if (data.content_format) this.contentFormatByModule.set(moduleAbbr, data.content_format);
          this.notify();
        }).catch(() => {});
      }
      return verseEntries;
    }

    // No active verse — load full chapter
    try {
      const data = await this.provider.getCommentary(moduleAbbr, book, chapter);
      this.entriesByTab.set(moduleAbbr, data.entries);
      if (data.content_format) this.contentFormatByModule.set(moduleAbbr, data.content_format);
      return data.entries;
    } catch {
      return [];
    }
  }

  /** Per-verse fast path: fetch only the entries that match a single verse for a single module.
   *  Updates entriesByTab cache so the detail view can render immediately, then the full
   *  chapter prefetch can be kicked off in the background.
   */
  async fetchEntriesForVerse(moduleAbbr: string, verseId: number): Promise<CommentaryEntryData[]> {
    try {
      const res = await fetch(`/api/commentary/${moduleAbbr}/verse/${verseId}`);
      if (!res.ok) return [];
      const data = await res.json();
      const entries: CommentaryEntryData[] = data.entries ?? [];
      // Only seed cache if a fuller chapter-level fetch hasn't already populated it.
      if (!this.entriesByTab.has(moduleAbbr)) {
        this.entriesByTab.set(moduleAbbr, entries);
      }
      if (data.content_format) {
        this.contentFormatByModule.set(moduleAbbr, data.content_format);
      }
      this.notify();
      return entries;
    } catch {
      return [];
    }
  }

  /** Prefetch commentary entries for a chapter in a single bulk request, so
   *  opening a module is instant.
   *
   *  Budget-gated. This used to fetch every active module's full chapter text
   *  unconditionally, which is fine for the small commentaries and ruinous for
   *  the large ones: Matthew Henry's John 3 is ~2 MB on its own and Luther's is
   *  ~850 KB, so a reader tapping through chapters on a phone was pulling
   *  multiple megabytes per navigation for content they had not asked to see.
   *
   *  The chapter overview already gives us per-entry word counts for nothing,
   *  so we spend that first and only prefetch what fits. Anything excluded
   *  still loads on demand through `fetchEntriesForVerse` / `fetchModuleEntries`
   *  the moment the reader opens it, which is the path that already existed.
   *
   *  Runs silently in the background — does not set loading state or notify.
   */
  private _prefetchKey = '';
  private _prefetchPromise: Promise<void> | null = null;
  async prefetchAllEntries(book: number, chapter: number): Promise<void> {
    if (!this.provider) return;
    const key = `${book}-${chapter}`;
    if (this._prefetchKey === key) return;  // already prefetched for this chapter
    this._prefetchKey = key;
    this._prefetchPromise = this._doPrefetch(book, chapter);
    await this._prefetchPromise;
  }

  /**
   * Which modules are cheap enough to pull eagerly for this chapter.
   *
   * Returns `null` when we have no overview to judge by — the caller treats
   * that as "don't guess", and skips the bulk fetch rather than risk the
   * multi-megabyte case. An empty array means "we looked, nothing qualifies".
   */
  affordablePrefetchModules(book: number, chapter: number): string[] | null {
    const overview = this.chapterOverviewCache.get(`${book}-${chapter}`);
    if (!overview) return null;

    const wordsByModule = new Map<string, number>();
    for (const entry of overview.entries) {
      const abbr = overview.modules[entry.moduleIdx]?.[0];
      if (!abbr) continue;
      wordsByModule.set(abbr, (wordsByModule.get(abbr) ?? 0) + entry.wordCount);
    }

    // Cheapest first, so a budget buys as many modules as possible rather than
    // being spent on one large one.
    const ranked = [...wordsByModule.entries()].sort((a, b) => a[1] - b[1]);

    const chosen: string[] = [];
    let spent = 0;
    for (const [abbr, words] of ranked) {
      if (words > PREFETCH_MODULE_WORD_CAP) continue;
      if (spent + words > PREFETCH_WORD_BUDGET) break;
      chosen.push(abbr);
      spent += words;
    }
    return chosen;
  }

  /**
   * Whether a single module's chapter is small enough to fetch speculatively.
   *
   * Unknown size (no overview yet) counts as too expensive: the modules that
   * hurt are precisely the ones worth being careful about, and the on-demand
   * path covers the miss.
   */
  isCheapEnoughToWarm(moduleAbbr: string, book: number, chapter: number): boolean {
    const overview = this.chapterOverviewCache.get(`${book}-${chapter}`);
    if (!overview) return false;

    let words = 0;
    let seen = false;
    for (const entry of overview.entries) {
      if (overview.modules[entry.moduleIdx]?.[0] !== moduleAbbr) continue;
      seen = true;
      words += entry.wordCount;
    }
    // Not in the overview at all means it has no content for this chapter —
    // nothing to warm, and nothing to spend.
    if (!seen) return false;
    return words <= PREFETCH_MODULE_WORD_CAP;
  }

  private async _doPrefetch(book: number, chapter: number): Promise<void> {
    try {
      // Cheap metadata first — it is what the budget is computed from, and it
      // is cached and reused by the card list anyway.
      await this.prefetchChapterOverview(book, chapter);

      const affordable = this.affordablePrefetchModules(book, chapter);
      // No overview (offline, or the request failed) — decline to prefetch
      // rather than gamble on the size. On-demand loading still works.
      if (affordable === null || affordable.length === 0) return;

      const data = await this.provider!.getAllCommentary(book, chapter, affordable);
      // Only populate cache for modules not already cached (don't overwrite fresh data)
      for (const [moduleAbbr, moduleData] of Object.entries(data.modules)) {
        if (!this.entriesByTab.has(moduleAbbr)) {
          this.entriesByTab.set(moduleAbbr, moduleData.entries);
          if (moduleData.content_format) {
            this.contentFormatByModule.set(moduleAbbr, moduleData.content_format);
          }
        }
      }
    } catch {
      // Silent failure — prefetch is best-effort
    } finally {
      this._prefetchPromise = null;
    }
  }

  /** Prefetch lightweight chapter overview (word counts, no content) for all modules.
   *  Runs in background — does not set loading state.
   */
  async prefetchChapterOverview(book: number, chapter: number): Promise<void> {
    if (!this.provider) return;
    const key = `${book}-${chapter}`;
    if (this._chapterOverviewKey === key) return;
    this._chapterOverviewKey = key;
    this._chapterOverviewPromise = this._doChapterOverview(book, chapter, key);
    await this._chapterOverviewPromise;
  }

  private async _doChapterOverview(book: number, chapter: number, key: string): Promise<void> {
    try {
      const data = await this.provider!.getChapterOverview(book, chapter);
      this.chapterOverviewCache.set(key, data);
    } catch {
      // silent failure
    } finally {
      this._chapterOverviewPromise = null;
    }
  }

  /** Compute CommentaryHomeData from the chapter overview cache for a specific verse.
   *  Returns null if chapter overview is not yet cached.
   */
  getHomeDataFromOverview(book: number, chapter: number, verse: number): CommentaryHomeData | null {
    const key = `${book}-${chapter}`;
    const overview = this.chapterOverviewCache.get(key);
    if (!overview) return null;

    const verseId = book * 1000000 + chapter * 1000 + verse;

    const verseModulesMap = new Map<string, { moduleAbbr: string; moduleName: string; wordCount: number }>();
    const passageModulesMap = new Map<string, { moduleAbbr: string; moduleName: string; wordCount: number }>();
    const chapterModulesMap = new Map<string, { moduleAbbr: string; moduleName: string; wordCount: number }>();

    for (const entry of overview.entries) {
      const [abbr, rawName] = overview.modules[entry.moduleIdx];
      // Same resolution the tabs use: the digest's shipped name is its
      // abbreviation, which is not a name a reader should be shown.
      const name = resolveTabName(abbr, rawName);
      const entryStartId = book * 1000000 + chapter * 1000 + entry.startVerse;
      const entryEndId = book * 1000000 + chapter * 1000 + entry.endVerse;
      if (entryStartId > verseId || entryEndId < verseId) continue;

      const isVerse = entry.level === 'v' && entry.startVerse === verse;
      const isPassage = !isVerse && (entry.level === 'p' || entry.startVerse !== entry.endVerse);
      const isChapter = entry.level === 'c' || entry.level === 'b';

      if (isVerse) {
        const existing = verseModulesMap.get(abbr);
        if (existing) existing.wordCount += entry.wordCount;
        else verseModulesMap.set(abbr, { moduleAbbr: abbr, moduleName: name, wordCount: entry.wordCount });
      } else if (isPassage) {
        if (!verseModulesMap.has(abbr)) {
          const existing = passageModulesMap.get(abbr);
          if (existing) existing.wordCount += entry.wordCount;
          else passageModulesMap.set(abbr, { moduleAbbr: abbr, moduleName: name, wordCount: entry.wordCount });
        }
      } else if (isChapter) {
        if (!verseModulesMap.has(abbr) && !passageModulesMap.has(abbr)) {
          const existing = chapterModulesMap.get(abbr);
          if (existing) existing.wordCount += entry.wordCount;
          else chapterModulesMap.set(abbr, { moduleAbbr: abbr, moduleName: name, wordCount: entry.wordCount });
        }
      }
    }

    const sortByName = (a: { moduleName: string }, b: { moduleName: string }) =>
      a.moduleName.localeCompare(b.moduleName);

    return {
      verseModules: [...verseModulesMap.values()].sort(sortByName),
      passageModules: passageModulesMap.size > 0 ? [...passageModulesMap.values()].sort(sortByName) : undefined,
      chapterModules: [...chapterModulesMap.values()].sort(sortByName),
    };
  }

  /** Load home tab data for the current passage.
   *  1. Uses pre-generated study overview cache when available (instant, no server round-trip).
   *  2. Falls back to chapter overview cache (lightweight metadata prefetch) if already loaded.
   *  3. Falls back to per-verse server endpoint (immediate, doesn't wait for in-flight prefetches).
   */
  async loadHomeData(book: number, chapter: number, verse?: number): Promise<void> {
    if (!this.provider) return;
    const key = `${book}-${chapter}-${verse ?? ''}`;
    if (this.homeData && this.homeDataKey === key) return;  // already cached

    // 1. Try the study overview cache first (chapter-level, pre-generated)
    if (verse && this.studyOverviewProvider) {
      try {
        await this.studyOverviewProvider.loadChapter(book, chapter);
        if (this.studyOverviewProvider.hasChapter(book, chapter)) {
          this.homeData = this.studyOverviewProvider.getCommentaryHomeForVerse(book, chapter, verse);
          this.homeDataKey = key;
          this.homeLoading = false;
          this.notify();
          return;
        }
      } catch {
        // Fall through
      }
    }

    // 2. Try chapter overview cache (our lightweight metadata prefetch) — only if already loaded
    if (verse) {
      const fromOverview = this.getHomeDataFromOverview(book, chapter, verse);
      if (fromOverview) {
        this.homeData = fromOverview;
        this.homeDataKey = key;
        this.homeLoading = false;
        this.notify();
        return;
      }
    }

    // 3. Fallback: per-verse server call (immediate, don't wait for any in-flight prefetches)
    this.homeLoading = true;
    this.homeDataKey = key;
    this.notify();
    try {
      this.homeData = await this.provider.getHomeData(book, chapter, verse);
    } catch {
      this.homeData = null;
    }
    this.homeLoading = false;
    this.notify();
  }

  /**
   * Work out which verses of this chapter the module has content for.
   *
   * This used to be its own server call per module
   * (`/api/commentary/:module/chapter-verses/:book/:chapter`), which was a
   * round trip to have the server do a `%` and a sort. The chapter overview —
   * already fetched on every chapter change, and cached for a day — carries
   * `[moduleIdx, startVerse, endVerse, level, wordCount]` for *every* module,
   * which is the same input the endpoint derived its answer from. So derive it
   * here, for nothing, and for all modules at once.
   */
  async loadChapterVerses(moduleAbbr: string, book: number, chapter: number): Promise<void> {
    if (!this.provider) return;
    // Don't reload if already cached for this module
    if (this.chapterVersesCache.has(moduleAbbr)) return;

    this.chapterVersesLoading = true;
    this.notify();
    // Resolves immediately once the overview for this chapter is in hand, and
    // joins the in-flight request otherwise.
    await this.prefetchChapterOverview(book, chapter);
    this.chapterVersesCache.set(moduleAbbr, this.chapterVersesFromOverview(moduleAbbr, book, chapter));
    this.chapterVersesLoading = false;
    this.notify();
  }

  /** The verse numbers `moduleAbbr` covers in this chapter, per the overview. */
  private chapterVersesFromOverview(moduleAbbr: string, book: number, chapter: number): number[] {
    const overview = this.chapterOverviewCache.get(`${book}-${chapter}`);
    if (!overview) return [];

    const verses = new Set<number>();
    for (const entry of overview.entries) {
      if (overview.modules[entry.moduleIdx]?.[0] !== moduleAbbr) continue;
      // A chapter- or book-level entry starts at verse 0 and covers no
      // particular verse; the endpoint skipped those the same way.
      if (entry.startVerse <= 0) continue;
      for (let v = entry.startVerse; v <= Math.max(entry.startVerse, entry.endVerse); v++) {
        verses.add(v);
      }
    }
    return [...verses].sort((a, b) => a - b);
  }

  /** Get chapter verses for the active tab's module */
  getActiveChapterVerses(): number[] {
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (!tab) return [];
    return this.chapterVersesCache.get(tab.moduleAbbr) ?? [];
  }

  /** Get content format for a module (defaults to 'html') */
  getContentFormat(moduleAbbr: string): string {
    return this.contentFormatByModule.get(moduleAbbr) ?? 'html';
  }

  /** Set an override verse for commentary navigation (doesn't change Bible pane) */
  setOverrideVerse(verse: number | null): void {
    this.overrideVerse = verse;
    this.notify();
  }

  /** Set the selected commentary for mobile persistence */
  setMobileSelectedCommentary(detail: { abbr: string; name: string } | null, verseId?: number | null): void {
    this.mobileSelectedCommentary = detail;
    this.mobileSelectedVerseId = verseId ?? null;
    this.notify();
  }

  /** Toggle muted state for a commentary module */
  toggleMuted(moduleAbbr: string): void {
    const newMuted = new Set(this.mutedModules);
    const newPromoted = new Set(this.promotedModules);
    if (newMuted.has(moduleAbbr)) {
      newMuted.delete(moduleAbbr);
    } else {
      newMuted.add(moduleAbbr);
      // If promoting, un-promote when muting
      newPromoted.delete(moduleAbbr);
    }
    this.mutedModules = newMuted;
    this.promotedModules = newPromoted;
    this.saveSession();
    this.notify();
  }

  /** Toggle promoted state for a commentary module */
  togglePromoted(moduleAbbr: string): void {
    const newPromoted = new Set(this.promotedModules);
    const newMuted = new Set(this.mutedModules);
    if (newPromoted.has(moduleAbbr)) {
      newPromoted.delete(moduleAbbr);
    } else {
      newPromoted.add(moduleAbbr);
      // If muted, un-mute when promoting
      newMuted.delete(moduleAbbr);
    }
    this.promotedModules = newPromoted;
    this.mutedModules = newMuted;
    this.saveSession();
    this.notify();
  }

  /** Navigate to a commentary tab by module abbreviation, adding it if needed */
  openCommentaryTab(moduleAbbr: string, moduleName?: string): void {
    const existing = this.tabs.find(t => t.moduleAbbr === moduleAbbr);
    if (existing) {
      this.setActiveTab(existing.id);
    } else {
      this.addTab(moduleAbbr, moduleName);
    }
  }

  /** Open a temporary preview tab, replacing any existing temporary tab */
  openTemporaryTab(moduleAbbr: string, moduleName?: string, verseId?: number): void {
    // If this module already has a permanent tab, just switch to it
    const existing = this.tabs.find(t => t.moduleAbbr === moduleAbbr && !t.temporary);
    if (existing) {
      this.setActiveTab(existing.id);
      return;
    }

    // Remove any existing temporary tab
    const tempTab = this.tabs.find(t => t.temporary);
    if (tempTab) {
      if (tempTab.moduleAbbr === moduleAbbr) {
        // Already showing this module as temporary
        this.setActiveTab(tempTab.id);
        return;
      }
      const idx = this.tabs.indexOf(tempTab);
      this.tabs.splice(idx, 1);
      this.entriesByTab.delete(tempTab.moduleAbbr);
    }

    // Add new temporary tab
    const id = `ctab-${++tabCounter}-${Date.now()}`;
    const tab: CommentaryTab = { id, moduleAbbr, moduleName: resolveTabName(moduleAbbr, moduleName), temporary: true };
    this.tabs.push(tab);
    this.activeTabId = id;

    this._ensureTabContent(tab, verseId);
    this.notify();
  }

  /** Make a temporary tab permanent */
  keepTab(tabId: string): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab && tab.temporary) {
      tab.temporary = false;
      this.saveSession();
      this.notify();
    }
  }

  async loadForChapter(book: number, chapter: number): Promise<void> {
    // Per-tab pinning: always proceed — _loadChapter skips pinned tabs
    await this._loadChapter(book, chapter);
  }

  private async _loadChapter(book: number, chapter: number): Promise<void> {
    if (this.tabs.length === 0 || !this.provider) return;
    if (this.syncedBook === book && this.syncedChapter === chapter) return;

    const generation = ++this._loadGeneration;
    this.syncedBook = book;
    this.syncedChapter = chapter;
    this.chapterVersesCache.clear();
    // Clear cached entries only for UNPINNED tabs — pinned tabs keep their data
    for (const tab of this.tabs) {
      if (!tab.pinned) {
        this.entriesByTab.delete(tab.moduleAbbr);
      }
    }
    // The active tab's `entries` still belong to the chapter we are leaving.
    // Left in place they get filtered against a verse id from the NEW chapter,
    // match nothing, and CommentaryContent renders "No commentary for this
    // verse" while the fetch below is still in flight. Drop them; the spinner
    // that covers the gap follows from this tab's own request, started below
    // before we notify.
    // The Home tab is excluded: it has its own homeLoading/homeData cycle.
    const activeChapterTab = this.tabs.find(t => t.id === this.activeTabId);
    if (activeChapterTab && !activeChapterTab.pinned && activeChapterTab.id !== HOME_TAB_ID) {
      this.entries = [];
    }
    // Clear home data and prefetch caches so they re-fetch for the new chapter.
    // A pinned Overview tab keeps its data, exactly like a pinned module tab —
    // that is the whole point of pinning it.
    const homeTab = this.tabs.find(t => t.id === HOME_TAB_ID);
    if (!homeTab?.pinned) {
      this.homeDataKey = '';
      this.homeData = null;
      // Home renders "No commentary data available" whenever homeData is null
      // and homeLoading is false, so raise the flag in the same breath.
      this.homeLoading = true;
    }
    this._prefetchKey = '';
    this._chapterOverviewKey = '';

    // Start the content load only when a Commentary view is on screen to
    // receive it. Only one right-hand pane is mounted at a time, and this
    // fires from `bibleStore.navigateTo` regardless of which — so a reader in
    // the Study pane was pulling every open commentary tab's full chapter, per
    // chapter, and never seeing any of it.
    //
    // When a view *is* mounted this is started before the notify: each module
    // registers itself as in flight synchronously, and `loading` is derived
    // from that register, so this is what puts a spinner — rather than an empty
    // state — in the same paint that dropped the stale entries above.
    if (this._viewMounted) this._startChapterContent(book, chapter, generation);

    this.notify();
  }

  /**
   * Whether a Commentary view is currently rendered.
   *
   * Set by `CommentaryPane` / `MobileCommentaryView` through
   * {@link viewMounted}. It is a plain boolean rather than a refcount because
   * the two are never on screen at once — the app renders one layout or the
   * other — and a stale `true` costs a request the old code made unconditionally
   * anyway, while a stale `false` would lose content, which is the failure worth
   * ruling out.
   */
  private _viewMounted = false;

  /**
   * Tell the store a Commentary view has mounted or unmounted.
   *
   * On mount it also loads whatever the current chapter needs, because the
   * chapter change that would have started it may have happened while no view
   * was there to receive it — switching to the Commentary tab is exactly that
   * case.
   */
  viewMounted(mounted: boolean): void {
    this._viewMounted = mounted;
    if (mounted) this.ensureChapterContent();
  }

  /** Load the synced chapter's commentary content if it is not already loading. */
  ensureChapterContent(): void {
    if (!this.syncedBook || !this.syncedChapter) return;
    this._startChapterContent(this.syncedBook, this.syncedChapter, this._loadGeneration);
  }

  /**
   * Start the requests a chapter change needs: the visible tab on its own, and
   * everything behind it in one batch.
   *
   * The split is deliberate. Batching *all* of them would be fewer requests
   * still, but a batch can only land when its slowest member does — and the
   * members differ by two orders of magnitude (Matthew Henry's John 3 is ~2 MB
   * against Barnes' 74 KB). Putting the tab the reader is looking at in with
   * them would make the pane wait on content that is not on screen, which is a
   * worse trade than the round trip it saves. So: the active tab answers as
   * fast as it can, and the background tabs — which nobody is waiting on — cost
   * one request between them instead of one each.
   */
  private _startChapterContent(book: number, chapter: number, generation: number): void {
    const unpinned = this.tabs.filter(t => t.id !== HOME_TAB_ID && !t.pinned);
    const active = unpinned.find(t => t.id === this.activeTabId);
    if (active) void this._backgroundLoadTab(active.moduleAbbr, book, chapter, generation);

    const background = unpinned.filter(t => t !== active).map(t => t.moduleAbbr);
    void this._backgroundLoadTabs(background, book, chapter, generation);

    // Word counts for every module, and the only thing `getChapterVerses` was
    // ever asking the server to derive. Non-blocking.
    void this.prefetchChapterOverview(book, chapter);
  }

  /**
   * Make sure the tab now on screen has content, or a request of its own out to
   * get it.
   *
   * Every path that makes a tab active funnels through here, so there is one
   * answer to "who starts the load?". `setActiveTab` used to defer to whatever
   * load happened to be running, on the premise that it would "pick up the new
   * activeTabId when it completes" — it cannot, because a response can only
   * paint the module it fetched. A tab activated while some *other* module was
   * mid-flight was left with no data and no request of its own: the pane spun
   * forever. Deferring is only correct when the request already out is for
   * *this* tab's module, which is what `isModuleLoading` asks.
   */
  private _ensureTabContent(tab: CommentaryTab, verseId?: number): void {
    if (tab.id === HOME_TAB_ID) return;

    const cached = this.entriesByTab.get(tab.moduleAbbr);
    if (cached) {
      this.entries = cached;
      return;
    }

    // Nothing cached: whatever `entries` holds belongs to the tab we just left,
    // and filtering it against this tab's verse would render a false "No
    // commentary for this verse" until the fetch lands.
    this.entries = [];
    if (this.isModuleLoading(tab.moduleAbbr)) return;
    void this._loadTabContent(tab, verseId);
  }

  /**
   * Fetch what one tab needs, and paint it if it is still the visible one.
   *
   * A pinned tab is deliberately out of step with the Bible pane, so it loads
   * from its pinned passage and passes a null generation: a later chapter
   * change must not discard a response the reader explicitly asked for.
   */
  private async _loadTabContent(tab: CommentaryTab, verseId?: number): Promise<void> {
    const book = tab.pinned ? (tab.pinnedBook ?? this.syncedBook) : this.syncedBook;
    const chapter = tab.pinned ? (tab.pinnedChapter ?? this.syncedChapter) : this.syncedChapter;
    if (!book || !chapter || !this.provider) return;
    const generation = tab.pinned ? null : this._loadGeneration;

    if (verseId) {
      // Per-verse fast path: the verse the reader asked for lands first, then
      // the full chapter follows below so stepping between verses is instant.
      this._beginLoad(tab.moduleAbbr);
      try {
        const entries = await this.fetchEntriesForVerse(tab.moduleAbbr, verseId);
        if (this.activeTabId === tab.id) this.entries = entries;
      } finally {
        this._endLoad(tab.moduleAbbr);
        this.notify();
      }
    }

    await this._backgroundLoadTab(tab.moduleAbbr, book, chapter, generation);
  }

  /**
   * Load full chapter entries for several tabs in **one** request.
   *
   * A chapter change reloads every unpinned tab, and doing that a module at a
   * time meant a reader with four commentaries open spent four round trips on
   * every next-chapter click. `/api/commentary/all` answers all of them at once
   * for the same bytes.
   *
   * Modules already cached for this chapter are dropped from the request rather
   * than re-fetched, so a tab opened on its own does not drag the others along
   * behind it.
   */
  private async _backgroundLoadTabs(moduleAbbrs: string[], book: number, chapter: number, generation: number | null): Promise<void> {
    const wanted = moduleAbbrs.filter(m => !this.entriesByTab.has(m) && !this._isChapterLoadInFlight(m, book, chapter));
    if (wanted.length === 0) return;
    if (wanted.length === 1) {
      await this._backgroundLoadTab(wanted[0], book, chapter, generation);
      return;
    }

    for (const moduleAbbr of wanted) this._claimChapterLoad(moduleAbbr, book, chapter);
    for (const moduleAbbr of wanted) this._beginLoad(moduleAbbr);
    try {
      const data = await this.provider!.getAllCommentary(book, chapter, wanted);
      if (generation !== null && generation !== this._loadGeneration) return;
      const activeTab = this.tabs.find(t => t.id === this.activeTabId);
      for (const moduleAbbr of wanted) {
        // A module with nothing in this chapter is simply absent from the
        // response. Caching the empty result is the point — it is what stops
        // the next verse click asking for it again.
        const moduleData = data.modules[moduleAbbr];
        this.entriesByTab.set(moduleAbbr, moduleData?.entries ?? []);
        if (moduleData?.content_format) this.contentFormatByModule.set(moduleAbbr, moduleData.content_format);
        if (activeTab?.moduleAbbr === moduleAbbr) this.entries = moduleData?.entries ?? [];
      }
    } catch (error) {
      console.error('Failed to load commentary for', wanted.join(', '), error);
      if (generation !== null && generation !== this._loadGeneration) return;
      const activeTab = this.tabs.find(t => t.id === this.activeTabId);
      if (activeTab && wanted.includes(activeTab.moduleAbbr)) this.entries = [];
    } finally {
      for (const moduleAbbr of wanted) this._releaseChapterLoad(moduleAbbr, book, chapter);
      for (const moduleAbbr of wanted) this._endLoad(moduleAbbr);
      this.notify();
    }
  }

  /**
   * Which (module, chapter) pairs have a request out.
   *
   * Keyed by chapter as well as module, and that is the whole point: the
   * spinner register (`isModuleLoading`) answers "is this module fetching
   * *something*", which is the wrong question here. A request still out for the
   * chapter the reader just left would otherwise suppress the new chapter's,
   * and the tab would sit empty waiting on a response it will discard.
   */
  private _chapterLoadsInFlight = new Set<string>();

  private _chapterLoadKey(moduleAbbr: string, book: number, chapter: number): string {
    return `${moduleAbbr}@${book}-${chapter}`;
  }

  private _isChapterLoadInFlight(moduleAbbr: string, book: number, chapter: number): boolean {
    return this._chapterLoadsInFlight.has(this._chapterLoadKey(moduleAbbr, book, chapter));
  }

  private _claimChapterLoad(moduleAbbr: string, book: number, chapter: number): void {
    this._chapterLoadsInFlight.add(this._chapterLoadKey(moduleAbbr, book, chapter));
  }

  private _releaseChapterLoad(moduleAbbr: string, book: number, chapter: number): void {
    this._chapterLoadsInFlight.delete(this._chapterLoadKey(moduleAbbr, book, chapter));
  }

  /** Load full chapter entries for one tab in the background. Non-blocking.
   *
   *  `generation` is the chapter generation the request belongs to, or null for
   *  a pinned tab, whose content is not tied to the synced chapter at all.
   */
  private async _backgroundLoadTab(moduleAbbr: string, book: number, chapter: number, generation: number | null): Promise<void> {
    // `ensureChapterContent` runs on every Commentary view mount as well as on
    // the chapter change itself, so the same load can be asked for twice.
    if (this._isChapterLoadInFlight(moduleAbbr, book, chapter)) return;
    this._claimChapterLoad(moduleAbbr, book, chapter);

    this._beginLoad(moduleAbbr);
    try {
      const data = await this.provider!.getCommentary(moduleAbbr, book, chapter);
      // A response from a chapter the reader has already left must not
      // overwrite the current one's entries.
      if (generation !== null && generation !== this._loadGeneration) return;
      this.entriesByTab.set(moduleAbbr, data.entries);
      if (data.content_format) this.contentFormatByModule.set(moduleAbbr, data.content_format);
      // Only the tab showing this module gets painted; the rest is cache.
      const activeTab = this.tabs.find(t => t.id === this.activeTabId);
      if (activeTab?.moduleAbbr === moduleAbbr) {
        this.entries = data.entries;
      }
    } catch (error) {
      console.error('Failed to load commentary for', moduleAbbr, error);
      if (generation !== null && generation !== this._loadGeneration) return;
      const activeTab = this.tabs.find(t => t.id === this.activeTabId);
      if (activeTab?.moduleAbbr === moduleAbbr) {
        this.entries = [];
      }
    } finally {
      // Unconditional, and keyed by module rather than by "am I the active
      // tab": a request may only retire the claim it made, but it must always
      // retire it — success, failure, or superseded — or the spinner it raised
      // outlives it.
      this._releaseChapterLoad(moduleAbbr, book, chapter);
      this._endLoad(moduleAbbr);
      this.notify();
    }
  }

  // Pin/unpin functionality (per-tab)

  /** Toggle pin for the active tab */
  togglePin(studyVerse?: number | null): void {
    if (this.pinned) {
      this.unpinTab(this.activeTabId);
    } else {
      this.pinTab(this.activeTabId, studyVerse);
    }
  }

  /**
   * Pin a specific tab to the current passage.
   *
   * The Overview (Home) tab pins like any other. Excluding it here makes its
   * pin button a no-op — it renders, highlights on hover, and does nothing,
   * while the same button on every other tab works.
   */
  pinTab(tabId: string, studyVerse?: number | null): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    tab.pinned = true;
    tab.pinnedBook = this.syncedBook;
    tab.pinnedChapter = this.syncedChapter;
    tab.pinnedVerse = studyVerse ?? null;
    this.saveSession();
    this.notify();
  }

  /** Unpin a specific tab and reload its entries for the current Bible chapter */
  unpinTab(tabId: string): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    tab.pinned = false;
    tab.pinnedBook = null;
    tab.pinnedChapter = null;
    tab.pinnedVerse = null;
    // Reload this tab's entries for the current Bible chapter. The pinned
    // chapter's entries stay on screen until the new ones land — they are real
    // content, just for the wrong passage, which reads better than a spinner.
    if (this.syncedBook && this.syncedChapter && this.provider) {
      void this._backgroundLoadTab(tab.moduleAbbr, this.syncedBook, this.syncedChapter, this._loadGeneration);
    }
    this.saveSession();
    this.notify();
  }

  /** Legacy alias — unpin the active tab */
  unpin(): void {
    this.unpinTab(this.activeTabId);
  }

  /** Check if any tab is pinned */
  get hasAnyPinnedTab(): boolean {
    return this.tabs.some(t => t.pinned);
  }

  setRightPaneMode(mode: string): void {
    this.rightPaneMode = mode;
    this.saveSession();
    this.notify();
  }

  /** Switch to Topics pane and navigate to a specific topic */
  navigateToTopic(topicId: number, module: string, topicName: string, sourceName?: string): void {
    this.pendingTopicNav = { topicId, module, topicName, sourceName, token: ++this._topicNavToken };
    this.rightPaneMode = 'topics';
    this.notify();
  }

  /**
   * Clear the pending request and return it.
   *
   * Call this from an *effect* once the request has actually been acted on —
   * never from a render body, where a discarded or repeated render throws the
   * request away before anything opens it.
   */
  consumePendingTopicNav(): PendingTopicNav | null {
    const nav = this.pendingTopicNav;
    if (nav) {
      this.pendingTopicNav = null;
      this.notify();
    }
    return nav;
  }

  addTab(moduleAbbr: string, moduleName?: string, verseId?: number): void {
    // Don't allow duplicate tabs for the same module
    const existing = this.tabs.find(t => t.moduleAbbr === moduleAbbr);
    if (existing) {
      this.activeTabId = existing.id;
      this._ensureTabContent(existing, verseId);
      this.saveSession();
      this.notify();
      return;
    }

    const id = `ctab-${++tabCounter}-${Date.now()}`;
    const tab: CommentaryTab = { id, moduleAbbr, moduleName: resolveTabName(moduleAbbr, moduleName) };
    this.tabs.push(tab);
    this.activeTabId = id;

    // Load entries for the new tab. The session is saved once, here: the tab
    // list and the active id are already final, and nothing the fetch returns
    // is persisted.
    this._ensureTabContent(tab, verseId);
    this.saveSession();
    this.notify();
  }

  reorderTabs(fromId: string, toId: string): void {
    const fromIdx = this.tabs.findIndex(t => t.id === fromId);
    const toIdx = this.tabs.findIndex(t => t.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;
    // Don't allow moving before the home tab
    if (toIdx === 0 && this.tabs[0]?.id === HOME_TAB_ID) return;
    const [moved] = this.tabs.splice(fromIdx, 1);
    this.tabs.splice(toIdx, 0, moved);
    this.saveSession();
    this.notify();
  }

  removeTab(tabId: string): void {
    // Can't remove the home tab
    if (tabId === HOME_TAB_ID) return;
    const idx = this.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    const removedTab = this.tabs[idx];
    this.tabs.splice(idx, 1);
    this.entriesByTab.delete(removedTab.moduleAbbr);

    if (this.activeTabId === tabId) {
      // If closing a temporary tab, go back to Home
      if (removedTab.temporary) {
        this.activeTabId = HOME_TAB_ID;
        this.entries = [];
      } else if (this.tabs.length > 0) {
        this.activeTabId = this.tabs[Math.min(idx, this.tabs.length - 1)].id;
        // Use cached entries for the new active tab, or fetch just that tab.
        // This used to fake a chapter change (null the synced passage, re-run
        // _loadChapter) to force a reload, which threw away every other tab's
        // cache to fill one.
        const newActiveTab = this.tabs.find(t => t.id === this.activeTabId);
        if (newActiveTab) this._ensureTabContent(newActiveTab);
      } else {
        this.activeTabId = '';
        this.entries = [];
      }
    }

    this.saveSession();
    this.notify();
  }

  setActiveTab(tabId: string): void {
    if (this.activeTabId === tabId) return;
    this.activeTabId = tabId;

    // Home tab manages its own data separately
    if (tabId === HOME_TAB_ID) {
      this.saveSession();
      this.notify();
      return;
    }

    // Use cached entries if available, otherwise fetch — including when some
    // other module's load is still running, which is the case the old early
    // return abandoned. `_ensureTabContent` carries the reasoning.
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) this._ensureTabContent(tab);

    this.saveSession();
    this.notify();
  }

  toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
    this.saveSession();
    this.notify();
  }

  collapse(): void {
    if (!this.collapsed) {
      this.collapsed = true;
      this.saveSession();
      this.notify();
    }
  }

  expand(): void {
    if (this.collapsed) {
      this.collapsed = false;
      this.saveSession();
      this.notify();
    }
  }

  private saveSession(): void {
    try {
      const saveTabs = this.tabs.filter(t => t.id !== HOME_TAB_ID && !t.temporary);
      localStorage.setItem('bible-reader-commentary', JSON.stringify({
        tabs: saveTabs.map(t => ({
          moduleAbbr: t.moduleAbbr,
          moduleName: t.moduleName,
          pinned: t.pinned ?? false,
          pinnedBook: t.pinnedBook ?? null,
          pinnedChapter: t.pinnedChapter ?? null,
          pinnedVerse: t.pinnedVerse ?? null,
        })),
        activeTabId: this.activeTabId,
        collapsed: this.collapsed,
        mutedModules: [...this.mutedModules],
        promotedModules: [...this.promotedModules],
        rightPaneMode: this.rightPaneMode,
      }));
    } catch { /* ignore */ }
  }

  private restoreSession(): void {
    try {
      const data = localStorage.getItem('bible-reader-commentary');
      if (!data) return;

      const parsed = JSON.parse(data);
      this.collapsed = parsed.collapsed ?? false;
      this.mutedModules = new Set(parsed.mutedModules ?? []);
      this.promotedModules = new Set(parsed.promotedModules ?? []);
      if (parsed.rightPaneMode && RESTORABLE_PANE_MODES.has(parsed.rightPaneMode)) {
        this.rightPaneMode = parsed.rightPaneMode;
      }

      // Migration: old global pin state (apply to first non-home tab if present)
      const legacyPinned = parsed.pinned ?? false;
      const legacyPinnedBook = parsed.pinnedBook ?? null;
      const legacyPinnedChapter = parsed.pinnedChapter ?? null;
      const legacyPinnedVerse = parsed.pinnedVerse ?? null;
      let legacyApplied = false;

      if (parsed.tabs?.length > 0) {
        for (const t of parsed.tabs) {
          if (t.moduleAbbr === '__home__') continue; // Skip home tab from old sessions
          const id = `ctab-${++tabCounter}-${Date.now()}`;
          const tab: CommentaryTab = {
            id,
            moduleAbbr: t.moduleAbbr,
            moduleName: resolveTabName(t.moduleAbbr, t.moduleName),
            pinned: t.pinned ?? false,
            pinnedBook: t.pinnedBook ?? null,
            pinnedChapter: t.pinnedChapter ?? null,
            pinnedVerse: t.pinnedVerse ?? null,
          };
          // Migrate old global pin to the first tab if per-tab pin data is absent
          if (legacyPinned && !legacyApplied && !t.pinned) {
            tab.pinned = true;
            tab.pinnedBook = legacyPinnedBook;
            tab.pinnedChapter = legacyPinnedChapter;
            tab.pinnedVerse = legacyPinnedVerse;
            legacyApplied = true;
          }
          this.tabs.push(tab);
        }
        // Restore active tab by ID or index
        if (parsed.activeTabId) {
          if (parsed.activeTabId === HOME_TAB_ID || this.tabs.find(t => t.id === parsed.activeTabId)) {
            this.activeTabId = parsed.activeTabId;
          }
        } else if (parsed.activeTabIndex != null) {
          const activeIdx = parsed.activeTabIndex ?? 0;
          this.activeTabId = this.tabs[Math.min(activeIdx, this.tabs.length - 1)]?.id ?? '';
        }
      }
    } catch { /* ignore */ }
  }
}

export const commentaryStore = new CommentaryStore();
