import { create } from 'zustand';
import type { NewlineHandling } from '@bible/core';
import { dictionaryAPI } from '../services/electronAPI';
import { DEFAULT_PANEL_ID, updatePanelState } from './helpers/panelStateHelpers';
import { createPanelSlice } from './helpers/createPanelSlice';
import { createPanelTabsSlice, withTabValues } from './helpers/createPanelTabsSlice';
import { sessionPanelState } from './helpers/sessionPanelSelection';
import { BOOK_DICT_PANEL_TYPES } from './helpers/bookDictPanelTypes';

import { markSessionDirty } from './helpers/sessionNotifier';
import { registerSessionSerializer } from './helpers/sessionRegistry';

// Dictionary module metadata
export interface DictionaryModule {
  module_id?: number;
  abbreviation: string;
  name: string;
  language_code?: string;
  version?: string;
  database_path: string;
}

// Dictionary entry from database
export interface DictionaryEntry {
  entry_id?: number;
  entry_key: string;
  word?: string;
  transliteration?: string;
  pronunciation?: string;
  part_of_speech?: string;
  definition: string;
  etymology?: string;
  usage_notes?: string;
  semantic_range?: string;
  related_words?: string[];
  example_verses?: Array<{ verse_id: number; text?: string }>;
  content_file?: string;
  metadata?: any;
  /**
   * The module's declared `newline_handling` (module_info.metadata), forwarded
   * by `dictionary:getEntry*`. Absent when the module declares none, which
   * leaves the decision to the per-entry fallback in
   * `dictionaryDefinitionToHtml`.
   */
  newline_handling?: NewlineHandling;
}

// Dictionary entry summary for browse mode
export interface DictionaryEntrySummary {
  entry_id?: number;
  entry_key: string;
  word?: string;
  definition: string;
  transliteration?: string;
  part_of_speech?: string;
}

// Open dictionary tab
export interface DictionaryTab {
  abbreviation: string;
  name: string;
}

// Recent lookup history item
export interface RecentLookup {
  abbreviation: string;
  entry_key: string;
  word?: string;
  timestamp: number;
}

/**
 * One step in a pane's back/forward trail.
 *
 * Distinct from `RecentLookup`, which is a global, de-duplicated,
 * most-recent-first list shown in a menu. This is a per-pane *sequence* with a
 * cursor in it: the same entry can appear twice, order is the order visited,
 * and going back does not remove anything. The abbreviation travels with each
 * step because a trail crosses dictionaries - following a cross-reference out
 * of one lexicon and stepping back has to return to the other one.
 */
export interface DictionaryNavEntry {
  abbreviation: string;
  entryKey: string;
  word?: string;
}

/** Options shared by the two lookup entry points. */
export interface LookupOptions {
  /**
   * Set when the lookup *is* a back/forward step, so it moves the cursor along
   * the existing trail instead of appending to it (which would make Back
   * bounce between two entries forever).
   */
  fromNavigation?: boolean;
}

// Right pane tab type (unified: study resources + user notes)
export type StudyPaneTab = 'commentary' | 'verse-notes' | 'book' | 'dictionary' | 'prayer' | 'notes';

/**
 * Per-panel-instance state for a Dictionary panel.
 * Each dockview panel gets its own independent copy of this state.
 */
export interface DictionaryPanelState {
  openTabs: DictionaryTab[];
  activeTabIndex: number;
  entriesByTab: Map<string, DictionaryEntry | null>;
  loadingByTab: Map<string, boolean>;
  errorByTab: Map<string, string | null>;
  browseModeByTab: Map<string, boolean>;
  allEntriesByTab: Map<string, DictionaryEntrySummary[]>;
  loadingAllEntriesByTab: Map<string, boolean>;
  /**
   * Whether the browse list for a tab has reached the end of the dictionary.
   * There is no entry-count IPC channel, so "is there more?" can only be
   * inferred from a short page - see `loadAllEntries`.
   */
  allEntriesCompleteByTab: Map<string, boolean>;
  searchResultsByTab: Map<string, DictionaryEntrySummary[]>;
  searchingByTab: Map<string, boolean>;
  /**
   * Where this pane has been, and where in that trail it currently is.
   * `navIndex` is -1 when nothing has been looked up yet.
   */
  navHistory: DictionaryNavEntry[];
  navIndex: number;
}

