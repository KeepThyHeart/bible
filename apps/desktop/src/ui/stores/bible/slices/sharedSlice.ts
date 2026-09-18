import type { StateCreator } from 'zustand';
import { VerseIdHelper } from '@bible/core';
import { bibleAPI } from '../../../services/electronAPI';
import { pickDefaultBible } from '../../../../../electron/ipc/defaultBible';
import { DEFAULT_PANEL_ID, updatePanelState } from '../../helpers/panelStateHelpers';
import { useLayoutStore } from '../../useLayoutStore';
import {
  BibleState,
  BibleModule,
  BibleTab,
  BiblePanelState,
  BibleVerse,
  HistoryEntry,
  createDefaultPanelState,
  DEFAULT_DISPLAY_MODE,
} from '../types';

export interface SharedSlice {
  // === SHARED (global across all panels) ===
  availableBibles: BibleModule[];
  loadingBibles: boolean;
  initialLoadComplete: boolean;
  interlinearByModule: Map<string, boolean>;

  // === SHARED ACTIONS (no panelId) ===
  loadAvailableBibles: () => Promise<void>;
  /** Seed `panelId` (default: the first Bible panel) with the default passage. */
  loadInitialData: (panelId?: string) => Promise<void>;

  /**
   * The Bible to use when nothing more specific was asked for: `preferred` if
   * it is installed, else the translation the reader already has open in a
   * Bible panel, else KJV if installed, else the first installed Bible.
   *
   * Synchronous and safe to call from a selector. Until the installed list has
   * loaded it can only vouch for `preferred` or a translation already on
   * screen (which loaded, so it is installed), and answers `undefined`
   * otherwise - it never guesses a Bible by name. Where waiting for the list is
   * worth it, use `resolveDefaultBible`.
   */
  getDefaultBible: (preferred?: string | null) => string | undefined;

  /** `getDefaultBible`, after loading the installed list if that has not happened yet. */
  resolveDefaultBible: (preferred?: string | null) => Promise<string | undefined>;

  /**
   * Navigate the first Bible panel to a verse (convenience for commentary,
   * search, etc.).
   *
   * `endVerseId` selects a whole range, exactly as clicking `verseId` and then
   * shift-clicking `endVerseId` would. It has to be applied here rather than by
   * the caller because `navigateToVerse` clears `selectionEndVerseId` on its
   * way in, and this action does not otherwise tell the caller which panel it
   * chose - so there is no panel id for a caller to extend the selection on.
   */
  navigateToVerseInPrimary: (verseId: number, endVerseId?: number) => Promise<void>;

  /** Find a BibleTab across all panels by tabId */
  getTabFromAnyPanel: (tabId: string) => BibleTab | undefined;
}

