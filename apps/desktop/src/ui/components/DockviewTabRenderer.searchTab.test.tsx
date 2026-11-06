/**
 * Search tabs (task 0210): how `DockviewTabRenderer` shows a search tab - the
 * session's query as its title (cut at 24 characters, the full query as the
 * tooltip), the accessible name, the "meaning" subtitle, and the
 * "Open in New Search Tab" context menu item.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../stores/useBibleStore', () => ({ useBibleStore: { getState: () => ({}) } }));
vi.mock('../stores/useCommentaryStore', () => ({ useCommentaryStore: { getState: () => ({}) } }));
vi.mock('../stores/useBookStore', () => ({ useBookStore: { getState: () => ({}) } }));
vi.mock('../stores/useStudyStore', () => ({ useStudyStore: { getState: () => ({}) } }));
vi.mock('../stores/useTopicsStore', () => ({ useTopicsStore: { getState: () => ({}) } }));
vi.mock('../stores/useFileNotesStore', () => ({ getNotesPanelNavState: () => undefined }));
vi.mock('../stores/useLayoutStore', () => ({ useLayoutStore: vi.fn().mockReturnValue(undefined) }));
vi.mock('../utils/verseReference', () => ({ formatVerseReference: (v: number) => `ref:${v}` }));
vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params?.query !== undefined ? `${key}|${params.query}` : key),
  }),
}));
vi.mock('../utils/paneNames', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/paneNames')>()),
  localizePaneLabel: (_t: unknown, _type: unknown, label: string) => label,
}));
vi.mock('../hooks/useOverlayDismissal', () => ({ useOverlayDismissal: vi.fn() }));

import DockviewTabRenderer, { searchTabTitle, SEARCH_TAB_TITLE_LENGTH } from './DockviewTabRenderer';
import { useSearchStore, freshSessionFields } from '../stores/useSearchStore';

const PANEL_ID = 'search_abc';
const LONG = 'the quick brown fox jumps over the lazy dog';

function makeProps(contentType: string, panelId = PANEL_ID, title = 'Search') {
  return {
    api: {
      id: panelId,
      title,
      group: { id: 'g1', panels: [{ id: panelId }, { id: 'other' }] },
      onDidTitleChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidGroupChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidActiveChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      setActive: vi.fn(),
      isActive: false,
      close: vi.fn(),
    },
    containerApi: {
      panels: [{ id: panelId }, { id: 'other' }],
      onDidLayoutChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      getPanel: vi.fn().mockReturnValue({ id: panelId, api: { moveTo: vi.fn() } }),
      addGroup: vi.fn().mockReturnValue({ id: 'g2' }),
    },
    params: { contentType },
  } as never;
}

/** Dockview wraps tab content in `.dv-tab`; the accessible name is written onto that host. */
function renderTab(props: ReturnType<typeof makeProps>) {
  return render(
    <div className="dv-tabs-container">
      <div className="dv-tab" data-testid="tab-host">
        <DockviewTabRenderer {...(props as object as React.ComponentProps<typeof DockviewTabRenderer>)} />
      </div>
    </div>,
  );
}

function setActiveSession(fields: Partial<ReturnType<typeof freshSessionFields>>) {
  useSearchStore.setState({
    ...freshSessionFields(false),
    activeSessionId: PANEL_ID,
    parkedSessions: {},
    sessionMeta: {},
    ...fields,
  });
}

beforeEach(() => {
  setActiveSession({});
});

describe('searchTabTitle', () => {
  it('leaves a short query alone and trims it', () => {
    expect(searchTabTitle('  love  ')).toBe('love');
  });

  it('keeps exactly 24 characters, and cuts a 25th with an ellipsis', () => {
    const exact = 'a'.repeat(SEARCH_TAB_TITLE_LENGTH);
    expect(searchTabTitle(exact)).toBe(exact);
    const cut = searchTabTitle('a'.repeat(SEARCH_TAB_TITLE_LENGTH + 1));
    expect(cut).toBe(`${'a'.repeat(SEARCH_TAB_TITLE_LENGTH - 1)}…`);
    expect(Array.from(cut)).toHaveLength(SEARCH_TAB_TITLE_LENGTH);
  });

  it('cuts at code-point boundaries and does not leave a space before the ellipsis', () => {
    expect(Array.from(searchTabTitle('\u{1F600}'.repeat(30)))).toHaveLength(SEARCH_TAB_TITLE_LENGTH);
    expect(searchTabTitle(`${'a'.repeat(22)} bbbbbbbb`)).toBe(`${'a'.repeat(22)}…`);
  });
});

