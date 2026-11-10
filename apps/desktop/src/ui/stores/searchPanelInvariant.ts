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
 *
 * With search tabs (task 0210) the rule holds per tab: each search panel is
 * judged by its own session (the panel id is the session id), so ending the
 * active tab's search closes that tab and leaves the others alone.
 */
import { useLayoutStore, SEARCH_HOST_CONTENT_KEY } from './useLayoutStore';
import { useSearchStore, sessionHasSearch, hostedSessionIds } from './useSearchStore';

/** Whether the search panel with this id still has a search behind it. */
function panelHasSearch(panelId: string, isHost: boolean): boolean {
  const s = useSearchStore.getState();
  // A search host panel ("Tab in the right pane") lives while any of its
  // sub-tabs has a search; with none left it is empty, whatever the box holds.
  const hosted = hostedSessionIds(s, panelId);
  if (isHost || hosted.length > 0) {
    return hosted.some((id) => sessionHasSearch(id === s.activeSessionId ? s : s.parkedSessions[id]));
  }
  if (panelId === s.activeSessionId) return sessionHasSearch(s);
  const parked = s.parkedSessions[panelId];
  if (parked) return sessionHasSearch(parked);
  // A panel no session knows about. While no session exists at all it can only
  // be a panel opened outside the search store (tests, an old code path); judge
  // it by the flat state as before tabs. Otherwise it is an orphan.
  return s.activeSessionId === null && Object.keys(s.parkedSessions).length === 0 && sessionHasSearch(s);
}

/** Ids of the search panels that have no search behind them. */
export function orphanedSearchPanelIds(): string[] {
  return useLayoutStore
    .getState()
    .getPanelsByType('search')
    .filter((p) => !panelHasSearch(p.panelId, p.contentKey === SEARCH_HOST_CONTENT_KEY))
    .map((p) => p.panelId);
}

export function searchPanelIsOrphaned(): boolean {
  return orphanedSearchPanelIds().length > 0;
}

export function reconcileSearchPanel(): void {
  const layout = useLayoutStore.getState();
  for (const id of orphanedSearchPanelIds()) layout.removePanel(id);
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
