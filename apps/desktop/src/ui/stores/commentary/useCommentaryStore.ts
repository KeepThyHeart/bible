import { create } from 'zustand';
import { DEFAULT_PANEL_ID } from '../helpers/panelStateHelpers';
import { createPanelSlice } from '../helpers/createPanelSlice';
import { registerSessionSerializer } from '../helpers/sessionRegistry';

import { CommentaryState, createDefaultPanelState } from './types';
import { commentaryControllers } from './internals/coordinationControllers';
import { createSharedSlice } from './slices/sharedSlice';
import { createTabSlice } from './slices/tabSlice';
import { createContentSlice } from './slices/contentSlice';
import { createNavigationSlice } from './slices/navigationSlice';
import { createSessionSlice } from './slices/sessionSlice';

const commentaryPanelSlice = createPanelSlice(createDefaultPanelState, (panelId) => {
  commentaryControllers.delete(panelId);
});

export const useCommentaryStore = create<CommentaryState>((set, get, store) => ({
  // === PER-INSTANCE initial state ===
  panels: new Map(),

  // === PANEL LIFECYCLE ===
  ...commentaryPanelSlice(set as any, get as any),

  // === SLICES ===
  ...createSharedSlice(set, get, store),
  ...createTabSlice(set, get, store),
  ...createContentSlice(set, get, store),
  ...createNavigationSlice(set, get, store),
  ...createSessionSlice(set, get, store),
}));

// Register session serializer so useSessionStore doesn't import us directly
registerSessionSerializer('commentary', () => {
  const commentaryState = useCommentaryStore.getState();
  const firstPanel = commentaryState.panels.values().next().value;
  const browseModeByTab: Record<string, boolean> = {};
  if (firstPanel?.browseModeByTab) {
    firstPanel.browseModeByTab.forEach((value: boolean, key: string) => {
      browseModeByTab[key] = value;
    });
  }
  return {
    openTabs: firstPanel?.openTabs || [],
    activeTabIndex: firstPanel?.activeTabIndex ?? 0,
    currentVerseId: firstPanel?.currentVerseId ?? null,
    browseModeByTab
  };
});

export { DEFAULT_PANEL_ID };