describe('a search tab', () => {
  it('shows the session query, with the full query as its tooltip and accessible name', () => {
    setActiveSession({ query: 'love', resultsForQuery: 'love' });
    renderTab(makeProps('search'));

    const label = screen.getByText('love');
    expect(label.closest('[title]')).toHaveAttribute('title', 'love');
    expect(screen.queryByText('Search')).toBeNull();
    expect(screen.getByTestId('tab-host')).toHaveAttribute('aria-label', 'searchTabs.accessibleName|love');
  });

  it('truncates a long query with an ellipsis; the full query stays in title and aria-label', () => {
    setActiveSession({ query: LONG, resultsForQuery: LONG });
    renderTab(makeProps('search'));

    const shown = searchTabTitle(LONG);
    expect(shown.endsWith('…')).toBe(true);
    expect(Array.from(shown).length).toBeLessThanOrEqual(24);
    const label = screen.getByText(shown);
    expect(label.closest('[title]')).toHaveAttribute('title', LONG);
    expect(screen.getByTestId('tab-host')).toHaveAttribute('aria-label', `searchTabs.accessibleName|${LONG}`);
  });

  it('a meaning (semantic) tab gets the subtitle and the meaning accessible name', () => {
    setActiveSession({ query: 'grace', resultsForQuery: 'grace', isSemanticMode: true });
    renderTab(makeProps('search'));

    expect(screen.getByText('searchTabs.meaningSubtitle')).toBeInTheDocument();
    expect(screen.getByText('grace').closest('[title]')).toHaveAttribute('title', 'grace');
    expect(screen.getByTestId('tab-host')).toHaveAttribute('aria-label', 'searchTabs.accessibleNameMeaning|grace');
  });

  it('a keyword tab has no meaning subtitle', () => {
    setActiveSession({ query: 'grace', resultsForQuery: 'grace' });
    renderTab(makeProps('search'));
    expect(screen.queryByText('searchTabs.meaningSubtitle')).toBeNull();
  });

  it('a parked session\'s tab shows that session\'s own query, not the active one\'s', () => {
    setActiveSession({ query: 'active', resultsForQuery: 'active' });
    useSearchStore.setState({
      parkedSessions: { [PANEL_ID]: { ...freshSessionFields(false), query: 'parked', resultsForQuery: 'parked' } },
      activeSessionId: 'search_other',
    });
    renderTab(makeProps('search'));
    expect(screen.getByText('parked')).toBeInTheDocument();
    expect(screen.queryByText('active')).toBeNull();
  });

  it('a restored tab whose re-run is pending is titled with its query', () => {
    useSearchStore.setState({
      activeSessionId: null,
      parkedSessions: { [PANEL_ID]: { ...freshSessionFields(false), query: 'faith', pendingRerun: true } },
    });
    renderTab(makeProps('search'));
    expect(screen.getByText('faith')).toBeInTheDocument();
  });

  it('with no query yet it falls back to the generic panel title and offers no search-tab menu item', async () => {
    renderTab(makeProps('search'));
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByTestId('tab-host')).toHaveAttribute('aria-label', 'Search');

    await userEvent.setup().pointer({ keys: '[MouseRight]', target: screen.getByText('Search') });
    expect(screen.queryByTestId('search-tab-open-in-new-tab')).toBeNull();
  });

  it('a non-search tab is untouched by the search store', () => {
    setActiveSession({ query: 'love', resultsForQuery: 'love' });
    renderTab(makeProps('bible', 'bible_1', 'John 3'));
    expect(screen.getByText('John 3')).toBeInTheDocument();
    expect(screen.queryByText('love')).toBeNull();
  });
});

describe('search tab context menu', () => {
  it('"Open in New Search Tab" calls openSessionInNewTab with the panel id and closes the menu', async () => {
    const openSessionInNewTab = vi.fn().mockResolvedValue(undefined);
    setActiveSession({ query: 'love', resultsForQuery: 'love' });
    useSearchStore.setState({ openSessionInNewTab });
    const user = userEvent.setup();
    renderTab(makeProps('search'));

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('love') });
    const item = screen.getByTestId('search-tab-open-in-new-tab');
    expect(item).toHaveTextContent('searchTabs.openInNewTab');
    await user.click(item);

    expect(openSessionInNewTab).toHaveBeenCalledTimes(1);
    expect(openSessionInNewTab).toHaveBeenCalledWith(PANEL_ID);
    expect(screen.queryByTestId('search-tab-open-in-new-tab')).toBeNull();
  });

  it('other tab types have no such item', async () => {
    const user = userEvent.setup();
    renderTab(makeProps('bible', 'bible_1', 'John 3'));
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('John 3') });
    expect(screen.queryByTestId('search-tab-open-in-new-tab')).toBeNull();
  });
});
