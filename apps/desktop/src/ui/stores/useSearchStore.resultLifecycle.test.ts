/**
 * When search results stop being true.
 *
 * The search bar's count badge is derived from these arrays, so anything that
 * leaves them populated after the user has moved on is a badge advertising a
 * search that is no longer on screen. Three gestures end a search - closing the
 * results pane by its own X, closing it by its dockview tab, and editing the
 * text in the box - and all three must clear the results.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSearchStore, normalizeSearchQuery } from './useSearchStore';
import { destroyPanelState } from './helpers/panelDisposal';

vi.mock('./useBookStore', () => ({
  useBookStore: { getState: () => ({ destroyPanel: vi.fn() }) },
}));
vi.mock('./useDictionaryStore', () => ({
  useDictionaryStore: { getState: () => ({ destroyPanel: vi.fn() }) },
}));

/** A store state that looks like "a search for `grace` just returned 2 hits". */
function seedResults(overrides: Record<string, unknown> = {}): void {
  useSearchStore.setState({
    query: 'grace',
    resultsForQuery: 'grace',
    searchResults: [{ verseId: 1 }, { verseId: 2 }] as never,
    semanticResults: [],
    isResultsVisible: true,
    lastClickedId: 'verse-1',
    retriedModules: ['ESV'],
    ...overrides,
  });
}

describe('normalizeSearchQuery', () => {
  it('treats the explicit `?` search prefix and surrounding space as noise', () => {
    expect(normalizeSearchQuery('  ?grace ')).toBe('grace');
    expect(normalizeSearchQuery('grace')).toBe('grace');
  });
});

describe('clearResults', () => {
  beforeEach(() => {
    seedResults();
  });

  it('empties every result set and hides the pane', () => {
    useSearchStore.getState().clearResults();
    const state = useSearchStore.getState();
    expect(state.searchResults).toEqual([]);
    expect(state.semanticResults).toEqual([]);
    expect(state.resultsForQuery).toBe('');
    expect(state.isResultsVisible).toBe(false);
    expect(state.lastClickedId).toBeNull();
    expect(state.retriedModules).toEqual([]);
  });

  it('leaves the query text alone — closing a pane must not retype the box', () => {
    useSearchStore.getState().clearResults();
    expect(useSearchStore.getState().query).toBe('grace');
  });
});

describe('setQuery', () => {
  beforeEach(() => {
    seedResults();
  });

  it('drops results that no longer belong to the text in the box', () => {
    useSearchStore.getState().setQuery('graceful');
    const state = useSearchStore.getState();
    expect(state.query).toBe('graceful');
    expect(state.searchResults).toEqual([]);
    expect(state.resultsForQuery).toBe('');
  });

  it('keeps results when only the `?` prefix or whitespace changed', () => {
    useSearchStore.getState().setQuery('?grace');
    const state = useSearchStore.getState();
    expect(state.query).toBe('?grace');
    expect(state.searchResults).toHaveLength(2);
  });

  it('does not close the results pane — typing empties it, it does not hide it', () => {
    useSearchStore.getState().setQuery('graceful');
    expect(useSearchStore.getState().isResultsVisible).toBe(true);
  });

  it('drops a stale semantic result set too', () => {
    seedResults({
      searchResults: [],
      semanticResults: [{ id: 'a' }, { id: 'b' }] as never,
    });
    useSearchStore.getState().setQuery('graceful');
    expect(useSearchStore.getState().semanticResults).toEqual([]);
  });
});

describe('destroyPanelState', () => {
  beforeEach(() => {
    seedResults();
  });

  // Closing the pane by its dockview tab x ran nothing search-specific, so the
  // results (and the badge) survived a pane that was gone.
  it('clears the results when the search panel is removed', () => {
    destroyPanelState('search-panel', 'search');
    const state = useSearchStore.getState();
    expect(state.searchResults).toEqual([]);
    expect(state.isResultsVisible).toBe(false);
  });

  it('leaves search results alone when some other panel is removed', () => {
    destroyPanelState('bible-panel', 'bible');
    expect(useSearchStore.getState().searchResults).toHaveLength(2);
  });
});
