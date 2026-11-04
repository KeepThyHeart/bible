import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { registerHostUiForTests } from '../modules/host/registerHostUiForTests';

beforeAll(() => registerHostUiForTests());
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import NewTabPage from './NewTabPage';
import { useLayoutStore } from '../stores/useLayoutStore';
import { useBibleStore, DEFAULT_PANEL_ID } from '../stores/useBibleStore';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { chooserIconFor, tabIconFor, ICONLESS_TAB_CONTENT_TYPES } from './paneIcons';
import { enT } from '../testing/enCatalog';

// Mock dockview-react
vi.mock('dockview-react', () => ({}));

/**
 * `t()` returns `[key]` for a key no catalog carries - the real service's
 * behaviour - so these assertions exercise the `tf()` English fallbacks the
 * user actually sees until `locales/en` picks the keys up.
 */
function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string, params?: Record<string, unknown>) => enT(key, params),
      currentLocale: 'en' as const,
      currentDirection: 'ltr' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function renderPage(ui: React.ReactElement) {
  return render(<ContextProvider services={createMockServices()}>{ui}</ContextProvider>);
}

/**
 * A dockview stub with just enough shape for `replaceWithPanel`: the New Tab
 * panel, the group holding it, and that group's panel list (used to place the
 * replacement at the same index).
 */
function fakeDockview() {
  const currentPanel = { api: { close: vi.fn() } } as never as { api: { close: () => void } };
  const group = { panels: [currentPanel] };
  return {
    getPanel: () => ({ ...currentPanel, group }),
  } as never;
}

/**
 * The English fallback each category tile renders (`tf()` supplies these while
 * `locales/en` has no key for them).
 */
const TILE_LABEL: Record<'bible' | 'commentary' | 'book' | 'dictionary' | 'notes' | 'prayer' | 'study' | 'topics', string> = {
  bible: 'Bible',
  commentary: 'Commentary',
  book: 'Books',
  dictionary: 'Dictionary',
  notes: 'Notes',
  prayer: 'Prayer',
  study: 'Study',
  topics: 'Topics',
};

/** Tile order as rendered: row 1 then row 2, four columns wide. */
const ALL_TILE_TYPES = [
  'bible', 'notes', 'prayer', 'book',
  'study', 'commentary', 'dictionary', 'topics',
] as const;

