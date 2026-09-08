/**
 * Tests for the panel lifecycle half of the layout store.
 *
 * `useLayoutStore` is 443 lines and its only test covered `canCollapseGroup`.
 * Everything that decides whether a pane exists and is visible -
 * `addPanel`, `removePanel`, the panel registry, the active-panel bookkeeping,
 * and `resolveStalePosition` - was untested. That is the desktop's version of
 * "click X and the right thing becomes visible", the same seam the web
 * context-menu routing bug lived in.
 *
 * dockview is faked rather than mounted: the store only ever talks to it through
 * `DockviewApi`, and a real dockview needs layout, which jsdom does not do.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DockviewApi } from 'dockview-react';
import { useLayoutStore, resolveStalePosition } from './useLayoutStore';

interface FakeApi {
  addPanel: ReturnType<typeof vi.fn>;
  getPanel: ReturnType<typeof vi.fn>;
  getGroup: ReturnType<typeof vi.fn>;
  toJSON: ReturnType<typeof vi.fn>;
  /** Panel ids dockview believes exist, and their close/setActive spies. */
  live: Map<string, { close: ReturnType<typeof vi.fn>; setActive: ReturnType<typeof vi.fn> }>;
  groups: Set<string>;
}

function fakeApi(): FakeApi {
  const live = new Map<string, { close: ReturnType<typeof vi.fn>; setActive: ReturnType<typeof vi.fn> }>();
  const groups = new Set<string>();

  const api: FakeApi = {
    live,
    groups,
    addPanel: vi.fn((options: { id: string }) => {
      live.set(options.id, { close: vi.fn(), setActive: vi.fn() });
    }),
    getPanel: vi.fn((id: string) => {
      const handle = live.get(id);
      return handle ? { api: handle } : undefined;
    }),
    getGroup: vi.fn((id: string) => (groups.has(id) ? { id } : undefined)),
    toJSON: vi.fn(() => ({ panels: {} })),
  };
  return api;
}

function install(api?: FakeApi): FakeApi {
  const fake = api ?? fakeApi();
  useLayoutStore.getState().setDockviewApi(fake as unknown as DockviewApi);
  return fake;
}

const store = () => useLayoutStore.getState();

