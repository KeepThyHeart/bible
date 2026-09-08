import type { StateCreator } from 'zustand';
import { commentaryAPI } from '../../../services/electronAPI';
import { updatePanelState } from '../../helpers/panelStateHelpers';
import { markSessionDirty } from '../../helpers/sessionNotifier';
import { navigateToVerseInPrimary } from '../../crossStoreBridge';
import { CommentaryState, createDefaultPanelState } from '../types';
import { getCommentaryController } from '../internals/coordinationControllers';

export interface NavigationSlice {
  syncWithBibleVerse: (panelId: string, verseId: number) => Promise<void>;
  togglePin: (panelId: string) => void;
  unpin: (panelId: string) => void;
  navigateToNextVerse: (panelId: string, abbreviation: string) => Promise<void>;
  navigateToPreviousVerse: (panelId: string, abbreviation: string) => Promise<void>;
  navigateToVerse: (panelId: string, abbreviation: string, verseId: number) => Promise<void>;
}

export const createNavigationSlice: StateCreator<CommentaryState, [], [], NavigationSlice> = (set, get) => ({
  syncWithBibleVerse: async (panelId: string, verseId: number) => {
    const ctrl = getCommentaryController(panelId);

    // Sync controller pin state from panel state (handles session restore or
    // direct setState where the controller is not in sync).
    const psBefore = get().getPanelState(panelId);
    if (psBefore.pinned && !ctrl.isPinned()) {
      if (psBefore.pinnedVerseId !== null) ctrl.syncToVerse(psBefore.pinnedVerseId);
      ctrl.pin();
    } else if (!psBefore.pinned && ctrl.isPinned()) {
      ctrl.unpin();
    }

    const effectiveVerseId = ctrl.syncToVerse(verseId);

    // Track where the Bible pane actually is, independent of whether the
    // commentary content itself follows - this is what the pinned banner
    // compares against `pinnedVerseId`, since `currentVerseId` freezes below
    // when pinned.
    set({ panels: updatePanelState(get().panels, panelId, { liveBibleVerseId: verseId }, createDefaultPanelState) });

    if (ctrl.isPinned()) return;

    set({ panels: updatePanelState(get().panels, panelId, { currentVerseId: effectiveVerseId }, createDefaultPanelState) });
    markSessionDirty();

    const ps = get().getPanelState(panelId);
    const tabsToSync = ps.openTabs.filter(tab => !ps.browseModeByTab.get(tab.abbreviation));
    const promises: Promise<void>[] = tabsToSync.map(tab =>
      get().loadCommentaryForVerse(panelId, tab.abbreviation, verseId)
    );
    promises.push(get().loadHomeData(panelId, verseId));

    await Promise.all(promises);
  },

  togglePin: (panelId: string) => {
    const ctrl = getCommentaryController(panelId);
    const ps = get().getPanelState(panelId);

    // Sync the controller's current verse from panel state so pinning
    // captures the correct verse even when state was restored from session
    // or set externally. Guard against pinning when there's no verse.
    if (!ctrl.isPinned() && ps.currentVerseId !== null) {
      ctrl.syncToVerse(ps.currentVerseId);
    }
    if (!ctrl.isPinned() && ps.currentVerseId === null) {
      // Nothing to pin to - no-op
      return;
    }

    ctrl.togglePin();
    set({ panels: updatePanelState(get().panels, panelId, { pinned: ctrl.isPinned(), pinnedVerseId: ctrl.isPinned() ? ctrl.getEffectiveVerseId() : null }, createDefaultPanelState) });
    markSessionDirty();
  },

  unpin: (panelId: string) => {
    const ctrl = getCommentaryController(panelId);
    ctrl.unpin();
    set({ panels: updatePanelState(get().panels, panelId, { pinned: false, pinnedVerseId: null }, createDefaultPanelState) });
    markSessionDirty();
  },

  navigateToNextVerse: async (panelId: string, abbreviation: string) => {
    const ps = get().getPanelState(panelId);
    if (!ps.currentVerseId) return;

    try {
      const nextVerseId = await commentaryAPI.getNextVerseWithContent(abbreviation, ps.currentVerseId);
      if (nextVerseId) {
        await get().navigateToVerse(panelId, abbreviation, nextVerseId);
      }
    } catch (error) {
      console.error(`Error navigating to next verse for ${abbreviation}:`, error);
    }
  },

  navigateToPreviousVerse: async (panelId: string, abbreviation: string) => {
    const ps = get().getPanelState(panelId);
    if (!ps.currentVerseId) return;

    try {
      const prevVerseId = await commentaryAPI.getPreviousVerseWithContent(abbreviation, ps.currentVerseId);
      if (prevVerseId) {
        await get().navigateToVerse(panelId, abbreviation, prevVerseId);
      }
    } catch (error) {
      console.error(`Error navigating to previous verse for ${abbreviation}:`, error);
    }
  },

  navigateToVerse: async (panelId: string, abbreviation: string, verseId: number) => {
    set({ panels: updatePanelState(get().panels, panelId, { currentVerseId: verseId, pinned: false, pinnedVerseId: null }, createDefaultPanelState) });
    markSessionDirty();
    // Also navigate the Bible pane to this verse (via cross-store bridge).
    navigateToVerseInPrimary(verseId);
    await get().loadCommentaryForVerse(panelId, abbreviation, verseId);
  },
});
