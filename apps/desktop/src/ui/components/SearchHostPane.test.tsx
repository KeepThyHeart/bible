/**
 * Search tabs (task 0210 follow-up): the sub-tab strip of the general Search
 * tab ("Tab in the right pane"). The search store is the real one; the results
 * pane is a stub that shows which session it was bound to and exposes its
 * panel API's `close` (what Esc and the pane's close button call).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchHostPane from './SearchHostPane';
import SearchPanel from './SearchPanel';
import { useSearchStore, freshSessionFields, resetSearchSessionBookkeepingForTests } from '../stores/useSearchStore';
import enUi from '../../../locales/en/ui.json';

const catalog = enUi as Record<string, string>;
vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      (catalog[key] ?? key).replace(/\{(\w+)\}/g, (_m, k: string) => params?.[k] ?? ''),
  }),
}));

vi.mock('./SearchResultsPane', () => ({
  default: ({ panelId, dockviewPanelApi }: { panelId?: string; dockviewPanelApi?: { close: () => void } }) => (
    <div data-testid="results-pane" data-panel-id={panelId}>
      <button type="button" data-testid="pane-close" onClick={() => dockviewPanelApi?.close()}>pane close</button>
    </div>
  ),
}));

const HOST = 'host1';
const meta = (t: number, host: string | null = HOST) => ({ hasPanel: true, lastUsed: t, createdAt: t, hostPanelId: host });
const sess = (query: string, semantic = false) => ({ ...freshSessionFields(semantic), query, resultsForQuery: query });

/** Three hosted sessions a, b, c; `active` is in the flat fields, the rest parked. */
function seed(active: string) {
  const all: Record<string, ReturnType<typeof sess>> = { a: sess('love'), b: sess('hope', true), c: sess('faith') };
  const parked = { ...all };
  delete parked[active];
  useSearchStore.setState({
    ...all[active],
    activeSessionId: active,
    parkedSessions: parked,
    sessionMeta: { a: meta(1), b: meta(2), c: meta(3) },
  });
}

const subtabs = () => screen.getAllByTestId('search-subtab');

beforeEach(() => {
  resetSearchSessionBookkeepingForTests();
  useSearchStore.setState({
    ...freshSessionFields(false),
    activeSessionId: null,
    parkedSessions: {},
    sessionMeta: {},
  });
});

