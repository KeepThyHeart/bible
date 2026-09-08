import type { StateCreator } from 'zustand';
import { commentaryAPI } from '../../../services/electronAPI';
import { DEFAULT_VERSE_ID } from '../../../constants';
import { updatePanelState } from '../../helpers/panelStateHelpers';
import { useToastStore } from '../../useToastStore';
import { CommentaryState, CommentaryEntry, createDefaultPanelState } from '../types';

export interface SessionSlice {
  restoreFromSession: (panelId: string, sessionData: {
    openTabs?: Array<{ abbreviation: string; name: string }>;
    activeTabIndex?: number;
    currentVerseId?: number | null;
    browseModeByTab?: Record<string, boolean>;
  }) => Promise<void>;
  preloadBackgroundTabs: (panelId: string) => void;

  // Initialize from state (for detached windows)
  initializeFromState: (panelId: string, state: {
    openTabs: Array<{ abbreviation: string; name: string }>;
    activeTabIndex: number;
    currentVerseId: number | null;
    entriesByTab: Map<string, CommentaryEntry[]>;
    browseModeByTab: Map<string, boolean>;
  }) => void;
}

export const createSessionSlice: StateCreator<CommentaryState, [], [], SessionSlice> = (set, get) => ({
  restoreFromSession: async (panelId: string, sessionData: {
    openTabs?: Array<{ abbreviation: string; name: string }>;
    activeTabIndex?: number;
    currentVerseId?: number | null;
    browseModeByTab?: Record<string, boolean>;
  }) => {
    if (!sessionData.openTabs || sessionData.openTabs.length === 0) {
      return;
    }

    set({ panels: updatePanelState(get().panels, panelId, { isRestoringSession: true }, createDefaultPanelState) });

    try {
      const verseIdToUse = sessionData.currentVerseId ?? DEFAULT_VERSE_ID;
      const activeTabIndex = sessionData.activeTabIndex ?? 0;

      const browseModeMap = new Map<string, boolean>();
      if (sessionData.browseModeByTab) {
        Object.entries(sessionData.browseModeByTab).forEach(([abbr, browseMode]) => {
          browseModeMap.set(abbr, browseMode);
        });
      }

      set({
        panels: updatePanelState(get().panels, panelId, {
          openTabs: sessionData.openTabs,
          activeTabIndex,
          currentVerseId: verseIdToUse,
          browseModeByTab: browseModeMap,
          // Seeded true for every restored tab in the SAME update that
          // publishes openTabs, so loadingByTab.get(abbreviation) is never
          // ambiguous with "no commentary for this verse" while
          // batchRestoreSession (below) is still in flight. Without this,
          // openTabs.length was already > 0 but isLoading read false (no map
          // entry yet), and CommentaryContentArea fell through straight to
          // its "no commentary" empty state. Cleared to false per-tab once
          // batchRestoreSession resolves (below) or on failure (catch).
          loadingByTab: new Map(sessionData.openTabs.map(t => [t.abbreviation, true])),
        }, createDefaultPanelState)
      });

      // Phase 1: Batch load with ONLY the active tab's abbreviation
      const activeTab = sessionData.openTabs[activeTabIndex];
      const activeAbbreviations = activeTab ? [activeTab.abbreviation] : [];
      const activeBrowseMode: Record<string, boolean> = {};
      if (activeTab && sessionData.browseModeByTab?.[activeTab.abbreviation]) {
        activeBrowseMode[activeTab.abbreviation] = sessionData.browseModeByTab[activeTab.abbreviation];
      }

      const result = await commentaryAPI.batchRestoreSession({
        abbreviations: activeAbbreviations,
        verseId: verseIdToUse,
        browseModeByTab: activeBrowseMode
      });

      // Apply available commentaries (shared)
      set({ availableCommentaries: result.availableCommentaries, loadingCommentaries: false });

      // Apply entries and summaries for the active tab (per-panel)
      const ps = get().getPanelState(panelId);
      const newEntriesMap = new Map(ps.entriesByTab);
      const newLoadingMap = new Map(ps.loadingByTab);
      const newSummariesMap = new Map(ps.entrySummariesByTab);
      const newLoadingSummariesMap = new Map(ps.loadingSummariesByTab);

      for (const abbreviation of activeAbbreviations) {
        if (result.entriesByTab[abbreviation]) {
          newEntriesMap.set(abbreviation, result.entriesByTab[abbreviation]);
        }
        newLoadingMap.set(abbreviation, false);
        if (result.summariesByTab[abbreviation]) {
          newSummariesMap.set(abbreviation, result.summariesByTab[abbreviation]);
        }
        newLoadingSummariesMap.set(abbreviation, false);
      }

      set({
        panels: updatePanelState(get().panels, panelId, {
          entriesByTab: newEntriesMap,
          loadingByTab: newLoadingMap,
          entrySummariesByTab: newSummariesMap,
          loadingSummariesByTab: newLoadingSummariesMap
        }, createDefaultPanelState)
      });

    } catch (error) {
      // loadingByTab was seeded true above; clear it so a genuine restore
      // failure (e.g. batchRestoreSession rejecting) doesn't leave the pane
      // stuck showing the loading skeleton forever instead of a real (if
      // empty/errored) state.
      console.error(`[useCommentaryStore] Error restoring panel ${panelId} from session:`, error);
      const clearedLoadingMap = new Map(get().getPanelState(panelId).loadingByTab);
      for (const openTab of sessionData.openTabs) {
        clearedLoadingMap.set(openTab.abbreviation, false);
      }
      set({ panels: updatePanelState(get().panels, panelId, { loadingByTab: clearedLoadingMap }, createDefaultPanelState) });
      throw error;
    } finally {
      set({ panels: updatePanelState(get().panels, panelId, { isRestoringSession: false }, createDefaultPanelState) });
    }
  },

  preloadBackgroundTabs: (panelId: string) => {
    const ps = get().getPanelState(panelId);
    if (ps.openTabs.length <= 1 || !ps.currentVerseId) return;

    const backgroundTabs = ps.openTabs.filter((_, i) => i !== ps.activeTabIndex);
    if (backgroundTabs.length === 0) return;

    const backgroundAbbreviations = backgroundTabs.map(t => t.abbreviation);
    const bgBrowseMode: Record<string, boolean> = {};
    for (const tab of backgroundTabs) {
      const mode = ps.browseModeByTab.get(tab.abbreviation);
      if (mode !== undefined) {
        bgBrowseMode[tab.abbreviation] = mode;
      }
    }

    commentaryAPI.batchRestoreSession({
      abbreviations: backgroundAbbreviations,
      verseId: ps.currentVerseId,
      browseModeByTab: bgBrowseMode
    }).then(result => {
      const ps2 = get().getPanelState(panelId);
      const newEntriesMap = new Map(ps2.entriesByTab);
      const newLoadingMap = new Map(ps2.loadingByTab);
      const newSummariesMap = new Map(ps2.entrySummariesByTab);
      const newLoadingSummariesMap = new Map(ps2.loadingSummariesByTab);

      for (const abbreviation of backgroundAbbreviations) {
        if (result.entriesByTab[abbreviation]) {
          newEntriesMap.set(abbreviation, result.entriesByTab[abbreviation]);
        }
        newLoadingMap.set(abbreviation, false);
        if (result.summariesByTab[abbreviation]) {
          newSummariesMap.set(abbreviation, result.summariesByTab[abbreviation]);
        }
        newLoadingSummariesMap.set(abbreviation, false);
      }

      set({
        panels: updatePanelState(get().panels, panelId, {
          entriesByTab: newEntriesMap,
          loadingByTab: newLoadingMap,
          entrySummariesByTab: newSummariesMap,
          loadingSummariesByTab: newLoadingSummariesMap
        }, createDefaultPanelState)
      });

    }).catch(error => {
      console.error(`[useCommentaryStore] Phase 2 error for panel ${panelId}:`, error);

      // Clear loading indicators for failed background tabs so the UI
      // doesn't show spinners indefinitely.
      const ps3 = get().getPanelState(panelId);
      const failedLoadingMap = new Map(ps3.loadingByTab);
      const failedSummariesMap = new Map(ps3.loadingSummariesByTab);
      for (const abbreviation of backgroundAbbreviations) {
        failedLoadingMap.set(abbreviation, false);
        failedSummariesMap.set(abbreviation, false);
      }
      set({
        panels: updatePanelState(get().panels, panelId, {
          loadingByTab: failedLoadingMap,
          loadingSummariesByTab: failedSummariesMap
        }, createDefaultPanelState)
      });

      // Notify user via toast so the failure is not completely silent
      useToastStore.getState().addToast(
        'Failed to preload background commentary tabs. Switch to a tab to retry.',
        'warning'
      );
    });
  },

  initializeFromState: (panelId: string, state) => {
    set({
      panels: updatePanelState(get().panels, panelId, {
        openTabs: state.openTabs,
        activeTabIndex: state.activeTabIndex,
        currentVerseId: state.currentVerseId,
        entriesByTab: state.entriesByTab,
        browseModeByTab: state.browseModeByTab
      }, createDefaultPanelState)
    });
  },
});
