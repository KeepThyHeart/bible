/**
 * Core-event dispatch sites (task 0123): a fixture module (defined here, not a production
 * built-in) declares all four hooks. Inactive or disabled, the sites build no payload and
 * the handlers hear nothing; active, the real store sites deliver; disabled again, silence.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VerseIdHelper } from '@bible/core';
import type { HookEventPayloads } from '@bible/core/browser';

vi.mock('../../services/electronAPI', () => ({
  bibleAPI: {
    getAvailableBibles: vi.fn().mockResolvedValue([]),
    getInitialData: vi.fn().mockResolvedValue(null),
    getBookName: vi.fn().mockResolvedValue('John'),
    getChapter: vi.fn().mockResolvedValue({ verses: [] }),
    getVerse: vi.fn().mockResolvedValue(null),
  },
  commentaryAPI: {
    getAvailableCommentaries: vi.fn().mockResolvedValue([]),
    getEntriesForVerse: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('../../stores/helpers/sessionNotifier', () => ({ markSessionDirty: vi.fn() }));

import { featureModules } from '../moduleHost';
import { useBibleStore } from '../../stores/useBibleStore';
import { usePreferencesStore } from '../../stores/usePreferencesStore';
import { emitSelectionChanged, resetReaderHookMemory } from './readerHooks';

const PANEL = 'reader_hooks_panel';
const KJV = { abbreviation: 'KJV', name: 'King James Version', database_path: 'bible_kjv.db', module_id: 1 };
const V16 = VerseIdHelper.calculate(43, 3, 16);
const V18 = VerseIdHelper.calculate(43, 3, 18);

const received: Array<[string, unknown]> = [];
const record = (event: string) => (payload: unknown) => received.push([event, payload]);

function fixtureManifest() {
  return {
    id: 'fixture',
    hooks: [
      { event: 'reader.verseChanged' as const },
      { event: 'reader.chapterRendered' as const },
      { event: 'reader.selectionChanged' as const },
      { event: 'settings.changed' as const },
    ],
    activationEvents: ['onStartupFinished' as const],
    contributes: {},
  };
}

function setOverride(value: string) {
  window.localStorage.setItem('kth.modules', value);
  featureModules.reconcile();
}

function showChapter() {
  const ps = useBibleStore.getState().getPanelState(PANEL);
  const tab = ps.openTabs[ps.activeTabIndex];
  const verses = [{ verse_id: VerseIdHelper.calculate(43, 3, 1), book_number: 43, chapter: 3, verse: 1, text: 'x' }];
  useBibleStore.setState({
    panels: new Map(useBibleStore.getState().panels).set(PANEL, {
      ...ps,
      versesByTab: new Map(ps.versesByTab).set(tab.tabId, verses),
      loadingByTab: new Map(ps.loadingByTab).set(tab.tabId, false),
    }),
  });
}

function drive() {
  const s = useBibleStore.getState();
  s.setSelectedVerse(PANEL, V16);
  s.extendSelectionTo(PANEL, V18);
  s.setSelectedVerse(PANEL, null);
  showChapter();
  usePreferencesStore.getState().setGlobalFontScale(1.25 + Math.random());
}

const load = vi.fn(async () => ({
  hooks: {
    'reader.verseChanged': record('verse'),
    'reader.chapterRendered': record('chapter'),
    'reader.selectionChanged': record('selection'),
    'settings.changed': record('setting'),
  },
}));
featureModules.add(fixtureManifest(), { id: 'fixture', load } as never);

beforeEach(async () => {
  received.length = 0;
  resetReaderHookMemory();
  window.localStorage.clear();
  useBibleStore.setState({ panels: new Map(), availableBibles: [KJV], initialLoadComplete: false });
  useBibleStore.getState().initPanel(PANEL);
  useBibleStore.getState().openBible(PANEL, KJV.abbreviation, KJV.name);
  load.mockClear();
  featureModules.reconcile();
});

describe('reader hook dispatch sites', () => {
  it('while the fixture is not active: no handler call, no payload built', () => {
    const getIds = vi.fn(() => [1]);
    emitSelectionChanged(getIds, 'KJV');
    drive();
    expect(getIds).not.toHaveBeenCalled();
    expect(received).toEqual([]);
    expect(load).not.toHaveBeenCalled();
    expect(featureModules.hasSubscribers('reader.verseChanged')).toBe(false);
  });

  it('while disabled by override: nothing is built or delivered, even after activation attempts', async () => {
    setOverride('-fixture');
    await featureModules.fire('onStartupFinished');
    const getIds = vi.fn(() => [1]);
    emitSelectionChanged(getIds, 'KJV');
    drive();
    expect(getIds).not.toHaveBeenCalled();
    expect(received).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it('once active it receives payloads from the real store sites; after disabling, nothing', async () => {
    await featureModules.fire('onStartupFinished');
    expect(featureModules.isActive('fixture')).toBe(true);

    const s = useBibleStore.getState();
    s.setSelectedVerse(PANEL, V16);
    s.extendSelectionTo(PANEL, V18);
    s.setSelectedVerse(PANEL, null);
    showChapter();
    showChapter(); // same chapter again: deduped
    usePreferencesStore.getState().setGlobalFontScale(1.5);

    const get = <E extends keyof HookEventPayloads>(e: string) => received.filter(([k]) => k === e).map(([, p]) => p as HookEventPayloads[E]);
    expect(get('verse')).toEqual([{ verseId: V16, module: 'KJV' }]);
    expect(get('selection')).toEqual([
      { verseIds: [V16], module: 'KJV' },
      { verseIds: [V16, V16 + 1, V18], module: 'KJV' },
      { verseIds: [], module: 'KJV' },
    ]);
    expect(get('chapter')).toEqual([{ book: 43, chapter: 3, module: 'KJV' }]);
    expect(get('setting')).toEqual([{ key: 'globalFontScale' }]);

    setOverride('-fixture');
    expect(featureModules.hasSubscribers('reader.verseChanged')).toBe(false);
    const before = received.length;
    const getIds = vi.fn(() => [1]);
    emitSelectionChanged(getIds, 'KJV');
    drive();
    expect(getIds).not.toHaveBeenCalled();
    expect(received.length).toBe(before);
  });
});
