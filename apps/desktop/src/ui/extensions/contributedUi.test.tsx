/**
 * Rendering for extension contributions the host already accepted
 * (`PlatformPlan.md` P1a and P1b).
 *
 * `RendererUiBridge` pushes seven kinds of UI contribution to the renderer and
 * the dispatcher handled exactly one of them. An extension calling
 * `ui.registerContextMenu('verse', ...)` or `ui.registerStatusBarItem(...)`
 * got a valid `DisposableHandle`, passed the permission guard, landed in
 * `ContributionRegistry`, and was then dropped on the floor — no error, no
 * warning, nothing on screen. The platform's biggest gap was not a missing
 * API; it was missing rendering for APIs that already validated.
 *
 * These tests cover the two surfaces that gap cost most:
 *
 *   - the verse context menu, the most requested integration shape in any
 *     Bible app, and the main way a passage gets added to anything;
 *   - the status bar, which did not exist as a component at all despite three
 *     unrelated consumers assuming it did.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import VerseContextMenu from '../components/VerseContextMenu';
import StatusBar from '../components/StatusBar';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { useExtensionUiStore } from './extensionUiStore';

const execute = vi.fn().mockResolvedValue(undefined);

function createMockServices(): AppServices {
  return {
    registry: { execute } as unknown as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string) => key,
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      // Mirrors `I18nService.resolve`: a literal passes through, a catalog
      // reference resolves to its key in this stub.
      resolve: (v: unknown) =>
        typeof v === 'object' && v !== null && 'key' in v
          ? String((v as { key: string }).key)
          : String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(<ContextProvider services={createMockServices()}>{ui}</ContextProvider>);
}

const mockVerse = {
  verse_id: 43003016,
  book_number: 43,
  chapter: 3,
  verse: 16,
  text: 'For God so loved the world',
};
const mockContext = { bookName: 'John', chapter: 3, translation: 'KJV' };
const position = { x: 100, y: 200 };

/** Reset the contribution registries between tests - the store is a singleton. */
function resetStore(): void {
  useExtensionUiStore.setState({ contextMenuItems: [], statusBarItems: [] });
}

