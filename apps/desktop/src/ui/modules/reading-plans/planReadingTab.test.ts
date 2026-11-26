import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReadingPlans } from '@bible/core/browser';
import { useLayoutStore } from '../../stores/useLayoutStore';
import {
  PLAN_READING_PANEL_ID, activatePlanReadingTab, applyReadingTabTitle, inScope, openInReadingTab,
  readingTabExists, resetPlanReadingTabForTests, scopeOf,
} from './planReadingTab';
import { usePreferencesStore } from '../../stores/usePreferencesStore';
import { openPlanReading, resetActiveReadingForTests } from './useActiveReadingStore';
import { installTestService, uninstallTestService } from './ReadingPlans/testSupport';

const bibleState = {
  panel: { currentBook: 1, currentChapter: 1, openTabs: [{ abbreviation: 'KJV' }] },
  navigateToVerse: vi.fn(async (_id: string, verse: number) => {
    const { book, chapter } = ReadingPlans.splitVid(verse);
    bibleState.panel = { ...bibleState.panel, currentBook: book, currentChapter: chapter };
    listeners.forEach((l) => l());
  }),
};
const listeners = new Set<() => void>();
vi.mock('../../stores/useBibleStore', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBibleStore: {
    getState: () => ({
      getPanelState: () => bibleState.panel,
      navigateToVerse: bibleState.navigateToVerse,
      getDefaultBible: () => 'KJV',
      resolveDefaultBible: async () => 'KJV',
    }),
    subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
  },
}));
const openApp = vi.fn().mockResolvedValue(undefined);
vi.mock('../../apps/appHost', async (importOriginal) => ({ ...(await importOriginal<object>()), openApp: (...a: unknown[]) => openApp(...a) }));
vi.mock('../../services/electronAPI', () => ({ bibleAPI: { getAllBooks: vi.fn().mockResolvedValue([]) } }));
const navigateCurrent = vi.fn();
vi.mock('../../stores/crossStoreBridge', () => ({ navigateToVerseInPrimary: (...a: unknown[]) => navigateCurrent(...a) }));

const { vid } = ReadingPlans;
const reading = { start: vid(1, 4, 1), end: vid(1, 6, 8) } as ReadingPlans.Reading;

/** A fake dockview: panels added through `addPanel` live in `docked`; `getPanel` sees only those. */
function fakeDock() {
  const docked = new Map<string, { api: { setActive: ReturnType<typeof vi.fn> }; group: object }>();
  const addPanel = vi.fn((_type: string, _key: string | undefined, _title: string, _pos: unknown, _sub: unknown, id?: string) => {
    useLayoutStore.getState().registerPanel({ panelId: id!, contentType: 'bible', contentKey: _key, displayName: _title });
    docked.set(id!, { api: { setActive: vi.fn() }, group: {} });
    return id!;
  });
  const api = { getPanel: (id: string) => docked.get(id) } as never;
  useLayoutStore.setState({ dockviewApi: api, panels: new Map(), titleOverrides: new Map(), lastActiveBiblePanelId: null, addPanel } as never);
  return { docked, addPanel };
}

