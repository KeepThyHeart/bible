/**
 * Two store-level behaviours the dictionary panes depend on:
 *
 * - `reorderTabs`: dictionary tabs had no reorder action at all, so dragging
 *   one lifted it and then silently snapped it back.
 * - `loadAllEntries` paging: the browse list was fetched once with a hard limit
 *   of 100 and no way to ask for the rest. There is no entry-count channel, so
 *   the end of the list is detected by a page coming back short.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDictionaryStore } from './useDictionaryStore';
import { dictionaryAPI } from '../services/electronAPI';

vi.mock('../services/electronAPI', () => ({
  dictionaryAPI: {
    getAvailableDictionaries: vi.fn().mockResolvedValue([]),
    getEntryByKey: vi.fn().mockResolvedValue(null),
    getAllEntries: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('./helpers/sessionNotifier', () => ({
  markSessionDirty: vi.fn(),
}));

const PANEL = 'book_abc123';

function makeEntries(count: number, offset = 0) {
  return Array.from({ length: count }, (_, i) => ({
    entry_key: String(i + offset).padStart(5, '0'),
    definition: `definition ${i + offset}`,
  }));
}

describe('useDictionaryStore tabs and browse paging', () => {
  beforeEach(() => {
    useDictionaryStore.setState({
      availableDictionaries: [],
      loadingDictionaries: false,
      recentLookups: [],
      panels: new Map(),
    });
    vi.clearAllMocks();
  });

  function openThree() {
    const store = useDictionaryStore.getState();
    store.openDictionary(PANEL, 'a', 'A');
    store.openDictionary(PANEL, 'b', 'B');
    store.openDictionary(PANEL, 'c', 'C');
  }

  describe('reorderTabs', () => {
    it('moves a tab and keeps the same tab active', () => {
      openThree();
      useDictionaryStore.getState().setActiveTab(PANEL, 0); // "a"

      useDictionaryStore.getState().reorderTabs(PANEL, 0, 2);

      const ps = useDictionaryStore.getState().getPanelState(PANEL);
      expect(ps.openTabs.map(t => t.abbreviation)).toEqual(['b', 'c', 'a']);
      expect(ps.activeTabIndex).toBe(2);
    });

    it('shifts the active index when a tab moves across it', () => {
      openThree();
      useDictionaryStore.getState().setActiveTab(PANEL, 1); // "b"

      useDictionaryStore.getState().reorderTabs(PANEL, 2, 0);

      const ps = useDictionaryStore.getState().getPanelState(PANEL);
      expect(ps.openTabs.map(t => t.abbreviation)).toEqual(['c', 'a', 'b']);
      expect(ps.activeTabIndex).toBe(2);
    });

    it('ignores out-of-range indices', () => {
      openThree();

      useDictionaryStore.getState().reorderTabs(PANEL, 0, 9);

      expect(useDictionaryStore.getState().getPanelState(PANEL).openTabs.map(t => t.abbreviation))
        .toEqual(['a', 'b', 'c']);
    });
  });

  describe('loadAllEntries paging', () => {
    it('marks a full page as possibly-incomplete and appends the next one', async () => {
      vi.mocked(dictionaryAPI.getAllEntries).mockResolvedValueOnce(makeEntries(100));
      await useDictionaryStore.getState().loadAllEntries(PANEL, 'a', 100);

      let ps = useDictionaryStore.getState().getPanelState(PANEL);
      expect(ps.allEntriesByTab.get('a')).toHaveLength(100);
      expect(ps.allEntriesCompleteByTab.get('a')).toBe(false);

      vi.mocked(dictionaryAPI.getAllEntries).mockResolvedValueOnce(makeEntries(20, 100));
      await useDictionaryStore.getState().loadAllEntries(PANEL, 'a', 100, 100, true);

      ps = useDictionaryStore.getState().getPanelState(PANEL);
      expect(dictionaryAPI.getAllEntries).toHaveBeenLastCalledWith('a', 100, 100);
      expect(ps.allEntriesByTab.get('a')).toHaveLength(120);
      // Short page - that was the end of the dictionary.
      expect(ps.allEntriesCompleteByTab.get('a')).toBe(true);
    });

    it('replaces rather than appends when append is not requested', async () => {
      vi.mocked(dictionaryAPI.getAllEntries).mockResolvedValue(makeEntries(5));
      await useDictionaryStore.getState().loadAllEntries(PANEL, 'a', 100);
      await useDictionaryStore.getState().loadAllEntries(PANEL, 'a', 100);

      expect(useDictionaryStore.getState().getPanelState(PANEL).allEntriesByTab.get('a')).toHaveLength(5);
    });
  });
});
