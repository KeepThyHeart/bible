import { create } from 'zustand';
import { createPanelSlice } from '../helpers/createPanelSlice';
import { DEFAULT_PANEL_ID } from '../helpers/panelStateHelpers';
import { whenContextService } from '../../services/WhenContextService';
import { registerSessionSerializer } from '../helpers/sessionRegistry';

import {
  BIBLE_SESSION_VERSION,
  BiblePanelSession,
  BiblePanelState,
  BibleSessionData,
  BibleState,
  createDefaultPanelState,
} from './types';
import { createSharedSlice } from './slices/sharedSlice';
import { createTabSlice } from './slices/tabSlice';
import { createTabOptionsSlice } from './slices/tabOptionsSlice';
import { createPassageSlice } from './slices/passageSlice';
import { createVerseSlice } from './slices/verseSlice';
import { createNavigationSlice } from './slices/navigationSlice';
import { createPreviewSlice } from './slices/previewSlice';
import { createSessionSlice } from './slices/sessionSlice';

// Navigation history lives entirely in the Zustand panel state
// (`navigationHistory` / `historyIndex`), so panel teardown is handled by the
// default lifecycle - no side-channel cleanup required.
const biblePanelSlice = createPanelSlice(createDefaultPanelState);

export const useBibleStore = create<BibleState>((set, get, store) => ({
  // === PER-INSTANCE initial state ===
  panels: new Map(),

  // === PANEL LIFECYCLE ===
  ...biblePanelSlice(set as any, get as any),

  // === SLICES ===
  ...createSharedSlice(set, get, store),
  ...createTabSlice(set, get, store),
  ...createTabOptionsSlice(set, get, store),
  ...createPassageSlice(set, get, store),
  ...createVerseSlice(set, get, store),
  ...createNavigationSlice(set, get, store),
  ...createPreviewSlice(set, get, store),
  ...createSessionSlice(set, get, store),
}));

// Publish Bible-related state into WhenContextService for command `when`-clause evaluation.
// Watches the whole store and derives: verseSelected, selectedVerseId,
// bible.parallelView, bible.interlinearOpen. Since state is per-panel, we use the
// default panel when present, otherwise the first panel in the map.
function publishBibleWhenContext(state: BibleState): void {
  const panels = state.panels;
  let ps: BiblePanelState | undefined = panels.get(DEFAULT_PANEL_ID);
  if (!ps) {
    const firstKey = panels.keys().next().value;
    if (firstKey) ps = panels.get(firstKey);
  }

  const selectedVerseId: number | null = ps?.selectedVerseId ?? null;
  whenContextService.set('verseSelected', selectedVerseId !== null);
  whenContextService.set('selectedVerseId', selectedVerseId);
  whenContextService.set('bible.parallelView', ps?.isParallelViewMode === true);

  // Interlinear is open if any open tab in any panel has showInterlinear set in study options.
  let interlinearOpen = false;
  for (const panelState of panels.values()) {
    for (const tab of panelState.openTabs) {
      const opts = panelState.studyOptionsByTab.get(tab.tabId);
      if (opts?.showInterlinear === true) {
        interlinearOpen = true;
        break;
      }
    }
    if (interlinearOpen) break;
  }
  whenContextService.set('bible.interlinearOpen', interlinearOpen);

  // displayMode is per-tab; publish the active tab's mode for the default panel
  // (or first panel) so commands gated on `displayMode == 'study'` etc. work.
  if (ps) {
    const activeTab = ps.openTabs[ps.activeTabIndex];
    whenContextService.set('displayMode', activeTab?.displayMode ?? null);
  } else {
    whenContextService.set('displayMode', null);
  }
}

publishBibleWhenContext(useBibleStore.getState());
useBibleStore.subscribe(publishBibleWhenContext);

/**
 * Snapshot one panel's live navigation state back onto its passage record.
 * The panel-level `current*` fields are the source of truth while the pane is
 * open; the tab only catches up when it is serialized.
 */
function serializePanel(ps: BiblePanelState): BiblePanelSession | undefined {
  const tab = ps.openTabs[ps.activeTabIndex] ?? ps.openTabs[0];
  if (!tab) return undefined;
  return {
    tab: {
      ...tab,
      book: ps.currentBook,
      chapter: ps.currentChapter,
      bookName: ps.currentBookName,
      selectedVerseId: ps.selectedVerseId,
      history: ps.navigationHistory,
      historyIndex: ps.historyIndex,
    },
    isParallelViewMode: ps.isParallelViewMode,
    parallelVersions: ps.parallelVersions,
    // Additive and optional - an older build reading this simply ignores it,
    // and a session written by an older build restores with an empty stack.
    visitStack: ps.visitStack,
  };
}

// Register session serializer so useSessionStore doesn't import us directly.
//
// Schema v2: one entry per Bible panel, keyed by dockview panel id, because a
// passage is now a top-level panel rather than a sub-tab. The v1 fields are
// still written as a mirror of the primary panel so that downgrading the app,
// or any consumer sniffing `bible.openTabs.length`, keeps working.
registerSessionSerializer('bible', () => {
  const bibleState = useBibleStore.getState();

  const panels: Record<string, BiblePanelSession> = {};
  for (const [panelId, ps] of bibleState.panels.entries()) {
    const serialized = serializePanel(ps);
    if (serialized) panels[panelId] = serialized;
  }

  const primary = bibleState.panels.values().next().value;
  const primaryTab = primary ? serializePanel(primary)?.tab : undefined;

  const data: BibleSessionData = {
    version: BIBLE_SESSION_VERSION,
    panels,
    openTabs: primaryTab ? [primaryTab] : [],
    activeTabIndex: 0,
    currentBook: primary?.currentBook ?? 43,
    currentChapter: primary?.currentChapter ?? 3,
    selectedVerseId: primary?.selectedVerseId ?? null,
  };
  return data;
});

export { DEFAULT_PANEL_ID };
