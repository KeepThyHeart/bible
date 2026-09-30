/**
 * navigateToVerseInPrimary targeting (QA 4.2).
 *
 * Search results and other "jump to a verse" callers must target the Bible
 * panel that was last focused (tracked in
 * useLayoutStore.lastActiveBiblePanelId), not always the first-created Bible
 * panel (DEFAULT_PANEL_ID, else Map insertion order) - which ignores which
 * pane the user is actually looking at. This exercises that targeting,
 * falling back to DEFAULT_PANEL_ID / first-Map-key behavior only when no
 * Bible panel has been focused yet.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VerseIdHelper } from '@bible/core';

vi.mock('../../../services/electronAPI', () => ({
  bibleAPI: {
    getAvailableBibles: vi.fn().mockResolvedValue([]),
    getInitialData: vi.fn().mockResolvedValue(null),
    getBookName: vi.fn().mockImplementation(async (n: number) => (n === 43 ? 'John' : `Book${n}`)),
    getChapter: vi.fn().mockResolvedValue({ verses: [] }),
    getVerse: vi.fn().mockResolvedValue(null),
  },
  commentaryAPI: {
    getAvailableCommentaries: vi.fn().mockResolvedValue([]),
    getEntriesForVerse: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../helpers/sessionNotifier', () => ({
  markSessionDirty: vi.fn(),
}));

import { useBibleStore } from '../../useBibleStore';
import { useLayoutStore } from '../../useLayoutStore';

const PANEL_FIRST = 'bible_first_created';
const PANEL_SECOND = 'bible_second_created';

const KJV = {
  abbreviation: 'KJV',
  name: 'King James Version',
  database_path: 'bible_kjv.db',
  module_id: 1,
};

const JOHN_3_16 = VerseIdHelper.calculate(43, 3, 16);

function panelState(panelId: string) {
  return useBibleStore.getState().getPanelState(panelId);
}

describe('navigateToVerseInPrimary targets the right Bible pane', () => {
  beforeEach(() => {
    useBibleStore.setState({ panels: new Map(), availableBibles: [KJV], initialLoadComplete: false });
    useLayoutStore.setState({
      panels: new Map(),
      activePanelId: null,
      lastActiveBiblePanelId: null,
    });

    // PANEL_FIRST is created (and registered in the layout store) before
    // PANEL_SECOND, mirroring the Map-insertion-order fallback used when no
    // panel has been focused.
    useBibleStore.getState().initPanel(PANEL_FIRST);
    useBibleStore.getState().openBible(PANEL_FIRST, KJV.abbreviation, KJV.name);
    useLayoutStore.getState().registerPanel({
      panelId: PANEL_FIRST,
      contentType: 'bible',
      displayName: 'Bible',
    });

    useBibleStore.getState().initPanel(PANEL_SECOND);
    useBibleStore.getState().openBible(PANEL_SECOND, KJV.abbreviation, KJV.name);
    useLayoutStore.getState().registerPanel({
      panelId: PANEL_SECOND,
      contentType: 'bible',
      displayName: 'Bible',
    });
  });

  it('targets the last-active Bible panel, not the first-created one', async () => {
    // User focused the second panel (e.g. clicked into it) after both panels
    // were created - dockview reports this via onDidActivePanelChange, which
    // DockviewLayout forwards into setActivePanelId.
    useLayoutStore.getState().setActivePanelId(PANEL_SECOND);
    expect(useLayoutStore.getState().lastActiveBiblePanelId).toBe(PANEL_SECOND);

    await useBibleStore.getState().navigateToVerseInPrimary(JOHN_3_16);

    expect(panelState(PANEL_SECOND).selectedVerseId).toBe(JOHN_3_16);
    // The first-created panel (the fallback target) must be untouched.
    expect(panelState(PANEL_FIRST).selectedVerseId).not.toBe(JOHN_3_16);
  });

  it('falls back to the first Bible panel when none has been focused', async () => {
    // Neither panel has ever been the active dockview panel (e.g. session
    // just restored, user has only used the search bar so far).
    expect(useLayoutStore.getState().lastActiveBiblePanelId).toBeNull();

    await useBibleStore.getState().navigateToVerseInPrimary(JOHN_3_16);

    expect(panelState(PANEL_FIRST).selectedVerseId).toBe(JOHN_3_16);
    expect(panelState(PANEL_SECOND).selectedVerseId).not.toBe(JOHN_3_16);
  });

  it('re-targets after focus moves from the second panel back to the first', async () => {
    useLayoutStore.getState().setActivePanelId(PANEL_SECOND);
    useLayoutStore.getState().setActivePanelId(PANEL_FIRST);
    expect(useLayoutStore.getState().lastActiveBiblePanelId).toBe(PANEL_FIRST);

    await useBibleStore.getState().navigateToVerseInPrimary(JOHN_3_16);

    expect(panelState(PANEL_FIRST).selectedVerseId).toBe(JOHN_3_16);
  });

  it('ignores focus moving to a non-Bible panel, keeping the last Bible panel as target', async () => {
    useLayoutStore.getState().setActivePanelId(PANEL_SECOND);
    useLayoutStore.getState().registerPanel({
      panelId: 'commentary_1',
      contentType: 'commentary',
      displayName: 'Commentary',
    });
    // User clicks into the Commentary pane (e.g. to read a search result's
    // context) - this must not steal the navigation target away from the
    // Bible pane they were last actually reading.
    useLayoutStore.getState().setActivePanelId('commentary_1');
    expect(useLayoutStore.getState().activePanelId).toBe('commentary_1');
    expect(useLayoutStore.getState().lastActiveBiblePanelId).toBe(PANEL_SECOND);

    await useBibleStore.getState().navigateToVerseInPrimary(JOHN_3_16);

    expect(panelState(PANEL_SECOND).selectedVerseId).toBe(JOHN_3_16);
  });
});

describe('navigateToVerseInPrimary activates the target pane in dockview', () => {
  beforeEach(() => {
    useBibleStore.setState({ panels: new Map(), availableBibles: [KJV], initialLoadComplete: false });
    useLayoutStore.setState({
      panels: new Map(),
      activePanelId: null,
      lastActiveBiblePanelId: null,
      dockviewApi: null,
    });

    useBibleStore.getState().initPanel(PANEL_FIRST);
    useBibleStore.getState().openBible(PANEL_FIRST, KJV.abbreviation, KJV.name);
    useLayoutStore.getState().registerPanel({
      panelId: PANEL_FIRST,
      contentType: 'bible',
      displayName: 'Bible',
    });
  });

  it('is a no-op when dockview has not mounted yet (dockviewApi is null)', async () => {
    // Regression guard: this must not throw when nothing has called
    // setDockviewApi (e.g. many store-level tests never mount DockviewLayout).
    await expect(useBibleStore.getState().navigateToVerseInPrimary(JOHN_3_16)).resolves.toBeUndefined();
  });

  it("calls the target dockview panel's api.setActive(), not some other panel's", async () => {
    const setActiveTarget = vi.fn();
    const setActiveOther = vi.fn();
    const dockviewApi = {
      getPanel: (id: string) => {
        if (id === PANEL_FIRST) return { api: { setActive: setActiveTarget } };
        if (id === 'commentary_1') return { api: { setActive: setActiveOther } };
        return undefined;
      },
    };
    useLayoutStore.setState({ dockviewApi: dockviewApi as never });

    await useBibleStore.getState().navigateToVerseInPrimary(JOHN_3_16);

    expect(setActiveTarget).toHaveBeenCalledTimes(1);
    expect(setActiveOther).not.toHaveBeenCalled();
  });

  it('does not throw when dockview no longer has the target panel', async () => {
    const dockviewApi = { getPanel: () => undefined };
    useLayoutStore.setState({ dockviewApi: dockviewApi as never });

    await expect(useBibleStore.getState().navigateToVerseInPrimary(JOHN_3_16)).resolves.toBeUndefined();
  });
});
