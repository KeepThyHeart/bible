// TODO: Just question.  Do any of these stores contain significant logic that ought to be reusable in the core package?  Something that the desktop could reuse (but only if I want to do that)?  But in a way that wouldn't lock the desktop into a certain UI _per se_, so that I wouldn't have to update the underlying core store but could expand upon it?
import { Store } from './Store';
import { eventBus } from '../events/eventBus';
import type { IBibleDataProvider, VotdData } from '../providers/interfaces';
import type { VerseData, BookTopicsData } from '../types';
import { formatPassageRef } from '../constants';
import { triggerAutoDownload } from '../offline/autoDownloadManager';

export type DisplayMode = 'standard' | 'reading' | 'study';

export interface BibleTab {
  id: string;
  moduleAbbr: string;
  moduleName: string;
  book: number | null;
  chapter: number | null;
  /** The verse the study tools are focused on (drives study/commentary panes) */
  studyVerse: number | null;
  /** A verse the user is previewing (from a link, search result, or cross-ref click).
   *  Does NOT update study panes — only provides a visual indicator. */
  previewVerse: number | null;
  /** End of preview range (when a cross-ref targets multiple verses) */
  previewVerseEnd: number | null;
  /** Far end of a shift-click passage selection. `studyVerse` stays the anchor
   *  and remains the one "real" selection that drives the study panes; this
   *  only widens what a copy will pick up, and is drawn more faintly to say so.
   *  May sit either side of the anchor — shift-clicking upwards is allowed. */
  selectionEndVerse: number | null;
  verses: VerseData[];
  loading: boolean;
  scrollPosition: number;
  /** Set during navigation to trigger auto-scroll, cleared after scroll completes */
  pendingScrollVerse: number | null;
  /** Set during history navigation to restore exact scroll position */
  pendingScrollTop: number | null;
  hasInterlinearData: boolean;
  displayMode: DisplayMode;
  /** Book numbers with content in this module. Set when a chapter has no verses. */
  coveredBooks?: number[];
  /** Per-tab navigation history */
  history: HistoryEntry[];
  historyIndex: number;
  /** Show "back to ..." bar after navigating via a verse link */
  showBackBar: boolean;
  /** Error message when chapter load fails (network/auth issue) */
  loadError?: string;
  /**
   * Which translation the verses currently in `verses` were actually fetched
   * from.
   *
   * Normally the same as `moduleAbbr`, and only ever differs while a load is
   * in flight. It exists because `moduleAbbr` is updated *before* the fetch —
   * the selector has to respond to the click immediately — so it alone cannot
   * answer "is the text on screen this translation's?".
   */
  versesModule?: string;
  /**
   * Monotonic counter identifying the newest load started for this tab.
   *
   * Every chapter fetch takes a copy before awaiting and re-checks it after,
   * so a slow response can no longer land on top of a newer one. Without this
   * the tab is a shared mutable object and the *last promise to resolve* wins
   * regardless of which was asked for last — and the two are routinely
   * different, because a downloaded module answers from OPFS in about a
   * millisecond while one that is not answers from the server in about a
   * hundred. That is the "selector says KJV, text is WEBBE" bug.
   *
   * Optional so that a tab built from a stored session — or from a test
   * fixture — need not carry one; `beginLoad` treats an absent counter as 0.
   */
  loadSeq?: number;
}

export interface HistoryEntry {
  moduleAbbr: string;
  book: number;
  chapter: number;
  verse?: number;
  scrollTop?: number;
  /** Set when this entry was created by navigateToPreview (clicking a study-pane link) */
  fromPreview?: boolean;
}

/**
 * Cap on the in-memory history list.
 *
 * Matched to what `saveSession` persists (`history.slice(-50)`): keeping more
 * in memory than survives a reload would only produce entries that vanish on
 * the next refresh. The desktop app caps at 10; the web menu is the only way
 * back to a passage here (there is no forward button), so it keeps more.
 */
export const MAX_HISTORY_ENTRIES = 50;

/** The pieces of a tab `addHistoryEntry` operates on. */
export interface HistorySlot {
  history: HistoryEntry[];
  historyIndex: number;
}

function isSamePassage(a: HistoryEntry, b: HistoryEntry): boolean {
  return a.moduleAbbr === b.moduleAbbr && a.book === b.book && a.chapter === b.chapter;
}

/**
 * Record a visit, returning a new slot (pure — no store access).
 *
 * Entries are per *passage*, not per click. Re-visiting a chapter **moves** its
 * existing entry to the end carrying the newest verse, rather than adding a
 * second row: John 7 → John 3 → John 7 has to read as two passages, or the
 * "Recent Passages" menu degenerates into a click log with the same chapter
 * listed over and over. This is the desktop app's rule (see
 * the desktop app's `src/ui/stores/bible/internals/navigationHistory.ts`),
 * keyed here on (module, book, chapter) because a web tab can change
 * translation without changing passage.
 *
 * `replace` drops the entry the cursor is standing on before recording the new
 * one, so a sequential step (next/previous chapter, or a chain of preview
 * links) modifies where the reader is instead of leaving a breadcrumb for every
 * chapter they paged through.
 */