describe('contributed verse context menu items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  function openMenu() {
    return renderWithProviders(
      <VerseContextMenu
        verses={mockVerse}
        context={mockContext}
        position={position}
        onClose={vi.fn()}
        onOpenCopyOptions={vi.fn()}
      />,
    );
  }

  it('renders a registered item', () => {
    useExtensionUiStore
      .getState()
      .addContextMenuItem('ext.test.memory', 'verse', {
        id: 'addToPlan',
        label: 'Add to memorization plan',
        command: 'ext.test.memory.add',
      });

    openMenu();

    expect(screen.getByText('Add to memorization plan')).toBeInTheDocument();
  });

  it('dispatches the named command through the registry, with args', async () => {
    const user = userEvent.setup();
    useExtensionUiStore.getState().addContextMenuItem('ext.test.memory', 'verse', {
      id: 'addToPlan',
      label: 'Add to memorization plan',
      command: 'ext.test.memory.add',
      args: { collectionId: 4 },
    });

    openMenu();
    await user.click(screen.getByText('Add to memorization plan'));

    // Extension commands are already in the same `ICommandRegistry` that
    // serves the palette and the menu bar, so this reuses a path wired in both
    // directions rather than inventing new IPC.
    expect(execute).toHaveBeenCalledWith('ext.test.memory.add', { collectionId: 4 });
  });

  it('resolves a catalog reference for the label', () => {
    useExtensionUiStore.getState().addContextMenuItem('ext.test.memory', 'verse', {
      id: 'addToPlan',
      label: { key: 'memory.addToPlan' },
      command: 'ext.test.memory.add',
    });

    openMenu();

    expect(screen.getByText('memory.addToPlan')).toBeInTheDocument();
  });

  it('orders items by `order`, ascending', () => {
    const store = useExtensionUiStore.getState();
    store.addContextMenuItem('ext.b', 'verse', {
      id: 'second',
      label: 'Second',
      command: 'c2',
      order: 20,
    });
    store.addContextMenuItem('ext.a', 'verse', {
      id: 'first',
      label: 'First',
      command: 'c1',
      order: 10,
    });

    openMenu();

    const labels = screen
      .getAllByRole('menuitem')
      .map((el) => el.textContent)
      .filter((tx) => tx === 'First' || tx === 'Second');
    expect(labels).toEqual(['First', 'Second']);
  });

  it('does not render items contributed for another target', () => {
    useExtensionUiStore.getState().addContextMenuItem('ext.test.other', 'note', {
      id: 'noteThing',
      label: 'Note thing',
      command: 'ext.test.other.note',
    });

    openMenu();

    expect(screen.queryByText('Note thing')).not.toBeInTheDocument();
  });

  it('holds back an item carrying a `when` clause rather than showing it unconditionally', () => {
    // `when` evaluates against `IContextApi` keys and the expression evaluator
    // is not wired into this menu. Showing the item anyway would be wrong in
    // precisely the case its author cared enough to write a condition for.
    useExtensionUiStore.getState().addContextMenuItem('ext.test.memory', 'verse', {
      id: 'conditional',
      label: 'Only sometimes',
      command: 'ext.test.memory.sometimes',
      when: 'ext.test.memory.hasCollection',
    });

    openMenu();

    expect(screen.queryByText('Only sometimes')).not.toBeInTheDocument();
  });

  it('disappears when the extension disposes it', () => {
    const store = useExtensionUiStore.getState();
    store.addContextMenuItem('ext.test.memory', 'verse', {
      id: 'addToPlan',
      label: 'Add to memorization plan',
      command: 'ext.test.memory.add',
    });
    store.removeContextMenuItem('ext.test.memory', 'addToPlan');

    openMenu();

    expect(screen.queryByText('Add to memorization plan')).not.toBeInTheDocument();
  });

  it('replaces rather than duplicates when the same id re-registers', () => {
    const store = useExtensionUiStore.getState();
    store.addContextMenuItem('ext.test.memory', 'verse', {
      id: 'addToPlan',
      label: 'Old label',
      command: 'ext.test.memory.add',
    });
    store.addContextMenuItem('ext.test.memory', 'verse', {
      id: 'addToPlan',
      label: 'New label',
      command: 'ext.test.memory.add',
    });

    openMenu();

    expect(screen.queryByText('Old label')).not.toBeInTheDocument();
    expect(screen.getAllByText('New label')).toHaveLength(1);
  });

  it('keeps the app’s own actions above the contributed ones', () => {
    useExtensionUiStore.getState().addContextMenuItem('ext.test.memory', 'verse', {
      id: 'addToPlan',
      label: 'Add to memorization plan',
      command: 'ext.test.memory.add',
    });

    openMenu();

    const texts = screen.getAllByRole('menuitem').map((el) => el.textContent ?? '');
    const copyIndex = texts.findIndex((tx) => tx.includes('copyPassage'));
    const extIndex = texts.findIndex((tx) => tx.includes('Add to memorization plan'));
    expect(copyIndex).toBeGreaterThanOrEqual(0);
    expect(extIndex).toBeGreaterThan(copyIndex);
  });
});

