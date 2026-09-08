/**
 * Unit tests for the Book store's table-of-contents load.
 *
 * The failure path is the interesting one: clearing only the loading flag
 * would leave the summaries key absent. Every consumer reads "key absent" as
 * "not attempted yet", which would make the Contents dialog permanently dead
 * and let the pane's auto-load effect re-fire the failing query on every
 * render.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useBookStore } from './useBookStore';

const getAllSectionSummaries = vi.fn();

vi.mock('../services/electronAPI', () => ({
  bookAPI: {
    getAvailableBooks: vi.fn().mockResolvedValue([]),
    getTopLevelSections: vi.fn().mockResolvedValue([]),
    getSection: vi.fn().mockResolvedValue(null),
    getSectionsByParent: vi.fn().mockResolvedValue([]),
    getNextSection: vi.fn().mockResolvedValue(null),
    getPreviousSection: vi.fn().mockResolvedValue(null),
    getParentSection: vi.fn().mockResolvedValue(null),
    getAllSectionSummaries: (...args: unknown[]) => getAllSectionSummaries(...args),
  },
}));

vi.mock('./helpers/sessionNotifier', () => ({
  markSessionDirty: vi.fn(),
}));

const PANEL = 'test_panel';
const ABBR = 'book_pp';

const getPs = () => useBookStore.getState().getPanelState(PANEL);

describe('useBookStore.loadSectionSummaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBookStore.setState({ availableBooks: [], loadingBooks: false, panels: new Map() });
    useBookStore.getState().initPanel(PANEL);
  });

  it('stores the summaries and clears the loading flag on success', async () => {
    getAllSectionSummaries.mockResolvedValue([{ section_id: 1, title: 'Chapter 1' }]);

    await useBookStore.getState().loadSectionSummaries(PANEL, ABBR);

    expect(getPs().sectionSummariesByTab.get(ABBR)).toEqual([{ section_id: 1, title: 'Chapter 1' }]);
    expect(getPs().loadingSummariesByTab.get(ABBR)).toBe(false);
    expect(getPs().summariesErrorByTab.get(ABBR)).toBeNull();
  });

  it('records an empty result on failure so the attempt is visible to consumers', async () => {
    getAllSectionSummaries.mockRejectedValue(new Error('database is locked'));

    await useBookStore.getState().loadSectionSummaries(PANEL, ABBR);

    expect(getPs().sectionSummariesByTab.has(ABBR)).toBe(true);
    expect(getPs().sectionSummariesByTab.get(ABBR)).toEqual([]);
    expect(getPs().loadingSummariesByTab.get(ABBR)).toBe(false);
  });

  it('surfaces the failure message so the Contents dialog can offer a retry', async () => {
    getAllSectionSummaries.mockRejectedValue(new Error('database is locked'));

    await useBookStore.getState().loadSectionSummaries(PANEL, ABBR);

    expect(getPs().summariesErrorByTab.get(ABBR)).toBe('database is locked');
  });

  it('reuses the same empty array across repeated failures', async () => {
    // Identity matters: a fresh [] per failure changes the dependencies of any
    // effect watching the summaries, which is what made the retry unbounded.
    getAllSectionSummaries.mockRejectedValue(new Error('nope'));

    await useBookStore.getState().loadSectionSummaries(PANEL, ABBR);
    const first = getPs().sectionSummariesByTab.get(ABBR);
    await useBookStore.getState().loadSectionSummaries(PANEL, ABBR);
    const second = getPs().sectionSummariesByTab.get(ABBR);

    expect(second).toBe(first);
  });

  it('clears a previous error when a retry succeeds', async () => {
    getAllSectionSummaries.mockRejectedValueOnce(new Error('nope'));
    await useBookStore.getState().loadSectionSummaries(PANEL, ABBR);
    expect(getPs().summariesErrorByTab.get(ABBR)).toBe('nope');

    getAllSectionSummaries.mockResolvedValue([{ section_id: 1, title: 'Chapter 1' }]);
    await useBookStore.getState().loadSectionSummaries(PANEL, ABBR);

    expect(getPs().summariesErrorByTab.get(ABBR)).toBeNull();
    expect(getPs().sectionSummariesByTab.get(ABBR)).toHaveLength(1);
  });

  it('drops the summaries error along with the tab when it is closed', async () => {
    getAllSectionSummaries.mockRejectedValue(new Error('nope'));
    useBookStore.getState().openBook(PANEL, ABBR, "Pilgrim's Progress");
    await useBookStore.getState().loadSectionSummaries(PANEL, ABBR);

    useBookStore.getState().closeBook(PANEL, ABBR);

    expect(getPs().summariesErrorByTab.has(ABBR)).toBe(false);
    expect(getPs().sectionSummariesByTab.has(ABBR)).toBe(false);
  });
});