export function addHistoryEntry(
  slot: HistorySlot,
  entry: HistoryEntry,
  options?: { replace?: boolean },
): HistorySlot {
  // Anything ahead of the cursor is a branch the reader stepped off of.
  const entries = slot.history.slice(0, slot.historyIndex + 1);

  // The entry being replaced is being *moved*, not kept.
  if (options?.replace && entries.length > 0) entries.pop();

  const deduped = entries.filter(h => !isSamePassage(h, entry));
  deduped.push(entry);

  const capped = deduped.slice(-MAX_HISTORY_ENTRIES);
  return { history: capped, historyIndex: capped.length - 1 };
}

const SESSION_KEY = 'bible-reader-session';
const STUDY_SETTINGS_KEY = 'bible-reader-study-settings';

let tabCounter = 0;

function newTabId(): string {
  return `tab-${++tabCounter}-${Date.now()}`;
}

class BibleStore extends Store {
  private bible: IBibleDataProvider | null = null;
  /** Cached verse-of-the-day request; see getVerseOfTheDay(). */
  private votdPromise: Promise<VotdData | null> | null = null;
  tabs: BibleTab[] = [];
  activeTabId = '';
  showBookPicker = false;
  /** Whether the Home screen is active (shows verse of the day) */
  showHome = true;
  /** Callback registered by BiblePane to read current scroll position */
  getScrollTop: (() => number) | null = null;
  /** Study mode toggle settings */
  studyShowInterlinear = true;
  studyShowNotes = true;

