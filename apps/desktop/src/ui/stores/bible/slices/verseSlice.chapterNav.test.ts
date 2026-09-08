/**
 * Chapter navigation and the selected verse.
 *
 * loadChapter must write the "verse 1 of the new chapter" default into the
 * panel-level selectedVerseId the pane actually renders from, not only into
 * the active tab's mirror: writing only the mirror would leave the highlight,
 * when paging to the next/previous chapter, on whatever verse number had been
 * selected in the chapter you just left. History navigation is the deliberate
 * exception: back/forward must restore the verse the entry remembers.
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

const PANEL = 'test_panel_chapter_nav';

const KJV = {
  abbreviation: 'KJV',
  name: 'King James Version',
  database_path: 'bible_kjv.db',
  module_id: 1,
};

const JOHN_3_16 = VerseIdHelper.calculate(43, 3, 16);
const JOHN_4_1 = VerseIdHelper.calculate(43, 4, 1);
const JOHN_3_1 = VerseIdHelper.calculate(43, 3, 1);

function panelState() {
  return useBibleStore.getState().getPanelState(PANEL);
}

describe('verseSlice - chapter navigation resets the selected verse', () => {
  beforeEach(() => {
    useBibleStore.setState({ panels: new Map(), availableBibles: [KJV], initialLoadComplete: false });
    useBibleStore.getState().initPanel(PANEL);
    useBibleStore.getState().openBible(PANEL, KJV.abbreviation, KJV.name);
  });

  it('resets the panel-level selection to verse 1 of the new chapter', async () => {
    useBibleStore.getState().setSelectedVerse(PANEL, JOHN_3_16);
    expect(panelState().selectedVerseId).toBe(JOHN_3_16);

    await useBibleStore.getState().loadChapter(PANEL, 43, 4);

    expect(panelState().selectedVerseId).toBe(JOHN_4_1);
  });

  it('mirrors the reset onto the active tab as well', async () => {
    useBibleStore.getState().setSelectedVerse(PANEL, JOHN_3_16);

    await useBibleStore.getState().loadChapter(PANEL, 43, 4);

    const ps = panelState();
    expect(ps.openTabs[ps.activeTabIndex].selectedVerseId).toBe(JOHN_4_1);
  });

  it('leaves the selection at verse 1 when re-loading the same chapter', async () => {
    await useBibleStore.getState().loadChapter(PANEL, 43, 3);

    expect(panelState().selectedVerseId).toBe(JOHN_3_1);
  });

  // Sequential paging is a move, not a visit: reading straight through a book
  // must leave one "recent passage", not one per chapter. A jump still appends.
  it('paging replaces the current history entry while a jump adds one', async () => {
    await useBibleStore.getState().navigateToVerse(PANEL, JOHN_3_16); // jump
    expect(panelState().navigationHistory).toHaveLength(1);

    await useBibleStore.getState().loadChapter(PANEL, 43, 4, { replaceHistory: true });
    await useBibleStore.getState().loadChapter(PANEL, 43, 5, { replaceHistory: true });

    expect(panelState().navigationHistory).toHaveLength(1);
    expect(panelState().navigationHistory[0]).toMatchObject({ bookNumber: 43, chapter: 5 });

    await useBibleStore.getState().loadChapter(PANEL, 45, 8); // jump
    expect(panelState().navigationHistory).toHaveLength(2);
  });

  it('paging does not disturb another chapter\'s remembered verse', async () => {
    await useBibleStore.getState().navigateToVerse(PANEL, JOHN_3_16);
    await useBibleStore.getState().loadChapter(PANEL, 45, 8); // jump away
    await useBibleStore.getState().loadChapter(PANEL, 45, 9, { replaceHistory: true });

    const history = panelState().navigationHistory;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ bookNumber: 43, chapter: 3, verseId: JOHN_3_16 });
  });

  it('back/forward still restore the verse the history entry remembers', async () => {
    // John 3:16 (a real verse selection) -> John 4 (a chapter page).
    await useBibleStore.getState().navigateToVerse(PANEL, JOHN_3_16);
    await useBibleStore.getState().loadChapter(PANEL, 43, 4);
    expect(panelState().selectedVerseId).toBe(JOHN_4_1);

    await useBibleStore.getState().goBack(PANEL);
    expect(panelState().selectedVerseId).toBe(JOHN_3_16);

    await useBibleStore.getState().goForward(PANEL);
    expect(panelState().selectedVerseId).toBe(JOHN_4_1);
  });
});
