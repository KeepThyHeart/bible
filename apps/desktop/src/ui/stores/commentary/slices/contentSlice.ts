import type { StateCreator } from 'zustand';
import { commentaryAPI } from '../../../services/electronAPI';
import { logModuleErrorOnce, isModuleUnavailableError, resetModuleErrorLog } from '../../../services/moduleErrorLog';
import { updatePanelState } from '../../helpers/panelStateHelpers';
import { CommentaryState, CommentaryEntry, CommentaryHomeModuleData, createDefaultPanelState } from '../types';

export interface ContentSlice {
  loadCommentaryForVerse: (panelId: string, abbreviation: string, verseId: number) => Promise<void>;
  loadHomeData: (panelId: string, verseId: number) => Promise<void>;
  loadEntrySummaries: (panelId: string, abbreviation: string) => Promise<void>;
  /** User pressed Retry: forget the unavailable / failed flags for the tab so the next load hits IPC once. */
  clearTabUnavailable: (panelId: string, abbreviation: string) => void;
}

export const createContentSlice: StateCreator<CommentaryState, [], [], ContentSlice> = (set, get) => ({
  clearTabUnavailable: (panelId: string, abbreviation: string) => {
    const ps = get().getPanelState(panelId);
    const unavailable = new Map(ps.unavailableByTab);
    const failed = new Map(ps.summariesFailedByTab);
    unavailable.delete(abbreviation);
    failed.delete(abbreviation);
    resetModuleErrorLog('commentary', abbreviation);
    set({ panels: updatePanelState(get().panels, panelId, { unavailableByTab: unavailable, summariesFailedByTab: failed }, createDefaultPanelState) });
  },

  loadCommentaryForVerse: async (panelId: string, abbreviation: string, verseId: number) => {
    // A tab whose module file is missing stays missing until Retry / reinstall:
    // no IPC, no loading flicker, no log.
    if (get().getPanelState(panelId).unavailableByTab.has(abbreviation)) return;

    // Set loading
    {
      const ps = get().getPanelState(panelId);
      const newLoadingMap = new Map(ps.loadingByTab);
      newLoadingMap.set(abbreviation, true);
      const newErrorMap = new Map(ps.errorByTab);
      newErrorMap.set(abbreviation, null);
      set({ panels: updatePanelState(get().panels, panelId, { loadingByTab: newLoadingMap, errorByTab: newErrorMap }, createDefaultPanelState) });
    }

    try {
      const entries = await commentaryAPI.getEntriesForVerse(abbreviation, verseId);

      const ps = get().getPanelState(panelId);
      const newEntriesMap = new Map(ps.entriesByTab);
      newEntriesMap.set(abbreviation, entries);
      const finalLoadingMap = new Map(ps.loadingByTab);
      finalLoadingMap.set(abbreviation, false);

      set({ panels: updatePanelState(get().panels, panelId, { entriesByTab: newEntriesMap, loadingByTab: finalLoadingMap }, createDefaultPanelState) });
    } catch (error) {
      const ps = get().getPanelState(panelId);
      const finalLoadingMap = new Map(ps.loadingByTab);
      finalLoadingMap.set(abbreviation, false);
      const finalErrorMap = new Map(ps.errorByTab);
      if (isModuleUnavailableError(error)) {
        logModuleErrorOnce('commentary', abbreviation, `verse ${verseId}`, error);
        finalErrorMap.set(abbreviation, null);
        const unavailable = new Map(ps.unavailableByTab);
        unavailable.set(abbreviation, error.code as 'module_missing' | 'not_found');
        set({ panels: updatePanelState(get().panels, panelId, { loadingByTab: finalLoadingMap, errorByTab: finalErrorMap, unavailableByTab: unavailable }, createDefaultPanelState) });
        return;
      }
      console.error(`[CommentaryStore] Error loading ${abbreviation} verse ${verseId}:`, error);
      finalErrorMap.set(abbreviation, error instanceof Error ? error.message : 'Failed to load commentary');

      set({ panels: updatePanelState(get().panels, panelId, { loadingByTab: finalLoadingMap, errorByTab: finalErrorMap }, createDefaultPanelState) });
    }
  },

  loadHomeData: async (panelId: string, verseId: number) => {
    const ps = get().getPanelState(panelId);
    const { availableCommentaries } = get();

    if (ps.homeDataVerseId === verseId && ps.homeData.length > 0) return;

    set({ panels: updatePanelState(get().panels, panelId, { homeLoading: true }, createDefaultPanelState) });
    try {
      const results = await Promise.allSettled(
        availableCommentaries.map(async (mod) => {
          const entries = await commentaryAPI.getEntriesForVerse(mod.abbreviation, verseId);
          const totalWordCount = entries.reduce((sum: number, e: CommentaryEntry) => sum + (e.word_count || 0), 0);
          return { abbreviation: mod.abbreviation, name: mod.name, entries, totalWordCount } as CommentaryHomeModuleData;
        })
      );

      const homeData = results
        .filter((r): r is PromiseFulfilledResult<CommentaryHomeModuleData> => r.status === 'fulfilled')
        .map(r => r.value)
        .filter(d => d.entries.length > 0)
        .sort((a, b) => b.totalWordCount - a.totalWordCount);

      set({ panels: updatePanelState(get().panels, panelId, { homeData, homeLoading: false, homeDataVerseId: verseId }, createDefaultPanelState) });
    } catch (error) {
      console.error('[CommentaryStore] Error loading home data:', error);
      set({ panels: updatePanelState(get().panels, panelId, { homeLoading: false }, createDefaultPanelState) });
    }
  },

  loadEntrySummaries: async (panelId: string, abbreviation: string) => {
    const ps = get().getPanelState(panelId);
    // Unavailable tab, a failed fetch awaiting Retry, or one already in flight:
    // no IPC. (CommentaryPane's effect re-fires whenever loadingSummaries flips,
    // so a failure must be remembered or it becomes a tight retry loop.)
    if (ps.unavailableByTab.has(abbreviation) || ps.summariesFailedByTab.get(abbreviation) || ps.loadingSummariesByTab.get(abbreviation)) return;
    const newLoadingMap = new Map(ps.loadingSummariesByTab);
    newLoadingMap.set(abbreviation, true);
    set({ panels: updatePanelState(get().panels, panelId, { loadingSummariesByTab: newLoadingMap }, createDefaultPanelState) });

    try {
      const summaries = await commentaryAPI.getAllEntrySummaries(abbreviation);

      const ps2 = get().getPanelState(panelId);
      const newSummariesMap = new Map(ps2.entrySummariesByTab);
      newSummariesMap.set(abbreviation, summaries);
      const finalLoadingMap = new Map(ps2.loadingSummariesByTab);
      finalLoadingMap.set(abbreviation, false);

      set({
        panels: updatePanelState(get().panels, panelId, {
          entrySummariesByTab: newSummariesMap,
          loadingSummariesByTab: finalLoadingMap
        }, createDefaultPanelState)
      });
    } catch (error) {
      const ps2 = get().getPanelState(panelId);
      const finalLoadingMap = new Map(ps2.loadingSummariesByTab);
      finalLoadingMap.set(abbreviation, false);
      const patch: Partial<typeof ps2> = { loadingSummariesByTab: finalLoadingMap };
      if (isModuleUnavailableError(error)) {
        logModuleErrorOnce('commentary', abbreviation, 'entry summaries', error);
        const unavailable = new Map(ps2.unavailableByTab);
        unavailable.set(abbreviation, error.code as 'module_missing' | 'not_found');
        patch.unavailableByTab = unavailable;
      } else {
        console.error(`Error loading entry summaries for ${abbreviation}:`, error);
        const failed = new Map(ps2.summariesFailedByTab);
        failed.set(abbreviation, true);
        patch.summariesFailedByTab = failed;
      }
      set({ panels: updatePanelState(get().panels, panelId, patch, createDefaultPanelState) });
    }
  },
});