describe('NewTabPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBibleStore.setState({
      panels: new Map(),
      availableBibles: [{ abbreviation: 'KJV', name: 'King James Version', database_path: '/tmp/kjv.db' }],
    });
    useLayoutStore.setState({
      dockviewApi: null,
      addPanel: vi.fn(),
    });
  });

  it('asks what the pane should hold rather than just saying "New Tab"', () => {
    renderPage(<NewTabPage panelId="test-panel" />);
    expect(screen.getByText(/What would you like in this pane\?/i)).toBeInTheDocument();
  });

  it('explains what typing in the box does', () => {
    renderPage(<NewTabPage panelId="test-panel" />);
    expect(screen.getByText(/Type where you want to go/i)).toBeInTheDocument();
  });

  it('renders the quick reference input with a name for assistive tech', () => {
    renderPage(<NewTabPage panelId="test-panel" />);
    const input = screen.getByPlaceholderText(/For example/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAccessibleName();
  });

  it('renders all quick action buttons', () => {
    renderPage(<NewTabPage panelId="test-panel" />);
    expect(screen.getByRole('button', { name: /Bible/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Commentary/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Notes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Prayer/i })).toBeInTheDocument();
  });

  // Every tile, including the four the *tab strip* deliberately leaves bare.
  // A chooser is a grid of equal-weight tiles scanned cold, where a tile with
  // no icon reads as unfinished next to seven that have one.
  it('gives every category tile an icon', () => {
    renderPage(<NewTabPage panelId="test-panel" />);
    for (const type of ALL_TILE_TYPES) {
      const icon = chooserIconFor(type);
      expect(icon, type).toBeDefined();
      expect(screen.getByRole('button', { name: TILE_LABEL[type] }).textContent, type).toContain(icon);
    }
  });

  // The iconless rule still governs tabs; it is only the chooser that opts out.
  // Pinned here as well as in paneIcons.test.ts to guard against asserting the
  // opposite for these four types.
  it('does not disturb the tab strip rule for the staple study surfaces', () => {
    for (const type of ['study', 'commentary', 'topics', 'dictionary'] as const) {
      expect(ICONLESS_TAB_CONTENT_TYPES, type).toContain(type);
      expect(tabIconFor(type), type).toBeUndefined();
    }
  });

  // Row 1 is Scripture plus the two places the user writes; row 2 is the study
  // apparatus that hangs off a verse. The grid is four wide, so DOM order is
  // reading order.
  it('lays the tiles out in the documented row order', () => {
    renderPage(<NewTabPage panelId="test-panel" />);
    const tileNames = ALL_TILE_TYPES.map(type => TILE_LABEL[type]);
    const rendered = screen
      .getAllByRole('button')
      .map(b => b.textContent ?? '')
      .filter(text => tileNames.some(name => text.endsWith(name)));
    expect(rendered.map(text => tileNames.find(name => text.endsWith(name)))).toEqual([
      'Bible', 'Notes', 'Prayer', 'Books',
      'Study', 'Commentary', 'Dictionary', 'Topics',
    ]);
  });

  it('reports unrecognized input as one message quoting what was typed', async () => {
    const user = userEvent.setup();
    renderPage(<NewTabPage panelId="test-panel" />);
    const input = screen.getByPlaceholderText(/For example/i);
    await user.type(input, 'xyzzy_not_a_verse');
    await user.keyboard('{Enter}');

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/xyzzy_not_a_verse/);
    expect(alert).toHaveTextContent(/did not match a passage or a category/i);
    // The field points at the error so a screen reader reads them together.
    expect(input).toHaveAttribute('aria-describedby', alert.id);
  });

  it('clears the error when input changes', async () => {
    const user = userEvent.setup();
    renderPage(<NewTabPage panelId="test-panel" />);
    const input = screen.getByPlaceholderText(/For example/i);
    await user.type(input, 'xyzzy_not_a_verse');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.clear(input);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  /**
   * A passage typed here must be seeded with the app default (Standard), not
   * `|reading`, which hides verse numbers - the wrong landing state for a
   * Bible *study* app, and inconsistent with every other way a passage is
   * opened.
   */
  /**
   * The verse slot must carry the verse the user typed. Leaving it empty
   * would open "John 5:5" on John 5 with verse 1 selected - the right
   * chapter, but not the verse asked for.
   */
  it('seeds a typed passage in the default display mode, with the verse selected', async () => {
    const addPanel = vi.fn().mockReturnValue('bible_new');
    useLayoutStore.setState({ dockviewApi: fakeDockview(), addPanel });

    const user = userEvent.setup();
    renderPage(<NewTabPage panelId="test-panel" dockviewPanelApi={{} as never} />);
    await user.type(screen.getByPlaceholderText(/For example/i), 'John 3:16');
    await user.keyboard('{Enter}');

    expect(addPanel).toHaveBeenCalledTimes(1);
    expect(addPanel.mock.calls[0][0]).toBe('bible');
    expect(addPanel.mock.calls[0][1]).toBe('KJV|43|3|43003016|standard');
  });

  it('seeds a typed "Book Chapter" in the default display mode too', async () => {
    const addPanel = vi.fn().mockReturnValue('bible_new');
    useLayoutStore.setState({ dockviewApi: fakeDockview(), addPanel });

    const user = userEvent.setup();
    renderPage(<NewTabPage panelId="test-panel" dockviewPanelApi={{} as never} />);
    await user.type(screen.getByPlaceholderText(/For example/i), 'John 3');
    await user.keyboard('{Enter}');

    expect(addPanel.mock.calls[0][1]).toBe('KJV|43|3||standard');
  });

  // Modules install separately, so KJV may not be there. The passage has to
  // open in a Bible that is installed, not in one named out of habit.
  it('opens a typed passage in an installed Bible when KJV is not installed', async () => {
    useBibleStore.setState({
      availableBibles: [{ abbreviation: 'ASV', name: 'American Standard Version', database_path: '/tmp/asv.db' }],
    });
    const addPanel = vi.fn().mockReturnValue('bible_new');
    useLayoutStore.setState({ dockviewApi: fakeDockview(), addPanel });

    const user = userEvent.setup();
    renderPage(<NewTabPage panelId="test-panel" dockviewPanelApi={{} as never} />);
    await user.type(screen.getByPlaceholderText(/For example/i), 'John 3:16');
    await user.keyboard('{Enter}');

    expect(addPanel.mock.calls[0][1]).toBe('ASV|43|3|43003016|standard');
  });

  // B-028: the Bible tile opens the passage being read, not a blank default.
  it('opens the Bible tile at the current passage', async () => {
    const addPanel = vi.fn().mockReturnValue('bible_new');
    useLayoutStore.setState({ dockviewApi: fakeDockview(), addPanel });
    useBibleStore.setState({
      panels: new Map([[DEFAULT_PANEL_ID, {
        currentBook: 45, currentChapter: 8, currentBookName: 'Romans', selectedVerseId: 45008028, openTabs: [],
      } as never]]),
    });
    const user = userEvent.setup();
    renderPage(<NewTabPage panelId="test-panel" dockviewPanelApi={{} as never} />);
    await user.click(screen.getByRole('button', { name: /^Bible$/i }));
    expect(addPanel.mock.calls[0][0]).toBe('bible');
    expect(addPanel.mock.calls[0][1]).toBe('KJV|45|8|45008028|standard');
  });

  // B-108: with two Bible tabs, the tile follows the tab being read, not the first one.
  it('opens the Bible tile at the passage of the last active Bible pane', async () => {
    const addPanel = vi.fn().mockReturnValue('bible_new');
    useLayoutStore.setState({ dockviewApi: fakeDockview(), addPanel, lastActiveBiblePanelId: 'bible_mark' });
    useBibleStore.setState({
      panels: new Map([
        [DEFAULT_PANEL_ID, { currentBook: 43, currentChapter: 15, currentBookName: 'John', selectedVerseId: 43015001, openTabs: [] } as never],
        ['bible_mark', { currentBook: 41, currentChapter: 4, currentBookName: 'Mark', selectedVerseId: 41004001, openTabs: [] } as never],
      ]),
    });
    const user = userEvent.setup();
    renderPage(<NewTabPage panelId="test-panel" dockviewPanelApi={{} as never} />);
    await user.click(screen.getByRole('button', { name: /^Bible$/i }));
    expect(addPanel.mock.calls[0][1]).toBe('KJV|41|4|41004001|standard');
    useLayoutStore.setState({ lastActiveBiblePanelId: null });
  });

  it('renders the pane-arrangement hint at the bottom', () => {
    renderPage(<NewTabPage panelId="test-panel" />);
    expect(screen.getByText(/dragged by their tab/i)).toBeInTheDocument();
  });
});
