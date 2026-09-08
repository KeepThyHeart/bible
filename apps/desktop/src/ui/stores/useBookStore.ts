import { create } from 'zustand';
import { bookAPI } from '../services/electronAPI';
import { DEFAULT_PANEL_ID, updatePanelState } from './helpers/panelStateHelpers';
import { createPanelSlice } from './helpers/createPanelSlice';
import { createPanelTabsSlice, withTabValues } from './helpers/createPanelTabsSlice';
import { sessionPanelState } from './helpers/sessionPanelSelection';
import { BOOK_DICT_PANEL_TYPES } from './helpers/bookDictPanelTypes';

import { markSessionDirty } from './helpers/sessionNotifier';
import { registerSessionSerializer } from './helpers/sessionRegistry';

// Book module metadata
export interface BookModule {
  module_id?: number;
  abbreviation: string;
  name: string;
  language_code?: string;
  version?: string;
  database_path: string;
}

// Book section from database
export interface BookSection {
  section_id?: number;
  parent_section_id?: number;
  section_number?: string;
  title: string;
  content: string;
  content_file?: string;
  word_count?: number;
}

// Book section summary for tree view
export interface BookSectionSummary {
  section_id: number;
  parent_section_id?: number;
  section_number?: string;
  title: string;
  word_count?: number;
  has_children?: boolean;
}

// Open book tab
export interface BookTab {
  abbreviation: string;
  name: string;
}

/**
 * One entry in a Books pane's unified tab strip.
 *
 * The pane shows books and dictionaries side by side in a single row, so the
 * strip's order cannot live in either content store on its own - a book tab and
 * a dictionary tab opened in between it have no shared index. `tabOrder` below
 * is that shared list; the two content stores keep their own arrays purely for
 * content and for within-type ordering.
 */
export interface PaneTabRef {
  type: 'book' | 'dictionary';
  abbreviation: string;
}

/**
 * Per-panel-instance state for a Book panel.
 * Each dockview panel gets its own independent copy of this state.
 */
export interface BookPanelState {
  openTabs: BookTab[];
  activeTabIndex: number;
  /**
   * Display order of the pane's unified books + dictionaries tab strip.
   *
   * Held here (rather than derived by concatenating the two stores) because
   * concatenation always groups by type: opening Book A, Dictionary X, Book B
   * displayed A, B, X and silently rearranged the user's tabs. Entries that are
   * no longer open are ignored and newly opened tabs are appended, so this
   * never has to be maintained by every code path that can open a module - see
   * `components/BookPane/tabOrder.ts`.
   */
  tabOrder: PaneTabRef[];
  currentSectionByTab: Map<string, number | null>;
  sectionsByTab: Map<string, BookSection | null>;
  loadingByTab: Map<string, boolean>;
  errorByTab: Map<string, string | null>;
  sectionSummariesByTab: Map<string, BookSectionSummary[]>;
  loadingSummariesByTab: Map<string, boolean>;
  /** Why the last table-of-contents load failed, so the Contents dialog can offer a retry. */
  summariesErrorByTab: Map<string, string | null>;
  childSectionsByTab: Map<string, BookSectionSummary[]>;
}

export function createDefaultBookPanelState(): BookPanelState {
  return {
    openTabs: [],
    activeTabIndex: 0,
    tabOrder: [],
    currentSectionByTab: new Map(),
    sectionsByTab: new Map(),
    loadingByTab: new Map(),
    errorByTab: new Map(),
    sectionSummariesByTab: new Map(),
    loadingSummariesByTab: new Map(),
    summariesErrorByTab: new Map(),
    childSectionsByTab: new Map(),
  };
}

interface BookState {
  // === SHARED (global across all panels) ===
  availableBooks: BookModule[];
  loadingBooks: boolean;

  // === PER-INSTANCE state keyed by panelId ===
  panels: Map<string, BookPanelState>;

  // === PANEL LIFECYCLE ===
  initPanel: (panelId: string) => void;
  detachPanel: (panelId: string) => void;
  destroyPanel: (panelId: string) => void;
  getPanelState: (panelId: string) => BookPanelState;

  // === SHARED ACTIONS (no panelId) ===
  loadAvailableBooks: () => Promise<void>;

