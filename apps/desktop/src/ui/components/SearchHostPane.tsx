/**
 * The general "Search" tab of the right-hand pane group (task 0210 follow-up,
 * placement "Tab in the right pane").
 *
 * One dockview panel shows several search sessions, each as a sub-tab in its
 * own strip, with the same rules as separate search tabs: Enter replaces the
 * active search, Ctrl/Cmd+Enter or "Open in New Search Tab" adds one, a cap of
 * 8 with least-recently-used replacement, the query as title, close, and
 * restore after a restart. The sessions have no panel of their own: their meta
 * names this panel as host (`hostPanelId`).
 *
 * The selected sub-tab is rendered by the ordinary `SearchResultsPane`, bound
 * to that session, with a panel API whose `close` closes the sub-tab (its
 * session) rather than the whole Search tab.
 */
import React, { useId, useMemo, useRef } from 'react';
import { Bdi } from '@bible/ui';
import { useI18n } from '../contexts/useI18n';
import {
  useSearchStore,
  hostedSessionIds,
  selectedHostedSessionId,
  selectSessionView,
  sessionTitleQuery,
} from '../stores/useSearchStore';
import SearchResultsPane from './SearchResultsPane';
import { searchTabTitle } from './searchTabTitle';

interface HostPanelApi {
  isVisible?: boolean;
  onDidVisibilityChange?: (cb: (event: { isVisible: boolean }) => void) => { dispose: () => void };
}

interface SearchHostPaneProps {
  panelId: string;
  dockviewPanelApi?: HostPanelApi;
}

/** One sub-tab's label, read from its own session. */
const SubTabLabel: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const { t } = useI18n();
  const query = useSearchStore((s) => sessionTitleQuery(selectSessionView(s, sessionId)));
  return <Bdi>{query ? searchTabTitle(query) : t('paneName.search')}</Bdi>;
};

const SearchHostPane: React.FC<SearchHostPaneProps> = ({ panelId, dockviewPanelApi }) => {
  const { t } = useI18n();
  const sessionMeta = useSearchStore((s) => s.sessionMeta);
  const activeSessionId = useSearchStore((s) => s.activeSessionId);
  const activateSession = useSearchStore((s) => s.activateSession);
  const closeSession = useSearchStore((s) => s.closeSession);
  const ids = useMemo(() => hostedSessionIds({ sessionMeta }, panelId), [sessionMeta, panelId]);
  const selected = useMemo(
    () => selectedHostedSessionId({ sessionMeta, activeSessionId }, panelId),
    [sessionMeta, activeSessionId, panelId],
  );
  // Read for accessible names; a parked session's query is stable, the active one re-renders the pane anyway.
  const queries = useSearchStore((s) => ids.map((id) => sessionTitleQuery(selectSessionView(s, id))).join('\u0000'));
  const queryList = queries.split('\u0000');
  const semantic = useSearchStore((s) => ids.map((id) => (selectSessionView(s, id).isSemanticMode ? '1' : '0')).join(''));
  const stripRef = useRef<HTMLDivElement>(null);
  const tabpanelId = `search-host-${useId().replace(/:/g, '')}`;
  const selectedIndex = selected ? ids.indexOf(selected) : -1;

  // The pane's own close button and Esc close this sub-tab, not the Search tab.
  const subPanelApi = useMemo(
    () =>
      selected
        ? {
            close: () => closeSession(selected),
            get isVisible() {
              return dockviewPanelApi?.isVisible;
            },
            onDidVisibilityChange: dockviewPanelApi?.onDidVisibilityChange?.bind(dockviewPanelApi),
          }
        : undefined,
    [selected, closeSession, dockviewPanelApi],
  );

  const onStripKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(stripRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
    const i = tabs.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    if (e.key === 'Delete') {
      // The close buttons are pointer targets only; Delete closes the focused sub-tab.
      const id = tabs[i].dataset.sessionId;
      if (id) {
        e.preventDefault();
        closeSession(id);
      }
      return;
    }
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    const fwd = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    let next = -1;
    if (e.key === fwd) next = (i + 1) % tabs.length;
    else if (e.key === back) next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    tabs[next].focus();
  };

  return (
    <div className="h-full flex flex-col" data-testid="search-host-pane">
      <div
        ref={stripRef}
        role="tablist"
        aria-label={t('searchTabs.subTabListLabel')}
        onKeyDown={onStripKeyDown}
        className="flex items-stretch overflow-x-auto flex-shrink-0"
        style={{
          borderBottom: '1px solid var(--theme-border-primary)',
          backgroundColor: 'var(--theme-bg-secondary)',
        }}
        data-testid="search-subtabs"
      >
        {ids.map((id, index) => {
          const isSelected = id === selected;
          const query = queryList[index] ?? '';
          const label = query
            ? t(semantic[index] === '1' ? 'searchTabs.accessibleNameMeaning' : 'searchTabs.accessibleName', { query })
            : t('paneName.search');
          return (
            <div
              key={id}
              role="presentation"
              className="flex items-center flex-shrink-0"
              style={{
                borderInlineEnd: '1px solid var(--theme-border-primary)',
                borderBottom: isSelected ? '2px solid var(--theme-accent-primary)' : '2px solid transparent',
                backgroundColor: isSelected ? 'var(--theme-bg-primary)' : 'transparent',
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-controls={isSelected ? tabpanelId : undefined}
                id={`${tabpanelId}-tab-${index}`}
                aria-label={label}
                title={query || undefined}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => activateSession(id)}
                className="px-3 py-1 text-sm whitespace-nowrap"
                style={{
                  color: isSelected ? 'var(--theme-text-primary)' : 'var(--theme-text-secondary)',
                  fontWeight: isSelected ? 600 : 400,
                }}
                data-testid="search-subtab"
                data-session-id={id}
              >
                <SubTabLabel sessionId={id} />
              </button>
              <button
                type="button"
                onClick={() => closeSession(id)}
                tabIndex={-1}
                className="pe-2 ps-0.5 text-sm"
                style={{ color: 'var(--theme-text-secondary)' }}
                aria-label={t('searchTabs.closeSubTab', { query: query || t('paneName.search') })}
                title={t('searchTabs.closeSubTab', { query: query || t('paneName.search') })}
                data-testid="search-subtab-close"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <div
        className="flex-1 min-h-0"
        role="tabpanel"
        id={tabpanelId}
        aria-labelledby={selectedIndex >= 0 ? `${tabpanelId}-tab-${selectedIndex}` : undefined}
      >
        {selected && <SearchResultsPane key={selected} panelId={selected} dockviewPanelApi={subPanelApi} />}
      </div>
    </div>
  );
};

export default SearchHostPane;
