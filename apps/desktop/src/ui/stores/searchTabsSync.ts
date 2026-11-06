/**
 * Wiring between search sessions and their dockview tabs (task 0210).
 *
 * A search tab's panel id IS its session id. This module keeps the two sides
 * in step without the search store or the layout store importing each other:
 *
 * - the search store's bridges open/focus a session's tab (placement rules in
 *   `useLayoutStore.openSearchResultsPanel`, placement preference from
 *   Preferences) and close one (the tab cap);
 * - focusing a search tab makes its session the active search, so the header
 *   box, count badge, highlights and study panes follow it;
 * - each tab's query (and keyword/meaning mode) is written into its dockview
 *   params, which are part of the saved layout - that is how tabs come back
 *   after a restart (`restoreSearchTabsFromLayout`).
 *
 * "Tab in the right pane" (0210 follow-up): one general Search panel
 * (`contentKey: 'host'`) in the right-hand pane group shows several sessions
 * as sub-tabs. Those sessions have no panel of their own; their meta names the
 * host (`hostPanelId`), and the host's params list them for restore.
 */
import type { DockviewApi } from 'dockview-react';
import { useLayoutStore, SEARCH_HOST_CONTENT_KEY } from './useLayoutStore';
import {
  useSearchStore,
  sessionTitleQuery,
  hostedSessionIds,
  selectedHostedSessionId,
  type SearchSessionFields,
  type RestoredSearchTab,
} from './useSearchStore';
import { usePreferencesStore } from './usePreferencesStore';
import { useSessionStore } from './useSessionStore';
import { setShowSearchResultsPanel, setCloseSearchResultsPanel } from './crossStoreBridge';

/** Dockview params a search tab carries in the saved layout. */
export interface SearchPanelParams {
  contentType?: string;
  searchQuery?: string;
  searchSemantic?: boolean;
  /** Search host panel: its sub-tabs, and which one was selected. */
  searchTabs?: HostedSearchTabParams[];
  searchSelected?: string | null;
}

/** What a session wants written into its tab's params: the query it re-runs after a restart. */
function persistedQuery(view: SearchSessionFields): string {
  return sessionTitleQuery(view);
}

/** One sub-tab of a search host panel, as saved in its params. */
export interface HostedSearchTabParams {
  id: string;
  query: string;
  semantic?: boolean;
}

/** A session's fields wherever it lives. */
function viewOf(s: ReturnType<typeof useSearchStore.getState>, id: string): SearchSessionFields | undefined {
  return id === s.activeSessionId ? s : s.parkedSessions[id];
}

/** The sub-tabs a host panel should save: its sessions that have a query to re-run. */
function hostedTabsFor(s: ReturnType<typeof useSearchStore.getState>, hostId: string): HostedSearchTabParams[] {
  const out: HostedSearchTabParams[] = [];
  for (const id of hostedSessionIds(s, hostId)) {
    const view = viewOf(s, id);
    const query = view ? persistedQuery(view) : '';
    if (view && query) out.push({ id, query, semantic: view.isSemanticMode });
  }
  return out;
}

/** Write every open search tab's query into its dockview params when it changed. */
function syncSearchPanelParams(): void {
  const layout = useLayoutStore.getState();
  const api = layout.dockviewApi;
  if (!api) return;
  const s = useSearchStore.getState();
  let changed = false;
  for (const panel of layout.getPanelsByType('search')) {
    const dock = api.getPanel(panel.panelId);
    if (!dock) continue;
    const params = (dock.params ?? {}) as SearchPanelParams;
    if (panel.contentKey === SEARCH_HOST_CONTENT_KEY) {
      // The host keeps its generic "Search" title; its sub-tabs are its params.
      const tabs = hostedTabsFor(s, panel.panelId);
      if (tabs.length === 0) continue;
      const selected = selectedHostedSessionId(s, panel.panelId);
      if (JSON.stringify(params.searchTabs ?? []) === JSON.stringify(tabs) && params.searchSelected === selected) continue;
      dock.api.updateParameters({ ...(dock.params ?? {}), searchTabs: tabs, searchSelected: selected });
      changed = true;
      continue;
    }
    const view = viewOf(s, panel.panelId);
    if (!view) continue;
    const query = persistedQuery(view);
    if (!query) continue;
    if (params.searchQuery === query && !!params.searchSemantic === view.isSemanticMode && dock.title === query) continue;
    layout.updateSearchPanelMeta(panel.panelId, query, view.isSemanticMode);
    changed = true;
  }
  // Params changes are not a dockview layout change, so autosave must be told.
  if (changed) useSessionStore.getState().markDirty();
}

/**
 * Recreate search sessions for the search tabs of a just-restored layout.
 *
 * A tab saved with a query comes back with it and re-runs when first shown; a
 * tab with no query (layouts saved before search tabs existed, whose results
 * lived only in memory) would reopen empty and squeeze the reading area
 * (B-054), so it is closed. A search host panel ("Tab in the right pane")
 * brings back each of its saved sub-tabs, and is closed when it has none.
 */
