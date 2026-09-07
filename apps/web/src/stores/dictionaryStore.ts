import { Store } from './Store';
import type { NewlineHandling } from '@bible/core/browser';

export interface DictionaryModule {
  abbreviation: string;
  name: string;
  language_code: string;
}

interface DictionaryEntryData {
  entry_key: string;
  word: string;
  transliteration?: string;
  pronunciation?: string;
  part_of_speech?: string;
  definition?: string;
  etymology?: string;
  usage_notes?: string;
  semantic_range?: string;
  related_words?: string[];
  example_verses?: string[];
  /**
   * The module's declared `newline_handling` (module_info.metadata), forwarded
   * by `GET /api/dictionary/:module/entry/:key`. Absent when the module
   * declares none, which leaves the decision to the per-entry fallback in
   * `resolveNewlineHandling`.
   */
  newline_handling?: NewlineHandling;
}

/** Cross-dictionary search result (from Home search) */
interface HomeSuggestion {
  entry_key: string;
  word: string;
  transliteration?: string;
  definition?: string;
  part_of_speech?: string;
  module_abbr: string;
  module_name: string;
}

/** Per-tab search result (within one dictionary) */
interface TabSuggestion {
  entry_key: string;
  word: string;
  transliteration?: string;
  definition?: string;
  part_of_speech?: string;
}

interface BrowseLetterInfo {
  letter: string;
  count: number;
}

interface BrowseEntry {
  entry_key: string;
  word: string;
}

interface AdjacentEntry {
  entry_key: string;
  word: string;
}

export interface DictionaryTab {
  id: string;
  moduleAbbr: string;
  moduleName: string;
  temporary?: boolean;
}

export const DICT_HOME_TAB_ID = 'dtab-home';

interface TabSearchState {
  // Search state
  searchQuery: string;
  suggestions: TabSuggestion[];
  searchLoading: boolean;
  /** Set when the last search failed outright, so the UI can say so. */
  searchError: string | null;
  /** True once a search has returned, so zero results can be told from "not searched yet". */
  searchCompleted: boolean;
  // Current entry
  entry: DictionaryEntryData | null;
  entryLoading: boolean;
  // Browse state
  browseLetters: BrowseLetterInfo[] | null;
  browseLetter: string;
  browseEntries: BrowseEntry[];
  browseOffset: number;
  browseTotal: number;
  browseLoading: boolean;
  // Adjacent entries for prev/next
  adjacentPrev: AdjacentEntry | null;
  adjacentNext: AdjacentEntry | null;
}

let tabCounter = 0;

function emptyTabState(): TabSearchState {
  return {
    searchQuery: '', suggestions: [], searchLoading: false, searchError: null, searchCompleted: false,
    entry: null, entryLoading: false,
    browseLetters: null, browseLetter: '', browseEntries: [], browseOffset: 0, browseTotal: 0, browseLoading: false,
    adjacentPrev: null, adjacentNext: null,
  };
}

class DictionaryStore extends Store {
  private baseUrl = '';

  // Module list
  modules: DictionaryModule[] = [];
  modulesLoaded = false;

  // Tabs
  tabs: DictionaryTab[] = [];
  activeTabId = DICT_HOME_TAB_ID;

  // Starred (promoted) dictionaries
  starredModules: Set<string> = new Set();

  // Home tab search state (cross-dictionary)
  homeSearchQuery = '';
  homeSuggestions: HomeSuggestion[] = [];
  homeSearchLoading = false;

  // Per-tab state keyed by tab ID
  tabStates = new Map<string, TabSearchState>();

  // Timers
  private homeSearchTimer: any = null;
  private tabSearchTimers = new Map<string, any>();

  init(baseUrl: string): void {
    this.baseUrl = baseUrl;
    this.restoreSession();
    // Ensure home tab exists at index 0
    if (!this.tabs.find(t => t.id === DICT_HOME_TAB_ID)) {
      this.tabs.unshift({ id: DICT_HOME_TAB_ID, moduleAbbr: '__home__', moduleName: 'Home' });
    }
    if (!this.activeTabId || !this.tabs.find(t => t.id === this.activeTabId)) {
      this.activeTabId = DICT_HOME_TAB_ID;
    }
    this.loadModules();
  }

