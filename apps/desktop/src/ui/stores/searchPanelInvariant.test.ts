import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useLayoutStore } from './useLayoutStore';
import { useSearchStore, freshSessionFields } from './useSearchStore';
import { installSearchPanelInvariant } from './searchPanelInvariant';

const searchPanel = { panelId: 's1', contentType: 'search' } as never;
let off: () => void;
let close: ReturnType<typeof vi.fn>;
const tick = () => new Promise<void>(r => queueMicrotask(r));

beforeEach(() => {
  close = vi.fn();
  useSearchStore.setState({ query: 'love', resultsForQuery: 'love', isSearching: false, isSemanticSearching: false });
  useLayoutStore.setState({
    panels: new Map(),
    removePanel: close as never,
    getPanelsByType: ((t: string) => (t === 'search' && useLayoutStore.getState().panels.has('s1') ? [searchPanel] : [])) as never,
  });
  off = installSearchPanelInvariant();
});
afterEach(() => off());

const addPanel = () => useLayoutStore.setState({ panels: new Map([['s1', searchPanel]]) });

describe('a Search panel never outlives its search (B-001/054/145/147)', () => {
  it('stays while a query has results', async () => {
    addPanel();
    await tick(); await tick();
    expect(close).not.toHaveBeenCalled();
  });

  it('B-145: clearing the query (Esc in the search bar) closes it', async () => {
    addPanel();
    useSearchStore.getState().clearSearch();
    await tick(); await tick();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('B-145/R45-7: a panel that appears with no query (reading-plan link, restore) is closed', async () => {
    useSearchStore.setState({ query: '', resultsForQuery: '' });
    addPanel();
    await tick(); await tick();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('B-147: a layout preset / reset that includes a search slot is closed', async () => {
    useSearchStore.setState({ query: '', resultsForQuery: '' });
    useLayoutStore.setState({ panels: new Map([['b', { panelId: 'b', contentType: 'bible' } as never], ['s1', searchPanel]]) });
    await tick(); await tick();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('B-001/B-145 reopened: typing one more character after a search keeps the pane (and, with tabs, its results)', async () => {
    addPanel();
    useSearchStore.setState({ searchResults: [{ verseId: 1 }] as never });
    useSearchStore.getState().setQuery('loves');
    await tick(); await tick();
    expect(useSearchStore.getState().resultsForQuery).toBe('love');
    expect(close).not.toHaveBeenCalled();
  });

  it('a search in flight keeps it', async () => {
    useSearchStore.setState({ query: '', resultsForQuery: '', isSearching: true });
    addPanel();
    await tick(); await tick();
    expect(close).not.toHaveBeenCalled();
  });
});

describe('a search host panel ("Tab in the right pane")', () => {
  const hostPanel = { panelId: 'h1', contentType: 'search', contentKey: 'host' } as never;
  const addHost = () => useLayoutStore.setState({
    panels: new Map([['h1', hostPanel]]),
    getPanelsByType: ((t: string) => (t === 'search' && useLayoutStore.getState().panels.has('h1') ? [hostPanel] : [])) as never,
  });
  const hosted = (_id: string, lastUsed: number) => ({ hasPanel: true, lastUsed, createdAt: lastUsed, hostPanelId: 'h1' });

  it('is kept while any hosted session has a search, even when the active one is empty', async () => {
    useSearchStore.setState({
      query: '', resultsForQuery: '', activeSessionId: 'a',
      parkedSessions: { b: { ...freshSessionFields(false), query: 'hope', resultsForQuery: 'hope' } },
      sessionMeta: { a: hosted('a', 1), b: hosted('b', 2) },
    });
    addHost();
    await tick(); await tick();
    expect(close).not.toHaveBeenCalled();
  });

  it('is removed when no hosted session has a search', async () => {
    useSearchStore.setState({
      query: '', resultsForQuery: '', activeSessionId: 'a',
      parkedSessions: { b: { ...freshSessionFields(false), query: '', resultsForQuery: '' } },
      sessionMeta: { a: hosted('a', 1), b: hosted('b', 2) },
    });
    addHost();
    await tick(); await tick();
    expect(close).toHaveBeenCalledWith('h1');
  });

  it('is removed when it has no hosted sessions and nothing is being searched', async () => {
    useSearchStore.setState({ query: '', resultsForQuery: '', activeSessionId: null, parkedSessions: {}, sessionMeta: {} });
    addHost();
    await tick(); await tick();
    expect(close).toHaveBeenCalledWith('h1');
  });

  // closeSession keeps the query text in the box after the last session closes; a host panel with no
  // hosted sessions must still go (found by this test and the e2e spec, fixed in panelHasSearch).
  it('a host whose last sub-tab was closed (query text kept in the box) is removed', async () => {
    useSearchStore.setState({ query: 'love', resultsForQuery: '', activeSessionId: null, parkedSessions: {}, sessionMeta: {} });
    addHost();
    await tick(); await tick();
    expect(close).toHaveBeenCalledWith('h1');
  });
});