beforeEach(() => {
  useLayoutStore.setState({
    dockviewApi: null,
    panels: new Map(),
    isReady: false,
    activePanelId: null,
    lastActiveBiblePanelId: null,
    dynamicSubtitles: new Map(),
    collapsedGroups: [],
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('setDockviewApi', () => {
  it('marks the store ready', () => {
    expect(store().isReady).toBe(false);

    install();

    expect(store().isReady).toBe(true);
  });
});

describe('addPanel', () => {
  it('creates the panel and registers it', () => {
    const api = install();

    const panelId = store().addPanel('commentary', 'MHC', 'Matthew Henry');

    expect(panelId).not.toBeNull();
    expect(api.addPanel).toHaveBeenCalledTimes(1);
    expect(store().getPanel(panelId!)).toMatchObject({
      panelId,
      contentType: 'commentary',
      contentKey: 'MHC',
      displayName: 'Matthew Henry',
    });
  });

  it('refuses to add a panel before dockview exists', () => {
    // Called too early this returns null rather than throwing, so the caller
    // can decide; registering anyway would leave a panel nothing renders.
    expect(store().addPanel('commentary')).toBeNull();
    expect(store().panels.size).toBe(0);
  });

  it('generates a unique id per panel', () => {
    install();

    const first = store().addPanel('bible', 'KJV');
    const second = store().addPanel('bible', 'KJV');

    expect(first).not.toBe(second);
    expect(store().panels.size).toBe(2);
  });

  it('honours an explicit id, which session restore depends on', () => {
    // Restore has to recreate a panel under the id the saved session already
    // refers to; a fresh id lands the restored state in a panel nothing renders.
    install();

    const panelId = store().addPanel('bible', 'KJV', 'KJV', undefined, undefined, 'bible_restored');

    expect(panelId).toBe('bible_restored');
    expect(store().getPanel('bible_restored')).toBeDefined();
  });

  it('falls back to the content key, then the type, for the title', () => {
    const api = install();

    store().addPanel('dictionary', 'Easton');
    store().addPanel('prayer');

    expect(api.addPanel.mock.calls[0][0].title).toBe('Easton');
    expect(api.addPanel.mock.calls[1][0].title).toBe('prayer');
  });

  it('passes the content type and subtitle through as panel params', () => {
    const api = install();

    store().addPanel('topics', undefined, 'Topics', undefined, 'Nave\'s');

    expect(api.addPanel.mock.calls[0][0].params).toMatchObject({
      contentType: 'topics',
      subtitle: "Nave's",
    });
  });

  it('activates the existing prayer pane instead of opening a second', () => {
    // Prayer is a singleton. Two prayer panes would edit the same file.
    const api = install();
    const first = store().addPanel('prayer');

    const second = store().addPanel('prayer');

    expect(second).toBe(first);
    expect(api.addPanel).toHaveBeenCalledTimes(1);
    expect(api.live.get(first!)!.setActive).toHaveBeenCalled();
  });

  it('allows several notes panes', () => {
    // Unlike prayer: notes are per-document, and the one-editor-per-document
    // rule is enforced in the component instead.
    install();

    const first = store().addPanel('notes', 'a.bn');
    const second = store().addPanel('notes', 'b.bn');

    expect(second).not.toBe(first);
    expect(store().getPanelsByType('notes')).toHaveLength(2);
  });

  it('unregisters the panel again when dockview throws', () => {
    // Leaving the registration behind would report a pane that does not exist,
    // and the layout would then try to serialize it.
    const api = install();
    api.addPanel.mockImplementationOnce(() => { throw new Error('bad position'); });

    const panelId = store().addPanel('commentary', 'MHC');

    expect(panelId).toBeNull();
    expect(store().panels.size).toBe(0);
  });
});

describe('removePanel', () => {
  it('closes the dockview panel and unregisters it', () => {
    const api = install();
    const panelId = store().addPanel('commentary', 'MHC')!;

    store().removePanel(panelId);

    expect(api.live.get(panelId)!.close).toHaveBeenCalled();
    expect(store().getPanel(panelId)).toBeUndefined();
  });

  it('still unregisters when dockview no longer knows the panel', () => {
    // The two can disagree - a group closed underneath us. The registry must
    // not keep a ghost.
    const api = install();
    const panelId = store().addPanel('commentary', 'MHC')!;
    api.live.delete(panelId);

    store().removePanel(panelId);

    expect(store().getPanel(panelId)).toBeUndefined();
  });

  it('does nothing without a dockview api', () => {
    expect(() => store().removePanel('whatever')).not.toThrow();
  });
});

describe('active panel bookkeeping', () => {
  it('remembers the last active Bible panel separately', () => {
    // Commands like "open this passage in the Bible pane" need a Bible target
    // even while the reader is focused on a commentary.
    install();
    const bible = store().addPanel('bible', 'KJV')!;
    const commentary = store().addPanel('commentary', 'MHC')!;

    store().setActivePanelId(bible);
    store().setActivePanelId(commentary);

    expect(store().activePanelId).toBe(commentary);
    expect(store().lastActiveBiblePanelId).toBe(bible);
  });

  it('does not treat a non-Bible panel as the last Bible panel', () => {
    install();
    const commentary = store().addPanel('commentary', 'MHC')!;

    store().setActivePanelId(commentary);

    expect(store().lastActiveBiblePanelId).toBeNull();
  });

  it('clears both ids when the panel they point at is removed', () => {
    // A stale active id is how a command ends up dispatching into a pane that
    // is no longer on screen.
    install();
    const bible = store().addPanel('bible', 'KJV')!;
    store().setActivePanelId(bible);

    store().removePanel(bible);

    expect(store().activePanelId).toBeNull();
    expect(store().lastActiveBiblePanelId).toBeNull();
  });

  it('leaves the ids alone when a different panel is removed', () => {
    install();
    const bible = store().addPanel('bible', 'KJV')!;
    const commentary = store().addPanel('commentary', 'MHC')!;
    store().setActivePanelId(bible);

    store().removePanel(commentary);

    expect(store().activePanelId).toBe(bible);
    expect(store().lastActiveBiblePanelId).toBe(bible);
  });
});

describe('getPanelsByType', () => {
  it('returns only panels of the requested type', () => {
    install();
    store().addPanel('bible', 'KJV');
    store().addPanel('bible', 'ASV');
    store().addPanel('commentary', 'MHC');

    expect(store().getPanelsByType('bible')).toHaveLength(2);
    expect(store().getPanelsByType('commentary')).toHaveLength(1);
    expect(store().getPanelsByType('topics')).toEqual([]);
  });
});

describe('resolveStalePosition', () => {
  /**
   * The bug this guards: dockview does not validate a group or panel passed as
   * an object. Handed a disposed group it opens the panel into nothing - no
   * error, no panel, the pane simply never appears.
   */
  function api(groups: string[] = [], panels: string[] = []): DockviewApi {
    return {
      getGroup: (id: string) => (groups.includes(id) ? { id } : undefined),
      getPanel: (id: string) => (panels.includes(id) ? { id } : undefined),
    } as unknown as DockviewApi;
  }

  it('keeps a position whose reference group still exists', () => {
    const position = { referenceGroup: { id: 'group-1' }, direction: 'right' };

    expect(resolveStalePosition(api(['group-1']), position)).toBe(position);
  });

  it('keeps a position whose reference panel still exists', () => {
    const position = { referencePanel: 'panel-1' };

    expect(resolveStalePosition(api([], ['panel-1']), position)).toBe(position);
  });

  it('drops a position pointing at a disposed group', () => {
    expect(resolveStalePosition(api([]), { referenceGroup: { id: 'gone' } })).toBeUndefined();
  });

  it('drops a position pointing at a disposed panel', () => {
    expect(resolveStalePosition(api([], []), { referencePanel: 'gone' })).toBeUndefined();
  });

  it('drops a reference with no id at all', () => {
    expect(resolveStalePosition(api(['group-1']), { referenceGroup: {} })).toBeUndefined();
  });

  it('accepts a reference given as a bare id string', () => {
    const position = { referenceGroup: 'group-1' };

    expect(resolveStalePosition(api(['group-1']), position)).toBe(position);
  });

  it('leaves a position with no references alone', () => {
    const position = { direction: 'below' };

    expect(resolveStalePosition(api(), position)).toBe(position);
  });

  it('treats an explicit null reference as no reference', () => {
    const position = { referenceGroup: null, referencePanel: null };

    expect(resolveStalePosition(api(), position)).toBe(position);
  });

  it('rejects when either reference is stale, not just the first', () => {
    const stale = { referenceGroup: { id: 'group-1' }, referencePanel: 'gone' };

    expect(resolveStalePosition(api(['group-1'], []), stale)).toBeUndefined();
  });
});

describe('addPanel positioning', () => {
  it('drops a stale position rather than losing the panel', () => {
    const api = install();

    const panelId = store().addPanel('commentary', 'MHC', 'MHC', { referenceGroup: { id: 'disposed' } });

    expect(panelId).not.toBeNull();
    // No position at all: the panel lands in the active group, which is visible
    // and recoverable - unlike being created into a group that no longer exists.
    expect(api.addPanel.mock.calls[0][0].position).toBeUndefined();
  });

  it('passes a valid position through', () => {
    const api = install();
    api.groups.add('group-1');

    store().addPanel('commentary', 'MHC', 'MHC', { referenceGroup: { id: 'group-1' }, direction: 'right' });

    expect(api.addPanel.mock.calls[0][0].position).toEqual({
      referenceGroup: { id: 'group-1' },
      direction: 'right',
    });
  });
});