export function createDefaultDictionaryPanelState(): DictionaryPanelState {
  return {
    openTabs: [],
    activeTabIndex: 0,
    entriesByTab: new Map(),
    loadingByTab: new Map(),
    errorByTab: new Map(),
    browseModeByTab: new Map(),
    allEntriesByTab: new Map(),
    loadingAllEntriesByTab: new Map(),
    allEntriesCompleteByTab: new Map(),
    searchResultsByTab: new Map(),
    searchingByTab: new Map(),
    navHistory: [],
    navIndex: -1,
  };
}

/**
 * Append a step to a pane's trail, truncating anything ahead of the cursor.
 *
 * Same rule a browser uses: looking something new up after stepping back
 * abandons the forward branch. Repeating the step you are already on is a
 * no-op, so a re-lookup of the open entry (a retry, a session restore) does not
 * stack duplicates that then take two Backs to get past.
 */
function pushNavEntry(
  state: DictionaryPanelState,
  entry: DictionaryNavEntry,
): Pick<DictionaryPanelState, 'navHistory' | 'navIndex'> {
  const current = state.navHistory[state.navIndex];
  if (current && current.abbreviation === entry.abbreviation && current.entryKey === entry.entryKey) {
    return { navHistory: state.navHistory, navIndex: state.navIndex };
  }
  const navHistory = [...state.navHistory.slice(0, state.navIndex + 1), entry];
  // A trail is a convenience, not a record; an unbounded one is a slow leak in
  // a pane that stays open for a long reading session.
  const trimmed = navHistory.length > MAX_NAV_HISTORY
    ? navHistory.slice(navHistory.length - MAX_NAV_HISTORY)
    : navHistory;
  return { navHistory: trimmed, navIndex: trimmed.length - 1 };
}

/** How many steps of back/forward a pane keeps. */
const MAX_NAV_HISTORY = 50;

/**
 * Move a pane's cursor to `targetIndex` and show the entry that lives there.
 *
 * Kept out of the store object so `goBack` and `goForward` are the two-line
 * bounds checks they should be. Reads the store through the module-level hook
 * rather than a captured `get`, which is the same thing the store's own
 * cross-action calls do.
 */
async function stepTo(
  panelId: string,
  targetIndex: number,
  target: DictionaryNavEntry,
): Promise<void> {
  // allow-getstate: store-internal navigation step, not a React render path
  const store = useDictionaryStore.getState();
  const panelState = store.getPanelState(panelId);

  // The trail crosses dictionaries, so the step may belong to another tab. If
  // that tab has since been closed the step is dead: drop the cursor there
  // anyway so a second Back keeps walking rather than jamming.
  const tabIndex = panelState.openTabs.findIndex(tab => tab.abbreviation === target.abbreviation);

  useDictionaryStore.setState({
    panels: updatePanelState(
      store.panels,
      panelId,
      {
        ...panelState,
        navIndex: targetIndex,
        activeTabIndex: tabIndex >= 0 ? tabIndex : panelState.activeTabIndex,
      },
      createDefaultDictionaryPanelState,
    ),
  });

  if (tabIndex < 0) return;
  await store.lookupEntry(panelId, target.abbreviation, target.entryKey, { fromNavigation: true });
}

interface DictionaryState {
  // === SHARED (global across all panels) ===
  availableDictionaries: DictionaryModule[];
  loadingDictionaries: boolean;
  studyPaneActiveTab: StudyPaneTab;
  recentLookups: RecentLookup[];

  // === PER-INSTANCE state keyed by panelId ===
  panels: Map<string, DictionaryPanelState>;