export function restoreSearchTabsFromLayout(api: DockviewApi): void {
  const layout = useLayoutStore.getState();
  const restored: RestoredSearchTab[] = [];
  for (const panel of layout.getPanelsByType('search')) {
    const params = (api.getPanel(panel.panelId)?.params ?? {}) as SearchPanelParams;
    if (panel.contentKey === SEARCH_HOST_CONTENT_KEY) {
      const tabs = Array.isArray(params.searchTabs) ? params.searchTabs : [];
      const valid = tabs.filter(
        (t): t is HostedSearchTabParams => !!t && typeof t.id === 'string' && typeof t.query === 'string' && t.query.trim() !== '',
      );
      if (valid.length === 0) {
        layout.removePanel(panel.panelId);
        continue;
      }
      // Sub-tabs keep their order; the one that was selected comes back as the
      // most recently used, so it is the one shown.
      for (const t of valid) {
        restored.push({
          id: t.id,
          query: t.query.trim(),
          semantic: t.semantic === true,
          hostPanelId: panel.panelId,
          recent: t.id === params.searchSelected,
        });
      }
      continue;
    }
    const query = typeof params.searchQuery === 'string' ? params.searchQuery.trim() : '';
    if (query) restored.push({ id: panel.panelId, query, semantic: params.searchSemantic === true });
    else layout.removePanel(panel.panelId);
  }
  if (restored.length > 0) useSearchStore.getState().restoreSessions(restored);
}

/**
 * Open or focus the tab that shows a session, following the placement rules
 * (task 0210 and its follow-up). Returns the id of the panel that shows it:
 * the session's own tab, or the search host panel it is a sub-tab of.
 */
export function showSessionPanel(sessionId: string, opts: { reveal: boolean; nearSessionId: string | null }): string | null {
  const layout = useLayoutStore.getState();
  const api = layout.dockviewApi;
  if (!api) return null;
  const search = useSearchStore.getState();
  const reveal = opts.reveal;
  const hostOf = (id: string | null): string | null => {
    const host = id ? search.sessionMeta[id]?.hostPanelId : null;
    return host && api.getPanel(host) ? host : null;
  };
  // Record the session as the host's sub-tab BEFORE the host is activated:
  // activating it makes its selected sub-tab the active search (see the
  // layout subscription below), and a session the host does not know yet
  // would lose to an older sub-tab and be dropped.
  const focusHost = (host: string): string => {
    attachToHost(sessionId, host);
    if (reveal) api.getPanel(host)?.api.setActive();
    return host;
  };

  // Already shown: its host, or its own tab.
  const ownHost = hostOf(sessionId);
  if (ownHost) return focusHost(ownHost);
  if (api.getPanel(sessionId)) return layout.openSearchResultsPanel(sessionId, { reveal });

  // A new tab goes where the search it was opened from lives.
  const nearHost = hostOf(opts.nearSessionId);
  if (nearHost) return focusHost(nearHost);
  if (opts.nearSessionId && api.getPanel(opts.nearSessionId)) {
    return layout.openSearchResultsPanel(sessionId, { reveal, nearSessionId: opts.nearSessionId });
  }

  // Otherwise beside the searches already open: an open host first, then search tabs.
  const openHost = layout.getPanelsByType('search')
    .find((p) => p.contentKey === SEARCH_HOST_CONTENT_KEY && api.getPanel(p.panelId));
  const openTab = layout.getPanelsByType('search')
    .find((p) => p.contentKey !== SEARCH_HOST_CONTENT_KEY && api.getPanel(p.panelId));
  if (openHost && !openTab) return focusHost(openHost.panelId);
  if (openTab) return layout.openSearchResultsPanel(sessionId, { reveal });

  // Nothing open: the placement preference. "Tab in the right pane" falls back
  // to the full-height column when the layout has no right-hand pane group.
  const placement = usePreferencesStore.getState().searchResultsPlacement;
  if (placement === 'tab') {
    const host = layout.openSearchHostPanel({ reveal: false });
    if (host) return focusHost(host);
    return layout.openSearchResultsPanel(sessionId, { reveal, placement: 'right' });
  }
  return layout.openSearchResultsPanel(sessionId, { reveal, placement });
}

/** Mark a session as shown by a search host panel (a no-op when it already is, or is gone). */
function attachToHost(sessionId: string, hostPanelId: string): void {
  const search = useSearchStore.getState();
  const meta = search.sessionMeta[sessionId];
  if (!meta || (meta.hasPanel && meta.hostPanelId === hostPanelId)) return;
  useSearchStore.setState({
    sessionMeta: { ...search.sessionMeta, [sessionId]: { ...meta, hasPanel: true, hostPanelId } },
  });
}

/** Install the bridges and subscriptions. Called once from `wireStoreSync`. */
export function installSearchTabsSync(): () => void {
  setShowSearchResultsPanel(showSessionPanel);
  setCloseSearchResultsPanel((sessionId) => {
    const layout = useLayoutStore.getState();
    // A sub-tab has no panel of its own; the store drops its session.
    if (layout.getPanel(sessionId)) layout.removePanel(sessionId);
  });

  // Focusing a search tab makes its search the active one; focusing the
  // search host panel makes its selected sub-tab the active one.
  let lastActivePanel = useLayoutStore.getState().activePanelId;
  const offLayout = useLayoutStore.subscribe((state) => {
    if (state.activePanelId === lastActivePanel) return;
    lastActivePanel = state.activePanelId;
    const id = state.activePanelId;
    const panel = id ? state.panels.get(id) : undefined;
    if (!id || panel?.contentType !== 'search') return;
    const search = useSearchStore.getState();
    const target = panel.contentKey === SEARCH_HOST_CONTENT_KEY ? selectedHostedSessionId(search, id) : id;
    if (target && target !== search.activeSessionId && search.parkedSessions[target]) search.activateSession(target);
  });

  const offSearch = useSearchStore.subscribe(syncSearchPanelParams);

  return () => {
    offLayout();
    offSearch();
    setShowSearchResultsPanel(null);
    setCloseSearchResultsPanel(null);
  };
}