  // === PER-PANEL ACTIONS (panelId first param) ===
  /**
   * Open (or re-focus) a book tab. `initialSectionId` opens straight at a
   * known section instead of the start of the book - without it, moving a book
   * back from its own panel raced its own "load the first section " fetch and
   * landed on chapter one about half the time.
   */
  openBook: (panelId: string, abbreviation: string, name: string, initialSectionId?: number) => void;
  closeBook: (panelId: string, abbreviation: string) => void;
  setActiveTab: (panelId: string, index: number) => void;
  reorderTabs: (panelId: string, sourceIndex: number, destinationIndex: number) => void;
  /** Replace the pane's unified (books + dictionaries) tab strip order. */
  setTabOrder: (panelId: string, order: PaneTabRef[]) => void;
  loadSection: (panelId: string, abbreviation: string, sectionId: number) => Promise<void>;
  /**
   * Park a book on its Home page - the table of contents - rather than on a
   * section. Clears the reading position; the pane renders `BookHome` for it.
   */
  navigateToHome: (panelId: string, abbreviation: string) => void;
  clearError: (panelId: string, abbreviation: string) => void;

  // Navigation actions
  navigateToNextSection: (panelId: string, abbreviation: string) => Promise<void>;
  navigateToPreviousSection: (panelId: string, abbreviation: string) => Promise<void>;
  navigateToParentSection: (panelId: string, abbreviation: string) => Promise<void>;
  navigateToSection: (panelId: string, abbreviation: string, sectionId: number) => Promise<void>;
  loadSectionSummaries: (panelId: string, abbreviation: string) => Promise<void>;
  loadChildSections: (panelId: string, abbreviation: string, sectionId: number) => Promise<void>;

  preloadBackgroundTabs: (panelId: string) => void;

  // Session management
  restoreFromSession: (panelId: string, sessionData: {
    openTabs?: Array<{ abbreviation: string; name: string }>;
    activeTabIndex?: number;
    currentSectionByTab?: Record<string, number | null>;
    /** Unified books + dictionaries strip order, if the session recorded one. */
    tabOrder?: PaneTabRef[];
  }) => Promise<void>;
}

/**
 * Shared "no sections" value written on a failed summaries load. A fresh `[]`
 * per failure would change identity on every retry and re-trigger any effect
 * that depends on the summaries array.
 */
const EMPTY_SUMMARIES: BookSectionSummary[] = [];

/**
 * What survives the pane's component unmounting (see `detachPanel`).
 *
 * `openTabs`, `activeTabIndex` and `tabOrder` are the pane's identity - the
 * strip itself, whose order only `tabOrder` records. `currentSectionByTab` is the reading position each book
 * is parked on, which the session serializer below persists.
 *
 * Section bodies, the table of contents, child-section lists and every
 * loading/error flag are dropped: all are re-fetched on demand from the
 * retained section id, and a stale loading flag would leave the pane on a
 * spinner nothing clears.
 */
const bookPanelSlice = createPanelSlice(createDefaultBookPanelState, {
  retainOnDetach: (state) => ({
    openTabs: state.openTabs,
    activeTabIndex: state.activeTabIndex,
    tabOrder: state.tabOrder,
    currentSectionByTab: state.currentSectionByTab,
  }),
});

/**
 * The tab-strip actions, shared with `useDictionaryStore` - see
 * `helpers/createPanelTabsSlice.ts`.
 *
 * `tabOrder` is deliberately left alone by `closeTab`: the pane reconciles it
 * against what is actually open on every render (`mergeTabOrder`), so a
 * lingering ref for a closed module is inert.
 */
const bookTabsSlice = createPanelTabsSlice(createDefaultBookPanelState);

