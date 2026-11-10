/**
 * Search tabs (task 0210): the wiring between search sessions and dockview
 * panels (`searchTabsSync`). The layout and search stores are the real ones;
 * dockview is a small fake and the session store's `markDirty` is a spy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const markDirty = vi.fn();
vi.mock('./useSessionStore', () => ({
  useSessionStore: { getState: () => ({ markDirty }) },
}));

import { useLayoutStore, type LayoutPanel } from './useLayoutStore';
import { useSearchStore, freshSessionFields, resetSearchSessionBookkeepingForTests, hostedSessionIds, selectedHostedSessionId } from './useSearchStore';
import { usePreferencesStore } from './usePreferencesStore';
import { showSearchResultsPanel, closeSearchResultsPanel } from './crossStoreBridge';
import { installSearchTabsSync, restoreSearchTabsFromLayout, showSessionPanel } from './searchTabsSync';

interface FakeDockPanel {
  id: string;
  params: Record<string, unknown>;
  title?: string;
  api: { updateParameters: ReturnType<typeof vi.fn>; setActive: ReturnType<typeof vi.fn>; setTitle: ReturnType<typeof vi.fn>; title?: string };
}

let dockPanels: Map<string, FakeDockPanel>;
let fakeApi: { getPanel: (id: string) => FakeDockPanel | undefined };

const searchPanel = (id: string): LayoutPanel => ({ panelId: id, contentType: 'search', displayName: 'Search' });
const hostPanel = (id: string): LayoutPanel => ({ panelId: id, contentType: 'search', contentKey: 'host', displayName: 'Search' });
const biblePanel = (id: string): LayoutPanel => ({ panelId: id, contentType: 'bible', displayName: 'Bible' });

function addDock(id: string, params: Record<string, unknown> = {}): FakeDockPanel {
  const panel: FakeDockPanel = {
    id,
    params,
    // Dockview keeps the title in step with the saved query (updateSearchPanelMeta sets both).
    title: typeof params.searchQuery === 'string' ? params.searchQuery : undefined,
    api: {
      updateParameters: vi.fn((next: Record<string, unknown>) => { panel.params = next; }),
      setActive: vi.fn(),
      setTitle: vi.fn((t: string) => { panel.title = t; panel.api.title = t; }),
      title: typeof params.searchQuery === 'string' ? params.searchQuery : undefined,
    },
  };
  dockPanels.set(id, panel);
  return panel;
}

function setPanels(...panels: LayoutPanel[]): void {
  useLayoutStore.setState({ panels: new Map(panels.map((p) => [p.panelId, p])) });
}

let off: (() => void) | null;

// Tests replace some actions with spies; put the real ones back before each test.
const realRestoreSessions = useSearchStore.getState().restoreSessions;
const realRemovePanel = useLayoutStore.getState().removePanel;
const realOpenSearchResultsPanel = useLayoutStore.getState().openSearchResultsPanel;
const realOpenSearchHostPanel = useLayoutStore.getState().openSearchHostPanel;

beforeEach(() => {
  markDirty.mockReset();
  resetSearchSessionBookkeepingForTests();
  dockPanels = new Map();
  fakeApi = { getPanel: (id) => dockPanels.get(id) };
  useSearchStore.setState({
    ...freshSessionFields(false),
    activeSessionId: null,
    parkedSessions: {},
    sessionMeta: {},
    restoreSessions: realRestoreSessions,
  });
  useLayoutStore.setState({
    removePanel: realRemovePanel,
    openSearchResultsPanel: realOpenSearchResultsPanel,
    openSearchHostPanel: realOpenSearchHostPanel,
    dockviewApi: fakeApi as never,
    panels: new Map(),
    activePanelId: null,
  });
  usePreferencesStore.setState({ searchResultsPlacement: 'below' });
  off = null;
});

afterEach(() => {
  off?.();
  useLayoutStore.setState({ dockviewApi: null, panels: new Map(), activePanelId: null });
});

describe('restoreSearchTabsFromLayout', () => {
  it('keeps panels with a saved query (restoreSessions) and removes the ones without', () => {
    setPanels(searchPanel('s1'), searchPanel('s2'), searchPanel('s3'), biblePanel('b1'));
    addDock('s1', { searchQuery: '  faith ', searchSemantic: true });
    addDock('s2', {});
    addDock('s3', { searchQuery: '   ' });
    addDock('b1', {});
    const removePanel = vi.fn();
    useLayoutStore.setState({ removePanel: removePanel as never });
    const restoreSessions = vi.fn();
    useSearchStore.setState({ restoreSessions });

    restoreSearchTabsFromLayout(fakeApi as never);

    expect(restoreSessions).toHaveBeenCalledTimes(1);
    expect(restoreSessions).toHaveBeenCalledWith([{ id: 's1', query: 'faith', semantic: true }]);
    expect(removePanel.mock.calls.map((c) => c[0]).sort()).toEqual(['s2', 's3']);
  });

  it('a non-boolean semantic flag restores as keyword mode', () => {
    setPanels(searchPanel('s1'));
    addDock('s1', { searchQuery: 'grace', searchSemantic: 'yes' });
    const restoreSessions = vi.fn();
    useSearchStore.setState({ restoreSessions });
    useLayoutStore.setState({ removePanel: vi.fn() as never });

    restoreSearchTabsFromLayout(fakeApi as never);

    expect(restoreSessions).toHaveBeenCalledWith([{ id: 's1', query: 'grace', semantic: false }]);
  });

  it('does not call restoreSessions when no search tab has a query', () => {
    setPanels(searchPanel('s1'));
    addDock('s1', {});
    const removePanel = vi.fn();
    useLayoutStore.setState({ removePanel: removePanel as never });
    const restoreSessions = vi.fn();
    useSearchStore.setState({ restoreSessions });

    restoreSearchTabsFromLayout(fakeApi as never);

    expect(restoreSessions).not.toHaveBeenCalled();
    expect(removePanel).toHaveBeenCalledWith('s1');
  });

  it('with the real store the restored tab becomes a parked, pending session', () => {
    setPanels(searchPanel('s1'));
    addDock('s1', { searchQuery: 'faith' });

    restoreSearchTabsFromLayout(fakeApi as never);

    expect(useSearchStore.getState().parkedSessions.s1).toMatchObject({ query: 'faith', pendingRerun: true });
  });
});

describe('panel params sync', () => {
  it('writes the session query into the panel params and marks the layout dirty', () => {
    setPanels(searchPanel('s1'));
    const dock = addDock('s1', { contentType: 'search' });
    off = installSearchTabsSync();

    useSearchStore.setState({ activeSessionId: 's1', query: 'love', resultsForQuery: 'love' });

    expect(dock.api.updateParameters).toHaveBeenCalledWith({
      contentType: 'search',
      searchQuery: 'love',
      searchSemantic: false,
    });
    expect(markDirty).toHaveBeenCalled();
  });

  it('writes the meaning flag, and a parked session\'s query too', () => {
    setPanels(searchPanel('s1'), searchPanel('s2'));
    const d1 = addDock('s1');
    const d2 = addDock('s2');
    off = installSearchTabsSync();

    useSearchStore.setState({
      activeSessionId: 's1',
      resultsForQuery: 'love',
      isSemanticMode: true,
      parkedSessions: { s2: { ...freshSessionFields(false), query: 'hope', resultsForQuery: 'hope' } },
    });

    expect(d1.params).toMatchObject({ searchQuery: 'love', searchSemantic: true });
    expect(d2.params).toMatchObject({ searchQuery: 'hope', searchSemantic: false });
  });

  it('does not write or mark dirty when the params already match', () => {
    setPanels(searchPanel('s1'));
    const dock = addDock('s1', { searchQuery: 'love', searchSemantic: false });
    off = installSearchTabsSync();

    useSearchStore.setState({ activeSessionId: 's1', resultsForQuery: 'love' });

    expect(dock.api.updateParameters).not.toHaveBeenCalled();
    expect(markDirty).not.toHaveBeenCalled();
  });

  it('skips a session with nothing to name (no query yet)', () => {
    setPanels(searchPanel('s1'));
    const dock = addDock('s1');
    off = installSearchTabsSync();

    useSearchStore.setState({ activeSessionId: 's1', query: '', resultsForQuery: '' });

    expect(dock.api.updateParameters).not.toHaveBeenCalled();
    expect(markDirty).not.toHaveBeenCalled();
  });

  it('a pending search names the tab by the query being searched', () => {
    setPanels(searchPanel('s1'));
    const dock = addDock('s1');
    off = installSearchTabsSync();

    useSearchStore.setState({ activeSessionId: 's1', query: 'mercy', resultsForQuery: '', isSearching: true });

    expect(dock.params.searchQuery).toBe('mercy');
  });
});

describe('focusing a search tab activates its session', () => {
  beforeEach(() => {
    setPanels(searchPanel('s1'), searchPanel('s2'), biblePanel('b1'));
    useSearchStore.setState({
      activeSessionId: 's1',
      query: 'one',
      resultsForQuery: 'one',
      parkedSessions: { s2: { ...freshSessionFields(false), query: 'two', resultsForQuery: 'two' } },
      sessionMeta: { s1: { hasPanel: true, lastUsed: 1 }, s2: { hasPanel: true, lastUsed: 0 } },
    });
    addDock('s1', { searchQuery: 'one', searchSemantic: false });
    addDock('s2', { searchQuery: 'two', searchSemantic: false });
    off = installSearchTabsSync();
  });

  it('activating a parked search panel swaps its session in', () => {
    useLayoutStore.setState({ activePanelId: 's2' });

    const s = useSearchStore.getState();
    expect(s.activeSessionId).toBe('s2');
    expect(s.resultsForQuery).toBe('two');
    expect(s.parkedSessions.s1.resultsForQuery).toBe('one');
  });

  it('focusing a non-search panel leaves the active search alone', () => {
    useLayoutStore.setState({ activePanelId: 'b1' });
    expect(useSearchStore.getState().activeSessionId).toBe('s1');
  });

  it('focusing the already-active search panel changes nothing', () => {
    useLayoutStore.setState({ activePanelId: 's1' });
    expect(useSearchStore.getState().activeSessionId).toBe('s1');
    expect(useSearchStore.getState().parkedSessions.s2).toBeDefined();
  });
});

describe('bridges', () => {
  it('the show bridge opens the panel with the placement preference and reports the panel id or null', () => {
    usePreferencesStore.setState({ searchResultsPlacement: 'right' });
    const open = vi.fn().mockReturnValueOnce('s1').mockReturnValueOnce(null);
    useLayoutStore.setState({ openSearchResultsPanel: open as never });
    off = installSearchTabsSync();

    expect(showSearchResultsPanel('s1', { reveal: false, nearSessionId: 'sx' })).toBe('s1');
    expect(open).toHaveBeenCalledWith('s1', { reveal: false, placement: 'right' });
    expect(showSearchResultsPanel('s1', { reveal: true, nearSessionId: null })).toBeNull();
  });

  it('the show bridge does nothing without dockview', () => {
    useLayoutStore.setState({ dockviewApi: null });
    off = installSearchTabsSync();
    expect(showSearchResultsPanel('s1', { reveal: true, nearSessionId: null })).toBeNull();
  });

  it('the close bridge removes an existing panel and ignores an unknown one', () => {
    setPanels(searchPanel('s1'));
    const removePanel = vi.fn();
    useLayoutStore.setState({ removePanel: removePanel as never });
    off = installSearchTabsSync();

    closeSearchResultsPanel('s1');
    closeSearchResultsPanel('ghost');

    expect(removePanel).toHaveBeenCalledTimes(1);
    expect(removePanel).toHaveBeenCalledWith('s1');
  });

  it('disposing unwires the bridges and the subscriptions', () => {
    setPanels(searchPanel('s1'));
    const dock = addDock('s1');
    const dispose = installSearchTabsSync();
    dispose();

    // The bridge is gone: the crossStoreBridge returns its "nothing there" answer.
    expect(showSearchResultsPanel('s1', { reveal: true, nearSessionId: null })).toBeNull();
    useSearchStore.setState({ activeSessionId: 's1', resultsForQuery: 'love' });
    expect(dock.api.updateParameters).not.toHaveBeenCalled();
  });
});

describe('showSessionPanel: decision rules', () => {
  let openTab: ReturnType<typeof vi.fn>;
  let openHost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openTab = vi.fn((id: string) => id);
    openHost = vi.fn(() => 'host1');
    useLayoutStore.setState({ openSearchResultsPanel: openTab as never, openSearchHostPanel: openHost as never });
  });

  const hostSession = (id: string, host = 'host1') =>
    useSearchStore.setState({ sessionMeta: { ...useSearchStore.getState().sessionMeta, [id]: { hasPanel: true, lastUsed: 1, createdAt: 1, hostPanelId: host } } });

  it('no dockview: null', () => {
    useLayoutStore.setState({ dockviewApi: null });
    expect(showSessionPanel('s1', { reveal: true, nearSessionId: null })).toBeNull();
  });

  it('a session already hosted returns its host, focusing it only when revealing', () => {
    setPanels(hostPanel('host1'));
    const dock = addDock('host1');
    hostSession('s1');

    expect(showSessionPanel('s1', { reveal: false, nearSessionId: null })).toBe('host1');
    expect(dock.api.setActive).not.toHaveBeenCalled();
    expect(showSessionPanel('s1', { reveal: true, nearSessionId: null })).toBe('host1');
    expect(dock.api.setActive).toHaveBeenCalledTimes(1);
    expect(openTab).not.toHaveBeenCalled();
    expect(openHost).not.toHaveBeenCalled();
  });

  it('a session whose host panel is gone is not "already shown"', () => {
    hostSession('s1', 'gone');
    setPanels(searchPanel('s2'));
    addDock('s2');
    showSessionPanel('s1', { reveal: true, nearSessionId: null });
    expect(openTab).toHaveBeenCalledWith('s1', { reveal: true });
  });

  it('a session with its own panel goes through openSearchResultsPanel (rule 1)', () => {
    setPanels(searchPanel('s1'));
    addDock('s1');
    expect(showSessionPanel('s1', { reveal: false, nearSessionId: null })).toBe('s1');
    expect(openTab).toHaveBeenCalledWith('s1', { reveal: false });
    expect(openHost).not.toHaveBeenCalled();
  });

  it('a new session opened near a hosted session joins that host, even with own tabs open', () => {
    setPanels(hostPanel('host1'), searchPanel('t1'));
    const dock = addDock('host1');
    addDock('t1');
    hostSession('near');

    expect(showSessionPanel('new', { reveal: true, nearSessionId: 'near' })).toBe('host1');
    expect(dock.api.setActive).toHaveBeenCalledTimes(1);
    expect(openTab).not.toHaveBeenCalled();
  });

  it('a new session opened near an own tab joins that tab', () => {
    setPanels(searchPanel('t1'), hostPanel('host1'));
    addDock('t1');
    addDock('host1');
    showSessionPanel('new', { reveal: true, nearSessionId: 't1' });
    expect(openTab).toHaveBeenCalledWith('new', { reveal: true, nearSessionId: 't1' });
  });

  it('with an open host and no own tabs a new session goes to the host', () => {
    setPanels(hostPanel('host1'));
    addDock('host1');
    expect(showSessionPanel('new', { reveal: true, nearSessionId: null })).toBe('host1');
    expect(openTab).not.toHaveBeenCalled();
    expect(openHost).not.toHaveBeenCalled();
  });

  it('with own tabs open (and no host) a new session joins them', () => {
    setPanels(searchPanel('t1'));
    addDock('t1');
    usePreferencesStore.setState({ searchResultsPlacement: 'tab' });
    showSessionPanel('new', { reveal: false, nearSessionId: null });
    expect(openTab).toHaveBeenCalledWith('new', { reveal: false });
    expect(openHost).not.toHaveBeenCalled();
  });

  it('with own tabs AND a host open, own tabs win for a new session without a near session', () => {
    setPanels(searchPanel('t1'), hostPanel('host1'));
    addDock('t1');
    addDock('host1');
    showSessionPanel('new', { reveal: true, nearSessionId: null });
    expect(openTab).toHaveBeenCalledWith('new', { reveal: true });
  });

  it('a layout panel dockview no longer has is not an anchor', () => {
    setPanels(hostPanel('ghost'), searchPanel('ghost2'));
    usePreferencesStore.setState({ searchResultsPlacement: 'tab' });
    showSessionPanel('new', { reveal: true, nearSessionId: null });
    // The host is created inactive; the session is attached to it, then it is activated.
    expect(openHost).toHaveBeenCalledWith({ reveal: false });
  });

  it("nothing open and preference 'tab': openSearchHostPanel", () => {
    usePreferencesStore.setState({ searchResultsPlacement: 'tab' });
    expect(showSessionPanel('new', { reveal: false, nearSessionId: null })).toBe('host1');
    expect(openHost).toHaveBeenCalledWith({ reveal: false });
    expect(openTab).not.toHaveBeenCalled();
  });

  it("preference 'tab' with no right-hand group falls back to the full-height column", () => {
    openHost.mockReturnValue(null);
    usePreferencesStore.setState({ searchResultsPlacement: 'tab' });
    expect(showSessionPanel('new', { reveal: true, nearSessionId: null })).toBe('new');
    expect(openTab).toHaveBeenCalledWith('new', { reveal: true, placement: 'right' });
  });

  it.each(['below', 'right'] as const)("nothing open and preference '%s': openSearchResultsPanel with that placement", (placement) => {
    usePreferencesStore.setState({ searchResultsPlacement: placement });
    showSessionPanel('new', { reveal: true, nearSessionId: null });
    expect(openTab).toHaveBeenCalledWith('new', { reveal: true, placement });
    expect(openHost).not.toHaveBeenCalled();
  });
});

describe('search host panel: params sync and restore', () => {
  const hosted = (_id: string, lastUsed: number, query: string, semantic = false) => ({
    meta: { hasPanel: true, lastUsed, createdAt: lastUsed, hostPanelId: 'host1' },
    view: { ...freshSessionFields(semantic), query, resultsForQuery: query },
  });

  function seedHosted(specs: Array<[string, number, string, boolean?]>, activeId: string) {
    const meta: Record<string, ReturnType<typeof hosted>['meta']> = {};
    const parked: Record<string, ReturnType<typeof hosted>['view']> = {};
    let active: ReturnType<typeof hosted>['view'] | undefined;
    for (const [id, t, q, sem] of specs) {
      const h = hosted(id, t, q, !!sem);
      meta[id] = h.meta;
      if (id === activeId) active = h.view; else parked[id] = h.view;
    }
    useSearchStore.setState({ ...active!, activeSessionId: activeId, parkedSessions: parked, sessionMeta: meta });
  }

  it('writes searchTabs (in opening order) and searchSelected into the host params, and marks dirty', () => {
    setPanels(hostPanel('host1'));
    const dock = addDock('host1', { contentType: 'search', contentKey: 'host' });
    off = installSearchTabsSync();

    seedHosted([['a', 1, 'love'], ['b', 2, 'hope', true], ['c', 3, 'faith']], 'b');

    expect(dock.params).toMatchObject({
      contentType: 'search',
      contentKey: 'host',
      searchTabs: [
        { id: 'a', query: 'love', semantic: false },
        { id: 'b', query: 'hope', semantic: true },
        { id: 'c', query: 'faith', semantic: false },
      ],
      searchSelected: 'b',
    });
    expect(markDirty).toHaveBeenCalled();
    // The host keeps its generic title.
    expect(dock.api.setTitle).not.toHaveBeenCalled();
  });

  it('does not write again when nothing changed', () => {
    setPanels(hostPanel('host1'));
    const dock = addDock('host1');
    off = installSearchTabsSync();
    seedHosted([['a', 1, 'love']], 'a');
    dock.api.updateParameters.mockClear();
    markDirty.mockClear();

    useSearchStore.setState({ isSearching: false });

    expect(dock.api.updateParameters).not.toHaveBeenCalled();
    expect(markDirty).not.toHaveBeenCalled();
  });

  it('a changed selection is written', () => {
    setPanels(hostPanel('host1'));
    const dock = addDock('host1');
    off = installSearchTabsSync();
    seedHosted([['a', 1, 'love'], ['b', 2, 'hope']], 'b');

    useSearchStore.getState().activateSession('a');

    expect(dock.params.searchSelected).toBe('a');
  });

  it('sessions without a query are left out of searchTabs; a host with none is not written', () => {
    setPanels(hostPanel('host1'));
    const dock = addDock('host1');
    off = installSearchTabsSync();

    seedHosted([['a', 1, 'love'], ['b', 2, '']], 'a');
    expect((dock.params.searchTabs as unknown[]).length).toBe(1);

    dock.api.updateParameters.mockClear();
    seedHosted([['a', 1, '']], 'a');
    expect(dock.api.updateParameters).not.toHaveBeenCalled();
  });

  it('a host and an own tab are synced side by side', () => {
    setPanels(hostPanel('host1'), searchPanel('t1'));
    const hostDock = addDock('host1');
    const tabDock = addDock('t1');
    off = installSearchTabsSync();
    const own = hosted('a', 1, 'love');
    useSearchStore.setState({
      ...own.view,
      activeSessionId: 'a',
      parkedSessions: { t1: { ...freshSessionFields(false), query: 'solo', resultsForQuery: 'solo' } },
      sessionMeta: { a: own.meta, t1: { hasPanel: true, lastUsed: 0, createdAt: 0, hostPanelId: null } },
    });
    expect(hostDock.params.searchTabs).toEqual([{ id: 'a', query: 'love', semantic: false }]);
    expect(tabDock.params).toMatchObject({ searchQuery: 'solo' });
  });

  it('restore: the host\'s sub-tabs come back in order, the saved selection is the most recent', () => {
    setPanels(hostPanel('host1'));
    addDock('host1', {
      searchTabs: [
        { id: 'a', query: ' love ', semantic: false },
        { id: 'b', query: 'hope', semantic: true },
        { id: 'c', query: 'faith' },
      ],
      searchSelected: 'b',
    });

    restoreSearchTabsFromLayout(fakeApi as never);

    const s = useSearchStore.getState();
    expect(hostedSessionIds(s, 'host1')).toEqual(['a', 'b', 'c']);
    expect(selectedHostedSessionId(s, 'host1')).toBe('b');
    expect(s.parkedSessions.a).toMatchObject({ query: 'love', pendingRerun: true, isSemanticMode: false });
    expect(s.parkedSessions.b).toMatchObject({ query: 'hope', isSemanticMode: true });
    expect(s.parkedSessions.c).toMatchObject({ isSemanticMode: false });
    expect(s.sessionMeta.a.hostPanelId).toBe('host1');
  });

  it('restore: a host without valid tabs is removed; invalid entries are skipped', () => {
    setPanels(hostPanel('h1'), hostPanel('h2'), hostPanel('h3'));
    addDock('h1', {});
    addDock('h2', { searchTabs: [{ id: 'x', query: '   ' }, { id: 3, query: 'q' }, null] });
    addDock('h3', { searchTabs: [{ id: 'ok', query: 'fine' }, { query: 'noid' }] });
    const removePanel = vi.fn();
    useLayoutStore.setState({ removePanel: removePanel as never });

    restoreSearchTabsFromLayout(fakeApi as never);

    expect(removePanel.mock.calls.map((c) => c[0]).sort()).toEqual(['h1', 'h2']);
    expect(hostedSessionIds(useSearchStore.getState(), 'h3')).toEqual(['ok']);
  });

  it('restore: a non-array searchTabs is treated as none', () => {
    setPanels(hostPanel('h1'));
    addDock('h1', { searchTabs: 'oops' });
    const removePanel = vi.fn();
    useLayoutStore.setState({ removePanel: removePanel as never });
    restoreSearchTabsFromLayout(fakeApi as never);
    expect(removePanel).toHaveBeenCalledWith('h1');
  });

  it('round trip: what the sync wrote restores into the same sub-tabs and selection', () => {
    setPanels(hostPanel('host1'));
    const dock = addDock('host1');
    off = installSearchTabsSync();
    seedHosted([['a', 1, 'love'], ['b', 2, 'hope', true], ['c', 3, 'faith']], 'b');
    const saved = JSON.parse(JSON.stringify(dock.params));
    off(); off = null;

    // A restart: fresh stores, the saved params on the host.
    resetSearchSessionBookkeepingForTests();
    useSearchStore.setState({ ...freshSessionFields(false), activeSessionId: null, parkedSessions: {}, sessionMeta: {} });
    dockPanels = new Map();
    addDock('host1', saved);
    restoreSearchTabsFromLayout(fakeApi as never);

    const s = useSearchStore.getState();
    expect(hostedSessionIds(s, 'host1')).toEqual(['a', 'b', 'c']);
    expect(selectedHostedSessionId(s, 'host1')).toBe('b');
    expect(s.parkedSessions.b.isSemanticMode).toBe(true);
  });
});

describe('focusing a search host panel', () => {
  beforeEach(() => {
    setPanels(hostPanel('host1'), searchPanel('t1'), biblePanel('b1'));
    addDock('host1', {});
    addDock('t1', {});
    const meta = (t: number, host: string | null) => ({ hasPanel: true, lastUsed: t, createdAt: t, hostPanelId: host });
    useSearchStore.setState({
      activeSessionId: 't1',
      query: 'solo',
      resultsForQuery: 'solo',
      parkedSessions: {
        a: { ...freshSessionFields(false), query: 'love', resultsForQuery: 'love' },
        b: { ...freshSessionFields(false), query: 'hope', resultsForQuery: 'hope' },
      },
      sessionMeta: { t1: meta(5, null), a: meta(1, 'host1'), b: meta(3, 'host1') },
    });
    off = installSearchTabsSync();
  });

  it('activates the host\'s selected (most recent) sub-tab', () => {
    useLayoutStore.setState({ activePanelId: 'host1' });
    expect(useSearchStore.getState().activeSessionId).toBe('b');
    expect(useSearchStore.getState().resultsForQuery).toBe('hope');
  });

  it('leaves the active session alone when it is already the host\'s', () => {
    useSearchStore.getState().activateSession('a');
    useLayoutStore.setState({ activePanelId: 'b1' });
    useLayoutStore.setState({ activePanelId: 'host1' });
    expect(useSearchStore.getState().activeSessionId).toBe('a');
  });

  it('a host with no sessions changes nothing', () => {
    useSearchStore.setState({ sessionMeta: { t1: { hasPanel: true, lastUsed: 5, createdAt: 5, hostPanelId: null } }, parkedSessions: {} });
    useLayoutStore.setState({ activePanelId: 'host1' });
    expect(useSearchStore.getState().activeSessionId).toBe('t1');
  });
});

describe('a new sub-tab while the host is not the active panel (review finding)', () => {
  it('Ctrl+Enter from elsewhere adds the new search to the host and keeps it active', async () => {
    setPanels(hostPanel('host1'), biblePanel('b1'));
    const host = addDock('host1', {});
    // Activating the host in dockview reports it as the active panel, as the real app does.
    host.api.setActive.mockImplementation(() => useLayoutStore.setState({ activePanelId: 'host1' }));
    useSearchStore.setState({
      activeSessionId: 'p',
      query: 'love',
      resultsForQuery: 'love',
      searchResults: [{ verseId: 1 }] as never,
      parkedSessions: {},
      sessionMeta: { p: { hasPanel: true, lastUsed: 1, createdAt: 1, hostPanelId: 'host1' } },
    });
    useLayoutStore.setState({ activePanelId: 'b1' });
    off = installSearchTabsSync();
    const { searchAPI } = await import('../services/electronAPI');
    const spy = vi.spyOn(searchAPI, 'performSearch').mockResolvedValue([{ verseId: 2 }] as never);

    await useSearchStore.getState().performSearch('faith', { newTab: true });

    const st = useSearchStore.getState();
    expect(st.resultsForQuery).toBe('faith');
    const newId = st.activeSessionId!;
    expect(newId).not.toBe('p');
    expect(st.sessionMeta[newId]).toMatchObject({ hasPanel: true, hostPanelId: 'host1' });
    expect(st.parkedSessions.p).toBeDefined();
    // No meta entry without a session behind it.
    for (const id of Object.keys(st.sessionMeta)) {
      expect(id === st.activeSessionId || !!st.parkedSessions[id]).toBe(true);
    }
    spy.mockRestore();
  });

  it('closing the active sub-tab hands over to a sibling in the same host, not a more recent own tab', () => {
    const meta = (t: number, hostPanelId: string | null) => ({ hasPanel: true, lastUsed: t, createdAt: t, hostPanelId });
    useSearchStore.setState({
      activeSessionId: 'a',
      query: 'love',
      resultsForQuery: 'love',
      parkedSessions: {
        b: { ...freshSessionFields(false), query: 'hope', resultsForQuery: 'hope' },
        t1: { ...freshSessionFields(false), query: 'solo', resultsForQuery: 'solo' },
      },
      sessionMeta: { a: meta(9, 'host1'), b: meta(2, 'host1'), t1: meta(5, null) },
    });
    useSearchStore.getState().closeSession('a');
    expect(useSearchStore.getState().activeSessionId).toBe('b');
  });
});
