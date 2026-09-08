import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IDockviewHeaderActionsProps } from 'dockview-react';
import DockviewHeaderActions from './DockviewHeaderActions';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { useLayoutStore } from '../stores/useLayoutStore';

const STRINGS: Record<string, string> = {
  'layout.expandCollapsed.label': 'Show hidden panes',
  'layout.expandCollapsed.tooltip': 'Bring the collapsed study panes back into view',
  'layout.collapsePane.tooltip': 'Collapse this pane out of the way',
  'ui.dockviewHeaderActions.newTab': 'New Tab',
};

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string) => STRINGS[key] ?? key,
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

/**
 * Just enough of the dockview container API for the collapse button, which asks
 * two questions: "would this hide the last visible pane?" (`groups`) and "is
 * the workbench the plain left/right two-pane split?" (`toJSON().grid` - see
 * `isLeftRightTwoPaneLayout`). Omitted entirely (the default) the button never
 * renders, which is what the pre-existing cases below assume.
 *
 * The serialized grid mirrors what `PresetApplier.buildSingleRowGrid` emits:
 * a HORIZONTAL root branch with one leaf per group.
 */
function fakeContainerApi(groupIds: string[], orientation: 'HORIZONTAL' | 'VERTICAL' = 'HORIZONTAL') {
  return {
    groups: groupIds.map(id => ({ id })),
    onDidLayoutChange: () => ({ dispose: vi.fn() }),
    toJSON: () => ({
      grid: {
        orientation,
        root: {
          type: 'branch',
          data: groupIds.map(id => ({ type: 'leaf', data: { id, views: [], activeView: undefined } })),
        },
      },
    }),
  };
}

function renderHeader(groupId: string, containerApi?: ReturnType<typeof fakeContainerApi>) {
  const props = {
    containerApi,
    group: { id: groupId },
    api: undefined,
    isGroupActive: true,
    activePanel: undefined,
    panels: [],
  } as unknown as IDockviewHeaderActionsProps;

  return render(
    <ContextProvider services={createMockServices()}>
      <DockviewHeaderActions {...props} />
    </ContextProvider>,
  );
}

describe('DockviewHeaderActions collapsed-pane restore', () => {
  beforeEach(() => {
    act(() => { useLayoutStore.setState({ collapsedGroups: [] }); });
  });

  afterEach(() => {
    act(() => { useLayoutStore.setState({ collapsedGroups: [] }); });
    vi.restoreAllMocks();
  });

  it('shows nothing extra when no pane is collapsed', () => {
    renderHeader('group-1');
    expect(screen.queryByTestId('expand-collapsed-panes')).toBeNull();
  });

  it('offers a way back when another group is collapsed', () => {
    act(() => { useLayoutStore.setState({ collapsedGroups: [{ groupId: 'group-2', axis: 'width' }] }); });
    renderHeader('group-1');
    expect(screen.getByTestId('expand-collapsed-panes')).toHaveTextContent('Show hidden panes');
  });

  it('does not offer the control inside the collapsed group itself', () => {
    // A zero-width group has no visible header, so the control would be
    // unreachable there.
    act(() => { useLayoutStore.setState({ collapsedGroups: [{ groupId: 'group-2', axis: 'width' }] }); });
    renderHeader('group-2');
    expect(screen.queryByTestId('expand-collapsed-panes')).toBeNull();
  });

  it('expands the collapsed panes when clicked', async () => {
    const expand = vi.fn();
    act(() => {
      useLayoutStore.setState({
        collapsedGroups: [{ groupId: 'group-2', axis: 'width' }],
        expandCollapsedGroups: expand,
      });
    });
    renderHeader('group-1');

    await userEvent.click(screen.getByTestId('expand-collapsed-panes'));
    expect(expand).toHaveBeenCalledOnce();
  });
});

describe('DockviewHeaderActions collapse control', () => {
  const realCollapseGroup = useLayoutStore.getState().collapseGroup;

  beforeEach(() => {
    act(() => { useLayoutStore.setState({ collapsedGroups: [] }); });
  });

  afterEach(() => {
    act(() => { useLayoutStore.setState({ collapsedGroups: [], collapseGroup: realCollapseGroup }); });
    vi.restoreAllMocks();
  });

  it('offers a collapse control in the two-pane split, with no preset active', () => {
    // The whole point of this control: collapsing must not happen only as a side
    // effect of applying Reading Mode.
    renderHeader('group-1', fakeContainerApi(['group-1', 'group-2']));
    expect(screen.getByTestId('collapse-pane')).toBeInTheDocument();
  });

  it('is hidden when the workbench is not a plain left/right two-pane split', () => {
    // Three groups, or a vertical stack, are not the shape the control means
    // anything in - the restore path only understands a width collapse, and
    // "collapse the right pane" has no single answer in a grid. Matches the
    // web app, where the chevron belongs to the right panel of a two-panel
    // layout.
    renderHeader('group-1', fakeContainerApi(['group-1', 'group-2', 'group-3']));
    expect(screen.queryByTestId('collapse-pane')).toBeNull();
  });

  it('is hidden when the two panes are stacked vertically', () => {
    renderHeader('group-1', fakeContainerApi(['group-1', 'group-2'], 'VERTICAL'));
    expect(screen.queryByTestId('collapse-pane')).toBeNull();
  });

  it('is hidden when this is the only group', () => {
    renderHeader('group-1', fakeContainerApi(['group-1']));
    expect(screen.queryByTestId('collapse-pane')).toBeNull();
  });

  it('is hidden when collapsing would leave nothing visible', () => {
    act(() => { useLayoutStore.setState({ collapsedGroups: [{ groupId: 'group-2', axis: 'width' }] }); });
    renderHeader('group-1', fakeContainerApi(['group-1', 'group-2']));
    expect(screen.queryByTestId('collapse-pane')).toBeNull();
  });

  it('is hidden inside a group that is already collapsed', () => {
    act(() => { useLayoutStore.setState({ collapsedGroups: [{ groupId: 'group-1', axis: 'width' }] }); });
    renderHeader('group-1', fakeContainerApi(['group-1', 'group-2']));
    expect(screen.queryByTestId('collapse-pane')).toBeNull();
  });

  it('collapses its own group when clicked', async () => {
    const collapseGroup = vi.fn().mockReturnValue(true);
    act(() => { useLayoutStore.setState({ collapseGroup }); });
    renderHeader('group-1', fakeContainerApi(['group-1', 'group-2']));

    await userEvent.click(screen.getByTestId('collapse-pane'));
    expect(collapseGroup).toHaveBeenCalledWith('group-1');
  });
});