export const useBookStore = create<BookState>((set, get) => {
  const tabs = bookTabsSlice(set as any, get as any);

  return {
    // === SHARED initial state ===
    availableBooks: [],
    loadingBooks: false,

    // === PER-INSTANCE initial state ===
    panels: new Map(),

    // === PANEL LIFECYCLE ===
    ...bookPanelSlice(set as any, get as any),

    // === TAB STRIP (shared with useDictionaryStore) ===
    setActiveTab: tabs.setActiveTab,
    reorderTabs: tabs.reorderTabs,
    /** Close a tab and drop every cache keyed against it. */
    closeBook: tabs.closeTab,
    clearError: tabs.clearError,

    // === SHARED ACTIONS ===

    // Load list of available book modules
    loadAvailableBooks: async () => {
      set({ loadingBooks: true });
      try {
        const books = await bookAPI.getAvailableBooks();
        set({ availableBooks: books, loadingBooks: false });
      } catch (error) {
        console.error('Error loading available books:', error);
        set({ loadingBooks: false });
      }
    },

    // === PER-PANEL ACTIONS ===

    // Open a new book tab
    openBook: (panelId: string, abbreviation: string, name: string, initialSectionId?: number) => {
      const ps = get().getPanelState(panelId);

      // Check if already open
      const existingIndex = ps.openTabs.findIndex(tab => tab.abbreviation === abbreviation);
      if (existingIndex !== -1) {
        // Tab already open, just switch to it
        set({ panels: updatePanelState(get().panels, panelId, { activeTabIndex: existingIndex }, createDefaultBookPanelState) });
        markSessionDirty();
        if (initialSectionId !== undefined) {
          get().navigateToSection(panelId, abbreviation, initialSectionId);
        }
        return;
      }

      // Add new tab
      const newTabs = [...ps.openTabs, { abbreviation, name }];
      set({ panels: updatePanelState(get().panels, panelId, { openTabs: newTabs, activeTabIndex: newTabs.length - 1 }, createDefaultBookPanelState) });
      markSessionDirty();

      /*
        Open where the caller asked, or on the book's Home page.

        Dropping the reader straight into a book's first section would, for
        most books, land on a title page or a preface - the least useful place
        to land, and one that hides the fact the book has a structure at all.
        Home is the table of contents, so opening a book shows what is in it.
        The summaries load below is what Home renders from.
      */
      if (initialSectionId !== undefined) {
        get().loadSection(panelId, abbreviation, initialSectionId);
      }

      // Load section summaries for complete table of contents
      get().loadSectionSummaries(panelId, abbreviation);
    },

    /**
     * Replace the pane's unified tab strip order.
     *
     * Deliberately a plain assignment with no reconciliation: the pane derives
     * the list it renders from this plus both stores' open tabs (see
     * `components/BookPane/tabOrder.ts`), so a stale entry here is harmless and
     * a missing one is appended on the next render.
     */
    setTabOrder: (panelId: string, order: PaneTabRef[]) => {
      set({ panels: updatePanelState(get().panels, panelId, { tabOrder: order }, createDefaultBookPanelState) });
      markSessionDirty();
    },

    /*
      Back to the table of contents.

      A plain state clear rather than a navigation: Home has nothing to fetch
      that the summaries load has not already fetched, and routing it through
      `loadSection` would need a sentinel section id that does not exist.
    */
    navigateToHome: (panelId: string, abbreviation: string) => {
      set({
        panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
          currentSectionByTab: null,
          sectionsByTab: null,
          errorByTab: null,
        }), createDefaultBookPanelState)
      });
      markSessionDirty();
    },

    // Load a specific book section
    loadSection: async (panelId: string, abbreviation: string, sectionId: number) => {
      // Set loading state
      set({
        panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
          loadingByTab: true,
          errorByTab: null,
        }), createDefaultBookPanelState)
      });

      try {
        const section = await bookAPI.getSection(abbreviation, sectionId);

        set({
          panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
            sectionsByTab: section,
            currentSectionByTab: sectionId,
            loadingByTab: false,
          }), createDefaultBookPanelState)
        });
        markSessionDirty();

        // Load child sections for this section
        await get().loadChildSections(panelId, abbreviation, sectionId);
      } catch (error) {
        set({
          panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
            loadingByTab: false,
            errorByTab: error instanceof Error ? error.message : 'Failed to load book section',
          }), createDefaultBookPanelState)
        });
      }
    },

    // Load top-level sections (start of book)
    loadTopLevelSections: async (panelId: string, abbreviation: string) => {
      // Set loading state
      set({
        panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
          loadingByTab: true,
          errorByTab: null,
        }), createDefaultBookPanelState)
      });

      try {
        const sections = await bookAPI.getTopLevelSections(abbreviation);

        // Load the first top-level section
        if (sections && sections.length > 0 && sections[0].section_id) {
          const firstSection = sections[0];
          set({
            panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
              sectionsByTab: firstSection,
              currentSectionByTab: firstSection.section_id,
              loadingByTab: false,
            }), createDefaultBookPanelState)
          });
          markSessionDirty();

          // Load child sections for the first section
          await get().loadChildSections(panelId, abbreviation, firstSection.section_id);
        } else {
          set({
            panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
              loadingByTab: false,
              errorByTab: 'No sections found in this book',
            }), createDefaultBookPanelState)
          });
        }
      } catch (error) {
        set({
          panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
            loadingByTab: false,
            errorByTab: error instanceof Error ? error.message : 'Failed to load book',
          }), createDefaultBookPanelState)
        });
      }
    },

    // Navigate to next section in reading order
    navigateToNextSection: async (panelId: string, abbreviation: string) => {
      const ps = get().getPanelState(panelId);
      const currentSectionId = ps.currentSectionByTab.get(abbreviation);
      if (!currentSectionId) return;

      try {
        const nextSection = await bookAPI.getNextSection(abbreviation, currentSectionId);
        if (nextSection && nextSection.section_id) {
          await get().navigateToSection(panelId, abbreviation, nextSection.section_id);
        }
      } catch (error) {
        console.error(`Error navigating to next section for ${abbreviation}:`, error);
      }
    },

    // Navigate to previous section in reading order
    navigateToPreviousSection: async (panelId: string, abbreviation: string) => {
      const ps = get().getPanelState(panelId);
      const currentSectionId = ps.currentSectionByTab.get(abbreviation);
      if (!currentSectionId) return;

      try {
        const prevSection = await bookAPI.getPreviousSection(abbreviation, currentSectionId);
        if (prevSection && prevSection.section_id) {
          await get().navigateToSection(panelId, abbreviation, prevSection.section_id);
        }
      } catch (error) {
        console.error(`Error navigating to previous section for ${abbreviation}:`, error);
      }
    },

    // Navigate to parent section
    navigateToParentSection: async (panelId: string, abbreviation: string) => {
      const ps = get().getPanelState(panelId);
      const currentSectionId = ps.currentSectionByTab.get(abbreviation);
      if (!currentSectionId) return;

      try {
        const parentSection = await bookAPI.getParentSection(abbreviation, currentSectionId);
        if (parentSection && parentSection.section_id) {
          await get().navigateToSection(panelId, abbreviation, parentSection.section_id);
        }
      } catch (error) {
        console.error(`Error navigating to parent section for ${abbreviation}:`, error);
      }
    },

    // Navigate to a specific section (used by tree view)
    navigateToSection: async (panelId: string, abbreviation: string, sectionId: number) => {
      await get().loadSection(panelId, abbreviation, sectionId);
    },

    // Load all section summaries for tree view
    loadSectionSummaries: async (panelId: string, abbreviation: string) => {
      // Set loading state
      set({
        panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
          loadingSummariesByTab: true,
          summariesErrorByTab: null,
        }), createDefaultBookPanelState)
      });

      try {
        const summaries = await bookAPI.getAllSectionSummaries(abbreviation);

        set({
          panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
            sectionSummariesByTab: summaries,
            loadingSummariesByTab: false,
          }), createDefaultBookPanelState)
        });
      } catch (error) {
        console.error(`Error loading section summaries for ${abbreviation}:`, error);
        // Record the attempt with an empty result. Leaving the key absent made
        // every "are summaries loaded?" check read as "not yet", which both kept
        // the Contents dialog permanently shut and let the pane's auto-load
        // effect re-fire the failing query on every render.
        set({
          panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
            sectionSummariesByTab: EMPTY_SUMMARIES,
            loadingSummariesByTab: false,
            summariesErrorByTab: error instanceof Error ? error.message : 'Failed to load table of contents',
          }), createDefaultBookPanelState)
        });
      }
    },

    // Load child sections of a specific section
    loadChildSections: async (panelId: string, abbreviation: string, sectionId: number) => {
      try {
        const childSections = await bookAPI.getSectionsByParent(abbreviation, sectionId);

        // Convert to summaries format
        const childSummaries: BookSectionSummary[] = childSections.map(section => ({
          section_id: section.section_id!,
          parent_section_id: section.parent_section_id,
          section_number: section.section_number,
          title: section.title,
          word_count: section.word_count,
          has_children: false // We don't know this yet, but it's not critical for display
        }));

        set({
          panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
            childSectionsByTab: childSummaries,
          }), createDefaultBookPanelState)
        });
      } catch (error) {
        console.error(`Error loading child sections for ${abbreviation}, section ${sectionId}:`, error);
        // Clear child sections on error
        set({
          panels: updatePanelState(get().panels, panelId, withTabValues(get().getPanelState(panelId), abbreviation, {
            childSectionsByTab: [],
          }), createDefaultBookPanelState)
        });
      }
    },

    /**
     * Restore book store state from session data (Phase 1: active tab only)
     */
    restoreFromSession: async (panelId: string, sessionData: {
      openTabs?: Array<{ abbreviation: string; name: string }>;
      activeTabIndex?: number;
      currentSectionByTab?: Record<string, number | null>;
      tabOrder?: PaneTabRef[];
    }) => {
      if (!sessionData.openTabs || sessionData.openTabs.length === 0) {
        return;
      }

      const activeTabIndex = sessionData.activeTabIndex ?? 0;

      // Restore open tabs. A session written before the unified strip existed has
      // no `tabOrder`; the pane then falls back to books-then-dictionaries, which
      // is exactly what that session was displaying anyway.
      set({
        panels: updatePanelState(get().panels, panelId, {
          openTabs: sessionData.openTabs,
          activeTabIndex,
          tabOrder: sessionData.tabOrder ?? []
        }, createDefaultBookPanelState)
      });

      // Restore current sections map
      if (sessionData.currentSectionByTab) {
        const currentSectionMap = new Map<string, number | null>();
        Object.entries(sessionData.currentSectionByTab).forEach(([abbr, sectionId]) => {
          currentSectionMap.set(abbr, sectionId);
        });
        set({
          panels: updatePanelState(get().panels, panelId, {
            currentSectionByTab: currentSectionMap
          }, createDefaultBookPanelState)
        });

        // Phase 1: Load ONLY the active tab's section + summaries
        const activeTab = sessionData.openTabs[activeTabIndex];
        if (activeTab) {
          const sectionId = sessionData.currentSectionByTab[activeTab.abbreviation];

          // No recorded section means the book was parked on its Home page -
          // the table of contents - so only the summaries Home renders from
          // are loaded. Falling through to `loadTopLevelSections` here would
          // jump into the first section and lose the reader's place.
          await Promise.all([
            sectionId
              ? get().loadSection(panelId, activeTab.abbreviation, sectionId)
              : Promise.resolve(),
            get().loadSectionSummaries(panelId, activeTab.abbreviation)
          ]);
        }
      }
    },

    // Phase 2: Preload background tabs (non-blocking, called after initial render)
    preloadBackgroundTabs: (panelId: string) => {
      const ps = get().getPanelState(panelId);
      if (ps.openTabs.length <= 1) return;

      const backgroundTabs = ps.openTabs.filter((_, i) => i !== ps.activeTabIndex);
      if (backgroundTabs.length === 0) return;

      // Load all background tabs in parallel
      Promise.all(
        backgroundTabs.map(async (tab) => {
          const sectionId = ps.currentSectionByTab.get(tab.abbreviation);
          // As in `restoreFromSession`: a tab with no recorded section is on
          // its Home page, and the summaries are what that renders from.
          await Promise.all([
            sectionId
              ? get().loadSection(panelId, tab.abbreviation, sectionId)
              : Promise.resolve(),
            get().loadSectionSummaries(panelId, tab.abbreviation)
          ]);
        })
      ).catch(error => {
        console.error(`[useBookStore] Phase 2 error for panel ${panelId}:`, error);
      });
    }
  };
});

// Register session serializer so useSessionStore doesn't import us directly
registerSessionSerializer('book', () => {
  const bookState = useBookStore.getState();
  // The panel the *layout* has, not whichever entry happens to be first in this
  // store's map - see `sessionPanelState`. Books and dictionaries share one
  // dockview panel, so both content types are candidates.
  const firstPanel = sessionPanelState(bookState.panels, BOOK_DICT_PANEL_TYPES);
  const currentSectionByTab: Record<string, number | null> = {};
  if (firstPanel?.currentSectionByTab) {
    firstPanel.currentSectionByTab.forEach((value: number | null, key: string) => {
      currentSectionByTab[key] = value;
    });
  }
  return {
    openTabs: firstPanel?.openTabs || [],
    activeTabIndex: firstPanel?.activeTabIndex ?? 0,
    currentSectionByTab,
    // Persisted so a reordered strip comes back in
    // the order the user left it rather than regrouped by type. `SessionData`
    // in @bible/core does not declare this field yet; it round-trips as extra
    // JSON and `restoreFromSession` treats it as optional.
    tabOrder: firstPanel?.tabOrder ?? []
  };
});

export { DEFAULT_PANEL_ID };
