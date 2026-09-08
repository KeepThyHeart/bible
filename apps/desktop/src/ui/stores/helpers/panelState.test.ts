/**
 * Tests for the per-panel state machinery shared by every content store.
 *
 * `createPanelSlice` and `panelStateHelpers` are the engine behind all seven
 * `stores/hooks/use*Panel.ts` hooks (bible, commentary, book, dictionary,
 * notes, study, topics) - roughly a thousand lines of consumer code with no
 * tests of their own. Testing the ~150 lines underneath covers what all seven
 * rely on, at the level where a failure is a two-line diff rather than a
 * screenshot.
 *
 * The behaviours that matter here are the immutability rules (Zustand only
 * re-renders on a new Map identity, so an in-place mutation makes a pane stop
 * updating while every value is technically correct) and panel isolation (two
 * Bible panes must not share state - that is the whole reason panels are keyed).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_PANEL_ID,
  getPanelState,
  updatePanelState,
  removePanelState,
  panelIdFromLayout,
} from './panelStateHelpers';
import { createPanelSlice } from './createPanelSlice';

interface TestPanelState {
  activeTabIndex: number;
  openTabs: string[];
  pinned: boolean;
}

const createDefault = (): TestPanelState => ({ activeTabIndex: 0, openTabs: [], pinned: false });

describe('getPanelState', () => {
  it('returns the stored state for a known panel', () => {
    const stored = { ...createDefault(), pinned: true };
    const panels = new Map([['panel-1', stored]]);

    expect(getPanelState(panels, 'panel-1', createDefault)).toBe(stored);
  });

  it('falls back to a fresh default for an unknown panel', () => {
    const result = getPanelState(new Map<string, TestPanelState>(), 'missing', createDefault);

    expect(result).toEqual(createDefault());
  });

  it('does not store the fallback, so a read cannot create a panel', () => {
    const panels = new Map<string, TestPanelState>();

    getPanelState(panels, 'missing', createDefault);

    expect(panels.size).toBe(0);
  });

  it('hands out a distinct default each time', () => {
    // A shared default object would let one pane's mutation leak into the next
    // pane that happens to miss.
    const panels = new Map<string, TestPanelState>();
    const first = getPanelState(panels, 'a', createDefault);
    const second = getPanelState(panels, 'b', createDefault);

    expect(first).not.toBe(second);
  });
});

describe('updatePanelState', () => {
  it('returns a new Map rather than mutating the old one', () => {
    // Zustand compares by identity: mutating in place leaves subscribers on the
    // stale value and the pane silently stops updating.
    const panels = new Map([['panel-1', createDefault()]]);

    const next = updatePanelState(panels, 'panel-1', { pinned: true }, createDefault);

    expect(next).not.toBe(panels);
    expect(panels.get('panel-1')!.pinned).toBe(false);
    expect(next.get('panel-1')!.pinned).toBe(true);
  });

  it('merges the patch over the existing state', () => {
    const panels = new Map([['panel-1', { activeTabIndex: 2, openTabs: ['a'], pinned: false }]]);

    const next = updatePanelState(panels, 'panel-1', { pinned: true }, createDefault);

    expect(next.get('panel-1')).toEqual({ activeTabIndex: 2, openTabs: ['a'], pinned: true });
  });

  it('accepts an updater function that sees the previous state', () => {
    const panels = new Map([['panel-1', { ...createDefault(), activeTabIndex: 1 }]]);

    const next = updatePanelState(
      panels,
      'panel-1',
      prev => ({ activeTabIndex: prev.activeTabIndex + 1 }),
      createDefault,
    );

    expect(next.get('panel-1')!.activeTabIndex).toBe(2);
  });

  it('creates the panel from the default when it does not exist yet', () => {
    const next = updatePanelState(new Map<string, TestPanelState>(), 'new-panel', { pinned: true }, createDefault);

    expect(next.get('new-panel')).toEqual({ ...createDefault(), pinned: true });
  });

  it('gives the updater the default when the panel does not exist yet', () => {
    const updater = vi.fn(() => ({ pinned: true }));

    updatePanelState(new Map<string, TestPanelState>(), 'new-panel', updater, createDefault);

    expect(updater).toHaveBeenCalledWith(createDefault());
  });

  it('leaves other panels untouched', () => {
    // Two Bible panes are two panels; updating one must not disturb the other.
    const other = { ...createDefault(), activeTabIndex: 5 };
    const panels = new Map([['panel-1', createDefault()], ['panel-2', other]]);

    const next = updatePanelState(panels, 'panel-1', { pinned: true }, createDefault);

    expect(next.get('panel-2')).toBe(other);
  });
});

describe('removePanelState', () => {
  it('returns a new Map without the panel', () => {
    const panels = new Map([['panel-1', createDefault()], ['panel-2', createDefault()]]);

    const next = removePanelState(panels, 'panel-1');

    expect(next).not.toBe(panels);
    expect(next.has('panel-1')).toBe(false);
    expect(next.has('panel-2')).toBe(true);
    expect(panels.has('panel-1')).toBe(true);
  });

  it('is a no-op for an unknown panel', () => {
    const panels = new Map([['panel-1', createDefault()]]);

    expect(removePanelState(panels, 'nope').size).toBe(1);
  });
});

describe('createPanelSlice', () => {
  /** Minimal stand-in for the Zustand (set, get) pair. */
  function store(onDestroy?: (panelId: string) => void) {
    let panels = new Map<string, TestPanelState>();
    const slice = createPanelSlice(createDefault, onDestroy)(
      partial => { panels = partial.panels; },
      () => ({ panels }),
    );
    return { slice, panels: () => panels };
  }

  it('creates panel state on init', () => {
    const { slice, panels } = store();

    slice.initPanel('panel-1');

    expect(panels().get('panel-1')).toEqual(createDefault());
  });

  it('does not reset an already-initialized panel', () => {
    // Panes re-mount - a dockview drag, a tab switch. Re-initializing on mount
    // would throw away the reader's open tabs every time.
    const { slice, panels } = store();
    slice.initPanel('panel-1');
    slice.getPanelState('panel-1');
    const before = panels().get('panel-1');

    slice.initPanel('panel-1');

    expect(panels().get('panel-1')).toBe(before);
  });

  it('keeps panels independent', () => {
    const { slice, panels } = store();

    slice.initPanel('panel-1');
    slice.initPanel('panel-2');

    expect(panels().size).toBe(2);
    expect(panels().get('panel-1')).not.toBe(panels().get('panel-2'));
  });

  it('removes state on destroy', () => {
    const { slice, panels } = store();
    slice.initPanel('panel-1');

    slice.destroyPanel('panel-1');

    expect(panels().has('panel-1')).toBe(false);
  });

  it('runs onDestroy before the state goes away', () => {
    // The callback is where stores cancel in-flight loads for that panel, so it
    // has to see the state it is cleaning up.
    const seen: Array<TestPanelState | undefined> = [];
    const { slice, panels } = store(id => { seen.push(panels().get(id)); });
    slice.initPanel('panel-1');

    slice.destroyPanel('panel-1');

    expect(seen).toEqual([createDefault()]);
  });

  it('reads back a default for a panel that was never initialized', () => {
    const { slice } = store();

    expect(slice.getPanelState('never-initialized')).toEqual(createDefault());
  });

  it('supports the callbacks-object form with onInit', () => {
    let panels = new Map<string, TestPanelState>();
    const onInit = vi.fn();
    const slice = createPanelSlice(createDefault, { onInit })(
      partial => { panels = partial.panels; },
      () => ({ panels }),
    );

    slice.initPanel('panel-1');
    slice.initPanel('panel-1');

    // Once, not twice: the second init is a no-op.
    expect(onInit).toHaveBeenCalledTimes(1);
    expect(onInit).toHaveBeenCalledWith('panel-1');
  });
});

