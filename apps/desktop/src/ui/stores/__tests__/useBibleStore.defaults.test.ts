/**
 * Unit tests for the Bible store's fresh-profile defaults.
 *
 * Reading mode hides verse numbers - the wrong landing state for a Bible
 * *study* app. These tests pin Standard mode (verse numbers visible) as the
 * default for newly created tabs.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getInitialData = vi.fn();

vi.mock('../../services/electronAPI', () => ({
  bibleAPI: {
    getAvailableBibles: vi.fn().mockResolvedValue([]),
    getInitialData: (...args: unknown[]) => getInitialData(...args),
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

import { DEFAULT_DISPLAY_MODE, useBibleStore } from '../useBibleStore';
import { useLayoutStore } from '../useLayoutStore';

const PANEL = 'test_panel_defaults';

const KJV = {
  abbreviation: 'KJV',
  name: 'King James Version',
  database_path: 'bible_kjv.db',
  module_id: 1,
};

describe('useBibleStore - default display mode', () => {
  beforeEach(() => {
    useBibleStore.setState({ panels: new Map(), availableBibles: [KJV], initialLoadComplete: false });
    useBibleStore.getState().initPanel(PANEL);
    getInitialData.mockReset();
  });

  it('defaults to Standard so verse numbers are visible', () => {
    expect(DEFAULT_DISPLAY_MODE).toBe('standard');
  });

  it('creates the first-run tab in the default display mode', async () => {
    getInitialData.mockResolvedValue({
      availableBibles: [KJV],
      defaultBible: KJV,
      defaultVerses: [{ verse_id: 43003016, book_number: 43, chapter: 3, verse: 16, text: 'For God so loved...' }],
      bookNumber: 43,
      chapter: 3,
      bookName: 'John',
    });

    await useBibleStore.getState().loadInitialData();

    const ps = useBibleStore.getState().getPanelState(PANEL);
    expect(ps.openTabs).toHaveLength(1);
    expect(ps.openTabs[0].displayMode).toBe('standard');
  });

  it('opens new translation tabs in the default display mode', () => {
    useBibleStore.getState().openBible(PANEL, 'KJV', 'King James Version');

    const ps = useBibleStore.getState().getPanelState(PANEL);
    expect(ps.openTabs[0].displayMode).toBe('standard');
  });

  it('honors an explicitly requested display mode', () => {
    useBibleStore.getState().openBible(PANEL, 'KJV', 'King James Version', 'reading');

    const ps = useBibleStore.getState().getPanelState(PANEL);
    expect(ps.openTabs[0].displayMode).toBe('reading');
  });

  it('inherits the source passage\'s display mode when opening another passage', async () => {
    // A user who switched to Reading mode keeps it for passages opened from
    // that panel; only brand-new panels get the default.
    useBibleStore.getState().openBible(PANEL, 'KJV', 'King James Version', 'reading');

    const addPanel = vi.fn().mockReturnValue('bible_new');
    useLayoutStore.setState({ addPanel });

    const newPanelId = await useBibleStore.getState().openPassageInNewPanel(1, 1, 1, PANEL);

    expect(newPanelId).toBe('bible_new');
    // The seed handed to the layout carries the inherited mode: Genesis 1:1 in
    // the source panel's translation and display mode.
    expect(addPanel).toHaveBeenCalledTimes(1);
    expect(addPanel.mock.calls[0][0]).toBe('bible');
    expect(addPanel.mock.calls[0][1]).toBe('KJV|1|1|1001001|reading');
  });

  it('opens a passage as a new panel rather than a second tab', async () => {
    useBibleStore.getState().openBible(PANEL, 'KJV', 'King James Version');
    useLayoutStore.setState({ addPanel: vi.fn().mockReturnValue('bible_new') });

    await useBibleStore.getState().openPassageInNewPanel(1, 1, 1, PANEL);

    // The source panel still shows exactly one passage: a passage is a
    // top-level panel, never a sub-tab.
    expect(useBibleStore.getState().getPanelState(PANEL).openTabs).toHaveLength(1);
  });
});
