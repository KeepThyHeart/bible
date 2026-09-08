/**
 * Unit tests for useCommentaryStore
 *
 * Tests the Overview tab data, pin/unpin logic, and tab management
 * for the Commentary pane's Zustand store with per-panel-instance state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCommentaryStore } from './useCommentaryStore';

// Mock the electronAPI commentary module
vi.mock('../services/electronAPI', () => ({
  commentaryAPI: {
    getAvailableCommentaries: vi.fn().mockResolvedValue([]),
    getEntriesForVerse: vi.fn().mockResolvedValue([]),
    getNextVerseWithContent: vi.fn().mockResolvedValue(null),
    getPreviousVerseWithContent: vi.fn().mockResolvedValue(null),
    getAllEntrySummaries: vi.fn().mockResolvedValue([]),
    batchRestoreSession: vi.fn().mockResolvedValue({
      availableCommentaries: [],
      entriesByTab: {},
      summariesByTab: {}
    }),
  }
}));

// Mock session notifier to prevent side effects during tests
vi.mock('./helpers/sessionNotifier', () => ({
  markSessionDirty: vi.fn()
}));

const TEST_PANEL = 'test_panel';

describe('useCommentaryStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useCommentaryStore.setState({
      availableCommentaries: [],
      loadingCommentaries: false,
      mutedModules: new Set(),
      promotedModules: new Set(),
      panels: new Map(),
    });
    // Initialize the test panel
    useCommentaryStore.getState().initPanel(TEST_PANEL);
  });

  // Helper to get panel state
  const getPs = () => useCommentaryStore.getState().getPanelState(TEST_PANEL);

  describe('Pin/Unpin', () => {
    it('should start unpinned', () => {
      const ps = getPs();
      expect(ps.pinned).toBe(false);
      expect(ps.pinnedVerseId).toBeNull();
    });

    it('should pin to current verse when toggling on', () => {
      // Set currentVerseId on the panel
      const panels = useCommentaryStore.getState().panels;
      const newPanels = new Map(panels);
      newPanels.set(TEST_PANEL, { ...getPs(), currentVerseId: 43003016 });
      useCommentaryStore.setState({ panels: newPanels });

      useCommentaryStore.getState().togglePin(TEST_PANEL);

      const ps = getPs();
      expect(ps.pinned).toBe(true);
      expect(ps.pinnedVerseId).toBe(43003016);
    });

    it('should unpin when toggling off', () => {
      const panels = useCommentaryStore.getState().panels;
      const newPanels = new Map(panels);
      newPanels.set(TEST_PANEL, { ...getPs(), currentVerseId: 43003016, pinned: true, pinnedVerseId: 43003016 });
      useCommentaryStore.setState({ panels: newPanels });

      useCommentaryStore.getState().togglePin(TEST_PANEL);

      const ps = getPs();
      expect(ps.pinned).toBe(false);
      expect(ps.pinnedVerseId).toBeNull();
    });

    it('should not pin when no current verse', () => {
      useCommentaryStore.getState().togglePin(TEST_PANEL);

      const ps = getPs();
      expect(ps.pinned).toBe(false);
      expect(ps.pinnedVerseId).toBeNull();
    });

    it('should unpin via unpin() convenience method', () => {
      const panels = useCommentaryStore.getState().panels;
      const newPanels = new Map(panels);
      newPanels.set(TEST_PANEL, { ...getPs(), pinned: true, pinnedVerseId: 43003016, currentVerseId: 43003016 });
      useCommentaryStore.setState({ panels: newPanels });

      useCommentaryStore.getState().unpin(TEST_PANEL);

      const ps = getPs();
      expect(ps.pinned).toBe(false);
      expect(ps.pinnedVerseId).toBeNull();
    });

    it('should prevent syncWithBibleVerse from changing verse when pinned', async () => {
      const panels = useCommentaryStore.getState().panels;
      const newPanels = new Map(panels);
      newPanels.set(TEST_PANEL, {
        ...getPs(),
        currentVerseId: 43003016,
        pinned: true,
        pinnedVerseId: 43003016,
        openTabs: [{ abbreviation: 'TSK', name: 'Treasury of Scripture Knowledge' }]
      });
      useCommentaryStore.setState({ panels: newPanels });

      await useCommentaryStore.getState().syncWithBibleVerse(TEST_PANEL, 1001001);

      expect(getPs().currentVerseId).toBe(43003016);
    });

    it('should track the live Bible-pane verse separately from the frozen currentVerseId while pinned', async () => {
      // Pin at verse A (John 3:16).
      const panels = useCommentaryStore.getState().panels;
      const newPanels = new Map(panels);
      newPanels.set(TEST_PANEL, {
        ...getPs(),
        currentVerseId: 43003016,
        pinned: true,
        pinnedVerseId: 43003016,
        liveBibleVerseId: 43003016,
        openTabs: [{ abbreviation: 'TSK', name: 'Treasury of Scripture Knowledge' }]
      });
      useCommentaryStore.setState({ panels: newPanels });

      // The Bible pane navigates on to verse B (Genesis 1:1).
      await useCommentaryStore.getState().syncWithBibleVerse(TEST_PANEL, 1001001);

      const ps = getPs();
      // currentVerseId stays frozen at the pinned verse (existing behavior)...
      expect(ps.currentVerseId).toBe(43003016);
      expect(ps.pinnedVerseId).toBe(43003016);
      // ...but liveBibleVerseId follows the Bible pane to verse B, which is
      // what the pinned-sync banner is driven off of.
      expect(ps.liveBibleVerseId).toBe(1001001);
    });

    it('should allow syncWithBibleVerse when not pinned', async () => {
      const panels = useCommentaryStore.getState().panels;
      const newPanels = new Map(panels);
      newPanels.set(TEST_PANEL, {
        ...getPs(),
        currentVerseId: 43003016,
        pinned: false,
        pinnedVerseId: null,
        openTabs: []
      });
      useCommentaryStore.setState({ panels: newPanels });

      await useCommentaryStore.getState().syncWithBibleVerse(TEST_PANEL, 1001001);

      expect(getPs().currentVerseId).toBe(1001001);
    });
  });

  describe('Tab Management', () => {
    it('should open a new commentary tab', () => {
      useCommentaryStore.getState().openCommentary(TEST_PANEL, 'TSK', 'Treasury of Scripture Knowledge');

      const ps = getPs();
      expect(ps.openTabs).toHaveLength(1);
      expect(ps.openTabs[0].abbreviation).toBe('TSK');
      expect(ps.activeTabIndex).toBe(0);
    });

    it('should switch to existing tab instead of duplicating', () => {
      useCommentaryStore.getState().openCommentary(TEST_PANEL, 'TSK', 'Treasury of Scripture Knowledge');
      useCommentaryStore.getState().openCommentary(TEST_PANEL, 'MHC', 'Matthew Henry');
      useCommentaryStore.getState().openCommentary(TEST_PANEL, 'TSK', 'Treasury of Scripture Knowledge');

      const ps = getPs();
      expect(ps.openTabs).toHaveLength(2);
      expect(ps.activeTabIndex).toBe(0); // Back to TSK
    });

    it('should close a tab and adjust active index', () => {
      useCommentaryStore.getState().openCommentary(TEST_PANEL, 'TSK', 'TSK');
      useCommentaryStore.getState().openCommentary(TEST_PANEL, 'MHC', 'MHC');
      useCommentaryStore.getState().openCommentary(TEST_PANEL, 'JFB', 'JFB');

      // Set active to JFB (index 2)
      useCommentaryStore.getState().setActiveTab(TEST_PANEL, 2);

      useCommentaryStore.getState().closeCommentary(TEST_PANEL, 'MHC');

      const ps = getPs();
      expect(ps.openTabs).toHaveLength(2);
      expect(ps.openTabs.map(t => t.abbreviation)).toEqual(['TSK', 'JFB']);
      expect(ps.activeTabIndex).toBe(1);
    });

    it('should reorder tabs correctly', () => {
      useCommentaryStore.getState().openCommentary(TEST_PANEL, 'TSK', 'TSK');
      useCommentaryStore.getState().openCommentary(TEST_PANEL, 'MHC', 'MHC');
      useCommentaryStore.getState().openCommentary(TEST_PANEL, 'JFB', 'JFB');
      useCommentaryStore.getState().setActiveTab(TEST_PANEL, 0); // TSK active

      // Move TSK (index 0) to index 2
      useCommentaryStore.getState().reorderTabs(TEST_PANEL, 0, 2);

      const ps = getPs();
      expect(ps.openTabs.map(t => t.abbreviation)).toEqual(['MHC', 'JFB', 'TSK']);
      expect(ps.activeTabIndex).toBe(2); // TSK moved to index 2
    });

    it('should set active tab by index', () => {
      useCommentaryStore.getState().openCommentary(TEST_PANEL, 'TSK', 'TSK');
      useCommentaryStore.getState().openCommentary(TEST_PANEL, 'MHC', 'MHC');

      useCommentaryStore.getState().setActiveTab(TEST_PANEL, 0);
      expect(getPs().activeTabIndex).toBe(0);

      useCommentaryStore.getState().setActiveTab(TEST_PANEL, 1);
      expect(getPs().activeTabIndex).toBe(1);
    });

    it('should ignore invalid tab indices', () => {
      useCommentaryStore.getState().openCommentary(TEST_PANEL, 'TSK', 'TSK');
      useCommentaryStore.getState().setActiveTab(TEST_PANEL, 0);

      useCommentaryStore.getState().setActiveTab(TEST_PANEL, -1);
      expect(getPs().activeTabIndex).toBe(0);

      useCommentaryStore.getState().setActiveTab(TEST_PANEL, 5);
      expect(getPs().activeTabIndex).toBe(0);
    });
  });

  describe('Overview/Home Tab Data', () => {
    it('should start with empty home data', () => {
      const ps = getPs();
      expect(ps.homeData).toEqual([]);
      expect(ps.homeLoading).toBe(false);
      expect(ps.homeDataVerseId).toBeNull();
    });

    it('should load home data for a verse', async () => {
      useCommentaryStore.setState({
        availableCommentaries: [
          { abbreviation: 'TSK', name: 'TSK', database_path: 'tsk.db' },
          { abbreviation: 'MHC', name: 'MHC', database_path: 'mhc.db' }
        ]
      });

      const { commentaryAPI } = await import('../services/electronAPI');
      (commentaryAPI.getEntriesForVerse as ReturnType<typeof vi.fn>)
        .mockImplementation((abbr: string) => {
          if (abbr === 'TSK') {
            return Promise.resolve([
              { entry_id: 1, content: 'TSK content', entry_level: 'verse', word_count: 50 }
            ]);
          }
          return Promise.resolve([
            { entry_id: 2, content: 'MHC longer content here', entry_level: 'verse', word_count: 200 }
          ]);
        });

      await useCommentaryStore.getState().loadHomeData(TEST_PANEL, 43003016);

      const ps = getPs();
      expect(ps.homeData).toHaveLength(2);
      expect(ps.homeDataVerseId).toBe(43003016);
      expect(ps.homeLoading).toBe(false);
      expect(ps.homeData[0].totalWordCount).toBeGreaterThanOrEqual(ps.homeData[1].totalWordCount);
    });

    it('should skip loading if already loaded for same verse', async () => {
      // Pre-set home data on the panel
      const panels = useCommentaryStore.getState().panels;
      const newPanels = new Map(panels);
      newPanels.set(TEST_PANEL, {
        ...getPs(),
        homeDataVerseId: 43003016,
        homeData: [{ abbreviation: 'TSK', name: 'TSK', entries: [], totalWordCount: 100 }],
      });
      useCommentaryStore.setState({
        panels: newPanels,
        availableCommentaries: [{ abbreviation: 'TSK', name: 'TSK', database_path: 'tsk.db' }]
      });

      const { commentaryAPI } = await import('../services/electronAPI');
      const spy = commentaryAPI.getEntriesForVerse as ReturnType<typeof vi.fn>;
      spy.mockClear();

      await useCommentaryStore.getState().loadHomeData(TEST_PANEL, 43003016);

      expect(spy).not.toHaveBeenCalled();
    });

    it('should filter out modules with no content', async () => {
      useCommentaryStore.setState({
        availableCommentaries: [
          { abbreviation: 'TSK', name: 'TSK', database_path: 'tsk.db' },
          { abbreviation: 'EMPTY', name: 'Empty Module', database_path: 'empty.db' }
        ]
      });

      const { commentaryAPI } = await import('../services/electronAPI');
      (commentaryAPI.getEntriesForVerse as ReturnType<typeof vi.fn>)
        .mockImplementation((abbr: string) => {
          if (abbr === 'TSK') {
            return Promise.resolve([{ entry_id: 1, content: 'Content', entry_level: 'verse', word_count: 50 }]);
          }
          return Promise.resolve([]);
        });

      await useCommentaryStore.getState().loadHomeData(TEST_PANEL, 43003016);

      const ps = getPs();
      expect(ps.homeData).toHaveLength(1);
      expect(ps.homeData[0].abbreviation).toBe('TSK');
    });
  });

  describe('Browse Mode', () => {
    it('should toggle browse mode for a tab', () => {
      useCommentaryStore.getState().openCommentary(TEST_PANEL, 'TSK', 'TSK');

      expect(getPs().browseModeByTab.get('TSK')).toBeFalsy();

      useCommentaryStore.getState().toggleBrowseMode(TEST_PANEL, 'TSK');
      expect(getPs().browseModeByTab.get('TSK')).toBe(true);

      useCommentaryStore.getState().toggleBrowseMode(TEST_PANEL, 'TSK');
      expect(getPs().browseModeByTab.get('TSK')).toBe(false);
    });

    it('should not sync tabs in browse mode', async () => {
      const panels = useCommentaryStore.getState().panels;
      const newPanels = new Map(panels);
      newPanels.set(TEST_PANEL, {
        ...getPs(),
        openTabs: [
          { abbreviation: 'TSK', name: 'TSK' },
          { abbreviation: 'MHC', name: 'MHC' }
        ],
        browseModeByTab: new Map([['TSK', true]])
      });
      useCommentaryStore.setState({ panels: newPanels });

      const { commentaryAPI } = await import('../services/electronAPI');
      const spy = commentaryAPI.getEntriesForVerse as ReturnType<typeof vi.fn>;
      spy.mockClear();
      spy.mockResolvedValue([]);

      await useCommentaryStore.getState().syncWithBibleVerse(TEST_PANEL, 1001001);

      const calls = spy.mock.calls.map((c: string[]) => c[0]);
      expect(calls).not.toContain('TSK');
      expect(calls).toContain('MHC');
    });
  });

  describe('Close Tab Cleanup', () => {
    it('should clean up all related maps when closing a tab', () => {
      // Set up panel with data in all maps
      const panels = useCommentaryStore.getState().panels;
      const newPanels = new Map(panels);
      newPanels.set(TEST_PANEL, {
        ...getPs(),
        openTabs: [{ abbreviation: 'TSK', name: 'TSK' }],
        activeTabIndex: 0,
        entriesByTab: new Map([['TSK', [{ entry_id: 1, content: 'test', entry_level: 'verse' as const }]]]),
        loadingByTab: new Map([['TSK', false]]),
        errorByTab: new Map<string, string | null>([['TSK', null]]),
        browseModeByTab: new Map([['TSK', false]]),
        entrySummariesByTab: new Map([['TSK', [{ verse_id_start: 1, entry_level: 'verse' as const }]]]),
        loadingSummariesByTab: new Map([['TSK', false]]),
      });
      useCommentaryStore.setState({ panels: newPanels });

      useCommentaryStore.getState().closeCommentary(TEST_PANEL, 'TSK');

      const ps = getPs();
      expect(ps.openTabs).toHaveLength(0);
      expect(ps.entriesByTab.has('TSK')).toBe(false);
      expect(ps.loadingByTab.has('TSK')).toBe(false);
      expect(ps.errorByTab.has('TSK')).toBe(false);
      expect(ps.browseModeByTab.has('TSK')).toBe(false);
      expect(ps.entrySummariesByTab.has('TSK')).toBe(false);
      expect(ps.loadingSummariesByTab.has('TSK')).toBe(false);
    });
  });

  describe('Panel Isolation', () => {
    it('should maintain independent state across panels', () => {
      const PANEL_A = 'panel_a';
      const PANEL_B = 'panel_b';
      useCommentaryStore.getState().initPanel(PANEL_A);
      useCommentaryStore.getState().initPanel(PANEL_B);

      // Open different commentaries in each panel
      useCommentaryStore.getState().openCommentary(PANEL_A, 'TSK', 'TSK');
      useCommentaryStore.getState().openCommentary(PANEL_B, 'MHC', 'MHC');
      useCommentaryStore.getState().openCommentary(PANEL_B, 'JFB', 'JFB');

      const psA = useCommentaryStore.getState().getPanelState(PANEL_A);
      const psB = useCommentaryStore.getState().getPanelState(PANEL_B);

      expect(psA.openTabs).toHaveLength(1);
      expect(psA.openTabs[0].abbreviation).toBe('TSK');

      expect(psB.openTabs).toHaveLength(2);
      expect(psB.openTabs[0].abbreviation).toBe('MHC');
      expect(psB.openTabs[1].abbreviation).toBe('JFB');
    });

    it('should pin one panel independently of another', async () => {
      const PANEL_A = 'panel_a';
      const PANEL_B = 'panel_b';
      useCommentaryStore.getState().initPanel(PANEL_A);
      useCommentaryStore.getState().initPanel(PANEL_B);

      // Set verse on both panels
      const panels = useCommentaryStore.getState().panels;
      const newPanels = new Map(panels);
      newPanels.set(PANEL_A, { ...useCommentaryStore.getState().getPanelState(PANEL_A), currentVerseId: 43003016 });
      newPanels.set(PANEL_B, { ...useCommentaryStore.getState().getPanelState(PANEL_B), currentVerseId: 43003016 });
      useCommentaryStore.setState({ panels: newPanels });

      // Pin only panel A
      useCommentaryStore.getState().togglePin(PANEL_A);

      expect(useCommentaryStore.getState().getPanelState(PANEL_A).pinned).toBe(true);
      expect(useCommentaryStore.getState().getPanelState(PANEL_B).pinned).toBe(false);
    });
  });
});
