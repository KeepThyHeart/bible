/**
 * FIX 3 - "No verses loaded" flashes on app restart.
 *
 * loadingByTab is seeded true in the SAME synchronous update that publishes
 * openTabs. Publishing openTabs synchronously but only setting loadingByTab
 * true once loadChapterForTab itself runs, after awaiting loadAvailableBibles
 * (an IPC round trip), would leave a window where openTabs.length is already
 * 1 but loadingByTab has no entry for the tab yet - `|| false` defaults make
 * that indistinguishable from "finished loading, genuinely empty", and
 * BibleVerseList would render "no verses loaded".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../services/electronAPI', () => ({
  bibleAPI: {
    getAvailableBibles: vi.fn().mockResolvedValue([
      { abbreviation: 'KJV', name: 'King James Version', database_path: 'bible_kjv.db', module_id: 1 },
    ]),
    getBookName: vi.fn().mockResolvedValue('John'),
    getChapter: vi.fn().mockResolvedValue({
      verses: [{ verse_id: 43003001, book_number: 43, chapter: 3, verse: 1, text: 'v1' }],
    }),
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
import type { BibleTab } from '../types';

const PANEL = 'session_restore_test_panel';

function panelState() {
  return useBibleStore.getState().getPanelState(PANEL);
}

function stageSession(overrides: Partial<BibleTab> = {}): BibleTab {
  const tab: BibleTab = {
    tabId: 'restored-tab-1',
    abbreviation: 'KJV',
    name: 'King James Version',
    displayMode: 'standard',
    book: 43,
    chapter: 3,
    bookName: 'John',
    selectedVerseId: 43003016,
    history: [],
    historyIndex: -1,
    ...overrides,
  };
  useBibleStore.setState({
    sessionPanelStates: new Map([[PANEL, { tab }]]),
  });
  return tab;
}

describe('sessionSlice.restorePanelFromSession — loadingByTab seeding', () => {
  beforeEach(() => {
    useBibleStore.setState({ panels: new Map(), sessionPanelStates: new Map() });
  });

  it('seeds loadingByTab true for the restored tab in the same update that publishes openTabs', async () => {
    const tab = stageSession();

    const restorePromise = useBibleStore.getState().restorePanelFromSession(PANEL);

    // Synchronous portion of restorePanelFromSession has run (async functions
    // run synchronously up to their first await), but loadAvailableBibles's
    // IPC round trip hasn't resolved yet - exactly the window the synchronous
    // loadingByTab seeding above closes.
    const psImmediately = panelState();
    expect(psImmediately.openTabs).toHaveLength(1);
    expect(psImmediately.openTabs[0].tabId).toBe(tab.tabId);
    expect(psImmediately.loadingByTab.get(tab.tabId)).toBe(true);

    await restorePromise;

    // Once the chapter has actually loaded, loadingByTab settles back to
    // false and real verses are in place.
    expect(panelState().loadingByTab.get(tab.tabId)).toBe(false);
    expect(panelState().versesByTab.get(tab.tabId)?.length).toBeGreaterThan(0);
  });
});