  /** Deferred loading indicator — only shows spinner if fetch takes > 80ms.
   *  Returns a cancel function to call when the fetch completes. */
  private deferLoading(tab: BibleTab): () => void {
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timer = null;
      tab.loading = true;
      this.notify();
    }, 80);
    return () => { if (timer) { clearTimeout(timer); timer = null; } };
  }

  /**
   * Claim this tab's newest load, returning a token to check once the fetch
   * resolves. See {@link BibleTab.loadSeq}.
   */
  private beginLoad(tab: BibleTab): number {
    tab.loadSeq = (tab.loadSeq ?? 0) + 1;
    return tab.loadSeq;
  }

  /** True when `seq` is no longer this tab's newest load, and must be dropped. */
  private isSupersededLoad(tab: BibleTab, seq: number): boolean {
    return tab.loadSeq !== seq;
  }

  init(bible: IBibleDataProvider): void {
    this.bible = bible;
    this.restoreSession();
    this.restoreStudySettings();
    if (this.tabs.length === 0) {
      this.addTab('KJV');
    }
  }

  /**
   * The verse of the day changes once a day and two components ask for it
   * (HomeScreen and BibleContent's VerseOfTheDay), so fetch it at most once per
   * session. Remounting the home screen then resolves from the cached promise
   * instead of flashing its skeleton again.
   */
  getVerseOfTheDay(): Promise<VotdData | null> {
    if (!this.bible) return Promise.resolve(null);
    if (!this.votdPromise) {
      this.votdPromise = this.bible.getVerseOfTheDay().catch((err: unknown) => {
        this.votdPromise = null; // allow a retry after a failure
        throw err;
      });
    }
    return this.votdPromise;
  }

  async getBookTopics(book: number): Promise<BookTopicsData> {
    if (!this.bible) return { topics: [] };
    return this.bible.getBookTopics(book);
  }

  getActiveTab(): BibleTab | undefined {
    return this.tabs.find(t => t.id === this.activeTabId);
  }

  openBookPicker(): void {
    this.showBookPicker = true;
    this.notify();
  }

  closeBookPicker(): void {
    this.showBookPicker = false;
    this.notify();
  }

  setShowHome(show: boolean): void {
    this.showHome = show;
    this.notify();
  }

  /** Fetch a chapter's verses without changing the active tab */
  async fetchChapter(module: string, book: number, chapter: number): Promise<VerseData[]> {
    if (!this.bible) return [];
    const data = await this.bible.getChapter(module, book, chapter);
    return data.verses;
  }

  /**
   * Fetch a single verse without changing the active tab.
   *
   * The Study pane needs the selected verse's own `text_html` to render an
   * interlinear against — the English word space the original-language rows
   * index into — and the Bible pane only holds that while it happens to be on
   * the same chapter. Goes through the same offline-first provider as
   * everything else, so a downloaded module answers locally.
   */
  async fetchVerse(module: string, verseId: number): Promise<VerseData | null> {
    if (!this.bible) return null;
    return this.bible.getVerse(module, verseId);
  }

  /**
   * Open a passage in the active tab.
   *
   * `replace` marks the move as a *sequential step* — next/previous chapter,
   * a swipe — which modifies the current history entry instead of appending
   * one. Only a true jump (a typed reference, a search result, a cross-ref, a
   * history pick, the book/chapter picker) leaves a new breadcrumb. It is an
   * explicit flag rather than an adjacency test on purpose: "John 4 after
   * John 3" is a page for the chapter buttons and a jump when it was typed.
   */
  async navigateTo(book: number, chapter: number, verse?: number, options?: { fromLink?: boolean; endVerse?: number; replace?: boolean }): Promise<void> {
    const tab = this.getActiveTab();
    if (!tab || !this.bible) return;

    // Track whether we need to dismiss home screen after data loads
    const wasShowingHome = this.showHome;

    // Before navigating away, update the current history entry with the
    // highlighted verse and scroll position so goBack() can restore them.
    if (options?.fromLink && tab.historyIndex >= 0 && tab.historyIndex < tab.history.length) {
      const current = tab.history[tab.historyIndex];
      if (tab.studyVerse) {
        const v = tab.studyVerse % 1000;
        if (v > 0) current.verse = v;
      }
      if (this.getScrollTop) {
        current.scrollTop = this.getScrollTop();
      }
    }

    tab.loadError = undefined;
    // Update book/chapter immediately so the header title renders without flicker
    tab.book = book;
    tab.chapter = chapter;
    const cancelLoadingFn = this.deferLoading(tab);
    const seq = this.beginLoad(tab);
    const requestedModule = tab.moduleAbbr;
    // When navigating from home screen, don't notify yet — wait for verses to
    // load so the home→bible transition is seamless (no blank content flash).
    if (!wasShowingHome) {
      this.notify();
    }

    try {
      const data = await this.bible.getChapter(requestedModule, book, chapter);
      if (this.isSupersededLoad(tab, seq)) return;
      cancelLoadingFn();
      tab.versesModule = requestedModule;
      tab.verses = data.verses;
      tab.hasInterlinearData = data.hasInterlinearData;
      tab.coveredBooks = data.coveredBooks;
      tab.previewVerse = null;
      tab.previewVerseEnd = null;
      // A passage selection is anchored to verses in the chapter being left.
      tab.selectionEndVerse = null;
      if (verse) {
        // Calculate full verseId — select the specific verse
        const verseId = (book * 1000000) + (chapter * 1000) + verse;
        tab.studyVerse = verseId;
        tab.pendingScrollVerse = verseId;
        // A typed range ("John 3:16-18") lands as the same anchor + far-end
        // pair a click-then-shift-click produces, so the range highlight and
        // the copy dialog pick it up with no further wiring.
        if (options?.endVerse && options.endVerse > verse) {
          tab.selectionEndVerse = (book * 1000000) + (chapter * 1000) + options.endVerse;
        }
      } else {
        // No specific verse asked for: select the chapter's first verse so the
        // study and commentary panes have something to bind to immediately.
        //
        // This used to be left null and back-filled by an effect in
        // CommentaryContent that measures the DOM for the first visible verse.
        // That effect runs before the Bible pane has mounted its verses on a
        // fresh chapter load or a cold start, so it found nothing, and its deps
        // did not change again — leaving the pane stuck on "select a verse"
        // until the user clicked one. The verse data is right here, so there is
        // no reason to go to the DOM for it.
        tab.studyVerse = tab.verses[0]?.verse_id ?? null;
        // Chapter navigation with no named verse still selects one (the first),
        // and the reader should land on it. Leaving this null meant a prev/next
        // chapter step kept the previous chapter's scroll offset, so the
        // selected verse was scrolled to only when the caller happened to name
        // one — the inconsistency this fixes.
        tab.pendingScrollVerse = tab.studyVerse;
      }
      tab.loading = false;
      tab.scrollPosition = 0;
      tab.showBackBar = !!(options?.fromLink && this.canGoBack());

      // Sync commentary to this chapter (explicit, not auto-synced)
      eventBus.emit('commentary:load-chapter', { book, chapter });

      // Dismiss home screen now that verse data is ready (no blank flash)
      if (wasShowingHome) {
        this.showHome = false;
      }

      // Push to history
      this.pushHistory({ moduleAbbr: tab.moduleAbbr, book, chapter, verse }, { replace: options?.replace });
      this.updateHash();
      this.saveSession();
      this.notify();

      // Auto-download this translation for offline use (fire-and-forget)
      triggerAutoDownload(tab.moduleAbbr, tab.moduleName);
    } catch (error) {
      cancelLoadingFn();
      console.error('Navigation failed:', error);
      tab.loading = false;
      tab.loadError = 'Failed to load chapter. Please check your connection and try again.';
      if (wasShowingHome) {
        this.showHome = false;
      }
      this.notify();
    }
  }

  /** Navigate to a verse as a preview (from study pane links, search results).
   *  Sets previewVerse instead of studyVerse — no panes auto-sync or pin. */
  async navigateToPreview(book: number, chapter: number, verse?: number, endVerseId?: number): Promise<void> {
    const tab = this.getActiveTab();
    if (!tab || !this.bible) return;

    const verseId = verse ? (book * 1000000) + (chapter * 1000) + verse : null;

    // Same chapter — just set previewVerse and scroll
    if (tab.book === book && tab.chapter === chapter) {
      tab.previewVerse = verseId;
      tab.previewVerseEnd = endVerseId ?? null;
      if (verseId) tab.pendingScrollVerse = verseId;
      this.notify();
      return;
    }

    // Different chapter — full navigation but set previewVerse, not studyVerse
    // Save current position for back navigation
    if (tab.historyIndex >= 0 && tab.historyIndex < tab.history.length) {
      const current = tab.history[tab.historyIndex];
      if (tab.studyVerse) {
        const v = tab.studyVerse % 1000;
        if (v > 0) current.verse = v;
      }
      if (this.getScrollTop) {
        current.scrollTop = this.getScrollTop();
      }
    }

    tab.loadError = undefined;
    tab.book = book;
    tab.chapter = chapter;
    tab.previewVerse = verseId;
    tab.previewVerseEnd = endVerseId ?? null;
    const cancelLoading = this.deferLoading(tab);
    const seq = this.beginLoad(tab);
    const requestedModule = tab.moduleAbbr;
    this.notify();

    try {
      const data = await this.bible.getChapter(requestedModule, book, chapter);
      if (this.isSupersededLoad(tab, seq)) return;
      cancelLoading();
      tab.versesModule = requestedModule;
      tab.verses = data.verses;
      tab.hasInterlinearData = data.hasInterlinearData;
      tab.coveredBooks = data.coveredBooks;
      tab.previewVerse = verseId;
      tab.previewVerseEnd = endVerseId ?? null;
      // Keep studyVerse as-is (it won't be visible in the new chapter,
      // but preserves which verse the study panes are pinned to)
      if (verseId) {
        tab.pendingScrollVerse = verseId;
      }
      tab.loading = false;
      tab.scrollPosition = 0;
      tab.showBackBar = this.canGoBack();

      this.pushHistory({ moduleAbbr: tab.moduleAbbr, book, chapter, verse, fromPreview: true });
      this.updateHash();
      this.saveSession();
      this.notify();
    } catch (error) {
      cancelLoading();
      console.error('Preview navigation failed:', error);
      tab.loading = false;
      tab.loadError = 'Failed to load chapter. Please check your connection and try again.';
      this.notify();
    }
  }

  /** Set the study verse (clicking in Bible text). Clears preview, toggles selection. */
  setStudyVerse(verseId: number): void {
    const tab = this.getActiveTab();
    if (!tab) return;
    // Clicking in the Bible text clears preview selection
    tab.previewVerse = null;
    tab.previewVerseEnd = null;
    // A plain click starts a fresh selection, so any shift-click extension goes.
    tab.selectionEndVerse = null;
    // Toggle: clicking the already-selected study verse deselects it
    if (tab.studyVerse === verseId) {
      tab.studyVerse = null;
    } else {
      tab.studyVerse = verseId;
    }
    // The history entry for this chapter should name the last verse actually
    // visited in it, not the one the chapter was opened at.
    this.rememberVerseInCurrentEntry(tab);
    this.notify();
  }

  /**
   * Extend the selection from the study verse out to `verseId` (shift-click).
   *
   * With no anchor yet there is nothing to extend from, so this behaves as a
   * plain click and sets the anchor — the same thing a shift-click does in a
   * list with no prior selection. Shift-clicking the anchor itself collapses
   * back to the single verse.
   */
  extendSelectionTo(verseId: number): void {
    const tab = this.getActiveTab();
    if (!tab) return;
    if (tab.studyVerse === null) {
      this.setStudyVerse(verseId);
      return;
    }
    tab.previewVerse = null;
    tab.previewVerseEnd = null;
    tab.selectionEndVerse = tab.studyVerse === verseId ? null : verseId;
    this.notify();
  }

  /**
   * The selected passage as an inclusive [start, end] pair, ordered low to
   * high regardless of which direction the user shift-clicked. Null when
   * nothing is selected.
   */
  getSelectedRange(): { start: number; end: number } | null {
    const tab = this.getActiveTab();
    if (!tab?.studyVerse) return null;
    const other = tab.selectionEndVerse ?? tab.studyVerse;
    return {
      start: Math.min(tab.studyVerse, other),
      end: Math.max(tab.studyVerse, other),
    };
  }

  /**
   * Guarantee the active tab has a study verse, selecting the first verse of
   * the loaded chapter if it has none.
   *
   * For entry points that show a chapter without going through `navigateTo` —
   * notably a cold start that renders verses cached in the session, where the
   * restored tab carries `studyVerse: null`. Without this the commentary and
   * study panes open on "select a verse" even though a chapter is on screen.
   *
   * No-op when a verse is already selected, so it cannot disturb a restored or
   * user-chosen selection.
   */
  ensureStudyVerse(): void {
    const tab = this.getActiveTab();
    if (!tab || tab.studyVerse !== null || tab.verses.length === 0) return;
    tab.studyVerse = tab.verses[0].verse_id;
    this.notify();
  }

  /** Promote the preview verse to the study focus (no toggle). Used by "Sync" banner buttons. */
  adoptPreviewAsStudy(verseId: number): void {
    const tab = this.getActiveTab();
    if (!tab) return;
    tab.previewVerse = null;
    tab.previewVerseEnd = null;
    tab.studyVerse = verseId;
    this.notify();
  }

  /** Set pendingScrollVerse to scroll the Bible pane to a specific verse */
  scrollToVerse(verseId: number): void {
    const tab = this.getActiveTab();
    if (!tab) return;
    tab.pendingScrollVerse = verseId;
    this.notify();
  }

  /**
   * Clear the pending-scroll token once the Bible pane has acted on it — or
   * has established that it can never be satisfied (the verse is not in the
   * loaded chapter).
   *
   * `verseId` is the token the caller believes it is spending; a token that has
   * since been replaced (a second navigation while a scroll was deferred) is
   * left alone. Notifies for the same reason `scrollToVerse` does: setting and
   * clearing the token must look the same to subscribers.
   */
  clearPendingScrollVerse(verseId: number): void {
    const tab = this.getActiveTab();
    if (!tab || tab.pendingScrollVerse !== verseId) return;
    tab.pendingScrollVerse = null;
    this.notify();
  }

  clearVerseState(): void {
    const tab = this.getActiveTab();
    if (!tab) return;
    tab.studyVerse = null;
    tab.previewVerse = null;
    tab.previewVerseEnd = null;
    this.notify();
  }

  /** Find the verse most visible (>50%) in the Bible pane. Falls back to the
   *  first verse of the active tab's chapter when the Bible pane DOM isn't
   *  available (e.g. not yet mounted, or verses still loading). */
  getFirstVisibleVerseId(): number | null {
    const fallbackToActiveTab = (): number | null => {
      const tab = this.getActiveTab();
      if (!tab || !tab.book || !tab.chapter) return null;
      return (tab.book * 1000000) + (tab.chapter * 1000) + 1;
    };

    const container = document.querySelector('.bible-pane__scroll-container');
    if (!container) return fallbackToActiveTab();

    // On mobile, the real scroll parent may be .mobile-scroll-wrapper
    let scrollParent: Element = container;
    if (container.scrollHeight <= container.clientHeight) {
      const wrapper = container.closest('.mobile-scroll-wrapper');
      if (wrapper) scrollParent = wrapper;
    }

    const verseEls = container.querySelectorAll('[data-verse-id]');
    if (verseEls.length === 0) return fallbackToActiveTab();

    const parentRect = scrollParent.getBoundingClientRect();
    const viewTop = parentRect.top;
    const viewBottom = parentRect.bottom;

    // Find the verse with the largest visible fraction (>50% wins outright;
    // otherwise fall back to whichever verse has the most visible area).
    let bestId: string | null = null;
    let bestFraction = 0;
    let bestArea = 0;
    for (const el of verseEls) {
      const rect = el.getBoundingClientRect();
      const visibleTop = Math.max(rect.top, viewTop);
      const visibleBottom = Math.min(rect.bottom, viewBottom);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);
      if (visibleHeight === 0) continue;
      const fraction = rect.height > 0 ? visibleHeight / rect.height : 0;
      if (fraction > bestFraction || (fraction === bestFraction && visibleHeight > bestArea)) {
        bestFraction = fraction;
        bestArea = visibleHeight;
        bestId = el.getAttribute('data-verse-id');
      }
    }

    if (bestId) return parseInt(bestId, 10);
    return fallbackToActiveTab();
  }

  dismissBackBar(): void {
    const tab = this.getActiveTab();
    if (!tab || !tab.showBackBar) return;
    tab.showBackBar = false;
    this.notify();
  }

  /** Get the label for the previous history entry (for the back bar) */
  getBackLabel(): string | null {
    const tab = this.getActiveTab();
    if (!tab || tab.historyIndex <= 0) return null;
    const prev = tab.history[tab.historyIndex - 1];
    if (!prev) return null;
    return formatPassageRef(prev.book, prev.chapter, prev.verse);
  }

  addTab(moduleAbbr?: string): void {
    const activeTab = this.getActiveTab();
    const abbr = moduleAbbr ?? activeTab?.moduleAbbr ?? 'KJV';
    const tab: BibleTab = {
      id: newTabId(),
      moduleAbbr: abbr,
      moduleName: abbr,
      book: null,
      chapter: null,
      studyVerse: null,
      previewVerse: null,
      previewVerseEnd: null,
      selectionEndVerse: null,
      verses: [],
      loading: false,
      scrollPosition: 0,
      pendingScrollVerse: null,
      pendingScrollTop: null,
      hasInterlinearData: false,
      displayMode: activeTab?.displayMode ?? 'standard',
      history: [],
      historyIndex: -1,
      showBackBar: false,
      loadSeq: 0,
    };
    this.tabs.push(tab);
    this.activeTabId = tab.id;
    this.saveSession();
    this.notify();
  }

  async addTabWithPassage(moduleAbbr: string, book: number, chapter: number, verse?: number, endVerse?: number): Promise<void> {
    this.addTab(moduleAbbr);
    await this.navigateTo(book, chapter, verse, { endVerse });
  }

  reorderTabs(fromId: string, toId: string): void {
    const fromIdx = this.tabs.findIndex(t => t.id === fromId);
    const toIdx = this.tabs.findIndex(t => t.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = this.tabs.splice(fromIdx, 1);
    this.tabs.splice(toIdx, 0, moved);
    this.saveSession();
    this.notify();
  }

  removeTab(tabId: string): void {
    const idx = this.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    this.tabs.splice(idx, 1);

    if (this.tabs.length === 0) {
      this.addTab();
      return;
    }

    if (this.activeTabId === tabId) {
      this.activeTabId = this.tabs[Math.min(idx, this.tabs.length - 1)].id;
    }

    this.saveSession();
    this.notify();
  }

  setActiveTab(tabId: string): void {
    if (this.activeTabId === tabId) return;

    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    this.activeTabId = tabId;
    this.updateHash();
    this.saveSession();
    this.notify();
  }

  async setTabTranslation(tabId: string, moduleAbbr: string): Promise<void> {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || !this.bible) return;

    tab.moduleAbbr = moduleAbbr;
    tab.moduleName = moduleAbbr;

    // Reload current chapter in new translation
    if (tab.book && tab.chapter) {
      tab.loadError = undefined;
      const cancelLoading = this.deferLoading(tab);
      const seq = this.beginLoad(tab);
      this.notify();

      try {
        const data = await this.bible.getChapter(moduleAbbr, tab.book, tab.chapter);
        if (this.isSupersededLoad(tab, seq)) return;
        cancelLoading();
        tab.versesModule = moduleAbbr;
        tab.verses = data.verses;
        tab.hasInterlinearData = data.hasInterlinearData;
        tab.coveredBooks = data.coveredBooks;
        tab.loading = false;
      } catch {
        if (this.isSupersededLoad(tab, seq)) return;
        cancelLoading();
        tab.loading = false;
        // Drop the outgoing translation's text. Leaving it in place showed the
        // *previous* translation under the *new* name with no error at all,
        // because BibleContent only renders `loadError` when there are no
        // verses to render instead.
        tab.verses = [];
        tab.versesModule = undefined;
        tab.loadError = 'Failed to load chapter. Please check your connection and try again.';
      }
    }

    this.saveSession();
    this.notify();

    // Auto-download this translation for offline use (fire-and-forget)
    triggerAutoDownload(tab.moduleAbbr, tab.moduleName);
  }

  setDisplayMode(tabId: string, mode: DisplayMode): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    tab.displayMode = mode;
    this.saveSession();
    this.notify();
  }

  setStudyShowInterlinear(value: boolean): void {
    this.studyShowInterlinear = value;
    this.saveStudySettings();
    this.notify();
  }

  setStudyShowNotes(value: boolean): void {
    this.studyShowNotes = value;
    this.saveStudySettings();
    this.notify();
  }

  private saveStudySettings(): void {
    try {
      localStorage.setItem(STUDY_SETTINGS_KEY, JSON.stringify({
        showInterlinear: this.studyShowInterlinear,
        showNotes: this.studyShowNotes,
      }));
    } catch { /* ignore */ }
  }

  private restoreStudySettings(): void {
    try {
      const data = localStorage.getItem(STUDY_SETTINGS_KEY);
      if (!data) return;
      const parsed = JSON.parse(data);
      this.studyShowInterlinear = parsed.showInterlinear ?? true;
      this.studyShowNotes = parsed.showNotes ?? true;
    } catch { /* ignore */ }
  }

  // History (per-tab)
  private pushHistory(entry: HistoryEntry, options?: { replace?: boolean }): void {
    const tab = this.getActiveTab();
    if (!tab) return;

    const current = tab.historyIndex >= 0 && tab.historyIndex < tab.history.length
      ? tab.history[tab.historyIndex]
      : undefined;

    // Consecutive preview navigations replace the current entry so "Back to"
    // always points to the original study verse, not the last preview link.
    // That is the same shape as an explicit sequential step.
    const replace = options?.replace === true || !!(current?.fromPreview && entry.fromPreview);

    const next = addHistoryEntry({ history: tab.history, historyIndex: tab.historyIndex }, entry, { replace });
    tab.history = next.history;
    tab.historyIndex = next.historyIndex;
  }

  /**
   * Point the current history entry at the verse the reader is actually on.
   *
   * Called from plain verse clicks, which are movement *within* the passage the
   * entry already describes — so the entry is updated in place rather than a
   * new one pushed. Without this, "Recent Passages" always listed the verse the
   * chapter was entered at (usually :1) however far the reader had read.
   */
  private rememberVerseInCurrentEntry(tab: BibleTab): void {
    const current = tab.history[tab.historyIndex];
    if (!current || tab.studyVerse === null) return;
    const book = Math.floor(tab.studyVerse / 1000000);
    const chapter = Math.floor(tab.studyVerse / 1000) % 1000;
    // Only the entry describing this very passage; a click can never rewrite
    // some other chapter's remembered verse.
    if (current.book !== book || current.chapter !== chapter) return;
    current.verse = tab.studyVerse % 1000;
  }

  /**
   * The active tab's history, oldest first, plus the cursor into it.
   *
   * Entries are per *passage*, not per click: `addHistoryEntry` moves a
   * re-visited chapter's existing entry to the end instead of appending a
   * second one, and a verse click updates that entry in place. A chapter
   * therefore appears exactly once however many times it was visited, which is
   * what makes the list readable as "recently visited passages" rather than a
   * click log.
   */
  getHistory(): HistoryEntry[] {
    return this.getActiveTab()?.history ?? [];
  }

  getHistoryIndex(): number {
    return this.getActiveTab()?.historyIndex ?? -1;
  }

  /** Jump straight to a history entry by index (the history dropdown). */
  async goToHistoryEntry(index: number): Promise<void> {
    const tab = this.getActiveTab();
    if (!tab || index < 0 || index >= tab.history.length || index === tab.historyIndex) return;
    tab.showBackBar = false;
    tab.previewVerse = null;
    tab.previewVerseEnd = null;
    tab.selectionEndVerse = null;
    tab.historyIndex = index;
    const entry = tab.history[index];
    tab.moduleAbbr = entry.moduleAbbr;
    tab.moduleName = entry.moduleAbbr;
    await this._loadHistoryEntry(entry);
  }

  canGoBack(): boolean {
    const tab = this.getActiveTab();
    return !!tab && tab.historyIndex > 0;
  }

  async goBack(): Promise<void> {
    const tab = this.getActiveTab();
    if (!tab || !this.canGoBack()) return;
    tab.showBackBar = false;
    tab.previewVerse = null;
    tab.previewVerseEnd = null;
    tab.selectionEndVerse = null;
    tab.historyIndex--;
    const entry = tab.history[tab.historyIndex];
    tab.moduleAbbr = entry.moduleAbbr;
    tab.moduleName = entry.moduleAbbr;
    await this._loadHistoryEntry(entry);
  }

  // There is no goForward(): the toolbar has a Back button and a Recent
  // Passages menu, and anything ahead of the cursor is reachable from the menu
  // by name — which is more useful than an arrow whose destination is invisible.

  private async _loadHistoryEntry(entry: HistoryEntry): Promise<void> {
    const tab = this.getActiveTab();
    if (!tab || !this.bible) return;

    tab.loadError = undefined;
    // Update book/chapter immediately so the header title renders without flicker
    tab.book = entry.book;
    tab.chapter = entry.chapter;
    const cancelLoading = this.deferLoading(tab);
    const seq = this.beginLoad(tab);
    this.notify();

    try {
      const data = await this.bible.getChapter(entry.moduleAbbr, entry.book, entry.chapter);
      if (this.isSupersededLoad(tab, seq)) return;
      cancelLoading();
      tab.versesModule = entry.moduleAbbr;
      tab.verses = data.verses;
      tab.hasInterlinearData = data.hasInterlinearData;
      tab.coveredBooks = data.coveredBooks;
      if (entry.verse) {
        const verseId = (entry.book * 1000000) + (entry.chapter * 1000) + entry.verse;
        tab.studyVerse = verseId;
        // Prefer saved scroll position over scrolling to verse
        if (entry.scrollTop != null) {
          tab.pendingScrollVerse = null;
          tab.pendingScrollTop = entry.scrollTop;
        } else {
          tab.pendingScrollVerse = verseId;
          tab.pendingScrollTop = null;
        }
      } else {
        // Same invariant as navigateTo: a chapter always arrives with a verse
        // selected, or the study and commentary panes bind to nothing and sit
        // on their "select a verse" prompt.
        tab.studyVerse = tab.verses[0]?.verse_id ?? null;
        if (entry.scrollTop != null) {
          tab.pendingScrollVerse = null;
          tab.pendingScrollTop = entry.scrollTop;
        } else {
          tab.pendingScrollVerse = tab.studyVerse;
          tab.pendingScrollTop = null;
        }
      }
      tab.loading = false;

      // Sync commentary to the restored chapter
      eventBus.emit('commentary:load-chapter', { book: entry.book, chapter: entry.chapter });

      this.updateHash();
      this.saveSession();
      this.notify();

      // Auto-download this translation for offline use (fire-and-forget)
      triggerAutoDownload(entry.moduleAbbr, entry.moduleAbbr);
    } catch {
      cancelLoading();
      tab.loading = false;
      tab.loadError = 'Failed to load chapter. Please check your connection and try again.';
      this.notify();
    }
  }

  // URL hash
  updateHash(): void {
    const tab = this.getActiveTab();
    if (tab?.book && tab.chapter) {
      const hash = `#/${tab.moduleAbbr}/${tab.book}/${tab.chapter}`;
      if (window.location.hash !== hash) {
        history.replaceState(null, '', hash);
      }
    }
  }

  async navigateFromHash(hash: string): Promise<void> {
    const match = hash.match(/^#\/([^/]+)\/(\d+)\/(\d+)(?:\/(\d+))?$/);
    if (!match) return;

    const [, module, bookStr, chapterStr, verseStr] = match;
    const book = parseInt(bookStr, 10);
    const chapter = parseInt(chapterStr, 10);
    const verse = verseStr ? parseInt(verseStr, 10) : undefined;

    const tab = this.getActiveTab();
    if (tab && tab.moduleAbbr !== module) {
      tab.moduleAbbr = module;
      tab.moduleName = module;
    }

    await this.navigateTo(book, chapter, verse);
  }

  // Session persistence
  saveSession(): void {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        tabs: this.tabs.map(t => ({
          moduleAbbr: t.moduleAbbr,
          book: t.book,
          chapter: t.chapter,
          displayMode: t.displayMode,
          history: t.history.slice(-50),
          historyIndex: t.historyIndex,
          // Cache verses for active tab only (instant startup rendering)
          ...(t.id === this.activeTabId ? {
            verses: t.verses,
            // Stored beside the verses, not inferred from `moduleAbbr`: the two
            // can disagree mid-load, and the next cold start renders this
            // cached text without re-fetching it.
            versesModule: t.versesModule ?? t.moduleAbbr,
            hasInterlinearData: t.hasInterlinearData,
            coveredBooks: t.coveredBooks,
          } : {}),
        })),
        activeTabIndex: this.tabs.findIndex(t => t.id === this.activeTabId),
      }));
    } catch { /* ignore */ }
  }

  private restoreSession(): void {
    try {
      const data = localStorage.getItem(SESSION_KEY);
      if (!data) return;

      const parsed = JSON.parse(data);

      if (parsed.tabs?.length > 0) {
        for (const tabData of parsed.tabs) {
          // Per-tab history; fall back to old global history for migration
          const tabHistory = tabData.history ?? parsed.history ?? [];
          const tabHistoryIndex = tabData.history ? (tabData.historyIndex ?? -1) : (parsed.historyIndex ?? -1);
          const restoredModule = tabData.moduleAbbr || 'KJV';
          // Sessions written before `versesModule` existed have no record of
          // where their cached text came from; assume it matched, which is what
          // it did whenever no load was in flight at save time.
          const restoredVersesModule = tabData.versesModule ?? restoredModule;
          const tab: BibleTab = {
            id: newTabId(),
            moduleAbbr: restoredModule,
            moduleName: restoredModule,
            book: tabData.book,
            chapter: tabData.chapter,
            studyVerse: null,
            previewVerse: null,
            previewVerseEnd: null,
            selectionEndVerse: null,
            // Cached verses are only usable if they came from the translation
            // this tab is set to. A mismatch means the session was saved
            // mid-load; dropping the text makes `loadRestoredTabs` fetch it
            // again rather than rendering one translation under another's name.
            verses: restoredVersesModule === restoredModule ? (tabData.verses ?? []) : [],
            versesModule: restoredVersesModule === restoredModule ? restoredVersesModule : undefined,
            loading: false,
            scrollPosition: 0,
            pendingScrollVerse: null,
            pendingScrollTop: null,
            hasInterlinearData: tabData.hasInterlinearData ?? false,
            coveredBooks: tabData.coveredBooks,
            displayMode: tabData.displayMode ?? 'standard',
            history: tabHistory,
            historyIndex: tabHistoryIndex,
            showBackBar: false,
            loadSeq: 0,
          };
          this.tabs.push(tab);
        }
        const activeIdx = parsed.activeTabIndex ?? 0;
        this.activeTabId = this.tabs[Math.min(activeIdx, this.tabs.length - 1)]?.id ?? '';
      }
    } catch { /* ignore */ }
  }

  async loadRestoredTabs(): Promise<void> {
    // If any restored tab has a chapter, dismiss the home screen
    if (this.tabs.some(t => t.book && t.chapter)) {
      this.showHome = false;
    }
    // Load chapter data for all restored tabs that don't already have verses
    for (const tab of this.tabs) {
      if (tab.book && tab.chapter && tab.verses.length === 0 && this.bible) {
        const seq = this.beginLoad(tab);
        const requestedModule = tab.moduleAbbr;
        try {
          const data = await this.bible.getChapter(requestedModule, tab.book, tab.chapter);
          if (this.isSupersededLoad(tab, seq)) continue;
          tab.versesModule = requestedModule;
          tab.verses = data.verses;
          tab.hasInterlinearData = data.hasInterlinearData;
          tab.coveredBooks = data.coveredBooks;
          this.notify();
        } catch { /* ignore, tab will show empty */ }
      }
    }
    this.updateHash();
  }
}

export const bibleStore = new BibleStore();
