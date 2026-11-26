/** markReadingStop: audio stopped on a verse; selects it without scrolling, collapses a range. */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../services/electronAPI', () => ({
  bibleAPI: {
    getAvailableBibles: vi.fn().mockResolvedValue([]),
    getInitialData: vi.fn().mockResolvedValue(null),
    getBookName: vi.fn().mockResolvedValue('John'),
    getChapter: vi.fn().mockResolvedValue({ verses: [{ verse_id: 43003001, verse: 1, text: 'x' }] }),
    getVerse: vi.fn().mockResolvedValue(null),
  },
  commentaryAPI: { getAvailableCommentaries: vi.fn().mockResolvedValue([]), getEntriesForVerse: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../helpers/sessionNotifier', () => ({ markSessionDirty: vi.fn() }));

import { useBibleStore } from '../../useBibleStore';

const A = 'stop_panel_a';
const KJV = { abbreviation: 'KJV', name: 'King James Version', database_path: 'bible_kjv.db', module_id: 1 };
const st = () => useBibleStore.getState().getPanelState(A);

describe('verseSlice.markReadingStop', () => {
  beforeEach(async () => {
    useBibleStore.setState({ panels: new Map(), availableBibles: [KJV], initialLoadComplete: false });
    useBibleStore.getState().initPanel(A);
    useBibleStore.getState().openBible(A, KJV.abbreviation, KJV.name);
    await useBibleStore.getState().loadChapter(A, 43, 3);
  });

  it('selects the verse, mirrors it on the tab, collapses a range, and does not scroll', () => {
    useBibleStore.getState().setSelectedVerse(A, 43003010);
    useBibleStore.getState().extendSelectionTo(A, 43003014);
    const before = st();
    useBibleStore.getState().markReadingStop(A, 43003020);
    const ps = st();
    expect(ps.selectedVerseId).toBe(43003020);
    expect(ps.selectionEndVerseId).toBeNull();
    expect(ps.openTabs[ps.activeTabIndex].selectedVerseId).toBe(43003020);
    expect(ps.scrollTrigger).toBe(before.scrollTrigger);
    expect(ps.scrollMode).toBe(before.scrollMode);
  });

  it('is a no-op for a verse outside the shown chapter', () => {
    useBibleStore.getState().setSelectedVerse(A, 43003010);
    useBibleStore.getState().markReadingStop(A, 43004001);
    expect(st().selectedVerseId).toBe(43003010);
  });
});