describe('plan reading tab', () => {
  beforeEach(() => {
    resetPlanReadingTabForTests();
    bibleState.panel = { currentBook: 1, currentChapter: 1, openTabs: [{ abbreviation: 'KJV' }] };
    bibleState.navigateToVerse.mockClear();
    openApp.mockClear();
    navigateCurrent.mockClear();
    usePreferencesStore.setState({ readingPlanOpenIn: 'tab' } as never);
  });
  afterEach(() => { uninstallTestService(); resetActiveReadingForTests(); });

  it('scopes a reading to its first book and chapter range', () => {
    const s = scopeOf(reading, 'Genesis 4-6 · plan');
    expect(s).toMatchObject({ book: 1, chapterFrom: 4, chapterTo: 6 });
    expect(inScope(s, 1, 5)).toBe(true);
    expect(inScope(s, 1, 7)).toBe(false);
    expect(inScope(s, 2, 5)).toBe(false);
    // A reading across books (Genesis 49 - Exodus 2): the last book's chapters count too.
    const x = scopeOf({ start: ReadingPlans.vid(1, 49, 1), end: ReadingPlans.vid(2, 2, 10) }, 't');
    expect(x).toMatchObject({ book: 1, chapterFrom: 49, lastBook: 2, lastChapter: 2 });
    expect(inScope(x, 1, 50)).toBe(true);
    expect(inScope(x, 2, 2)).toBe(true);
    expect(inScope(x, 2, 3)).toBe(false);
    expect(inScope(x, 1, 48)).toBe(false);
  });

  it('creates the tab with the fixed panel id and the plan title, then reuses it', async () => {
    const { addPanel, docked } = fakeDock();
    expect(await openInReadingTab({ reading }, 'Genesis 4-6 · plan')).toBe(true);
    expect(addPanel).toHaveBeenCalledTimes(1);
    expect(addPanel.mock.calls[0][5]).toBe(PLAN_READING_PANEL_ID);
    expect(PLAN_READING_PANEL_ID).toBe('bible_plan-reading');
    expect(useLayoutStore.getState().titleOverrides.get(PLAN_READING_PANEL_ID)).toBe('Genesis 4-6 · plan');
    expect(readingTabExists()).toBe(true);
    const next = { start: vid(2, 1, 1), end: vid(2, 3, 1) } as ReadingPlans.Reading;
    expect(await openInReadingTab({ reading: next }, 'Exodus 1-3 · plan')).toBe(true);
    expect(addPanel).toHaveBeenCalledTimes(1);
    expect(bibleState.navigateToVerse).toHaveBeenCalledWith(PLAN_READING_PANEL_ID, next.start);
    expect(docked.get(PLAN_READING_PANEL_ID)!.api.setActive).toHaveBeenCalled();
    expect(useLayoutStore.getState().titleOverrides.get(PLAN_READING_PANEL_ID)).toBe('Exodus 1-3 · plan');
  });

  it('drops the title override outside the range and restores it when back inside', async () => {
    fakeDock();
    await openInReadingTab({ reading }, 'Genesis 4-6 · plan');
    const dispose = activatePlanReadingTab();
    bibleState.panel = { ...bibleState.panel, currentBook: 1, currentChapter: 5 };
    applyReadingTabTitle();
    expect(useLayoutStore.getState().titleOverrides.get(PLAN_READING_PANEL_ID)).toBe('Genesis 4-6 · plan');
    bibleState.panel = { ...bibleState.panel, currentChapter: 9 };
    listeners.forEach((l) => l());
    expect(useLayoutStore.getState().titleOverrides.has(PLAN_READING_PANEL_ID)).toBe(false);
    bibleState.panel = { ...bibleState.panel, currentChapter: 6 };
    listeners.forEach((l) => l());
    expect(useLayoutStore.getState().titleOverrides.get(PLAN_READING_PANEL_ID)).toBe('Genesis 4-6 · plan');
    dispose.dispose();
  });

  it('recreates the tab when the layout store still lists it but dockview lost it (preset switch / close)', async () => {
    const { addPanel, docked } = fakeDock();
    await openInReadingTab({ reading }, 'Genesis 4-6 · plan');
    docked.delete(PLAN_READING_PANEL_ID); // closed in dockview; the layout store entry is stale
    expect(readingTabExists()).toBe(false);
    expect(await openInReadingTab({ reading }, 'Genesis 4-6 · plan')).toBe(true);
    expect(addPanel).toHaveBeenCalledTimes(2);
    expect(readingTabExists()).toBe(true);
  });

  it('clears the override when the tab is gone, and re-derives it from today after a restart', async () => {
    const { service } = installTestService(new Date(2026, 9, 1, 12, 0));
    await service.startPlan('stock:gospels-30');
    const { useReadingPlanStore } = await import('./useReadingPlanStore');
    await useReadingPlanStore.getState().refresh();
    const { docked } = fakeDock();
    // A restored layout: the panel exists, no in-memory scope, the tab shows Matthew 2 (today's Matthew 1-5).
    useLayoutStore.getState().registerPanel({ panelId: PLAN_READING_PANEL_ID, contentType: 'bible', displayName: 'x' });
    docked.set(PLAN_READING_PANEL_ID, { api: { setActive: vi.fn() }, group: {} });
    bibleState.panel = { ...bibleState.panel, currentBook: 40, currentChapter: 2 };
    applyReadingTabTitle();
    expect(useLayoutStore.getState().titleOverrides.get(PLAN_READING_PANEL_ID)).toMatch(/Matthew 1-5/);
    docked.delete(PLAN_READING_PANEL_ID);
    applyReadingTabTitle();
    expect(useLayoutStore.getState().titleOverrides.has(PLAN_READING_PANEL_ID)).toBe(false);
  });

  it("openPlanReading uses the reading tab by default and the current tab with the 'current' pref", async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:gospels-30');
    const plan = await service.planFor(e);
    const r = plan.days[0].readings[0];
    const { addPanel } = fakeDock();
    openPlanReading({ enrollmentId: e.id, day: 1, index: 0, reading: r });
    await vi.waitFor(() => expect(addPanel).toHaveBeenCalledTimes(1));
    expect(navigateCurrent).not.toHaveBeenCalled();
    usePreferencesStore.setState({ readingPlanOpenIn: 'current' } as never);
    openPlanReading({ enrollmentId: e.id, day: 1, index: 0, reading: r });
    expect(navigateCurrent).toHaveBeenCalledWith(r.start);
    expect(addPanel).toHaveBeenCalledTimes(1);
  });

  it('falls back to the current tab when dockview is not ready', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:gospels-30');
    const r = (await service.planFor(e)).days[0].readings[0];
    useLayoutStore.setState({ dockviewApi: null } as never);
    openPlanReading({ enrollmentId: e.id, day: 1, index: 0, reading: r });
    expect(navigateCurrent).toHaveBeenCalledWith(r.start);
  });
});