  async loadModules(): Promise<void> {
    if (this.modulesLoaded) return;
    try {
      const res = await fetch(`${this.baseUrl}/api/dictionary/available`);
      if (res.ok) {
        this.modules = await res.json();
        this.modulesLoaded = true;
        this.notify();
      }
    } catch { /* ignore */ }
  }

  // ========================================================================
  // Starring (favorites)
  // ========================================================================

  toggleStarred(moduleAbbr: string): void {
    if (this.starredModules.has(moduleAbbr)) {
      this.starredModules.delete(moduleAbbr);
    } else {
      this.starredModules.add(moduleAbbr);
    }
    this.saveSession();
    this.notify();
  }

  // ========================================================================
  // Tab lifecycle
  // ========================================================================

  setActiveTab(tabId: string): void {
    if (!this.tabs.find(t => t.id === tabId)) return;
    // Auto-close the current tab if it's temporary and we're navigating away
    if (this.activeTabId !== tabId) {
      const currentTab = this.tabs.find(t => t.id === this.activeTabId);
      if (currentTab?.temporary) {
        const idx = this.tabs.indexOf(currentTab);
        this.tabs.splice(idx, 1);
        this.tabStates.delete(currentTab.id);
        const timer = this.tabSearchTimers.get(currentTab.id);
        if (timer) { clearTimeout(timer); this.tabSearchTimers.delete(currentTab.id); }
      }
    }
    this.activeTabId = tabId;
    this.notify();
  }

  addTab(moduleAbbr: string, moduleName?: string): void {
    // Don't duplicate — switch to existing tab
    const existing = this.tabs.find(t => t.moduleAbbr === moduleAbbr && t.id !== DICT_HOME_TAB_ID);
    if (existing) {
      this.activeTabId = existing.id;
      this.saveSession();
      this.notify();
      return;
    }

    const id = `dtab-${++tabCounter}-${Date.now()}`;
    this.tabs.push({ id, moduleAbbr, moduleName: moduleName ?? moduleAbbr });
    this.tabStates.set(id, emptyTabState());
    this.activeTabId = id;
    // Auto-load browse letters for new tab
    this.loadBrowseLetters(id);
    this.saveSession();
    this.notify();
  }

  removeTab(tabId: string): void {
    if (tabId === DICT_HOME_TAB_ID) return;
    const idx = this.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    const removed = this.tabs[idx];
    this.tabs.splice(idx, 1);
    this.tabStates.delete(tabId);

    // Clear timer
    const timer = this.tabSearchTimers.get(tabId);
    if (timer) { clearTimeout(timer); this.tabSearchTimers.delete(tabId); }

    if (this.activeTabId === tabId) {
      if (removed.temporary) {
        this.activeTabId = DICT_HOME_TAB_ID;
      } else if (this.tabs.length > 0) {
        this.activeTabId = this.tabs[Math.min(idx, this.tabs.length - 1)].id;
      }
    }
    this.saveSession();
    this.notify();
  }

