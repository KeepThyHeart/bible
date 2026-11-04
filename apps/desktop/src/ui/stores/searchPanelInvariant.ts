/**
 * Invariant: a Search results panel exists only while there is a search behind
 * it (B-001, B-054, B-145, B-147).
 *
 * Those four bugs were one cause: the panel's lifetime was tied only to the
 * code paths that opened or closed it (typed reference, Esc, restore after
 * restart...), so every path that cleared the query, restored a layout, or
 * applied a preset containing a 'search' slot left an empty panel behind.
 * This reconciler states the rule once, from both sides: whenever the search
 * state OR the layout changes and a search panel is open with no query, no
 * running search and no results, it is closed.
 */
import { useLayoutStore } from './useLayoutStore';
import { useSearchStore } from './useSearchStore';

export function searchPanelIsOrphaned(): boolean {
  const s = useSearchStore.getState();
  // Text still in the box counts: typing after a search empties the results
  // (useSearchStore.setQuery) but must not close the pane the user opened.
  // Every path that ends a search (Esc, a typed reference, a pick) clears the box too.
  const hasSearch =
    s.resultsForQuery.trim().length > 0 || s.query.trim().length > 0 || s.isSearching || s.isSemanticSearching;
  return !hasSearch && useLayoutStore.getState().getPanelsByType('search').length > 0;
}

export function reconcileSearchPanel(): void {
  if (searchPanelIsOrphaned()) useLayoutStore.getState().closeSearchResultsPanels();
}

/** Subscribe both stores; returns an unsubscribe. Deferred a microtask so it never mutates dockview mid-operation. */
export function installSearchPanelInvariant(): () => void {
  let queued = false;
  const schedule = (): void => {
    if (queued || !searchPanelIsOrphaned()) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      reconcileSearchPanel();
    });
  };
  const offSearch = useSearchStore.subscribe(schedule);
  const offLayout = useLayoutStore.subscribe(schedule);
  return () => {
    offSearch();
    offLayout();
  };
}
