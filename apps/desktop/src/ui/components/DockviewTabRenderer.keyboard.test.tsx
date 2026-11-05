/**
 * Round 2 (0209) keyboard behaviour of dockview tabs: the tab actions menu,
 * tabs that move into another group, focus after closing, and the tablist
 * name following its group.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../stores/useLayoutStore', () => ({ useLayoutStore: vi.fn().mockReturnValue(undefined) }));
vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, v?: Record<string, string>) => (v?.name ? `${k}:${v.name}` : k) }),
}));
vi.mock('../utils/paneNames', () => ({
  localizePaneLabel: (_t: unknown, _c: unknown, l: string) => l,
  PANE_NAME_KEYS: { study: 'paneName.study', bible: 'paneName.bible', newtab: 'paneName.newTab' },
}));
vi.mock('../hooks/useOverlayDismissal', () => ({ useOverlayDismissal: vi.fn() }));

import DockviewTabRenderer from './DockviewTabRenderer';

type Listener = () => void;
function emitter() {
  const ls = new Set<Listener>();
  return {
    on: vi.fn((cb: Listener) => { ls.add(cb); return { dispose: () => ls.delete(cb) }; }),
    fire: () => ls.forEach(l => l()),
  };
}

function makeProps(id: string, contentType: string, group: any, extra: Record<string, unknown> = {}) {
  const groupChange = emitter();
  const layout = emitter();
  const props = {
    api: {
      id, title: contentType, isActive: true, setActive: vi.fn(), group,
      onDidTitleChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidGroupChange: groupChange.on,
      onDidActiveChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      close: vi.fn(),
    },
    containerApi: {
      panels: [{ id: 'p1' }, { id: 'p2' }],
      groups: [group],
      activeGroup: group,
      onDidLayoutChange: layout.on,
      getPanel: vi.fn(),
      addGroup: vi.fn(),
    },
    params: { contentType },
    ...extra,
  } as any;
  return { props, groupChange, layout };
}

afterEach(cleanup);

describe('tab actions menu keyboard (round 2)', () => {
  function setup() {
    const group: any = { id: 'g', panels: [{ id: 'p1', params: { contentType: 'study' } }, { id: 'p2', params: { contentType: 'study' } }], activePanel: { id: 'p1' } };
    const { props } = makeProps('p1', 'study', group);
    const utils = render(
      <div className="dv-tabs-container">
        <div className="dv-tab" tabIndex={0}><DockviewTabRenderer {...props} /></div>
      </div>,
    );
    return { ...utils, tab: utils.container.querySelector('.dv-tab') as HTMLElement };
  }

  it('opens from the Menu key, focuses the first item and moves with the arrow keys', async () => {
    const { tab } = setup();
    const user = userEvent.setup();
    tab.focus();
    await user.keyboard('{ContextMenu}');
    const items = screen.getAllByRole('menuitem');
    expect(items.length).toBeGreaterThan(1);
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(items[1]);
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(items[items.length - 1]);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(items[items.length - 1]);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(items[0]);
  });

  it('opens from Shift+F10', async () => {
    const { tab } = setup();
    const user = userEvent.setup();
    tab.focus();
    await user.keyboard('{Shift>}{F10}{/Shift}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('Escape closes the menu and returns focus to the tab', async () => {
    const { tab } = setup();
    const user = userEvent.setup();
    tab.focus();
    await user.keyboard('{ContextMenu}');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(tab);
  });

  it('Tab closes the menu instead of moving on while it stays open', async () => {
    const { tab } = setup();
    const user = userEvent.setup();
    tab.focus();
    await user.keyboard('{ContextMenu}');
    await user.keyboard('{Tab}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(tab);
  });
});

describe('tabs in other groups (round 2)', () => {
  it('applies tab semantics when dockview moves the tab into a new strip, and names that strip for its group', async () => {
    const oldGroup: any = { id: 'g1', panels: [{ id: 'p1', params: { contentType: 'bible' } }], activePanel: { id: 'p1' } };
    const { props, groupChange } = makeProps('p1', 'bible', oldGroup);
    const { container } = render(
      <div>
        <div id="old" className="dv-tabs-container"><div className="dv-tab" tabIndex={0}><DockviewTabRenderer {...props} /></div></div>
        <div id="new" className="dv-tabs-container" />
      </div>,
    );
    const oldStrip = container.querySelector('#old') as HTMLElement;
    const newStrip = container.querySelector('#new') as HTMLElement;
    expect(oldStrip.getAttribute('aria-label')).toBe('ui.dockviewTab.tablistLabel:paneName.bible');

    // dockview moves the existing element into the new group's strip.
    const tab = oldStrip.querySelector('.dv-tab') as HTMLElement;
    newStrip.appendChild(tab);
    const newGroup: any = { id: 'g2', panels: [{ id: 'p1', params: { contentType: 'bible' } }], activePanel: { id: 'p1' } };
    props.api.group = newGroup;
    act(() => groupChange.fire());

    expect(newStrip.getAttribute('role')).toBe('tablist');
    expect(newStrip.getAttribute('aria-label')).toBe('ui.dockviewTab.tablistLabel:paneName.bible');
    expect(tab.getAttribute('role')).toBe('tab');
    expect(tab.getAttribute('aria-selected')).toBe('true');
    // Enter still activates it from the new strip.
    const user = userEvent.setup();
    tab.focus();
    await user.keyboard('{Enter}');
    expect(props.api.setActive).toHaveBeenCalled();
  });

  it('renames the tablist when the group\'s panels change', () => {
    const group: any = { id: 'g', panels: [{ id: 'p1', params: { contentType: 'newtab' } }], activePanel: { id: 'p1' } };
    const { props, layout } = makeProps('p1', 'newtab', group);
    const { container } = render(
      <div className="dv-tabs-container"><div className="dv-tab" tabIndex={0}><DockviewTabRenderer {...props} /></div></div>,
    );
    const strip = container.querySelector('.dv-tabs-container') as HTMLElement;
    expect(strip.getAttribute('aria-label')).toBe('ui.dockviewTab.tablistLabel:paneName.study');
    group.panels = [{ id: 'p1', params: { contentType: 'newtab' } }, { id: 'p2', params: { contentType: 'bible' } }];
    act(() => layout.fire());
    expect(strip.getAttribute('aria-label')).toBe('ui.dockviewTab.tablistLabel:paneName.bible');
  });
});

describe('tablist names (D8-3)', () => {
  function strip(group: any, others: any[] = []) {
    const { props } = makeProps('p1', 'newtab', group);
    props.containerApi.groups = [...others, group];
    const { container } = render(
      <div className="dv-tabs-container"><div className="dv-tab" tabIndex={0}><DockviewTabRenderer {...props} /></div></div>,
    );
    return container.querySelector('.dv-tabs-container') as HTMLElement;
  }

  it('names a group holding a Bible panel "Bible" whichever tab is selected', () => {
    const group: any = {
      id: 'g',
      panels: [{ id: 'p0', params: { contentType: 'bible' } }, { id: 'p1', params: { contentType: 'study' } }],
      activePanel: { id: 'p1' },
    };
    expect(strip(group).getAttribute('aria-label')).toBe('ui.dockviewTab.tablistLabel:paneName.bible');
  });

  it('names any other group "Study" whatever its selected tab is', () => {
    const group: any = {
      id: 'g',
      panels: [{ id: 'p0', params: { contentType: 'notes' } }, { id: 'p1', params: { contentType: 'dictionary' } }],
      activePanel: { id: 'p1' },
    };
    expect(strip(group).getAttribute('aria-label')).toBe('ui.dockviewTab.tablistLabel:paneName.study');
  });

  it('tells two groups of the same kind apart with a number', () => {
    const first: any = { id: 'g1', panels: [{ id: 'a', params: { contentType: 'newtab' } }], activePanel: { id: 'a' } };
    const second: any = { id: 'g2', panels: [{ id: 'p1', params: { contentType: 'newtab' } }], activePanel: { id: 'p1' } };
    expect(strip(second, [first]).getAttribute('aria-label')).toBe('ui.dockviewTab.tablistLabel:paneName.study 2');
  });

  it('leaves the first group of a kind unnumbered', () => {
    const first: any = { id: 'g1', panels: [{ id: 'p1', params: { contentType: 'newtab' } }], activePanel: { id: 'p1' } };
    const second: any = { id: 'g2', panels: [{ id: 'b', params: { contentType: 'newtab' } }], activePanel: { id: 'b' } };
    const { props } = makeProps('p1', 'newtab', first);
    props.containerApi.groups = [first, second];
    const { container } = render(
      <div className="dv-tabs-container"><div className="dv-tab" tabIndex={0}><DockviewTabRenderer {...props} /></div></div>,
    );
    expect(container.querySelector('.dv-tabs-container')!.getAttribute('aria-label')).toBe('ui.dockviewTab.tablistLabel:paneName.study');
  });
});

describe('focus after closing a tab (round 2)', () => {
  it('Delete moves focus to the tab that becomes active in the same group', async () => {
    const strip = document.createElement('div');
    strip.className = 'dv-tabs-container';
    const group: any = {
      id: 'g', element: strip,
      panels: [{ id: 'p1', params: { contentType: 'study' } }, { id: 'p2', params: { contentType: 'study' } }],
      activePanel: { id: 'p1' },
    };
    const { props } = makeProps('p1', 'study', group);
    props.api.close = vi.fn(() => {
      // dockview drops the panel and its tab element, and activates the neighbour.
      group.panels = [group.panels[1]];
      group.activePanel = group.panels[0];
      strip.querySelector('.dv-tab')!.remove();
    });
    // Build the strip by hand so the group's element owns both tabs.
    const t1 = document.createElement('div'); t1.className = 'dv-tab'; t1.tabIndex = 0;
    const t2 = document.createElement('div'); t2.className = 'dv-tab'; t2.tabIndex = 0;
    strip.append(t1, t2);
    document.body.appendChild(strip);
    render(<DockviewTabRenderer {...props} />, { container: t1 });
    const user = userEvent.setup();
    t1.focus();
    await user.keyboard('{Delete}');
    expect(props.api.close).toHaveBeenCalled();
    expect(document.activeElement).toBe(t2);
    strip.remove();
  });
});
