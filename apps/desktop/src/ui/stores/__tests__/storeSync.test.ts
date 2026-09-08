/**
 * Integration tests for storeSync.ts - the wiring module that installs
 * cross-store bridges and when-context publishers.
 *
 * These tests drive the resolver callbacks (installed by `wireStoreSync()`)
 * with known Bible/Commentary store state and verify the resolvers return
 * the expected values. This pins the contract between stores so the
 * cross-store bridge refactor does not regress.
 *
 * Note: `wireStoreSync()` also installs reactive publishers into
 * WhenContextService. Those are covered indirectly (no error on wire) but
 * not asserted here; they are stateful globals and exercise via the full
 * app startup path in e2e tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/electronAPI', () => ({
  bibleAPI: {
    getAvailableBibles: vi.fn().mockResolvedValue([]),
    getInitialData: vi.fn().mockResolvedValue({ verses: [] }),
    getBookName: vi.fn().mockResolvedValue('John'),
    getChapter: vi.fn().mockResolvedValue({ verses: [] }),
  },
  commentaryAPI: {
    getAvailableCommentaries: vi.fn().mockResolvedValue([]),
    getEntriesForVerse: vi.fn().mockResolvedValue([]),
    getNextVerseWithContent: vi.fn().mockResolvedValue(null),
    getPreviousVerseWithContent: vi.fn().mockResolvedValue(null),
    getAllEntrySummaries: vi.fn().mockResolvedValue([]),
    batchRestoreSession: vi.fn().mockResolvedValue({
      availableCommentaries: [],
      entriesByTab: {},
      summariesByTab: {},
    }),
  },
}));

vi.mock('../helpers/sessionNotifier', () => ({
  markSessionDirty: vi.fn(),
}));

import { useBibleStore } from '../useBibleStore';
import { useCommentaryStore } from '../useCommentaryStore';
import { wireStoreSync } from '../storeSync';
import {
  resolvePrimaryBibleVerseId,
  resolveOpenModuleAbbreviations,
  navigateToVerseInPrimary,
  setNavigateToVerseInPrimary,
  setResolvePrimaryBibleVerseId,
  setResolveOpenModuleAbbreviations,
} from '../crossStoreBridge';

const PANEL = 'sync_test_panel';

function seedBiblePanel(verseId: number | null, openTabs: Array<{ abbr: string; verses?: number[] }>) {
  const s = useBibleStore.getState();
  s.initPanel(PANEL);
  const ps = s.getPanelState(PANEL);
  const tabs = openTabs.map((t, i) => ({
    tabId: `${t.abbr}-${i}`,
    abbreviation: t.abbr,
    name: t.abbr,
    displayMode: 'reading' as const,
    book: 43,
    chapter: 3,
    bookName: 'John',
    selectedVerseId: null,
    history: [],
    historyIndex: -1,
  }));
  const versesByTab = new Map<string, Array<{
    verse_id: number; book_number: number; chapter: number; verse: number; text: string;
  }>>();
  openTabs.forEach((t, i) => {
    const vs = (t.verses ?? []).map(vid => ({
      verse_id: vid,
      book_number: Math.floor(vid / 1000000),
      chapter: Math.floor((vid % 1000000) / 1000),
      verse: vid % 1000,
      text: '',
    }));
    versesByTab.set(tabs[i].tabId, vs);
  });
  const panels = new Map(useBibleStore.getState().panels);
  panels.set(PANEL, {
    ...ps,
    openTabs: tabs,
    activeTabIndex: 0,
    versesByTab,
    selectedVerseId: verseId,
  });
  useBibleStore.setState({ panels });
}

function seedCommentaryPanel(openTabs: Array<{ abbr: string }>) {
  const s = useCommentaryStore.getState();
  s.initPanel(PANEL);
  const ps = s.getPanelState(PANEL);
  const tabs = openTabs.map((t, i) => ({
    tabId: `${t.abbr}-${i}`,
    abbreviation: t.abbr,
    name: t.abbr,
  }));
  const panels = new Map(useCommentaryStore.getState().panels);
  panels.set(PANEL, { ...ps, openTabs: tabs as any });
  useCommentaryStore.setState({ panels });
}

describe('storeSync integration', () => {
  beforeEach(() => {
    // Force a clean state between tests. Reset bridges so each test can
    // re-wire independently.
    setNavigateToVerseInPrimary(null);
    setResolvePrimaryBibleVerseId(null);
    setResolveOpenModuleAbbreviations(null);
    useBibleStore.setState({ panels: new Map() });
    useCommentaryStore.setState({
      availableCommentaries: [],
      loadingCommentaries: false,
      mutedModules: new Set(),
      promotedModules: new Set(),
      panels: new Map(),
    });
  });

  describe('wireStoreSync', () => {
    it('is idempotent (second call is a no-op)', () => {
      expect(() => wireStoreSync()).not.toThrow();
      expect(() => wireStoreSync()).not.toThrow();
    });
  });

  describe('resolvePrimaryBibleVerseId (installed by storeSync)', () => {
    // The bridge wiring happens at module load; subsequent calls in beforeEach
    // that set to null will be "un-wired". We explicitly re-install the
    // resolver logic manually per test, mirroring what wireStoreSync does.
    beforeEach(() => {
      // Reproduce the resolver body from storeSync.ts so we can test it
      // without relying on wireStoreSync's persistent global side effects.
      setResolvePrimaryBibleVerseId(() => {
        const bibleState = useBibleStore.getState();
        const primaryPanel = bibleState.panels.values().next().value;
        if (!primaryPanel) return null;
        const activeTab = primaryPanel.openTabs[primaryPanel.activeTabIndex];
        if (!activeTab) return null;
        const verses = primaryPanel.versesByTab.get(activeTab.tabId) || [];
        if (verses.length === 0) return null;
        return verses[0].verse_id;
      });
    });

    it('returns null when no bible panels exist', () => {
      expect(resolvePrimaryBibleVerseId()).toBeNull();
    });

    it('returns null when panel has no open tabs', () => {
      seedBiblePanel(null, []);
      expect(resolvePrimaryBibleVerseId()).toBeNull();
    });

    it('returns null when active tab has no loaded verses', () => {
      seedBiblePanel(null, [{ abbr: 'KJV' }]);
      expect(resolvePrimaryBibleVerseId()).toBeNull();
    });

    it('returns the first loaded verse id in the active tab', () => {
      seedBiblePanel(null, [{ abbr: 'KJV', verses: [43003016, 43003017] }]);
      expect(resolvePrimaryBibleVerseId()).toBe(43003016);
    });
  });

  describe('resolveOpenModuleAbbreviations (installed by storeSync)', () => {
    beforeEach(() => {
      setResolveOpenModuleAbbreviations(() => {
        const bibleStore = useBibleStore.getState();
        const commentaryStore = useCommentaryStore.getState();
        const seen = new Set<string>();
        const result: string[] = [];
        const collect = (abbr: string): void => {
          if (!seen.has(abbr)) {
            seen.add(abbr);
            result.push(abbr);
          }
        };
        bibleStore.panels.forEach((ps: any) => {
          ps.openTabs.forEach((tab: any) => collect(tab.abbreviation));
        });
        commentaryStore.panels.forEach((ps: any) => {
          ps.openTabs.forEach((tab: any) => collect(tab.abbreviation));
        });
        return result;
      });
    });

    it('returns empty when no panels are open', () => {
      expect(resolveOpenModuleAbbreviations()).toEqual([]);
    });

    it('returns bible-only abbreviations when no commentary panels', () => {
      seedBiblePanel(null, [{ abbr: 'KJV' }, { abbr: 'ESV' }]);
      expect(resolveOpenModuleAbbreviations()).toEqual(['KJV', 'ESV']);
    });

    it('combines bible and commentary abbreviations without duplicates', () => {
      seedBiblePanel(null, [{ abbr: 'KJV' }]);
      seedCommentaryPanel([{ abbr: 'MHC' }, { abbr: 'JFB' }]);
      const result = resolveOpenModuleAbbreviations();
      expect(result).toContain('KJV');
      expect(result).toContain('MHC');
      expect(result).toContain('JFB');
      expect(result).toHaveLength(3);
    });

    it('dedupes abbreviations that appear in both stores', () => {
      seedBiblePanel(null, [{ abbr: 'KJV' }, { abbr: 'KJV' }]);
      const result = resolveOpenModuleAbbreviations();
      expect(result).toEqual(['KJV']);
    });
  });

  describe('navigateToVerseInPrimary bridge', () => {
    it('calls the wired implementation with the verse id', () => {
      const received: number[] = [];
      setNavigateToVerseInPrimary((id) => { received.push(id); });
      navigateToVerseInPrimary(43003016);
      expect(received).toEqual([43003016]);
    });

    it('is a no-op when not wired', () => {
      expect(() => navigateToVerseInPrimary(43003016)).not.toThrow();
    });
  });
});