describe('SearchHostPane', () => {
  it('renders a sub-tab per hosted session, in opening order, labelled with the query', () => {
    seed('b');
    render(<SearchHostPane panelId={HOST} />);

    expect(screen.getByRole('tablist', { name: 'Searches' })).toBeInTheDocument();
    expect(subtabs().map((t) => t.getAttribute('data-session-id'))).toEqual(['a', 'b', 'c']);
    expect(subtabs().map((t) => t.textContent)).toEqual(['love', 'hope', 'faith']);
    expect(screen.getAllByTestId('search-subtab-close')).toHaveLength(3);
  });

  it('only shows sessions of this host', () => {
    seed('a');
    useSearchStore.setState({
      parkedSessions: { ...useSearchStore.getState().parkedSessions, x: sess('elsewhere') },
      sessionMeta: { ...useSearchStore.getState().sessionMeta, x: meta(9, 'other') },
    });
    render(<SearchHostPane panelId={HOST} />);
    expect(subtabs().map((t) => t.getAttribute('data-session-id'))).toEqual(['a', 'b', 'c']);
  });

  it('the active session is the selected tab and the results pane is bound to it', () => {
    seed('b');
    render(<SearchHostPane panelId={HOST} />);

    expect(subtabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(screen.getByTestId('results-pane')).toHaveAttribute('data-panel-id', 'b');
  });

  it('accessible names say keyword or meaning search', () => {
    seed('a');
    render(<SearchHostPane panelId={HOST} />);
    expect(screen.getByRole('tab', { name: 'Search: love' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Meaning search: hope' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close search: faith' })).toBeInTheDocument();
  });

  it('clicking a sub-tab activates that session and moves the selection', async () => {
    seed('a');
    const user = userEvent.setup();
    render(<SearchHostPane panelId={HOST} />);

    await user.click(subtabs()[2]);

    expect(useSearchStore.getState().activeSessionId).toBe('c');
    expect(useSearchStore.getState().resultsForQuery).toBe('faith');
    expect(subtabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
    expect(screen.getByTestId('results-pane')).toHaveAttribute('data-panel-id', 'c');
  });

  it('the close button of a sub-tab closes that session only', async () => {
    seed('a');
    const user = userEvent.setup();
    render(<SearchHostPane panelId={HOST} />);

    await user.click(screen.getAllByTestId('search-subtab-close')[1]);

    expect(useSearchStore.getState().sessionMeta.b).toBeUndefined();
    expect(subtabs().map((t) => t.getAttribute('data-session-id'))).toEqual(['a', 'c']);
    expect(useSearchStore.getState().activeSessionId).toBe('a');
  });

  it('closing the selected sub-tab selects the most recently used remaining one', async () => {
    seed('c');
    const user = userEvent.setup();
    render(<SearchHostPane panelId={HOST} />);

    await user.click(screen.getAllByTestId('search-subtab-close')[2]);

    expect(subtabs().map((t) => t.getAttribute('data-session-id'))).toEqual(['a', 'b']);
    expect(useSearchStore.getState().activeSessionId).toBe('b');
    expect(screen.getByTestId('results-pane')).toHaveAttribute('data-panel-id', 'b');
  });

  it('the results pane\'s own close (Esc / its close button) closes only the selected sub-tab, not the host', async () => {
    seed('b');
    const hostClose = vi.fn();
    const user = userEvent.setup();
    render(<SearchHostPane panelId={HOST} dockviewPanelApi={{ isVisible: true, onDidVisibilityChange: undefined, close: hostClose } as never} />);

    await user.click(screen.getByTestId('pane-close'));

    expect(hostClose).not.toHaveBeenCalled();
    expect(useSearchStore.getState().sessionMeta.b).toBeUndefined();
    expect(subtabs().map((t) => t.getAttribute('data-session-id'))).toEqual(['a', 'c']);
  });

  it('closing the last sub-tab leaves an empty strip and no results pane', async () => {
    useSearchStore.setState({ ...sess('solo'), activeSessionId: 'a', parkedSessions: {}, sessionMeta: { a: meta(1) } });
    const user = userEvent.setup();
    render(<SearchHostPane panelId={HOST} />);

    await user.click(screen.getByTestId('search-subtab-close'));

    expect(screen.queryAllByTestId('search-subtab')).toHaveLength(0);
    expect(screen.queryByTestId('results-pane')).toBeNull();
  });

  it('arrow keys move focus between sub-tabs, Home and End jump', async () => {
    seed('a');
    const user = userEvent.setup();
    render(<SearchHostPane panelId={HOST} />);

    subtabs()[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(subtabs()[1]).toHaveFocus();
    await user.keyboard('{End}');
    expect(subtabs()[2]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(subtabs()[0]).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(subtabs()[2]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(subtabs()[0]).toHaveFocus();
  });

  it('only the selected sub-tab is in the tab order', () => {
    seed('b');
    render(<SearchHostPane panelId={HOST} />);
    expect(subtabs().map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('a long query is cut in the label and kept in the tooltip', () => {
    const long = 'in the beginning was the word and the word was with God';
    useSearchStore.setState({ ...sess(long), activeSessionId: 'a', parkedSessions: {}, sessionMeta: { a: meta(1) } });
    render(<SearchHostPane panelId={HOST} />);
    const tab = within(screen.getByTestId('search-subtabs')).getByTestId('search-subtab');
    expect(tab.textContent!.endsWith('…')).toBe(true);
    expect(tab).toHaveAttribute('title', long);
  });
});

describe('SearchPanel', () => {
  it('contentKey host renders the host pane; anything else the normal results pane', () => {
    seed('a');
    const { rerender } = render(<SearchPanel panelId={HOST} contentKey="host" />);
    expect(screen.getByTestId('search-host-pane')).toBeInTheDocument();

    rerender(<SearchPanel panelId="a" />);
    expect(screen.queryByTestId('search-host-pane')).toBeNull();
    expect(screen.getByTestId('results-pane')).toHaveAttribute('data-panel-id', 'a');
  });
});
