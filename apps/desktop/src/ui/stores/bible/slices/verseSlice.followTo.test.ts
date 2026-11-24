/** followToChapter: the audio page turn. Selection, history and other panes stay put. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VerseIdHelper } from '@bible/core';

vi.mock('../../../services/electronAPI', () => ({
  bibleAPI: {
    getAvailableBibles: vi.fn().mockResolvedValue([]),
    getInitialData: vi.fn().mockResolvedValue(null),
    getBookName: vi.fn().mockImplementation(async (n: number) => (n === 43 ? 'John' : `Book${n}`)),
    getChapter: vi.fn().mockResolvedValue({ verses: [{ verse_id: 43004001, verse: 1, text: 'x' }] }),
    getVerse: vi.fn().mockResolvedValue(null),
  },
  commentaryAPI: {
    getAvailableCommentaries: vi.fn().mockResolvedValue([]),
    getEntriesForVerse: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('../../helpers/sessionNotifier', () => ({ markSessionDirty: vi.fn() }));

import { useBibleStore } from '../../useBibleStore';

const A = 'follow_panel_a';
const B = 'follow_panel_b';
const KJV = { abbreviation: 'KJV', name: 'King James Version', database_path: 'bible_kjv.db', module_id: 1 };
const JOHN_3_16 = VerseIdHelper.calculate(43, 3, 16);
const st = (id: string) => useBibleStore.getState().getPanelState(id);

describe('verseSlice.followToChapter', () => {
  beforeEach(async () => {
    useBibleStore.setState({ panels: new Map(), availableBibles: [KJV], initialLoadComplete: false });
    for (const id of [A, B]) {
      useBibleStore.getState().initPanel(id);
      useBibleStore.getState().openBible(id, KJV.abbreviation, KJV.name);
    }
    await useBibleStore.getState().loadChapter(A, 43, 3);
    await useBibleStore.getState().loadChapter(B, 43, 3);
    useBibleStore.getState().setSelectedVerse(A, JOHN_3_16);
  });

  it('turns the page and keeps the selection, history, visits and other panes', async () => {
    const hist = st(A).navigationHistory;
    const idx = st(A).historyIndex;
    const visits = st(A).visitStack;
    const bBefore = st(B);
    const trigger = st(A).scrollTrigger;

    await useBibleStore.getState().followToChapter(A, 43, 4);

    const a = st(A);
    expect([a.currentBook, a.currentChapter, a.currentBookName]).toEqual([43, 4, 'John']);
    expect(a.versesByTab.get(a.openTabs[a.activeTabIndex].tabId)?.length).toBe(1);
    expect(a.selectedVerseId).toBe(JOHN_3_16);
    expect(a.selectionEndVerseId).toBeNull();
    expect(a.navigationHistory).toBe(hist);
    expect(a.historyIndex).toBe(idx);
    expect(a.visitStack).toBe(visits);
    expect(a.scrollMode).toBe('top');
    expect(a.scrollTrigger).toBeGreaterThan(trigger);
    expect(a.openTabs[a.activeTabIndex].chapter).toBe(4);
    expect(a.openTabs[a.activeTabIndex].selectedVerseId).toBe(JOHN_3_16);
    expect(st(B)).toBe(bBefore);
  });

  it('does nothing for a pane without a tab', async () => {
    await expect(useBibleStore.getState().followToChapter('nope', 43, 4)).resolves.toBeUndefined();
  });
});
