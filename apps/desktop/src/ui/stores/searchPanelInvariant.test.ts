import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useLayoutStore } from './useLayoutStore';
import { useSearchStore } from './useSearchStore';
import { installSearchPanelInvariant } from './searchPanelInvariant';

const searchPanel = { panelId: 's1', contentType: 'search' } as never;
let off: () => void;
let close: ReturnType<typeof vi.fn>;
const tick = () => new Promise<void>(r => queueMicrotask(r));

beforeEach(() => {
  close = vi.fn();
  useSearchStore.setState({ resultsForQuery: 'love', isSearching: false, isSemanticSearching: false });
  useLayoutStore.setState({
    panels: new Map(),
    closeSearchResultsPanels: close as never,
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
    useSearchStore.setState({ resultsForQuery: '' });
    addPanel();
    await tick(); await tick();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('B-147: a layout preset / reset that includes a search slot is closed', async () => {
    useSearchStore.setState({ resultsForQuery: '' });
    useLayoutStore.setState({ panels: new Map([['b', { panelId: 'b', contentType: 'bible' } as never], ['s1', searchPanel]]) });
    await tick(); await tick();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('a search in flight keeps it', async () => {
    useSearchStore.setState({ resultsForQuery: '', isSearching: true });
    addPanel();
    await tick(); await tick();
    expect(close).not.toHaveBeenCalled();
  });
});