  // === PANEL LIFECYCLE ===
  initPanel: (panelId: string) => void;
  detachPanel: (panelId: string) => void;
  destroyPanel: (panelId: string) => void;
  getPanelState: (panelId: string) => DictionaryPanelState;

  // === SHARED ACTIONS (no panelId) ===
  loadAvailableDictionaries: () => Promise<void>;
  setStudyPaneActiveTab: (tab: StudyPaneTab) => void;
  addToHistory: (abbreviation: string, entry: DictionaryEntry) => void;
  clearHistory: () => void;
  lookupStrongsNumber: (strongsNumber: string, panelId: string) => Promise<void>;

  // === PER-PANEL ACTIONS (panelId first param) ===
  openDictionary: (panelId: string, abbreviation: string, name: string) => void;
  closeDictionary: (panelId: string, abbreviation: string) => void;
  setActiveTab: (panelId: string, index: number) => void;
  reorderTabs: (panelId: string, sourceIndex: number, destinationIndex: number) => void;
  lookupEntry: (panelId: string, abbreviation: string, entryKey: string, options?: LookupOptions) => Promise<void>;
  lookupEntryById: (panelId: string, abbreviation: string, entryId: number, options?: LookupOptions) => Promise<void>;
  /** Step back through this pane's trail. No-op at the start of it. */
  goBack: (panelId: string) => Promise<void>;
  /** Step forward again after a `goBack`. No-op at the end of the trail. */
  goForward: (panelId: string) => Promise<void>;
  searchDictionary: (panelId: string, abbreviation: string, query: string, limit?: number) => Promise<void>;
  loadAllEntries: (panelId: string, abbreviation: string, limit?: number, offset?: number, append?: boolean) => Promise<void>;
  toggleBrowseMode: (panelId: string, abbreviation: string) => void;
  clearError: (panelId: string, abbreviation: string) => void;
  preloadBackgroundTabs: (panelId: string) => void;

  // === SESSION MANAGEMENT ===
  restoreFromSession: (panelId: string, sessionData: {
    openTabs?: Array<{ abbreviation: string; name: string }>;
    activeTabIndex?: number;
    currentEntryByTab?: Record<string, string>;
  }) => Promise<void>;
}

/**
 * What survives the pane's component unmounting (see `detachPanel`).
 *
 * `openTabs` and `activeTabIndex` are the pane's identity - losing them is the
 * tab-disappears bug. `entriesByTab` is kept because for a dictionary it is the
 * *reading position*, not a cache: it is what the session serializer below
 * turns into `currentEntryByTab`, so dropping it here would silently forget
 * which entry each tab was showing.
 *
 * Everything else is deliberately reset - browse pages (up to hundreds of rows
 * per tab, cheap to refetch), search results, and every loading/searching flag,
 * which must not come back set on a fetch whose component no longer exists.
 */
const dictionaryPanelSlice = createPanelSlice(createDefaultDictionaryPanelState, {
  retainOnDetach: (state) => ({
    openTabs: state.openTabs,
    activeTabIndex: state.activeTabIndex,
    entriesByTab: state.entriesByTab,
  }),
});

/**
 * The tab-strip actions, shared with `useBookStore` - see
 * `helpers/createPanelTabsSlice.ts`.
 *
 * Books and dictionaries render through one component, so selecting,
 * reordering and closing a tab has to behave identically for both - two
 * copies of the same index arithmetic would have to be kept in step by hand.
 */
const dictionaryTabsSlice = createPanelTabsSlice(createDefaultDictionaryPanelState);

