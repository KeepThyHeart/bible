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

describe('sessionSlice.restorePanelFromSession - selected verse is brought into view (B-055)', () => {
  beforeEach(() => {
    useBibleStore.setState({ panels: new Map(), sessionPanelStates: new Map() });
  });

  it('asks the pane to centre the restored selected verse (scroll position itself is not restored)', async () => {
    stageSession({ selectedVerseId: 43003016 });
    await useBibleStore.getState().restorePanelFromSession(PANEL);
    const ps = panelState();
    expect(ps.selectedVerseId).toBe(43003016);
    expect(ps.scrollMode).toBe('center');
    expect(ps.scrollTrigger).toBeGreaterThan(0);
  });

  it('does not ask for a scroll when no verse was selected', async () => {
    stageSession({ selectedVerseId: undefined });
    await useBibleStore.getState().restorePanelFromSession(PANEL);
    expect(panelState().scrollMode).toBe('nearest');
    expect(panelState().scrollTrigger).toBe(0);
  });

  it('drops any saved scroll offset from the restored history, so the verse wins', async () => {
    stageSession({
      selectedVerseId: 43003016,
      history: [{ verseId: 43003016, bookNumber: 43, chapter: 3, bookName: 'John', scrollTop: 1234 }] as BibleTab['history'],
      historyIndex: 0,
    });
    await useBibleStore.getState().restorePanelFromSession(PANEL);
    expect(panelState().navigationHistory.every(h => h.scrollTop === undefined)).toBe(true);
  });
});