describe('status bar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('renders nothing at all when no extension contributes an item', () => {
    // The mitigation for adding permanent chrome to a shipping app: a user
    // with no such extension sees no strip, not an empty one.
    const { container } = renderWithProviders(<StatusBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('appears once an item is registered', () => {
    useExtensionUiStore.getState().addStatusBarItem('ext.bible-app.word-count', {
      id: 'display',
      text: 'Words: 402',
    });

    renderWithProviders(<StatusBar />);

    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
    expect(screen.getByText('Words: 402')).toBeInTheDocument();
  });

  it('splits items into leading and trailing slots by alignment', () => {
    const store = useExtensionUiStore.getState();
    store.addStatusBarItem('ext.a', { id: 'left', text: 'Left thing', alignment: 'left' });
    store.addStatusBarItem('ext.b', { id: 'right', text: 'Right thing', alignment: 'right' });

    renderWithProviders(<StatusBar />);

    const bar = screen.getByTestId('status-bar');
    const [leading, trailing] = Array.from(bar.children);
    expect(leading?.textContent).toBe('Left thing');
    expect(trailing?.textContent).toBe('Right thing');
  });

  it('orders by priority descending within a slot', () => {
    const store = useExtensionUiStore.getState();
    store.addStatusBarItem('ext.a', { id: 'low', text: 'Low', priority: 1 });
    store.addStatusBarItem('ext.b', { id: 'high', text: 'High', priority: 100 });

    renderWithProviders(<StatusBar />);

    const leading = screen.getByTestId('status-bar').children[0]!;
    expect(leading.textContent).toBe('HighLow');
  });

  it('runs the item’s command on click', async () => {
    const user = userEvent.setup();
    useExtensionUiStore.getState().addStatusBarItem('ext.test.memory', {
      id: 'due',
      text: '14 due',
      command: 'ext.test.memory.open',
    });

    renderWithProviders(<StatusBar />);
    await user.click(screen.getByText('14 due'));

    expect(execute).toHaveBeenCalledWith('ext.test.memory.open');
  });

  it('renders a command-less item as a readout, not a button', () => {
    useExtensionUiStore.getState().addStatusBarItem('ext.a', { id: 'readout', text: 'Indexing' });

    renderWithProviders(<StatusBar />);

    // No command means nothing happens on click, so it must not offer a
    // button's affordances or take a tab stop.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Indexing')).toBeInTheDocument();
  });

  it('resolves catalog references for text and tooltip', () => {
    useExtensionUiStore.getState().addStatusBarItem('ext.a', {
      id: 'i18n',
      text: { key: 'memory.dueCount' },
      tooltip: { key: 'memory.dueTooltip' },
      command: 'noop',
    });

    renderWithProviders(<StatusBar />);

    expect(screen.getByText('memory.dueCount')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('title', 'memory.dueTooltip');
  });

  it('drops back to nothing when the last item is disposed', () => {
    const store = useExtensionUiStore.getState();
    store.addStatusBarItem('ext.a', { id: 'only', text: 'Only' });
    store.removeStatusBarItem('ext.a', 'only');

    const { container } = renderWithProviders(<StatusBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('clears every contribution an extension owned when it deactivates', () => {
    const store = useExtensionUiStore.getState();
    store.addStatusBarItem('ext.a', { id: 's1', text: 'A status' });
    store.addContextMenuItem('ext.a', 'verse', { id: 'm1', label: 'A menu', command: 'c' });
    store.addPanelType('ext.a', { id: 'p1', title: 'A panel', uiEntry: 'ui/index.html' });
    store.addStatusBarItem('ext.b', { id: 's2', text: 'B status' });

    store.removeContributionsByOwner('ext.a');

    const state = useExtensionUiStore.getState();
    expect(state.statusBarItems.map((i) => i.extensionId)).toEqual(['ext.b']);
    expect(state.contextMenuItems).toEqual([]);
    expect(state.panelTypes).toEqual([]);
  });
});

describe('contributed panel types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useExtensionUiStore.setState({ panelTypes: [] });
  });

  it('composes the layout content type the rest of the app addresses panels by', () => {
    // Every consumer - the new-tab page, the auto-registered "Open X" command,
    // the pop-out mapping - has to spell this identically, so it is computed
    // once here rather than rebuilt at each call site.
    useExtensionUiStore.getState().addPanelType('ext.bible-app.memory', {
      id: 'session',
      title: 'Scripture Memory',
      uiEntry: 'ui/index.html',
    });

    const [panel] = useExtensionUiStore.getState().panelTypes;
    expect(panel).toMatchObject({
      extensionId: 'ext.bible-app.memory',
      panelTypeId: 'session',
      contentType: 'ext:ext.bible-app.memory.session',
    });
  });

  it('replaces rather than duplicates when the same panel type re-registers', () => {
    const store = useExtensionUiStore.getState();
    store.addPanelType('ext.a', { id: 'p', title: 'Old', uiEntry: 'a.html' });
    store.addPanelType('ext.a', { id: 'p', title: 'New', uiEntry: 'a.html' });

    const panels = useExtensionUiStore.getState().panelTypes;
    expect(panels).toHaveLength(1);
    expect(panels[0]!.def.title).toBe('New');
  });

  it('removes one panel type without touching its siblings', () => {
    const store = useExtensionUiStore.getState();
    store.addPanelType('ext.a', { id: 'one', title: 'One', uiEntry: 'a.html' });
    store.addPanelType('ext.a', { id: 'two', title: 'Two', uiEntry: 'b.html' });

    store.removePanelType('ext.a', 'one');

    expect(useExtensionUiStore.getState().panelTypes.map((p) => p.panelTypeId)).toEqual([
      'two',
    ]);
  });
});