describe('panelIdFromLayout', () => {
  const layout = (panels: Record<string, unknown>) => ({ panels });

  it('finds the panel id for a matching content type', () => {
    const state = layout({
      'panel-a': { params: { contentType: 'bible' } },
      'panel-b': { params: { contentType: 'dictionary' } },
    });

    expect(panelIdFromLayout(state, ['dictionary'])).toBe('panel-b');
  });

  it('accepts several acceptable content types', () => {
    const state = layout({ 'panel-a': { params: { contentType: 'book' } } });

    expect(panelIdFromLayout(state, ['dictionary', 'book'])).toBe('panel-a');
  });

  it('returns undefined when no panel matches', () => {
    const state = layout({ 'panel-a': { params: { contentType: 'bible' } } });

    expect(panelIdFromLayout(state, ['topics'])).toBeUndefined();
  });

  it('tolerates malformed layouts rather than throwing', () => {
    // The layout comes off disk, so it can be anything after a bad write or an
    // older app version. Throwing here would take the whole restore with it.
    expect(panelIdFromLayout(undefined, ['bible'])).toBeUndefined();
    expect(panelIdFromLayout(null, ['bible'])).toBeUndefined();
    expect(panelIdFromLayout('not an object', ['bible'])).toBeUndefined();
    expect(panelIdFromLayout({}, ['bible'])).toBeUndefined();
    expect(panelIdFromLayout({ panels: null }, ['bible'])).toBeUndefined();
    expect(panelIdFromLayout(layout({ a: null }), ['bible'])).toBeUndefined();
    expect(panelIdFromLayout(layout({ a: {} }), ['bible'])).toBeUndefined();
    expect(panelIdFromLayout(layout({ a: { params: {} } }), ['bible'])).toBeUndefined();
    expect(panelIdFromLayout(layout({ a: { params: { contentType: 42 } } }), ['bible'])).toBeUndefined();
  });

  it('skips unusable entries and keeps looking', () => {
    const state = layout({
      broken: null,
      'no-params': {},
      good: { params: { contentType: 'topics' } },
    });

    expect(panelIdFromLayout(state, ['topics'])).toBe('good');
  });
});

describe('DEFAULT_PANEL_ID', () => {
  it('is the underscore-prefixed sentinel detached windows fall back to', () => {
    // Detached windows render straight from COMPONENT_MAP and have no dockview
    // panel to take an id from. The underscore keeps it out of the namespace
    // dockview generates ids in.
    expect(DEFAULT_PANEL_ID).toBe('_default');
  });
});
