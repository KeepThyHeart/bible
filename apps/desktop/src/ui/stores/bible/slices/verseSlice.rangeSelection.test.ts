/**
 * Shift-click passage selection in the store.
 *
 * The model is an *anchor* (`selectedVerseId` - the verse the reader actually
 * clicked, and the one every dependent pane follows) plus an optional *end*
 * (`selectionEndVerseId`, written only by shift-click). Three properties carry
 * the whole feature and each of them was easy to get wrong:
 *
 *  1. The anchor never moves on shift-click. If it did, the commentary/notes/
 *     study panes would follow the far end of the passage instead of the verse
 *     the reader chose, and a shift-click would read as a navigation.
 *  2. The pair is ordered on the way out, so shift-clicking *upwards* (an end
 *     numerically below the anchor) yields the same range as clicking down.
 *  3. Everything that sets a plain selection, or changes the passage, clears
 *     the range - otherwise a stale end paints verses in a chapter the reader
 *     never selected anything in.
 *
 * The range is also deliberately absent from `BibleTab`, which is what the
 * session persists; see the last describe block.
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

const PANEL = 'test_panel_range_selection';

const KJV = {
  abbreviation: 'KJV',
  name: 'King James Version',
  database_path: 'bible_kjv.db',
  module_id: 1,
};

const JOHN_3_14 = VerseIdHelper.calculate(43, 3, 14);
const JOHN_3_16 = VerseIdHelper.calculate(43, 3, 16);
const JOHN_3_18 = VerseIdHelper.calculate(43, 3, 18);

function store() {
  return useBibleStore.getState();
}

function panelState() {
  return store().getPanelState(PANEL);
}

describe('verseSlice — shift-click range selection', () => {
  beforeEach(() => {
    useBibleStore.setState({ panels: new Map(), availableBibles: [KJV], initialLoadComplete: false });
    store().initPanel(PANEL);
    store().openBible(PANEL, KJV.abbreviation, KJV.name);
  });

  describe('extendSelectionTo', () => {
    it('extends downwards without moving the anchor', () => {
      store().setSelectedVerse(PANEL, JOHN_3_16);
      store().extendSelectionTo(PANEL, JOHN_3_18);

      // The anchor is what the study panes follow - it must be untouched.
      expect(panelState().selectedVerseId).toBe(JOHN_3_16);
      expect(panelState().selectionEndVerseId).toBe(JOHN_3_18);
      expect(store().getSelectedRange(PANEL)).toEqual({ start: JOHN_3_16, end: JOHN_3_18 });
    });

    it('extends UPWARDS and still reports an ordered range', () => {
      // Shift-clicking above the anchor puts the end numerically below it.
      // Without the Math.min/max ordering the range comes back inverted and
      // every `id >= start && id <= end` test downstream matches nothing.
      store().setSelectedVerse(PANEL, JOHN_3_16);
      store().extendSelectionTo(PANEL, JOHN_3_14);

      expect(panelState().selectedVerseId).toBe(JOHN_3_16);
      expect(panelState().selectionEndVerseId).toBe(JOHN_3_14);
      expect(store().getSelectedRange(PANEL)).toEqual({ start: JOHN_3_14, end: JOHN_3_16 });
    });

    it('collapses the range when the anchor itself is shift-clicked', () => {
      store().setSelectedVerse(PANEL, JOHN_3_16);
      store().extendSelectionTo(PANEL, JOHN_3_18);
      store().extendSelectionTo(PANEL, JOHN_3_16);

      expect(panelState().selectedVerseId).toBe(JOHN_3_16);
      expect(panelState().selectionEndVerseId).toBeNull();
      expect(store().getSelectedRange(PANEL)).toEqual({ start: JOHN_3_16, end: JOHN_3_16 });
    });

    it('re-extending from the same anchor replaces the end rather than accumulating', () => {
      store().setSelectedVerse(PANEL, JOHN_3_14);
      store().extendSelectionTo(PANEL, JOHN_3_18);
      store().extendSelectionTo(PANEL, JOHN_3_16);

      expect(panelState().selectedVerseId).toBe(JOHN_3_14);
      expect(store().getSelectedRange(PANEL)).toEqual({ start: JOHN_3_14, end: JOHN_3_16 });
    });

    it('acts as a plain click when there is no anchor to extend from', () => {
      store().setSelectedVerse(PANEL, null);
      store().extendSelectionTo(PANEL, JOHN_3_16);

      expect(panelState().selectedVerseId).toBe(JOHN_3_16);
      expect(panelState().selectionEndVerseId).toBeNull();
    });
  });

  describe('getSelectedRange', () => {
    it('is null when nothing is selected', () => {
      store().setSelectedVerse(PANEL, null);
      expect(store().getSelectedRange(PANEL)).toBeNull();
    });

    it('is a one-verse range for a plain selection, so callers need no special case', () => {
      store().setSelectedVerse(PANEL, JOHN_3_16);
      expect(store().getSelectedRange(PANEL)).toEqual({ start: JOHN_3_16, end: JOHN_3_16 });
    });
  });

  describe('the range is cleared by everything that re-selects or re-navigates', () => {
    beforeEach(() => {
      store().setSelectedVerse(PANEL, JOHN_3_14);
      store().extendSelectionTo(PANEL, JOHN_3_18);
      expect(panelState().selectionEndVerseId).toBe(JOHN_3_18);
    });

    it('a plain click starts a fresh selection', () => {
      store().setSelectedVerse(PANEL, JOHN_3_16);
      expect(panelState().selectionEndVerseId).toBeNull();
    });

    it('paging to another chapter', async () => {
      await store().loadChapter(PANEL, 43, 4);
      expect(panelState().selectionEndVerseId).toBeNull();
    });

    it('navigating to a verse in the SAME chapter (search result, cross-reference)', async () => {
      await store().navigateToVerse(PANEL, JOHN_3_16);
      expect(panelState().selectedVerseId).toBe(JOHN_3_16);
      expect(panelState().selectionEndVerseId).toBeNull();
    });

    it('navigating to a verse in another chapter', async () => {
      const john4_1 = VerseIdHelper.calculate(43, 4, 1);
      await store().navigateToVerse(PANEL, john4_1);
      expect(panelState().selectionEndVerseId).toBeNull();
    });

    it('history navigation (Back / the history dropdown)', async () => {
      await store()._navigateWithoutHistory(PANEL, 43, 4, VerseIdHelper.calculate(43, 4, 2));
      expect(panelState().selectionEndVerseId).toBeNull();
    });

    it('seeding a panel with its passage', () => {
      // `openBible` on the panel PANEL already has would be a no-op (same
      // translation, same passage, so the selection is untouched and keeping
      // the range is correct), so exercise the path that actually seeds one.
      const fresh = 'panel_seeded_with_a_stale_range';
      store().initPanel(fresh);
      store().setSelectedVerse(fresh, JOHN_3_14);
      store().extendSelectionTo(fresh, JOHN_3_18);

      store().openBible(fresh, KJV.abbreviation, KJV.name);

      expect(store().getPanelState(fresh).selectionEndVerseId).toBeNull();
    });
  });

  describe('the range is never persisted', () => {
    it('is absent from the tab mirror the session writes', () => {
      store().setSelectedVerse(PANEL, JOHN_3_14);
      store().extendSelectionTo(PANEL, JOHN_3_18);

      const tab = panelState().openTabs[0];
      // The tab carries the anchor and nothing about the extension: a restored
      // session opens on a single selected verse, never a half-washed chapter.
      expect(tab.selectedVerseId).toBe(JOHN_3_14);
      expect(Object.keys(tab)).not.toContain('selectionEndVerseId');
    });

    it('a fresh panel starts with no range', () => {
      store().initPanel('another_panel');
      expect(store().getPanelState('another_panel').selectionEndVerseId).toBeNull();
    });
  });
});