  /**
   * Open a temporary preview tab, replacing any existing temporary tab.
   *
   * `skipBrowse` suppresses the automatic browse-letter load. Callers about to
   * load one specific entry pass it so the alphabet bar and its 50-entry word
   * list do not paint for a frame before the definition arrives.
   */
  openTemporaryTab(moduleAbbr: string, moduleName: string, opts?: { skipBrowse?: boolean }): string {
    // If already has a permanent tab, just switch to it
    const existing = this.tabs.find(t => t.moduleAbbr === moduleAbbr && !t.temporary && t.id !== DICT_HOME_TAB_ID);
    if (existing) {
      this.activeTabId = existing.id;
      this.notify();
      return existing.id;
    }

    // Remove any existing temporary tab
    const tempTab = this.tabs.find(t => t.temporary);
    if (tempTab) {
      if (tempTab.moduleAbbr === moduleAbbr) {
        this.activeTabId = tempTab.id;
        this.notify();
        return tempTab.id;
      }
      const tempIdx = this.tabs.indexOf(tempTab);
      this.tabs.splice(tempIdx, 1);
      this.tabStates.delete(tempTab.id);
      const timer = this.tabSearchTimers.get(tempTab.id);
      if (timer) { clearTimeout(timer); this.tabSearchTimers.delete(tempTab.id); }
    }

    const id = `dtab-${++tabCounter}-${Date.now()}`;
    this.tabs.push({ id, moduleAbbr, moduleName, temporary: true });
    this.tabStates.set(id, emptyTabState());
    this.activeTabId = id;
    // Auto-load browse letters for new tab
    if (!opts?.skipBrowse) this.loadBrowseLetters(id);
    this.notify();
    return id;
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

  reorderTabs(fromId: string, toId: string): void {
    const fromIdx = this.tabs.findIndex(t => t.id === fromId);
    const toIdx = this.tabs.findIndex(t => t.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;
    if (toIdx === 0 && this.tabs[0]?.id === DICT_HOME_TAB_ID) return;
    const [moved] = this.tabs.splice(fromIdx, 1);
    this.tabs.splice(toIdx, 0, moved);
    this.saveSession();
    this.notify();
  }

  // ========================================================================
  // Home tab search (cross-dictionary)
  // ========================================================================

  setHomeSearchQuery(query: string): void {
    this.homeSearchQuery = query;
    this.notify();

    if (this.homeSearchTimer) clearTimeout(this.homeSearchTimer);
    if (!query.trim()) {
      this.homeSuggestions = [];
      this.homeSearchLoading = false;
      this.notify();
      return;
    }

    this.homeSearchLoading = true;
    this.notify();

    this.homeSearchTimer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${this.baseUrl}/api/dictionary/search?q=${encodeURIComponent(query.trim())}`
        );
        if (res.ok) {
          this.homeSuggestions = await res.json();
        }
      } catch {
        this.homeSuggestions = [];
      }
      this.homeSearchLoading = false;
      this.notify();
    }, 300);
  }

  /** Called when clicking a Home search result — opens temp tab and loads entry */
  async openDictionaryEntry(entryKey: string, moduleAbbr: string, moduleName: string): Promise<void> {
    const tabId = this.openTemporaryTab(moduleAbbr, moduleName);
    await this.loadEntryInTab(tabId, entryKey);
  }

  // ========================================================================
  // Per-tab search (within one dictionary) — dropdown overlay style
  // ========================================================================

  getTabState(tabId: string): TabSearchState {
    let state = this.tabStates.get(tabId);
    if (!state) {
      state = emptyTabState();
      this.tabStates.set(tabId, state);
    }
    return state;
  }

  setTabSearchQuery(tabId: string, query: string): void {
    const state = this.getTabState(tabId);
    state.searchQuery = query;
    // Do NOT clear state.entry — suggestions appear as an overlay on top of the entry
    this.notify();

    // Clear existing timer for this tab
    const existingTimer = this.tabSearchTimers.get(tabId);
    if (existingTimer) clearTimeout(existingTimer);

    if (!query.trim()) {
      state.suggestions = [];
      state.searchLoading = false;
      state.searchError = null;
      state.searchCompleted = false;
      this.notify();
      return;
    }

    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || tab.id === DICT_HOME_TAB_ID) return;

    state.searchLoading = true;
    state.searchError = null;
    this.notify();

    this.tabSearchTimers.set(tabId, setTimeout(async () => {
      try {
        const res = await fetch(
          `${this.baseUrl}/api/dictionary/${tab.moduleAbbr}/search?q=${encodeURIComponent(query.trim())}`
        );
        if (res.ok) {
          state.suggestions = await res.json();
          state.searchError = null;
        } else {
          // A failed request used to leave the previous suggestions on screen
          // and say nothing, which is indistinguishable from "no matches" —
          // the reason a search that errored looked like it did nothing.
          state.suggestions = [];
          state.searchError = `Search failed (${res.status}).`;
        }
      } catch {
        state.suggestions = [];
        state.searchError = 'Search failed. Check your connection and try again.';
      }
      state.searchLoading = false;
      state.searchCompleted = true;
      this.tabSearchTimers.delete(tabId);
      this.notify();
    }, 300));
  }

  /** Dismiss the search dropdown without loading an entry */
  clearTabSuggestions(tabId: string): void {
    const state = this.getTabState(tabId);
    state.suggestions = [];
    state.searchQuery = '';
    state.searchLoading = false;
    state.searchError = null;
    state.searchCompleted = false;
    this.notify();
  }

  async loadEntryInTab(tabId: string, entryKey: string): Promise<void> {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || tab.id === DICT_HOME_TAB_ID) return;

    const state = this.getTabState(tabId);
    state.entryLoading = true;
    state.suggestions = [];
    state.searchQuery = '';
    this.notify();

    try {
      const res = await fetch(
        `${this.baseUrl}/api/dictionary/${tab.moduleAbbr}/entry/${encodeURIComponent(entryKey)}`
      );
      if (res.ok) {
        state.entry = await res.json();
      } else {
        state.entry = null;
      }
    } catch {
      state.entry = null;
    }

    state.entryLoading = false;
    this.notify();

    // Load adjacent entries for prev/next navigation
    if (state.entry) {
      this.loadAdjacent(tabId, entryKey);
    }
  }

  /** Clear the current entry, returning to browse mode */
  clearEntryInTab(tabId: string): void {
    const state = this.getTabState(tabId);
    state.entry = null;
    state.adjacentPrev = null;
    state.adjacentNext = null;
    state.searchQuery = '';
    state.suggestions = [];
    this.notify();
  }

  // ========================================================================
  // Browse (alphabet bar + paginated entry list)
  // ========================================================================

  async loadBrowseLetters(tabId: string): Promise<void> {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || tab.id === DICT_HOME_TAB_ID) return;

    try {
      const res = await fetch(`${this.baseUrl}/api/dictionary/${tab.moduleAbbr}/letters`);
      if (res.ok) {
        const state = this.getTabState(tabId);
        state.browseLetters = await res.json();
        // Auto-select first letter and load entries
        if (state.browseLetters && state.browseLetters.length > 0 && !state.browseLetter) {
          this.loadBrowseEntries(tabId, state.browseLetters[0].letter);
        }
        this.notify();
      }
    } catch { /* ignore */ }
  }

  async loadBrowseEntries(tabId: string, letter: string): Promise<void> {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || tab.id === DICT_HOME_TAB_ID) return;

    const state = this.getTabState(tabId);
    state.browseLetter = letter;
    state.browseOffset = 0;
    state.browseLoading = true;
    this.notify();

    try {
      const res = await fetch(
        `${this.baseUrl}/api/dictionary/${tab.moduleAbbr}/browse?letter=${encodeURIComponent(letter)}&limit=50`
      );
      if (res.ok) {
        const data = await res.json();
        state.browseEntries = data.entries;
        state.browseTotal = data.total;
        state.browseOffset = data.entries.length;
      }
    } catch {
      state.browseEntries = [];
    }

    state.browseLoading = false;
    this.notify();
  }

  async loadMoreBrowseEntries(tabId: string): Promise<void> {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || tab.id === DICT_HOME_TAB_ID) return;

    const state = this.getTabState(tabId);
    if (state.browseOffset >= state.browseTotal) return;

    state.browseLoading = true;
    this.notify();

    try {
      const res = await fetch(
        `${this.baseUrl}/api/dictionary/${tab.moduleAbbr}/browse?letter=${encodeURIComponent(state.browseLetter)}&limit=50&offset=${state.browseOffset}`
      );
      if (res.ok) {
        const data = await res.json();
        state.browseEntries = [...state.browseEntries, ...data.entries];
        state.browseOffset = state.browseEntries.length;
      }
    } catch { /* ignore */ }

    state.browseLoading = false;
    this.notify();
  }

  // ========================================================================
  // Adjacent entry navigation (prev/next)
  // ========================================================================

  private async loadAdjacent(tabId: string, entryKey: string): Promise<void> {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || tab.id === DICT_HOME_TAB_ID) return;

    const state = this.getTabState(tabId);

    try {
      const res = await fetch(
        `${this.baseUrl}/api/dictionary/${tab.moduleAbbr}/adjacent/${encodeURIComponent(entryKey)}`
      );
      if (res.ok) {
        const data = await res.json();
        state.adjacentPrev = data.prev;
        state.adjacentNext = data.next;
        this.notify();
      }
    } catch { /* ignore */ }
  }

  async navigatePrev(tabId: string): Promise<void> {
    const state = this.getTabState(tabId);
    if (state.adjacentPrev) {
      await this.loadEntryInTab(tabId, state.adjacentPrev.entry_key);
    }
  }

  async navigateNext(tabId: string): Promise<void> {
    const state = this.getTabState(tabId);
    if (state.adjacentNext) {
      await this.loadEntryInTab(tabId, state.adjacentNext.entry_key);
    }
  }

  // ========================================================================
  // Strong's integration
  // ========================================================================

  /** Open a Strong's entry — auto-selects the right dictionary and loads the entry */
  async openStrongs(strongsNumber: string): Promise<void> {
    const prefix = strongsNumber.charAt(0).toUpperCase();
    const dictAbbr = prefix === 'H' ? 'strongshebrew' : 'strongsgreek';
    // Convert "H1234" → "01234" (dictionary entry_key format is 5-digit zero-padded, no prefix)
    const numStr = strongsNumber.replace(/^[GHgh]0*/i, '');
    const dictKey = numStr.padStart(5, '0');

    await this.loadModules();
    const mod = this.modules.find(m => m.abbreviation === dictAbbr);
    const moduleName = mod?.name ?? dictAbbr;

    // skipBrowse: we are heading straight for one entry, and the browse list
    // would otherwise flash a screen of Greek/Hebrew words before it lands.
    const tabId = this.openTemporaryTab(dictAbbr, moduleName, { skipBrowse: true });
    await this.loadEntryInTab(tabId, dictKey);
    this.saveSession();
  }

  // ========================================================================
  // Session persistence
  // ========================================================================

  private saveSession(): void {
    try {
      // Save only permanent tabs (excluding home and temporary)
      const permanentTabs = this.tabs
        .filter(t => t.id !== DICT_HOME_TAB_ID && !t.temporary)
        .map(t => ({ moduleAbbr: t.moduleAbbr, moduleName: t.moduleName }));
      localStorage.setItem('bible-reader-dictionary', JSON.stringify({
        tabs: permanentTabs,
        activeTabId: this.activeTabId,
        starredModules: [...this.starredModules],
      }));
    } catch { /* ignore */ }
  }

  private restoreSession(): void {
    try {
      const data = localStorage.getItem('bible-reader-dictionary');
      if (!data) return;
      const parsed = JSON.parse(data);

      // Rebuild tabs from saved permanent tabs
      if (Array.isArray(parsed.tabs)) {
        for (const saved of parsed.tabs) {
          if (saved.moduleAbbr) {
            const id = `dtab-${++tabCounter}-${Date.now()}`;
            this.tabs.push({ id, moduleAbbr: saved.moduleAbbr, moduleName: saved.moduleName ?? saved.moduleAbbr });
            this.tabStates.set(id, emptyTabState());
          }
        }
      }

      // Restore starred modules
      if (Array.isArray(parsed.starredModules)) {
        this.starredModules = new Set(parsed.starredModules);
      }

      // Restore activeTabId if it matches a restored tab (or default to home)
      if (parsed.activeTabId && this.tabs.find(t => t.id === parsed.activeTabId)) {
        this.activeTabId = parsed.activeTabId;
      } else if (parsed.activeTabId === DICT_HOME_TAB_ID) {
        this.activeTabId = DICT_HOME_TAB_ID;
      }
    } catch { /* ignore */ }
  }
}

export const dictionaryStore = new DictionaryStore();
