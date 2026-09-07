import { describe, it, expect, beforeEach } from 'vitest';
import { BibleTabController, DEFAULT_STUDY_OPTIONS } from './BibleTabController';

describe('BibleTabController', () => {
  let ctrl: BibleTabController;

  beforeEach(() => {
    ctrl = new BibleTabController();
  });

  // ==========================================================================
  // Initial State
  // ==========================================================================

  describe('initial state', () => {
    it('should start with no tabs', () => {
      expect(ctrl.getTabCount()).toBe(0);
      expect(ctrl.getAllTabs()).toEqual([]);
    });

    it('should return undefined for active tab when empty', () => {
      expect(ctrl.getActiveTab()).toBeUndefined();
    });

    it('should return undefined for active navigation when empty', () => {
      expect(ctrl.getActiveNavigation()).toBeUndefined();
    });

    it('should default to non-parallel view', () => {
      expect(ctrl.getIsParallelViewMode()).toBe(false);
      expect(ctrl.getParallelVersions()).toEqual([]);
    });
  });

  // ==========================================================================
  // openTab
  // ==========================================================================

  describe('openTab', () => {
    it('should open a new tab and return a tab ID', () => {
      const tabId = ctrl.openTab({ abbreviation: 'KJV', name: 'King James Version' });

      expect(tabId).toBeTruthy();
      expect(ctrl.getTabCount()).toBe(1);
      expect(ctrl.getActiveTab()!.abbreviation).toBe('KJV');
    });

    it('should set the new tab as active', () => {
      ctrl.openTab({ abbreviation: 'KJV', name: 'King James Version' });
      ctrl.openTab({ abbreviation: 'ESV', name: 'English Standard Version' });

      expect(ctrl.getActiveTabIndex()).toBe(1);
      expect(ctrl.getActiveTab()!.abbreviation).toBe('ESV');
    });

    it('should inherit passage from active tab if not specified', () => {
      ctrl.openTab({
        abbreviation: 'KJV',
        name: 'KJV',
        bookNumber: 45,
        chapter: 8,
        bookName: 'Romans',
      });
      ctrl.openTab({ abbreviation: 'ESV', name: 'ESV' });

      const esv = ctrl.getActiveTab()!;
      expect(esv.bookNumber).toBe(45);
      expect(esv.chapter).toBe(8);
      expect(esv.bookName).toBe('Romans');
    });

    it('should default to John 3 when no active tab exists', () => {
      ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });

      const tab = ctrl.getActiveTab()!;
      expect(tab.bookNumber).toBe(43);
      expect(tab.chapter).toBe(3);
      expect(tab.bookName).toBe('John');
    });

    it('should switch to existing tab if same abbreviation is opened', () => {
      const id1 = ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });
      ctrl.openTab({ abbreviation: 'ESV', name: 'ESV' });
      const id2 = ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });

      expect(id1).toBe(id2);
      expect(ctrl.getTabCount()).toBe(2);
      expect(ctrl.getActiveTabIndex()).toBe(0);
    });

    it('should apply default display mode of reading', () => {
      ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });
      expect(ctrl.getActiveTab()!.displayMode).toBe('reading');
    });

    it('should accept custom display mode', () => {
      ctrl.openTab({ abbreviation: 'KJV', name: 'KJV', displayMode: 'study' });
      expect(ctrl.getActiveTab()!.displayMode).toBe('study');
    });

    it('should initialize study options to defaults', () => {
      ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });
      expect(ctrl.getActiveTab()!.studyOptions).toEqual(DEFAULT_STUDY_OPTIONS);
    });

    it('should seed navigation history when selectedVerseId is provided', () => {
      ctrl.openTab({
        abbreviation: 'KJV',
        name: 'KJV',
        selectedVerseId: 43003016,
        bookNumber: 43,
        chapter: 3,
        bookName: 'John',
      });

      const nav = ctrl.getActiveNavigation()!;
      expect(nav.getHistory()).toHaveLength(1);
      expect(nav.getCurrentEntry()!.verseId).toBe(43003016);
    });
  });

  // ==========================================================================
  // closeTab
  // ==========================================================================

  describe('closeTab', () => {
    it('should close a tab by ID', () => {
      const tabId = ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });
      const closed = ctrl.closeTab(tabId);

      expect(closed).toBe(true);
      expect(ctrl.getTabCount()).toBe(0);
    });

    it('should return false for non-existent tab ID', () => {
      expect(ctrl.closeTab('nonexistent')).toBe(false);
    });

    it('should adjust active index when closing active tab', () => {
      ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });
      const esv = ctrl.openTab({ abbreviation: 'ESV', name: 'ESV' });
      ctrl.openTab({ abbreviation: 'NIV', name: 'NIV' });

      // ESV is at index 1, make it active
      ctrl.switchTab(1);
      ctrl.closeTab(esv);

      // Should fall back to index 0
      expect(ctrl.getActiveTabIndex()).toBe(0);
      expect(ctrl.getActiveTab()!.abbreviation).toBe('KJV');
    });

    it('should adjust active index when closing tab before active', () => {
      const kjv = ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });
      ctrl.openTab({ abbreviation: 'ESV', name: 'ESV' });
      ctrl.openTab({ abbreviation: 'NIV', name: 'NIV' });

      // Active is NIV (index 2)
      expect(ctrl.getActiveTabIndex()).toBe(2);
      ctrl.closeTab(kjv); // close index 0

      expect(ctrl.getActiveTabIndex()).toBe(1);
      expect(ctrl.getActiveTab()!.abbreviation).toBe('NIV');
    });

    it('should handle closing the last remaining tab', () => {
      const tabId = ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });
      ctrl.closeTab(tabId);

      expect(ctrl.getTabCount()).toBe(0);
      expect(ctrl.getActiveTabIndex()).toBe(0);
    });
  });

  // ==========================================================================
  // switchTab
  // ==========================================================================

  describe('switchTab', () => {
    it('should switch to a different tab', () => {
      ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });
      ctrl.openTab({ abbreviation: 'ESV', name: 'ESV' });

      const switched = ctrl.switchTab(0);

      expect(switched).toBe(true);
      expect(ctrl.getActiveTabIndex()).toBe(0);
      expect(ctrl.getActiveTab()!.abbreviation).toBe('KJV');
    });

    it('should return false for out-of-range index', () => {
      ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });
      expect(ctrl.switchTab(5)).toBe(false);
      expect(ctrl.switchTab(-1)).toBe(false);
    });

    it('should return false when switching to same index', () => {
      ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });
      expect(ctrl.switchTab(0)).toBe(false);
    });
  });

  // ==========================================================================
  // reorderTabs
  // ==========================================================================

  describe('reorderTabs', () => {
    beforeEach(() => {
      ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });
      ctrl.openTab({ abbreviation: 'ESV', name: 'ESV' });
      ctrl.openTab({ abbreviation: 'NIV', name: 'NIV' });
    });

    it('should move a tab from one position to another', () => {
      // Active is NIV at index 2
      ctrl.switchTab(0); // switch to KJV
      ctrl.reorderTabs(2, 0); // move NIV from 2 to 0

      const tabs = ctrl.getAllTabs();
      expect(tabs[0].abbreviation).toBe('NIV');
      expect(tabs[1].abbreviation).toBe('KJV');
      expect(tabs[2].abbreviation).toBe('ESV');
    });

    it('should update active index when the active tab is moved', () => {
      ctrl.switchTab(0); // KJV is active at index 0
      ctrl.reorderTabs(0, 2); // move KJV from 0 to 2

      expect(ctrl.getActiveTabIndex()).toBe(2);
      expect(ctrl.getActiveTab()!.abbreviation).toBe('KJV');
    });

    it('should adjust active index when source < active <= destination', () => {
      // NIV is active at index 2
      ctrl.reorderTabs(0, 2); // move KJV from 0 past active

      // Active was at 2, source(0) < active(2), dest(2) >= active(2) -> active--
      expect(ctrl.getActiveTabIndex()).toBe(1);
      expect(ctrl.getActiveTab()!.abbreviation).toBe('NIV');
    });

    it('should return false for invalid indices', () => {
      expect(ctrl.reorderTabs(-1, 0)).toBe(false);
      expect(ctrl.reorderTabs(0, 5)).toBe(false);
    });
  });

  // ==========================================================================
  // getTab / getNavigation
  // ==========================================================================

  describe('getTab / getNavigation', () => {
    it('should retrieve a tab by ID', () => {
      const tabId = ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });
      const tab = ctrl.getTab(tabId);

      expect(tab).toBeDefined();
      expect(tab!.abbreviation).toBe('KJV');
    });

    it('should return undefined for unknown tab ID', () => {
      expect(ctrl.getTab('unknown')).toBeUndefined();
    });

    it('should get navigation for a specific tab', () => {
      const tabId = ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });
      const nav = ctrl.getNavigation(tabId);
      expect(nav).toBeDefined();
    });

    it('should return undefined navigation for unknown tab', () => {
      expect(ctrl.getNavigation('unknown')).toBeUndefined();
    });
  });

  // ==========================================================================
  // Tab State Updates
  // ==========================================================================

  describe('setDisplayMode', () => {
    it('should update display mode', () => {
      const tabId = ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });
      ctrl.setDisplayMode(tabId, 'study');

      expect(ctrl.getTab(tabId)!.displayMode).toBe('study');
    });

    it('should not throw for unknown tab', () => {
      expect(() => ctrl.setDisplayMode('unknown', 'study')).not.toThrow();
    });
  });

  describe('setStudyOptions', () => {
    it('should merge partial study options', () => {
      const tabId = ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });
      ctrl.setStudyOptions(tabId, { showInterlinear: true });

      const opts = ctrl.getTab(tabId)!.studyOptions;
      expect(opts.showInterlinear).toBe(true);
      expect(opts.showFootnotes).toBe(true); // unchanged from default
    });
  });

  describe('updateTabPassage', () => {
    it('should update passage details', () => {
      const tabId = ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });
      ctrl.updateTabPassage(tabId, {
        bookNumber: 1,
        chapter: 1,
        bookName: 'Genesis',
        selectedVerseId: 1001001,
      });

      const tab = ctrl.getTab(tabId)!;
      expect(tab.bookNumber).toBe(1);
      expect(tab.chapter).toBe(1);
      expect(tab.bookName).toBe('Genesis');
      expect(tab.selectedVerseId).toBe(1001001);
    });
  });

  describe('changeTabVersion', () => {
    it('should change version while keeping passage', () => {
      const tabId = ctrl.openTab({
        abbreviation: 'KJV',
        name: 'KJV',
        bookNumber: 43,
        chapter: 3,
        bookName: 'John',
      });

      ctrl.changeTabVersion(tabId, 'ESV', 'English Standard Version', 2);

      const tab = ctrl.getTab(tabId)!;
      expect(tab.abbreviation).toBe('ESV');
      expect(tab.name).toBe('English Standard Version');
      expect(tab.moduleId).toBe(2);
      expect(tab.bookNumber).toBe(43); // passage unchanged
      expect(tab.chapter).toBe(3);
    });
  });

  // ==========================================================================
  // Parallel View
  // ==========================================================================

  describe('parallel view', () => {
    it('should toggle parallel mode', () => {
      expect(ctrl.getIsParallelViewMode()).toBe(false);
      ctrl.toggleParallelView();
      expect(ctrl.getIsParallelViewMode()).toBe(true);
      ctrl.toggleParallelView();
      expect(ctrl.getIsParallelViewMode()).toBe(false);
    });

    it('should set parallel versions', () => {
      ctrl.setParallelVersions(['KJV', 'ESV', 'NIV']);
      expect(ctrl.getParallelVersions()).toEqual(['KJV', 'ESV', 'NIV']);
    });

    it('should return a copy of parallel versions', () => {
      ctrl.setParallelVersions(['KJV']);
      const versions = ctrl.getParallelVersions();
      versions.push('ESV');
      expect(ctrl.getParallelVersions()).toEqual(['KJV']); // unchanged
    });
  });

  // ==========================================================================
  // Serialization
  // ==========================================================================

  describe('serializeState / restoreState', () => {
    it('should round-trip all tab state', () => {
      ctrl.openTab({
        abbreviation: 'KJV',
        name: 'KJV',
        bookNumber: 43,
        chapter: 3,
        bookName: 'John',
        selectedVerseId: 43003016,
      });
      ctrl.openTab({
        abbreviation: 'ESV',
        name: 'ESV',
        bookNumber: 1,
        chapter: 1,
        bookName: 'Genesis',
      });
      ctrl.switchTab(0);
      ctrl.setDisplayMode(ctrl.getActiveTab()!.tabId, 'study');
      ctrl.toggleParallelView();
      ctrl.setParallelVersions(['KJV', 'ESV']);

      const serialized = ctrl.serializeState();

      const restored = new BibleTabController();
      restored.restoreState(serialized);

      expect(restored.getTabCount()).toBe(2);
      expect(restored.getActiveTabIndex()).toBe(0);
      expect(restored.getActiveTab()!.abbreviation).toBe('KJV');
      expect(restored.getActiveTab()!.displayMode).toBe('study');
      expect(restored.getIsParallelViewMode()).toBe(true);
      expect(restored.getParallelVersions()).toEqual(['KJV', 'ESV']);

      // Second tab
      const tabs = restored.getAllTabs();
      expect(tabs[1].abbreviation).toBe('ESV');
      expect(tabs[1].bookName).toBe('Genesis');
    });

    it('should restore per-tab navigation state', () => {
      const tabId = ctrl.openTab({
        abbreviation: 'KJV',
        name: 'KJV',
        bookNumber: 43,
        chapter: 3,
        bookName: 'John',
        selectedVerseId: 43003016,
      });

      // Add some navigation history
      const nav = ctrl.getNavigation(tabId)!;
      nav.addEntry({ verseId: 1001001, bookNumber: 1, chapter: 1, bookName: 'Genesis' });

      const serialized = ctrl.serializeState();
      const restored = new BibleTabController();
      restored.restoreState(serialized);

      const restoredTab = restored.getAllTabs()[0];
      const restoredNav = restored.getNavigation(restoredTab.tabId)!;

      expect(restoredNav.getHistory()).toHaveLength(2); // seed + added
    });

    it('should serialize empty state', () => {
      const serialized = ctrl.serializeState();
      expect(serialized.tabs).toEqual([]);
      expect(serialized.activeTabIndex).toBe(0);
    });

    it('should handle restoring state with out-of-bounds activeTabIndex', () => {
      ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });
      const serialized = ctrl.serializeState();
      serialized.activeTabIndex = 99; // out of bounds

      const restored = new BibleTabController();
      restored.restoreState(serialized);

      // Should not crash; activeTabIndex may be out of bounds but tabs restored
      expect(restored.getTabCount()).toBe(1);
    });

    it('should handle restoring empty tabs array', () => {
      const restored = new BibleTabController();
      restored.restoreState({
        tabs: [],
        activeTabIndex: 0,
        isParallelViewMode: false,
        parallelVersions: [],
      });

      expect(restored.getTabCount()).toBe(0);
      expect(restored.getActiveTab()).toBeUndefined();
    });

    it('should restore display mode across serialization', () => {
      const tabId = ctrl.openTab({
        abbreviation: 'KJV',
        name: 'KJV',
        bookNumber: 1,
        chapter: 1,
        bookName: 'Genesis',
      });
      ctrl.setDisplayMode(tabId, 'reading');
      ctrl.setStudyOptions(tabId, { showFootnotes: false });

      const serialized = ctrl.serializeState();
      const restored = new BibleTabController();
      restored.restoreState(serialized);

      const tab = restored.getActiveTab()!;
      expect(tab.displayMode).toBe('reading');
      expect(tab.studyOptions.showFootnotes).toBe(false);
    });
  });

  // ==========================================================================
  // Edge Cases (Hardening)
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle closing the only tab', () => {
      const tabId = ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });
      ctrl.closeTab(tabId);
      expect(ctrl.getTabCount()).toBe(0);
      expect(ctrl.getActiveTab()).toBeUndefined();
    });

    it('should handle closing a non-existent tab', () => {
      ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });
      ctrl.closeTab('nonexistent-id');
      expect(ctrl.getTabCount()).toBe(1); // unchanged
    });

    it('should handle switching to invalid tab index', () => {
      ctrl.openTab({ abbreviation: 'KJV', name: 'KJV' });
      ctrl.switchTab(99);
      // Should not crash; behavior may vary
      expect(ctrl.getTabCount()).toBe(1);
    });

    it('should handle getTab with non-existent id', () => {
      expect(ctrl.getTab('nonexistent')).toBeUndefined();
    });

    it('should handle getNavigation with non-existent tab id', () => {
      expect(ctrl.getNavigation('nonexistent')).toBeUndefined();
    });

    it('should handle setDisplayMode on non-existent tab', () => {
      // Should not throw
      ctrl.setDisplayMode('nonexistent', 'study');
    });

    it('should handle opening many tabs', () => {
      for (let i = 0; i < 20; i++) {
        ctrl.openTab({ abbreviation: `V${i}`, name: `Version ${i}` });
      }
      expect(ctrl.getTabCount()).toBe(20);
      expect(ctrl.getAllTabs()).toHaveLength(20);
    });
  });
});