export const useDictionaryStore = create<DictionaryState>((set, get) => {
  const tabs = dictionaryTabsSlice(set as any, get as any);

  return {
    // === SHARED initial state ===
    availableDictionaries: [],
    loadingDictionaries: false,
    studyPaneActiveTab: 'commentary',
    recentLookups: [],

    // === PER-INSTANCE initial state ===
    panels: new Map(),

    // === PANEL LIFECYCLE ===
    ...dictionaryPanelSlice(set as any, get as any),

    // === TAB STRIP (shared with useBookStore) ===
    setActiveTab: tabs.setActiveTab,
    reorderTabs: tabs.reorderTabs,
    /** Close a tab and drop every cache keyed against it. */
    closeDictionary: tabs.closeTab,
    clearError: tabs.clearError,

    // === SHARED ACTIONS ===

    // Load list of available dictionary modules
    loadAvailableDictionaries: async () => {
      set({ loadingDictionaries: true });
      try {
        const dictionaries = await dictionaryAPI.getAvailableDictionaries();
        set({ availableDictionaries: dictionaries, loadingDictionaries: false });
      } catch (error) {
        console.error('Error loading available dictionaries:', error);
        set({ loadingDictionaries: false });
      }
    },

    // Set the study resources pane active tab
    setStudyPaneActiveTab: (tab) => {
      // Migrate old tab values to the unified 'notes' tab
      const mappedTab = (tab === 'verse-notes' || tab === 'prayer') ? 'notes' : tab;
      set({ studyPaneActiveTab: mappedTab });
    },

    // Add entry to recent lookups history
    addToHistory: (abbreviation: string, entry: DictionaryEntry) => {
      const { recentLookups } = get();

      // Create new history item
      const newItem: RecentLookup = {
        abbreviation,
        entry_key: entry.entry_key,
        word: entry.word,
        timestamp: Date.now()
      };

      // Remove duplicates (same abbreviation and key)
      const filtered = recentLookups.filter(
        item => !(item.abbreviation === abbreviation && item.entry_key === entry.entry_key)
      );

      // Add to beginning, keep only last 20
      const newHistory = [newItem, ...filtered].slice(0, 20);

      set({ recentLookups: newHistory });
    },

    // Clear recent lookups history
    clearHistory: () => {
      set({ recentLookups: [] });
    },

    /**
     * Look up a Strong's number (e.g., "G281" or "H0430") in the appropriate
     * Strong's dictionary. Handles number format conversion (G281 -> 00281),
     * opens the dictionary tab, switches study pane to Dictionary, and navigates.
     * Shows an alert if the required dictionary is not available.
     *
     * `panelId` must be the dockview panel id of the Dictionary pane that is
     * actually on screen (see `revealDictionaryPanel`). Writing to
     * `DEFAULT_PANEL_ID` unconditionally would land the lookup on a
     * panel-state entry nothing renders, since the on-screen pane always has
     * its own dockview-assigned id.
     */
    lookupStrongsNumber: async (strongsNumber: string, panelId: string) => {
      try {
        // Parse the Strong's number: "G281", "H0430", "G3588", etc.
        const isGreek = strongsNumber.startsWith('G');
        const isHebrew = strongsNumber.startsWith('H');
        if (!isGreek && !isHebrew) return;

        // The target dictionary abbreviation
        const targetAbbr = isGreek ? 'StrongsGreek' : 'StrongsHebrew';
        const targetLabel = isGreek ? "Strong's Greek Lexicon" : "Strong's Hebrew Lexicon";

        // Ensure dictionaries are loaded
        let dicts = get().availableDictionaries;
        if (dicts.length === 0) {
          await get().loadAvailableDictionaries();
          dicts = get().availableDictionaries;
        }

        // Find the specific Strong's dictionary (case-insensitive abbreviation match)
        const targetAbbrLower = targetAbbr.toLowerCase();
        const lexicon = dicts.find(d =>
          d.abbreviation.toLowerCase() === targetAbbrLower
        );

        if (!lexicon) {
          // Show a user-visible message that the dictionary is not available
          alert(`${targetLabel} is not installed. Please import the ${targetAbbr} module to look up Strong's numbers.`);
          return;
        }

        // Convert Strong's number to dictionary entry key format
        // "G281" -> "00281", "H0430" -> "00430", "H07225" -> "07225"
        const numericPart = strongsNumber.slice(1); // Remove G/H prefix
        const entryKey = numericPart.padStart(5, '0');

        // Bring the study column's Dictionary tab forward
        get().setStudyPaneActiveTab('dictionary');

        // Open the dictionary tab on the panel that is actually rendered
        get().openDictionary(panelId, lexicon.abbreviation, lexicon.name);

        // Look up the entry
        await get().lookupEntry(panelId, lexicon.abbreviation, entryKey);

        // Check if entry was found - if not, set an informative error message
        const ps = get().getPanelState(panelId);
        const currentEntry = ps.entriesByTab.get(lexicon.abbreviation);
        if (!currentEntry) {
          set({
            panels: updatePanelState(get().panels, panelId, withTabValues(ps, lexicon.abbreviation, {
              errorByTab: `No Strong's entry found for ${strongsNumber}. This number may not exist in the ${targetLabel}.`
            }), createDefaultDictionaryPanelState)
          });
        }
      } catch (error) {
        console.error("Error looking up Strong's number:", error);
      }
    },

    // === PER-PANEL ACTIONS ===

    // Open a new dictionary tab
    openDictionary: (panelId: string, abbreviation: string, name: string) => {
      const ps = get().getPanelState(panelId);

      // Check if already open
      const existingIndex = ps.openTabs.findIndex(tab => tab.abbreviation === abbreviation);
      if (existingIndex !== -1) {
        // Tab already open, just switch to it
        set({ panels: updatePanelState(get().panels, panelId, { activeTabIndex: existingIndex }, createDefaultDictionaryPanelState) });
        markSessionDirty();
        return;
      }

      // Add new tab
      const newTabs = [...ps.openTabs, { abbreviation, name }];
      set({ panels: updatePanelState(get().panels, panelId, { openTabs: newTabs, activeTabIndex: newTabs.length - 1 }, createDefaultDictionaryPanelState) });
      markSessionDirty();
    },

    // Look up a dictionary entry by key
    lookupEntry: async (panelId: string, abbreviation: string, entryKey: string, options?: LookupOptions) => {
      // Set loading state
      set({
        panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
          loadingByTab: true,
          errorByTab: null,
        }), createDefaultDictionaryPanelState)
      });

      try {
        const entry = await dictionaryAPI.getEntryByKey(abbreviation, entryKey);

        // A miss is a *result*, not the absence of one. Without the error text
        // the pane fell through to its "Nothing looked up yet" empty state,
        // telling the user the lookup had never happened rather than that it
        // found nothing - so typing "Joshua" into a Strong's lexicon looked
        // like the box was broken.
        set({
          panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
            entriesByTab: entry,
            loadingByTab: false,
            errorByTab: entry ? null : `No entry for "${entryKey}" in this dictionary.`,
          }), createDefaultDictionaryPanelState)
        });
        markSessionDirty();

        // Add to history if entry found
        if (entry) {
          get().addToHistory(abbreviation, entry);
          if (!options?.fromNavigation) {
            const panelState = get().getPanelState(panelId);
            set({
              panels: updatePanelState(
                get().panels,
                panelId,
                {
                  ...panelState,
                  ...pushNavEntry(panelState, {
                    abbreviation,
                    entryKey: entry.entry_key,
                    word: entry.word,
                  }),
                },
                createDefaultDictionaryPanelState,
              ),
            });
          }
        }
      } catch (error) {
        set({
          panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
            loadingByTab: false,
            errorByTab: error instanceof Error ? error.message : 'Failed to load dictionary entry',
          }), createDefaultDictionaryPanelState)
        });
      }
    },

    // Look up a dictionary entry by ID
    lookupEntryById: async (panelId: string, abbreviation: string, entryId: number, options?: LookupOptions) => {
      // Set loading state
      set({
        panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
          loadingByTab: true,
          errorByTab: null,
        }), createDefaultDictionaryPanelState)
      });

      try {
        const entry = await dictionaryAPI.getEntry(abbreviation, entryId);

        // See lookupEntry: a miss must read as "found nothing", not as "nothing
        // has been looked up yet".
        set({
          panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
            entriesByTab: entry,
            loadingByTab: false,
            errorByTab: entry ? null : 'That dictionary entry could not be found.',
          }), createDefaultDictionaryPanelState)
        });
        markSessionDirty();

        // Add to history if entry found
        if (entry) {
          get().addToHistory(abbreviation, entry);
          if (!options?.fromNavigation) {
            const panelState = get().getPanelState(panelId);
            set({
              panels: updatePanelState(
                get().panels,
                panelId,
                {
                  ...panelState,
                  ...pushNavEntry(panelState, {
                    abbreviation,
                    entryKey: entry.entry_key,
                    word: entry.word,
                  }),
                },
                createDefaultDictionaryPanelState,
              ),
            });
          }
        }
      } catch (error) {
        set({
          panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
            loadingByTab: false,
            errorByTab: error instanceof Error ? error.message : 'Failed to load dictionary entry',
          }), createDefaultDictionaryPanelState)
        });
      }
    },

    /*
      Back and forward along this pane's trail.

      Both re-run the lookup rather than caching the entry: the entry cache is
      per-tab and a step can cross dictionaries, so replaying the lookup is what
      guarantees the pane shows the step it says it is on. `fromNavigation`
      stops that replay from appending to the trail it is walking.

      The cursor moves *before* the await so two fast clicks step twice rather
      than racing to the same place.
    */
    goBack: async (panelId: string) => {
      const panelState = get().getPanelState(panelId);
      const targetIndex = panelState.navIndex - 1;
      const target = panelState.navHistory[targetIndex];
      if (!target) return;
      await stepTo(panelId, targetIndex, target);
    },

    goForward: async (panelId: string) => {
      const panelState = get().getPanelState(panelId);
      const targetIndex = panelState.navIndex + 1;
      const target = panelState.navHistory[targetIndex];
      if (!target) return;
      await stepTo(panelId, targetIndex, target);
    },

    // Search dictionary entries
    searchDictionary: async (panelId: string, abbreviation: string, query: string, limit?: number) => {
      // Set searching state
      set({
        panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
          searchingByTab: true,
        }), createDefaultDictionaryPanelState)
      });

      try {
        const results = await dictionaryAPI.searchEntries(abbreviation, query, limit);

        set({
          panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
            searchResultsByTab: results,
            searchingByTab: false,
          }), createDefaultDictionaryPanelState)
        });
      } catch (error) {
        console.error(`Error searching dictionary ${abbreviation}:`, error);
        set({
          panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
            searchingByTab: false,
          }), createDefaultDictionaryPanelState)
        });
      }
    },

    /**
     * Load a page of entries for browse mode.
     *
     * `append` adds the page to what is already loaded, which is how the browse
     * dialog's "Load more" walks a dictionary of thousands of entries. There is
     * no entry-count IPC channel, so the end of the list is detected by a short
     * page - fewer rows than `limit` asked for - rather than by comparing against
     * a total.
     */
    loadAllEntries: async (panelId: string, abbreviation: string, limit?: number, offset?: number, append?: boolean) => {
      // Set loading state
      set({
        panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
          loadingAllEntriesByTab: true,
        }), createDefaultDictionaryPanelState)
      });

      try {
        const entries = await dictionaryAPI.getAllEntries(abbreviation, limit, offset);

        const ps = get().getPanelState(panelId);
        const existing = append ? ps.allEntriesByTab.get(abbreviation) || [] : [];

        set({
          panels: updatePanelState(get().panels, panelId, withTabValues(ps, abbreviation, {
            allEntriesByTab: [...existing, ...entries],
            loadingAllEntriesByTab: false,
            // An unlimited request always returns everything; a limited one has
            // more to give only when it filled the page exactly.
            allEntriesCompleteByTab: limit === undefined || entries.length < limit,
          }), createDefaultDictionaryPanelState)
        });
      } catch (error) {
        console.error(`Error loading all entries for ${abbreviation}:`, error);
        set({
          panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
            loadingAllEntriesByTab: false,
          }), createDefaultDictionaryPanelState)
        });
      }
    },

    // Toggle between browse mode and normal mode
    toggleBrowseMode: (panelId: string, abbreviation: string) => {
      const ps = get().getPanelState(panelId);
      const currentMode = ps.browseModeByTab.get(abbreviation) || false;
      set({
        panels: updatePanelState(get().panels, panelId, withTabValues(ps, abbreviation, {
          browseModeByTab: !currentMode,
        }), createDefaultDictionaryPanelState)
      });

      // If switching to browse mode and entries not loaded, load them
      if (!currentMode && !get().getPanelState(panelId).allEntriesByTab.has(abbreviation)) {
        get().loadAllEntries(panelId, abbreviation, 100); // Load first 100 entries
      }
    },

    // === SESSION MANAGEMENT ===

    /**
     * Restore dictionary store state from session data (Phase 1: active tab only)
     */
    restoreFromSession: async (panelId: string, sessionData: {
      openTabs?: Array<{ abbreviation: string; name: string }>;
      activeTabIndex?: number;
      currentEntryByTab?: Record<string, string>;
    }) => {
      if (!sessionData.openTabs || sessionData.openTabs.length === 0) {
        return;
      }

      const activeTabIndex = sessionData.activeTabIndex ?? 0;

      // Restore open tabs
      set({ panels: updatePanelState(get().panels, panelId, {
        openTabs: sessionData.openTabs,
        activeTabIndex
      }, createDefaultDictionaryPanelState) });

      // Phase 1: Load ONLY the active tab's entry
      if (sessionData.currentEntryByTab) {
        const activeTab = sessionData.openTabs[activeTabIndex];
        if (activeTab) {
          const entryKey = sessionData.currentEntryByTab[activeTab.abbreviation];
          if (entryKey) {
            await get().lookupEntry(panelId, activeTab.abbreviation, entryKey);
          }
        }
      }
    },

    // Phase 2: Preload background tabs (non-blocking, called after initial render)
    preloadBackgroundTabs: (panelId: string) => {
      const ps = get().getPanelState(panelId);
      if (ps.openTabs.length <= 1) return;

      // We need to get the session data for entry keys - check if entries are already loaded
      const backgroundTabs = ps.openTabs.filter((_, i) => i !== ps.activeTabIndex);
      if (backgroundTabs.length === 0) return;

      // Background tabs that don't have entries loaded yet
      const tabsToLoad = backgroundTabs.filter(tab => !ps.entriesByTab.has(tab.abbreviation));
      if (tabsToLoad.length === 0) return;
      // Dictionary entries are loaded on demand when the user switches tabs;
      // entry keys for background tabs are not persisted in the session.
    }
  };
});

// Register session serializer so useSessionStore doesn't import us directly
registerSessionSerializer('dictionary', () => {
  const dictState = useDictionaryStore.getState();
  // The panel the *layout* has, not whichever entry happens to be first in this
  // store's map - see `sessionPanelState`. Books and dictionaries share one
  // dockview panel, so both content types are candidates.
  const firstPanel = sessionPanelState(dictState.panels, BOOK_DICT_PANEL_TYPES);
  const currentEntryByTab: Record<string, string> = {};
  if (firstPanel?.entriesByTab) {
    firstPanel.entriesByTab.forEach((value: { entry_key: string } | null, key: string) => {
      if (value?.entry_key) {
        currentEntryByTab[key] = value.entry_key;
      }
    });
  }
  return {
    openTabs: firstPanel?.openTabs || [],
    activeTabIndex: firstPanel?.activeTabIndex ?? 0,
    currentEntryByTab
  };
});

export { DEFAULT_PANEL_ID };
