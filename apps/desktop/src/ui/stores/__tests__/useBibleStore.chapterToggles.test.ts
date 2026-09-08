/**
 * Unit tests for the chapter-level Interlinear / Notes toggle preferences
 * (see BibleTab.showInterlinear / showNotes and tabOptionsSlice.setTabShow*).
 *
 * Verifies both that the tab fields update *and* that the mirrored study
 * options (studyOptionsByTab.showInterlinear / showFootnotes) update in lock
 * step, so Study mode features honour the same chapter-level switches.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/electronAPI', () => ({
  bibleAPI: {
    getAvailableBibles: vi.fn().mockResolvedValue([]),
    getInitialData: vi.fn().mockResolvedValue({ verses: [], currentBook: 43, currentChapter: 3 }),
    getBookName: vi.fn().mockImplementation(async (n: number) => `Book${n}`),
    getChapter: vi.fn().mockResolvedValue({ verses: [] }),
    getVerse: vi.fn().mockResolvedValue(null),
  },
  commentaryAPI: {
    getAvailableCommentaries: vi.fn().mockResolvedValue([]),
    getEntriesForVerse: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../helpers/sessionNotifier', () => ({
  markSessionDirty: vi.fn(),
}));

import { useBibleStore } from '../useBibleStore';

const PANEL = 'test_panel_toggles';
const TAB = 'tab-1';

describe('useBibleStore - chapter toggle bar preferences', () => {
  beforeEach(() => {
    useBibleStore.setState({ panels: new Map() });
    useBibleStore.getState().initPanel(PANEL);

    const s = useBibleStore.getState();
    const ps = s.getPanelState(PANEL);
    const newPanels = new Map(s.panels);
    newPanels.set(PANEL, {
      ...ps,
      openTabs: [{
        tabId: TAB,
        abbreviation: 'KJV',
        name: 'King James',
        displayMode: 'reading',
        book: 43,
        chapter: 3,
        bookName: 'John',
        selectedVerseId: null,
        history: [],
        historyIndex: -1,
      }],
      activeTabIndex: 0,
    });
    useBibleStore.setState({ panels: newPanels });
  });

  it('defaults tab.showInterlinear and tab.showNotes to undefined/false', () => {
    const ps = useBibleStore.getState().getPanelState(PANEL);
    const tab = ps.openTabs[0];
    expect(tab.showInterlinear).toBeUndefined();
    expect(tab.showNotes).toBeUndefined();
  });

  it('setTabShowInterlinear updates tab field and mirrors into study options', () => {
    useBibleStore.getState().setTabShowInterlinear(PANEL, TAB, true);

    const ps = useBibleStore.getState().getPanelState(PANEL);
    expect(ps.openTabs[0].showInterlinear).toBe(true);
    expect(ps.studyOptionsByTab.get(TAB)?.showInterlinear).toBe(true);
  });

  it('setTabShowNotes updates tab field and mirrors into study options showFootnotes', () => {
    useBibleStore.getState().setTabShowNotes(PANEL, TAB, false);

    const ps = useBibleStore.getState().getPanelState(PANEL);
    expect(ps.openTabs[0].showNotes).toBe(false);
    expect(ps.studyOptionsByTab.get(TAB)?.showFootnotes).toBe(false);
  });

  it('toggles are independent — flipping one does not touch the other', () => {
    const s = useBibleStore.getState();
    s.setTabShowInterlinear(PANEL, TAB, true);
    s.setTabShowNotes(PANEL, TAB, false);

    const ps = useBibleStore.getState().getPanelState(PANEL);
    expect(ps.openTabs[0].showInterlinear).toBe(true);
    expect(ps.openTabs[0].showNotes).toBe(false);
  });
});
