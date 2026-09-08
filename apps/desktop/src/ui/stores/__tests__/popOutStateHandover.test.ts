/**
 * Unit tests for the store-side pieces of pop-out state handover.
 *
 * Two store surfaces exist purely to serve detached windows and are otherwise
 * unexercised:
 *
 *  - `useCommentaryStore.initializeFromState` - the detached commentary pane's
 *    equivalent of a session restore. Unlike `restoreFromSession` it does no
 *    IPC: the entries were already fetched in the main window and shipped over,
 *    so this is a straight write into the panel map.
 *  - the notes panel nav registry (`setNotesPanelNavState` and friends) -
 *    imperative wrappers over `useFileNotesStore.panelNavStates`, because the
 *    notes pane keeps its view/path in local React state that
 *    `DockviewTabRenderer` cannot read. (The same map is now persisted into the
 *    session as `ui.notesPanels`; that side of it is covered by
 *    notesPanelSession.test.ts.)
 *
 * A regression in either produces the same symptom the user sees as "the popped
 * out pane came up blank".
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/electronAPI', () => ({
  commentaryAPI: {
    getAvailableCommentaries: vi.fn().mockResolvedValue([]),
    getEntriesForVerse: vi.fn().mockResolvedValue([]),
    getNextVerseWithContent: vi.fn().mockResolvedValue(null),
    getPreviousVerseWithContent: vi.fn().mockResolvedValue(null),
    getAllEntrySummaries: vi.fn().mockResolvedValue([]),
    batchRestoreSession: vi.fn().mockResolvedValue({
      availableCommentaries: [],
      entriesByTab: {},
      summariesByTab: {},
    }),
  },
}));

vi.mock('../helpers/sessionNotifier', () => ({
  markSessionDirty: vi.fn(),
}));

import { useCommentaryStore } from '../useCommentaryStore';
import {
  setNotesPanelNavState,
  getNotesPanelNavState,
  clearNotesPanelNavState,
} from '../useFileNotesStore';

const PANEL = 'detached-1';

const ENTRIES = [{ entry_id: 1, text: 'For God so loved the world...' }] as any;

const HANDOVER = {
  openTabs: [{ abbreviation: 'MHC', name: 'Matthew Henry' }],
  activeTabIndex: 0,
  currentVerseId: 43003016,
  entriesByTab: new Map([['MHC', ENTRIES]]),
  browseModeByTab: new Map([['MHC', true]]),
};

describe('useCommentaryStore.initializeFromState', () => {
  beforeEach(() => {
    useCommentaryStore.setState({
      availableCommentaries: [],
      loadingCommentaries: false,
      mutedModules: new Set(),
      promotedModules: new Set(),
      panels: new Map(),
    });
  });

  const getPs = () => useCommentaryStore.getState().getPanelState(PANEL);

  it('restores tabs, verse and entries into a panel that does not exist yet', () => {
    // A detached window's store starts completely empty - there is no initPanel
    // call before this runs, so it has to create the panel on the way in.
    useCommentaryStore.getState().initializeFromState(PANEL, HANDOVER);

    const ps = getPs();
    expect(ps.openTabs).toEqual(HANDOVER.openTabs);
    expect(ps.activeTabIndex).toBe(0);
    expect(ps.currentVerseId).toBe(43003016);
    expect(ps.entriesByTab.get('MHC')).toEqual(ENTRIES);
    expect(ps.browseModeByTab.get('MHC')).toBe(true);
  });

  it('makes the entries available without any further IPC', () => {
    // The whole point of shipping entries over is that the detached window
    // renders text immediately instead of re-querying the module database.
    useCommentaryStore.getState().initializeFromState(PANEL, HANDOVER);
    expect(getPs().entriesByTab.get('MHC')).toHaveLength(1);
  });

  it('leaves other panels untouched', () => {
    useCommentaryStore.getState().initPanel('other-panel');
    useCommentaryStore.getState().openCommentary('other-panel', 'JFB', 'Jamieson-Fausset-Brown');

    useCommentaryStore.getState().initializeFromState(PANEL, HANDOVER);

    const other = useCommentaryStore.getState().getPanelState('other-panel');
    expect(other.openTabs.map(t => t.abbreviation)).toEqual(['JFB']);
    expect(getPs().openTabs.map(t => t.abbreviation)).toEqual(['MHC']);
  });

  it('restores a multi-tab panel on the tab that was active', () => {
    useCommentaryStore.getState().initializeFromState(PANEL, {
      ...HANDOVER,
      openTabs: [
        { abbreviation: 'MHC', name: 'Matthew Henry' },
        { abbreviation: 'JFB', name: 'Jamieson-Fausset-Brown' },
      ],
      activeTabIndex: 1,
    });

    expect(getPs().activeTabIndex).toBe(1);
    expect(getPs().openTabs).toHaveLength(2);
  });

  it('accepts an empty handover for a pane popped out with nothing open', () => {
    useCommentaryStore.getState().initializeFromState(PANEL, {
      openTabs: [],
      activeTabIndex: 0,
      currentVerseId: null,
      entriesByTab: new Map(),
      browseModeByTab: new Map(),
    });

    expect(getPs().openTabs).toEqual([]);
    expect(getPs().currentVerseId).toBeNull();
  });

  it('is idempotent', () => {
    useCommentaryStore.getState().initializeFromState(PANEL, HANDOVER);
    useCommentaryStore.getState().initializeFromState(PANEL, HANDOVER);

    expect(getPs().openTabs).toHaveLength(1);
    expect(getPs().entriesByTab.get('MHC')).toEqual(ENTRIES);
  });
});

describe('notes panel nav registry', () => {
  beforeEach(() => {
    clearNotesPanelNavState(PANEL);
    clearNotesPanelNavState('other-panel');
  });

  const NAV = {
    view: 'editor' as const,
    sideTab: 'recent' as const,
    currentPath: 'C:/notes/romans',
    currentNotePath: 'C:/notes/romans/ch8.bn',
  };

  it('round-trips a panel nav state', () => {
    setNotesPanelNavState(PANEL, NAV);
    expect(getNotesPanelNavState(PANEL)).toEqual(NAV);
  });

  it('returns undefined for a panel that never registered', () => {
    // DockviewTabRenderer relies on this to decide whether to send an initial
    // state at all, so it must be undefined rather than a default object.
    expect(getNotesPanelNavState('never-seen')).toBeUndefined();
  });

  it('overwrites on re-registration so the latest position wins', () => {
    setNotesPanelNavState(PANEL, NAV);
    setNotesPanelNavState(PANEL, { ...NAV, currentNotePath: 'C:/notes/romans/ch9.bn' });

    expect(getNotesPanelNavState(PANEL)?.currentNotePath).toBe('C:/notes/romans/ch9.bn');
  });

  it('keeps panels independent', () => {
    setNotesPanelNavState(PANEL, NAV);
    setNotesPanelNavState('other-panel', { ...NAV, currentPath: 'C:/notes/psalms' });

    expect(getNotesPanelNavState(PANEL)?.currentPath).toBe('C:/notes/romans');
    expect(getNotesPanelNavState('other-panel')?.currentPath).toBe('C:/notes/psalms');
  });

  it('clears a panel without disturbing the others', () => {
    setNotesPanelNavState(PANEL, NAV);
    setNotesPanelNavState('other-panel', NAV);

    clearNotesPanelNavState(PANEL);

    expect(getNotesPanelNavState(PANEL)).toBeUndefined();
    expect(getNotesPanelNavState('other-panel')).toEqual(NAV);
  });

  it('tolerates clearing a panel that was never registered', () => {
    expect(() => clearNotesPanelNavState('never-seen')).not.toThrow();
  });
});
