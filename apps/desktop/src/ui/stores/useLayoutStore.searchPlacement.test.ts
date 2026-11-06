/**
 * Search tabs (task 0210): where `openSearchResultsPanel` puts a session's tab.
 *
 * `useLayoutStore.searchPanel.test.ts` drives a real dockview for the "below"
 * geometry. These tests use a fake `DockviewApi` that records the exact
 * options handed to `addPanel`, so each placement rule and the `inactive` /
 * `initialWidth` pass-through can be asserted directly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useLayoutStore,
  rightSearchColumnWidth,
  findRightPaneGroupId,
  SEARCH_HOST_CONTENT_KEY,
  type GroupSummary,
  type PanelContentType,
} from './useLayoutStore';

interface FakePanel {
  id: string;
  params: Record<string, unknown>;
  api: { setActive: ReturnType<typeof vi.fn>; updateParameters: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; setTitle: ReturnType<typeof vi.fn>; title?: string };
}

let panels: Map<string, FakePanel>;
let addPanelSpy: ReturnType<typeof vi.fn>;
let api: { width: number; getPanel: (id: string) => FakePanel | undefined; getGroup: () => undefined; addPanel: ReturnType<typeof vi.fn> };

function seed(id: string, contentType: PanelContentType, params: Record<string, unknown> = {}): FakePanel {
  const panel: FakePanel = {
    id,
    params: { contentType, ...params },
    api: {
      setActive: vi.fn(),
      close: vi.fn(),
      updateParameters: vi.fn((next: Record<string, unknown>) => { panel.params = next; }),
      setTitle: vi.fn((t: string) => { panel.api.title = t; }),
      title: typeof params.searchQuery === 'string' ? params.searchQuery : undefined,
    },
  };
  panels.set(id, panel);
  useLayoutStore.getState().registerPanel({ panelId: id, contentType, displayName: contentType });
  return panel;
}

function seedHost(id: string): FakePanel {
  const p = seed(id, 'search');
  useLayoutStore.getState().registerPanel({ panelId: id, contentType: 'search', contentKey: SEARCH_HOST_CONTENT_KEY, displayName: 'Search' });
  return p;
}

const lastAdd = (): Record<string, unknown> => addPanelSpy.mock.calls[addPanelSpy.mock.calls.length - 1][0];

beforeEach(() => {
  panels = new Map();
  addPanelSpy = vi.fn();
  api = {
    width: 1200,
    getPanel: (id) => panels.get(id),
    getGroup: () => undefined,
    addPanel: addPanelSpy,
  };
  useLayoutStore.setState({
    dockviewApi: api as never,
    panels: new Map(),
    activePanelId: null,
    lastActiveBiblePanelId: null,
  });
});

afterEach(() => {
  useLayoutStore.setState({ dockviewApi: null, panels: new Map(), activePanelId: null, lastActiveBiblePanelId: null });
});

describe('openSearchResultsPanel: rule 1, the session\'s own tab', () => {
  it('focuses it, and never adds a panel', () => {
    const own = seed('s1', 'search');
    expect(useLayoutStore.getState().openSearchResultsPanel('s1', { reveal: true })).toBe('s1');
    expect(own.api.setActive).toHaveBeenCalledTimes(1);
    expect(addPanelSpy).not.toHaveBeenCalled();
  });

  it('with reveal:false it does not call setActive', () => {
    const own = seed('s1', 'search');
    expect(useLayoutStore.getState().openSearchResultsPanel('s1', { reveal: false })).toBe('s1');
    expect(own.api.setActive).not.toHaveBeenCalled();
    expect(addPanelSpy).not.toHaveBeenCalled();
  });

  it('beats the other rules: a right-placement preference does not move an existing tab', () => {
    seed('s1', 'search');
    useLayoutStore.getState().openSearchResultsPanel('s1', { placement: 'right' });
    expect(addPanelSpy).not.toHaveBeenCalled();
  });

  it('without a session id it reuses the first open search tab', () => {
    const first = seed('s1', 'search');
    seed('s2', 'search');
    expect(useLayoutStore.getState().openSearchResultsPanel()).toBe('s1');
    expect(first.api.setActive).toHaveBeenCalled();
    expect(addPanelSpy).not.toHaveBeenCalled();
  });

  it('returns null when dockview is not ready', () => {
    useLayoutStore.setState({ dockviewApi: null });
    expect(useLayoutStore.getState().openSearchResultsPanel('s1')).toBeNull();
  });
});

describe('openSearchResultsPanel: rule 2, join the search tab group', () => {
  it('a new session joins the last search tab as a tab within its group', () => {
    seed('bible_a', 'bible');
    seed('s1', 'search');
    seed('s2', 'search');

    const id = useLayoutStore.getState().openSearchResultsPanel('s3', { placement: 'right' });

    expect(id).toBe('s3');
    expect(lastAdd()).toMatchObject({ id: 's3', position: { referencePanel: 's2', direction: 'within' } });
    expect(lastAdd().initialWidth).toBeUndefined();
  });

  it('prefers nearSessionId when that tab is open', () => {
    seed('s1', 'search');
    seed('s2', 'search');
    useLayoutStore.getState().openSearchResultsPanel('s3', { nearSessionId: 's1' });
    expect(lastAdd().position).toEqual({ referencePanel: 's1', direction: 'within' });
  });

  it('ignores a nearSessionId that is no longer open', () => {
    seed('s1', 'search');
    useLayoutStore.getState().openSearchResultsPanel('s3', { nearSessionId: 'closed' });
    expect(lastAdd().position).toEqual({ referencePanel: 's1', direction: 'within' });
  });

  it('a search panel the store knows but dockview does not is not an anchor', () => {
    useLayoutStore.getState().registerPanel({ panelId: 'ghost', contentType: 'search', displayName: 'x' });
    seed('bible_a', 'bible');
    useLayoutStore.getState().openSearchResultsPanel('s3');
    expect(lastAdd().position).toEqual({ direction: 'below', referencePanel: 'bible_a' });
  });
});

describe('openSearchResultsPanel: rule 3, the placement preference', () => {
  it('right: a full-height column with an initial width from rightSearchColumnWidth', () => {
    seed('bible_a', 'bible');
    useLayoutStore.getState().openSearchResultsPanel('s1', { placement: 'right' });
    expect(lastAdd().position).toEqual({ direction: 'right' });
    expect(lastAdd().initialWidth).toBe(rightSearchColumnWidth(1200));
    expect(lastAdd().initialWidth).toBe(400);
  });

  it('right: no initialWidth when the workbench has no width yet', () => {
    api.width = 0;
    useLayoutStore.getState().openSearchResultsPanel('s1', { placement: 'right' });
    expect(lastAdd().position).toEqual({ direction: 'right' });
    expect(lastAdd()).not.toHaveProperty('initialWidth');
  });

  it('below (the default): under the last active Bible panel', () => {
    seed('bible_a', 'bible');
    seed('bible_b', 'bible');
    useLayoutStore.getState().setActivePanelId('bible_b');

    useLayoutStore.getState().openSearchResultsPanel('s1');

    expect(lastAdd().position).toEqual({ direction: 'below', referencePanel: 'bible_b' });
    expect(lastAdd().initialWidth).toBeUndefined();
  });

  it('below: falls back to any open Bible panel when the last active one is gone', () => {
    seed('bible_a', 'bible');
    useLayoutStore.setState({ lastActiveBiblePanelId: 'bible_closed' });
    useLayoutStore.getState().openSearchResultsPanel('s1', { placement: 'below' });
    expect(lastAdd().position).toEqual({ direction: 'below', referencePanel: 'bible_a' });
  });

  it('below with no Bible pane: no position at all (dockview uses the active group)', () => {
    seed('notes_a', 'notes');
    useLayoutStore.getState().openSearchResultsPanel('s1');
    expect(lastAdd()).not.toHaveProperty('position');
  });

  it('registers the panel with the generic English title and the session id as its panel id', () => {
    seed('bible_a', 'bible');
    useLayoutStore.getState().openSearchResultsPanel('s1');
    expect(lastAdd()).toMatchObject({ id: 's1', title: 'Search', params: { contentType: 'search' } });
    expect(useLayoutStore.getState().getPanel('s1')?.contentType).toBe('search');
  });
});

describe('openSearchResultsPanel: reveal', () => {
  it('reveal:false adds the panel inactive', () => {
    seed('bible_a', 'bible');
    useLayoutStore.getState().openSearchResultsPanel('s1', { reveal: false });
    expect(lastAdd().inactive).toBe(true);
  });

  it('reveal defaults to true: the panel is not marked inactive', () => {
    seed('bible_a', 'bible');
    useLayoutStore.getState().openSearchResultsPanel('s1');
    expect(lastAdd()).not.toHaveProperty('inactive');
  });

  it('reveal:false also applies to a tab joining the search group', () => {
    seed('s1', 'search');
    useLayoutStore.getState().openSearchResultsPanel('s2', { reveal: false });
    expect(lastAdd()).toMatchObject({ inactive: true, position: { referencePanel: 's1', direction: 'within' } });
  });
});

describe('rightSearchColumnWidth bounds', () => {
  it('is a third of the workbench inside the range', () => {
    expect(rightSearchColumnWidth(1200)).toBe(400);
    expect(rightSearchColumnWidth(1500)).toBe(500);
  });

  it('caps at 560 on a very wide workbench', () => {
    expect(rightSearchColumnWidth(3000)).toBe(560);
    expect(rightSearchColumnWidth(1680)).toBe(560);
  });

  it('is at least 280 on a narrow one', () => {
    expect(rightSearchColumnWidth(600)).toBe(280);
    expect(rightSearchColumnWidth(840)).toBe(280);
  });

  it('never exceeds half of a tiny workbench', () => {
    expect(rightSearchColumnWidth(400)).toBe(200);
    expect(rightSearchColumnWidth(100)).toBe(50);
  });

  it('is undefined for a zero, negative or non-finite width', () => {
    expect(rightSearchColumnWidth(0)).toBeUndefined();
    expect(rightSearchColumnWidth(-5)).toBeUndefined();
    expect(rightSearchColumnWidth(Number.NaN)).toBeUndefined();
    expect(rightSearchColumnWidth(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe('updateSearchPanelMeta', () => {
  it('merges the query and meaning flag into the existing params', () => {
    const p = seed('s1', 'search', { subtitle: 'keep' });
    useLayoutStore.getState().updateSearchPanelMeta('s1', 'love', true);
    expect(p.api.updateParameters).toHaveBeenCalledWith({
      contentType: 'search',
      subtitle: 'keep',
      searchQuery: 'love',
      searchSemantic: true,
    });
  });

  it('does nothing when the params already match (a missing flag counts as false)', () => {
    const p = seed('s1', 'search', { searchQuery: 'love' });
    useLayoutStore.getState().updateSearchPanelMeta('s1', 'love', false);
    expect(p.api.updateParameters).not.toHaveBeenCalled();
  });

  it('updates when only the query changed', () => {
    const p = seed('s1', 'search', { searchQuery: 'love', searchSemantic: false });
    useLayoutStore.getState().updateSearchPanelMeta('s1', 'hope', false);
    expect(p.api.updateParameters).toHaveBeenCalledTimes(1);
  });

  it('ignores an unknown panel or a missing dockview', () => {
    expect(() => useLayoutStore.getState().updateSearchPanelMeta('ghost', 'x', false)).not.toThrow();
    useLayoutStore.setState({ dockviewApi: null });
    expect(() => useLayoutStore.getState().updateSearchPanelMeta('s1', 'x', false)).not.toThrow();
  });
});

describe('openSearchResultsPanel: a host panel is not an anchor (rule 2)', () => {
  it('a search host panel is ignored when looking for a search tab to join', () => {
    seed('bible_a', 'bible');
    seedHost('host1');
    useLayoutStore.getState().openSearchResultsPanel('s9');
    expect(lastAdd().position).toEqual({ direction: 'below', referencePanel: 'bible_a' });
  });

  it('own search tabs are still the anchor when a host is also open', () => {
    seed('s1', 'search');
    seedHost('host1');
    useLayoutStore.getState().openSearchResultsPanel('s9');
    expect(lastAdd().position).toEqual({ referencePanel: 's1', direction: 'within' });
  });
});

const grp = (id: string, panelTypes: string[], right = 0): GroupSummary => ({ id, panelTypes, right });

describe('findRightPaneGroupId', () => {
  it('prefers the group that has the Study pane', () => {
    expect(findRightPaneGroupId([
      grp('g1', ['notes'], 900),
      grp('g2', ['study', 'notes'], 500),
    ])).toBe('g2');
  });

  it('ignores groups holding a Bible pane', () => {
    expect(findRightPaneGroupId([grp('g1', ['bible', 'study'], 900), grp('g2', ['notes'], 400)])).toBe('g2');
    expect(findRightPaneGroupId([grp('g1', ['bible']), grp('g2', ['bible', 'notes'])])).toBeNull();
  });

  it('ignores groups holding only search tabs', () => {
    expect(findRightPaneGroupId([grp('g1', ['search', 'search'], 900), grp('g2', ['notes'], 100)])).toBe('g2');
    expect(findRightPaneGroupId([grp('g1', ['search'])])).toBeNull();
  });

  it('a group with search plus another tool counts', () => {
    expect(findRightPaneGroupId([grp('g1', ['search', 'notes'])])).toBe('g1');
  });

  it('ignores collapsed groups, even the Study one', () => {
    expect(findRightPaneGroupId([grp('g1', ['study'], 900), grp('g2', ['notes'], 400)], ['g1'])).toBe('g2');
    expect(findRightPaneGroupId([grp('g1', ['study'])], ['g1'])).toBeNull();
  });

  it('ignores empty groups', () => {
    expect(findRightPaneGroupId([grp('g1', [], 900), grp('g2', ['notes'], 10)])).toBe('g2');
  });

  it('without a Study group takes the rightmost', () => {
    expect(findRightPaneGroupId([grp('g1', ['notes'], 300), grp('g2', ['prayer'], 900), grp('g3', ['dictionary'], 600)])).toBe('g2');
  });

  it('is null when there are no groups', () => {
    expect(findRightPaneGroupId([])).toBeNull();
  });
});

describe('openSearchHostPanel', () => {
  let groups: Array<{ id: string; panels: Array<{ id: string }>; element?: { getBoundingClientRect: () => { right: number } } }>;

  beforeEach(() => {
    groups = [];
    (api as unknown as Record<string, unknown>).groups = groups;
    api.getGroup = ((id: string) => groups.find((g) => g.id === id)) as never;
  });

  function group(id: string, ...members: Array<[string, PanelContentType]>): void {
    for (const [pid, type] of members) if (!panels.has(pid)) seed(pid, type);
    groups.push({ id, panels: members.map(([pid]) => ({ id: pid })), element: { getBoundingClientRect: () => ({ right: 0 }) } });
  }

  it('adds a host panel within the right-hand group, with contentKey host and the generic title', () => {
    group('gb', ['bible_a', 'bible']);
    group('gs', ['study_a', 'study'], ['notes_a', 'notes']);

    const id = useLayoutStore.getState().openSearchHostPanel();

    expect(id).toBeTruthy();
    expect(lastAdd()).toMatchObject({
      id,
      title: 'Search',
      position: { referenceGroup: 'gs', direction: 'within' },
      params: { contentType: 'search', contentKey: SEARCH_HOST_CONTENT_KEY },
    });
    expect(lastAdd()).not.toHaveProperty('inactive');
    expect(useLayoutStore.getState().getPanel(id!)).toMatchObject({ contentType: 'search', contentKey: 'host' });
  });

  it('reuses an existing host panel instead of adding another, and focuses it', () => {
    group('gs', ['study_a', 'study']);
    const host = seedHost('host1');

    expect(useLayoutStore.getState().openSearchHostPanel()).toBe('host1');
    expect(host.api.setActive).toHaveBeenCalledTimes(1);
    expect(addPanelSpy).not.toHaveBeenCalled();
  });

  it('reusing with reveal:false does not focus', () => {
    const host = seedHost('host1');
    expect(useLayoutStore.getState().openSearchHostPanel({ reveal: false })).toBe('host1');
    expect(host.api.setActive).not.toHaveBeenCalled();
  });

  it('returns null without adding anything when there is no right-hand group', () => {
    group('gb', ['bible_a', 'bible']);
    expect(useLayoutStore.getState().openSearchHostPanel()).toBeNull();
    expect(addPanelSpy).not.toHaveBeenCalled();
  });

  it('a collapsed right-hand group does not count', () => {
    group('gb', ['bible_a', 'bible']);
    group('gs', ['study_a', 'study']);
    useLayoutStore.setState({ collapsedGroups: [{ groupId: 'gs' } as never] });
    expect(useLayoutStore.getState().openSearchHostPanel()).toBeNull();
    useLayoutStore.setState({ collapsedGroups: [] });
  });

  it('reveal:false adds the host inactive', () => {
    group('gs', ['study_a', 'study']);
    useLayoutStore.getState().openSearchHostPanel({ reveal: false });
    expect(lastAdd().inactive).toBe(true);
  });

  it('returns null when dockview is not ready', () => {
    useLayoutStore.setState({ dockviewApi: null });
    expect(useLayoutStore.getState().openSearchHostPanel()).toBeNull();
  });
});