export const createSharedSlice: StateCreator<BibleState, [], [], SharedSlice> = (set, get) => ({
  // === SHARED initial state ===
  availableBibles: [],
  loadingBibles: false,
  initialLoadComplete: false,
  interlinearByModule: new Map(),

  // Load list of available Bible modules
  loadAvailableBibles: async () => {
    set({ loadingBibles: true });
    try {
      const bibles = await bibleAPI.getAvailableBibles();
      set({ availableBibles: bibles, loadingBibles: false });
    } catch (error) {
      console.error('Error loading available Bibles:', error);
      set({ loadingBibles: false });
    }
  },

  // Batch load for faster startup - loads available Bibles AND default chapter in one IPC call
  loadInitialData: async (panelId?: string) => {
    const { initialLoadComplete } = get();
    // Use the caller's panel, else the first actual panel ID
    // (e.g. 'bible_default' from dockview) instead of '_default'.
    const targetPanelId = panelId ?? (get().panels.size > 0
      ? get().panels.keys().next().value ?? DEFAULT_PANEL_ID
      : DEFAULT_PANEL_ID);
    const ps = get().getPanelState(targetPanelId);

    // Skip if already loaded or if session restore has already opened tabs
    if (initialLoadComplete || ps.openTabs.length > 0) {
      return;
    }

    set({ loadingBibles: true });

    try {
      // On a fresh start nothing is known yet - this call is what loads the
      // installed list - so no Bible is named and the main process chooses
      // with the same rule. Naming one by habit asked for a module that may
      // not be installed.
      const data = await bibleAPI.getInitialData(get().getDefaultBible(), 43, 3);

      if (!data.defaultBible || data.defaultVerses.length === 0) {
        // No Bibles available, just update available list
        set({
          availableBibles: data.availableBibles,
          loadingBibles: false,
          initialLoadComplete: true
        });
        return;
      }

      // Create tab for the default Bible
      const tabId = `${data.defaultBible.abbreviation}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Calculate initial verse ID and create initial history entry
      const initialVerseId = VerseIdHelper.calculate(data.bookNumber, data.chapter, 16);
      const initialHistoryEntry: HistoryEntry = {
        verseId: initialVerseId,
        bookNumber: data.bookNumber,
        chapter: data.chapter,
        bookName: data.bookName
      };

      const newTab: BibleTab = {
        tabId,
        abbreviation: data.defaultBible.abbreviation,
        name: data.defaultBible.name,
        displayMode: DEFAULT_DISPLAY_MODE,
        moduleId: data.defaultBible.module_id,
        book: data.bookNumber,
        chapter: data.chapter,
        bookName: data.bookName,
        selectedVerseId: initialVerseId,
        history: [initialHistoryEntry],
        historyIndex: 0
      };

      // Set verses for this tab
      const versesMap = new Map<string, BibleVerse[]>();
      versesMap.set(tabId, data.defaultVerses);

      const loadingMap = new Map<string, boolean>();
      loadingMap.set(tabId, false);

      const errorMap = new Map<string, string | null>();
      errorMap.set(tabId, null);

      // Cache interlinear data availability from initial load
      const interlinearMap = new Map<string, boolean>();
      if (data.hasInterlinearData !== undefined) {
        interlinearMap.set(data.defaultBible.abbreviation, data.hasInterlinearData);
      }

      // Build the default panel state
      const panelState: BiblePanelState = {
        openTabs: [newTab],
        activeTabIndex: 0,
        isParallelViewMode: false,
        parallelVersions: [],
        currentBook: data.bookNumber,
        currentChapter: data.chapter,
        currentBookName: data.bookName,
        selectedVerseId: initialVerseId,
        selectionEndVerseId: null,
        previewVerseId: null,
        previewVerseEndId: null,
        backBarVerseId: null,
        scrollTrigger: 0,
        scrollMode: 'nearest',
        versesByTab: versesMap,
        loadingByTab: loadingMap,
        errorByTab: errorMap,
        studyOptionsByTab: new Map(),
        navigationHistory: [initialHistoryEntry],
        historyIndex: 0,
        maxHistorySize: 10,
        // One entry: the reader is here and has nowhere to go back to yet.
        visitStack: [{
          verseId: initialVerseId,
          bookNumber: data.bookNumber,
          chapter: data.chapter,
          bookName: data.bookName,
          abbreviation: data.defaultBible.abbreviation,
        }]
      };

      // Update state with everything at once
      set({
        availableBibles: data.availableBibles,
        loadingBibles: false,
        initialLoadComplete: true,
        interlinearByModule: interlinearMap,
        panels: updatePanelState(get().panels, targetPanelId, panelState, createDefaultPanelState)
      });

    } catch (error) {
      console.error('[useBibleStore] Error loading initial data:', error);
      set({ loadingBibles: false, initialLoadComplete: true });
    }
  },

  getDefaultBible: (preferred?: string | null) => {
    const { availableBibles, panels } = get();

    // The reader's last-used translation: whatever the first Bible panel with
    // a passage is showing.
    let onScreen: string | undefined;
    for (const ps of panels.values()) {
      onScreen = ps.openTabs[ps.activeTabIndex]?.abbreviation;
      if (onScreen) break;
    }

    if (availableBibles.length === 0) {
      return preferred ?? onScreen;
    }

    const isInstalled = (abbreviation: string | null | undefined): boolean =>
      !!abbreviation && availableBibles.some(b => b.abbreviation.toLowerCase() === abbreviation.toLowerCase());
    return pickDefaultBible(
      availableBibles,
      isInstalled(preferred) ? preferred : onScreen,
    );
  },

  resolveDefaultBible: async (preferred?: string | null) => {
    if (get().availableBibles.length === 0) {
      await get().loadAvailableBibles();
    }
    return get().getDefaultBible(preferred);
  },

  // Navigate the Bible panel the user is actually looking at to a verse
  // (convenience for commentary, search, etc.)
  navigateToVerseInPrimary: async (verseId: number, endVerseId?: number) => {
    const { panels } = get();

    // Prefer the Bible panel the user most recently had focus in. This is
    // deliberately "last active Bible panel" rather than "currently active
    // dockview panel": focus is often somewhere dockview doesn't track at all
    // (the search bar lives outside the dockview tree) or in a non-Bible pane
    // (commentary, notes) when a search result is picked - in both cases the
    // Bible pane the user was last actually reading is the sensible target,
    // not whichever pane happens to be focused right now. Only fall back to
    // the old "DEFAULT_PANEL_ID, else first Map key" behavior when no Bible
    // panel has ever been focused (e.g. session just restored, user never
    // clicked into the Bible pane).
    const layoutState = useLayoutStore.getState(); // allow-getstate: store action - reads latest layout focus tracking, not a render
    const lastActiveBibleId = layoutState.lastActiveBiblePanelId;

    let targetPanelId: string;
    if (lastActiveBibleId && panels.has(lastActiveBibleId)) {
      targetPanelId = lastActiveBibleId;
    } else if (panels.has(DEFAULT_PANEL_ID)) {
      targetPanelId = DEFAULT_PANEL_ID;
    } else {
      const firstKey = panels.keys().next().value;
      if (firstKey) {
        targetPanelId = firstKey;
      } else {
        // No Bible pane exists - auto-create one
        const newPanelId = useLayoutStore.getState().addPanel('bible'); // allow-getstate: store action - imperative panel creation, not a render
        if (newPanelId) {
          // Wait a tick for the panel to mount and initialize its store state
          await new Promise(resolve => setTimeout(resolve, 50));
          targetPanelId = newPanelId;
        } else {
          targetPanelId = DEFAULT_PANEL_ID;
        }
      }
    }
    await get().navigateToVerse(targetPanelId, verseId);
    // After the navigation, which resets the selection to the single anchor.
    if (endVerseId !== undefined && endVerseId !== verseId) {
      get().extendSelectionTo(targetPanelId, endVerseId);
    }
  },

  // Find a BibleTab across all panels by tabId
  getTabFromAnyPanel: (tabId: string) => {
    const { panels } = get();
    for (const ps of panels.values()) {
      const tab = ps.openTabs.find(t => t.tabId === tabId);
      if (tab) return tab;
    }
    return undefined;
  },
});
