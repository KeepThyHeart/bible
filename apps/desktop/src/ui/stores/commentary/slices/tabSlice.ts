import type { StateCreator } from 'zustand';
import { updatePanelState } from '../../helpers/panelStateHelpers';
import { markSessionDirty } from '../../helpers/sessionNotifier';
import { resolvePrimaryBibleVerseId } from '../../crossStoreBridge';
import { CommentaryState, createDefaultPanelState } from '../types';

/** Options for {@link TabSlice.openCommentary}. */
export interface OpenCommentaryOptions {
  /**
   * Bring the tab forward, and tell the pane to stop showing Overview.
   * Default `true` - opening a commentary is nearly always a request to read
   * it.
   *
   * `false` is for *populating* a pane: `AppInitService` puts a default
   * commentary in the pane on first launch so one is a click away, and that
   * must not decide what the reader is looking at.
   */
  activate?: boolean;
}

export interface TabSlice {
  openCommentary: (panelId: string, abbreviation: string, name: string, options?: OpenCommentaryOptions) => void;
  closeCommentary: (panelId: string, abbreviation: string) => void;
  setActiveTab: (panelId: string, index: number) => void;
  reorderTabs: (panelId: string, sourceIndex: number, destinationIndex: number) => void;
  clearError: (panelId: string, abbreviation: string) => void;
  toggleBrowseMode: (panelId: string, abbreviation: string) => void;
}

export const createTabSlice: StateCreator<CommentaryState, [], [], TabSlice> = (set, get) => ({
  openCommentary: (panelId: string, abbreviation: string, name: string, options?: OpenCommentaryOptions) => {
    const ps = get().getPanelState(panelId);
    const activate = options?.activate ?? true;

    const existingIndex = ps.openTabs.findIndex(tab => tab.abbreviation === abbreviation);
    if (existingIndex !== -1) {
      if (activate) {
        set({ panels: updatePanelState(get().panels, panelId, {
          activeTabIndex: existingIndex,
          tabActivationSeq: ps.tabActivationSeq + 1,
        }, createDefaultPanelState) });
        markSessionDirty();
      }
      return;
    }

    const newTabs = [...ps.openTabs, { abbreviation, name }];
    // Without `activate` the tab is appended and nothing else moves: the pane
    // keeps whatever it was showing, and `activeTabIndex` keeps pointing where
    // it did.
    set({ panels: updatePanelState(get().panels, panelId, activate
      ? { openTabs: newTabs, activeTabIndex: newTabs.length - 1, tabActivationSeq: ps.tabActivationSeq + 1 }
      : { openTabs: newTabs },
      createDefaultPanelState) });
    markSessionDirty();

    // Load commentary for current verse; if not set yet, ask the cross-store
    // bridge for a fallback verse from the Bible pane.
    let verseId = ps.currentVerseId;
    if (!verseId) {
      const fallback = resolvePrimaryBibleVerseId();
      if (fallback !== null) {
        verseId = fallback;
        // Also update the commentary panel's currentVerseId
        set({ panels: updatePanelState(get().panels, panelId, { currentVerseId: verseId }, createDefaultPanelState) });
      }
    }
    if (verseId) {
      get().loadCommentaryForVerse(panelId, abbreviation, verseId);
    }
  },

  closeCommentary: (panelId: string, abbreviation: string) => {
    const ps = get().getPanelState(panelId);
    const tabIndex = ps.openTabs.findIndex(tab => tab.abbreviation === abbreviation);
    if (tabIndex === -1) return;

    const newTabs = ps.openTabs.filter(tab => tab.abbreviation !== abbreviation);

    let newActiveIndex = ps.activeTabIndex;
    if (tabIndex === ps.activeTabIndex && newTabs.length > 0) {
      newActiveIndex = Math.max(0, tabIndex - 1);
    } else if (tabIndex < ps.activeTabIndex) {
      newActiveIndex = ps.activeTabIndex - 1;
    } else if (newTabs.length === 0) {
      newActiveIndex = 0;
    }

    const newEntriesMap = new Map(ps.entriesByTab);
    const newLoadingMap = new Map(ps.loadingByTab);
    const newErrorMap = new Map(ps.errorByTab);
    const newBrowseModeMap = new Map(ps.browseModeByTab);
    const newSummariesMap = new Map(ps.entrySummariesByTab);
    const newLoadingSummariesMap = new Map(ps.loadingSummariesByTab);
    newEntriesMap.delete(abbreviation);
    newLoadingMap.delete(abbreviation);
    newErrorMap.delete(abbreviation);
    newBrowseModeMap.delete(abbreviation);
    newSummariesMap.delete(abbreviation);
    newLoadingSummariesMap.delete(abbreviation);

    set({
      panels: updatePanelState(get().panels, panelId, {
        openTabs: newTabs,
        activeTabIndex: newActiveIndex,
        entriesByTab: newEntriesMap,
        loadingByTab: newLoadingMap,
        errorByTab: newErrorMap,
        browseModeByTab: newBrowseModeMap,
        entrySummariesByTab: newSummariesMap,
        loadingSummariesByTab: newLoadingSummariesMap
      }, createDefaultPanelState)
    });
    markSessionDirty();
  },

  setActiveTab: (panelId: string, index: number) => {
    const ps = get().getPanelState(panelId);
    if (index >= 0 && index < ps.openTabs.length) {
      // Always a deliberate choice of tab, so it counts as an activation.
      set({ panels: updatePanelState(get().panels, panelId, {
        activeTabIndex: index,
        tabActivationSeq: ps.tabActivationSeq + 1,
      }, createDefaultPanelState) });
      markSessionDirty();
    }
  },

  reorderTabs: (panelId: string, sourceIndex: number, destinationIndex: number) => {
    const ps = get().getPanelState(panelId);
    if (sourceIndex < 0 || sourceIndex >= ps.openTabs.length ||
        destinationIndex < 0 || destinationIndex >= ps.openTabs.length) {
      return;
    }

    const newTabs = Array.from(ps.openTabs);
    const [movedTab] = newTabs.splice(sourceIndex, 1);
    newTabs.splice(destinationIndex, 0, movedTab);

    let newActiveIndex = ps.activeTabIndex;
    if (ps.activeTabIndex === sourceIndex) {
      newActiveIndex = destinationIndex;
    } else if (sourceIndex < ps.activeTabIndex && destinationIndex >= ps.activeTabIndex) {
      newActiveIndex = ps.activeTabIndex - 1;
    } else if (sourceIndex > ps.activeTabIndex && destinationIndex <= ps.activeTabIndex) {
      newActiveIndex = ps.activeTabIndex + 1;
    }

    set({ panels: updatePanelState(get().panels, panelId, { openTabs: newTabs, activeTabIndex: newActiveIndex }, createDefaultPanelState) });
    markSessionDirty();
  },

  clearError: (panelId: string, abbreviation: string) => {
    const ps = get().getPanelState(panelId);
    const newErrorMap = new Map(ps.errorByTab);
    newErrorMap.set(abbreviation, null);
    set({ panels: updatePanelState(get().panels, panelId, { errorByTab: newErrorMap }, createDefaultPanelState) });
  },

  toggleBrowseMode: (panelId: string, abbreviation: string) => {
    const ps = get().getPanelState(panelId);
    const newMap = new Map(ps.browseModeByTab);
    const currentMode = newMap.get(abbreviation) || false;
    newMap.set(abbreviation, !currentMode);
    set({ panels: updatePanelState(get().panels, panelId, { browseModeByTab: newMap }, createDefaultPanelState) });
    markSessionDirty();
  },
});
