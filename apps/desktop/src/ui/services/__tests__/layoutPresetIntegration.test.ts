/**
 * End-to-end coverage for the docking-layout preset system, driving a REAL
 * dockview instance in jsdom.
 *
 * A faked API cannot catch these bugs - every one of them was a mismatch
 * between what this app told dockview and what dockview actually does with it
 * (which panel field it deserializes, what it does with a removed group passed
 * as a position, how small it lets a group get). So the tests below use
 * `DockviewComponent` itself and assert on the resulting layout.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DockviewComponent } from 'dockview-react';
import { useLayoutStore, resolveStalePosition } from '../../stores/useLayoutStore';
import { LayoutPresetService } from '../LayoutPresetService';
import { zeroSizedGroupIds } from '../PresetApplier';
import { STUDY_MODE, READING_MODE, STUDY_MODE_QUAD, WRITER_MODE } from '../../presets';

class ResizeObserverStub {
  observe(): void { /* jsdom has no layout engine */ }
  unobserve(): void { /* noop */ }
  disconnect(): void { /* noop */ }
}

/**
 * Component names dockview asked us to build, in order. The React binding looks
 * the name up in its component map, so a name that is not `panelContent`
 * renders as `undefined` - a blank pane.
 */
let requested: { panelId: string; component: string }[] = [];

function createDockview(): DockviewComponent {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const dv = new DockviewComponent(el, {
    createComponent: (options) => {
      requested.push({ panelId: options.id, component: options.name });
      return {
        element: document.createElement('div'),
        init: () => undefined,
        dispose: () => undefined,
      };
    },
  });
  dv.layout(1000, 1000);
  return dv;
}

/** Bible on the left; Study + Commentary tabbed together on the right. */
function seedDefaultLayout(dv: DockviewComponent): void {
  const bible = dv.api.addPanel({
    id: 'bible_default', component: 'panelContent', title: 'Bible',
    params: { contentType: 'bible' },
  });
  const study = dv.api.addPanel({
    id: 'study_default', component: 'panelContent', title: 'Study',
    params: { contentType: 'study' },
    position: { direction: 'right', referencePanel: bible },
  });
  dv.api.addPanel({
    id: 'commentary_default', component: 'panelContent', title: 'Commentary',
    params: { contentType: 'commentary' },
    position: { referenceGroup: study.group, direction: 'within' },
  });
  for (const panel of dv.api.panels) {
    const params = panel.params as { contentType: string };
    useLayoutStore.getState().registerPanel({
      panelId: panel.id,
      contentType: params.contentType as 'bible',
      displayName: panel.title ?? panel.id,
    });
  }
}

function shape(dv: DockviewComponent): { panels: string[]; width: number }[] {
  return dv.api.groups.map(g => ({ panels: g.panels.map(p => p.id), width: g.width }));
}

let dockview: DockviewComponent;
let service: LayoutPresetService;

let layoutChangeDisposable: { dispose: () => void } | undefined;

beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  requested = [];
  dockview = createDockview();
  useLayoutStore.setState({ panels: new Map(), collapsedGroups: [] });
  useLayoutStore.getState().setDockviewApi(dockview.api);
  service = new LayoutPresetService();
  // Mirrors DockviewLayout.tsx's own onDidLayoutChange subscription (this
  // test drives the dockview instance directly, without mounting that
  // component), so the currentPresetId-invalidation tests below exercise the
  // real wiring rather than calling notifyManualLayoutChange() by hand.
  layoutChangeDisposable = dockview.api.onDidLayoutChange(() => {
    service.notifyManualLayoutChange();
  });
});

afterEach(() => {
  layoutChangeDisposable?.dispose();
  useLayoutStore.setState({ dockviewApi: null, isReady: false, collapsedGroups: [], panels: new Map() });
  dockview.dispose();
});

describe('applying a preset rearranges rather than recreates', () => {
  it('does not re-create a single panel component', async () => {
    seedDefaultLayout(dockview);
    const bibleBefore = dockview.api.getPanel('bible_default');
    const seeded = dockview.api.panels.map(p => p.id);
    requested = [];

    await service.apply(STUDY_MODE.id);

    // Rebuilding every panel from scratch here would unmount the pane's React
    // tree, and every content store's `destroyPanel` cleanup would wipe that
    // pane's state along with it.
    //
    // Study Mode's `autoOpen` does create the study panes the seed is missing,
    // so `requested` is not empty - but nothing already open may appear in it.
    expect(requested.filter(r => seeded.includes(r.panelId))).toEqual([]);
    expect(dockview.api.getPanel('bible_default')).toBe(bibleBefore);
  });

  it('never asks for a component the app has no renderer for', async () => {
    seedDefaultLayout(dockview);
    await service.apply(STUDY_MODE.id);
    await service.apply(STUDY_MODE_QUAD.id);
    await service.apply(WRITER_MODE.id);

    expect(requested.every(r => r.component === 'panelContent')).toBe(true);
    const serialized = dockview.api.toJSON().panels as unknown as Record<string, { contentComponent?: string }>;
    for (const state of Object.values(serialized)) {
      expect(state.contentComponent).toBe('panelContent');
    }
  });

  it('keeps every pane through a chain of preset switches', async () => {
    seedDefaultLayout(dockview);
    await service.apply(STUDY_MODE.id);
    await service.apply(READING_MODE.id);
    await service.apply(STUDY_MODE_QUAD.id);
    await service.apply(WRITER_MODE.id);

    // (Quad's `autoOpen` adds a Dictionary and a Notes pane along the way, so
    // this asserts nothing was *lost* rather than an exact panel list.)
    for (const id of ['bible_default', 'commentary_default', 'study_default']) {
      expect(dockview.api.getPanel(id)).toBeDefined();
    }
  });

  it('never materialises an empty group', async () => {
    seedDefaultLayout(dockview);
    // A preset group with nothing to hold must be omitted, not created: an
    // empty group's only affordance was a "+", and the New Tab placeholder it
    // made was then the group's only panel, so replacing it destroyed the pane.
    // Quad fills its bottom row via `autoOpen` instead of materialising it.
    await service.apply(STUDY_MODE_QUAD.id);
    expect(dockview.api.groups.every(g => g.panels.length > 0)).toBe(true);
  });
});

describe('Study Mode delivers its whole study column', () => {
  function rightColumnTypes(): string[] {
    const bibleGroup = dockview.api.getPanel('bible_default')!.group;
    const studyGroup = dockview.api.groups.find(g => g !== bibleGroup)!;
    return studyGroup.panels.map(p => (p.params as { contentType: string }).contentType);
  }

  it('opens the study panes the session is missing and orders the column', async () => {
    // The seed has only Study and Commentary on the right. Picking a layout
    // named "Study Mode" is a request for the column it is named after, in the
    // order it specifies - not for whichever two of the five happen to be open.
    seedDefaultLayout(dockview);
    await service.apply(STUDY_MODE.id);

    expect(rightColumnTypes())
      .toEqual(['study', 'commentary', 'topics', 'dictionary', 'notes']);
  });

  it('does not duplicate a study pane the session already has', async () => {
    seedDefaultLayout(dockview);
    await service.apply(STUDY_MODE.id);
    const first = dockview.api.panels.length;

    await service.apply(READING_MODE.id);
    await service.apply(STUDY_MODE.id);

    expect(dockview.api.panels).toHaveLength(first);
  });
});

describe('Study Mode (Quad) produces four panes, not two', () => {
  function contentTypes(): string[] {
    return dockview.api.panels.map(p => (p.params as { contentType: string }).contentType);
  }

  it('opens the panes its bottom row needs', async () => {
    // The bug: the default session has only Bible and Study/Commentary open, so
    // both bottom cells were pruned as empty, row 2 vanished, and Quad reduced
    // to a two-pane layout. Choosing a preset called "Quad" by name is a
    // request for the four-cell shape.
    seedDefaultLayout(dockview);
    await service.apply(STUDY_MODE_QUAD.id);

    expect(contentTypes()).toContain('dictionary');
    expect(contentTypes()).toContain('notes');
    expect(dockview.api.groups).toHaveLength(4);
    expect(dockview.api.groups.every(g => g.panels.length > 0)).toBe(true);

    // Auto-open goes through addPanel, which fires the same onDidLayoutChange
    // that clears the preset checkmark. dockview buffers that event by a
    // microtask, so it lands inside apply()'s `_applyingPreset` guard - but
    // that is subtle enough to be worth pinning down.
    await Promise.resolve();
    expect(service.currentPresetId).toBe(STUDY_MODE_QUAD.id);
  });

  it('leaves Bible in the first cell', async () => {
    // Listing the study/commentary cell first would swap the Bible pane to
    // the other side of the window when switching to Quad - the "quad just
    // flips left and right" report.
    seedDefaultLayout(dockview);
    await service.apply(STUDY_MODE_QUAD.id);

    expect(dockview.api.groups[0].panels.map(p => p.id)).toEqual(['bible_default']);
  });

  it('reuses panes that are already open instead of opening seconds', async () => {
    seedDefaultLayout(dockview);
    dockview.api.addPanel({
      id: 'dictionary_existing', component: 'panelContent', title: 'Dictionary',
      params: { contentType: 'dictionary' }, position: { direction: 'below' },
    });

    await service.apply(STUDY_MODE_QUAD.id);
    await service.apply(STUDY_MODE.id);
    await service.apply(STUDY_MODE_QUAD.id);

    expect(contentTypes().filter(t => t === 'dictionary')).toHaveLength(1);
    expect(contentTypes().filter(t => t === 'notes')).toHaveLength(1);
    expect(dockview.api.getPanel('dictionary_existing')).toBeDefined();
  });

  it('opens nothing on an empty workbench', async () => {
    // A preset arranges what is there. With nothing open, the watermark should
    // stay - auto-open exists to complete a shape, not to populate the app.
    await service.apply(STUDY_MODE_QUAD.id);
    expect(dockview.api.panels).toHaveLength(0);
  });

  it('degrades to what it has, without moving Bible, when a pane cannot be opened', async () => {
    // e.g. no dictionary module installed and the pane refuses to open. The
    // empty-group pruning still applies, so Quad collapses to a single row -
    // but Bible must not change sides on the way.
    seedDefaultLayout(dockview);
    const realAddPanel = useLayoutStore.getState().addPanel;
    useLayoutStore.setState({ addPanel: () => null });
    try {
      await service.apply(STUDY_MODE_QUAD.id);
    } finally {
      useLayoutStore.setState({ addPanel: realAddPanel });
    }

    expect(dockview.api.groups).toHaveLength(2);
    expect(dockview.api.groups[0].panels.map(p => p.id)).toEqual(['bible_default']);
  });
});

describe('Writer Mode gives you somewhere to write', () => {
  function contentTypes(): string[] {
    return dockview.api.panels.map(p => (p.params as { contentType: string }).contentType);
  }

  it('opens a notes pane when the session has none', async () => {
    // The bug: this preset had no `autoOpen`, so on the default session
    // (Bible + Study/Commentary) there was no notes pane to place. Its second
    // group filled with the study panes instead and the preset produced no
    // writing surface at all - clicking it appeared to do nothing.
    seedDefaultLayout(dockview);
    await service.apply(WRITER_MODE.id);

    expect(contentTypes()).toContain('notes');
  });

  it('brings the notes pane to the front of its group', async () => {
    // Opening is not showing. Notes is bucketed into the same group as Study
    // and Commentary, so without `activate` it sat behind whichever tab was
    // already selected and the user still saw no editor.
    seedDefaultLayout(dockview);
    await service.apply(WRITER_MODE.id);

    const notes = dockview.api.panels.find(
      p => (p.params as { contentType: string }).contentType === 'notes',
    );
    expect(notes).toBeDefined();
    expect(notes!.group.activePanel?.id).toBe(notes!.id);
  });

  it('reuses a notes pane that is already open', async () => {
    seedDefaultLayout(dockview);
    dockview.api.addPanel({
      id: 'notes_existing', component: 'panelContent', title: 'Notes',
      params: { contentType: 'notes' }, position: { direction: 'below' },
    });

    await service.apply(WRITER_MODE.id);

    expect(contentTypes().filter(t => t === 'notes')).toHaveLength(1);
    expect(dockview.api.getPanel('notes_existing')).toBeDefined();
  });

  it('opens nothing on an empty workbench', async () => {
    // Same rule as Quad: auto-open completes a shape, it does not populate an
    // empty app.
    await service.apply(WRITER_MODE.id);
    expect(dockview.api.panels).toHaveLength(0);
  });

  it('degrades quietly when the notes pane cannot be opened', async () => {
    seedDefaultLayout(dockview);
    const realAddPanel = useLayoutStore.getState().addPanel;
    useLayoutStore.setState({ addPanel: () => null });
    try {
      await service.apply(WRITER_MODE.id);
    } finally {
      useLayoutStore.setState({ addPanel: realAddPanel });
    }

    expect(contentTypes()).not.toContain('notes');
    expect(dockview.api.groups[0].panels.map(p => p.id)).toEqual(['bible_default']);
  });
});

describe('collapsing a group by hand (KAN QA: no preset required)', () => {
  function groupIdOf(panelId: string): string {
    return dockview.api.getPanel(panelId)!.group.id;
  }

  it('takes the group to zero width and records it for the restore controls', () => {
    seedDefaultLayout(dockview);
    const studyGroup = groupIdOf('study_default');

    expect(useLayoutStore.getState().collapseGroup(studyGroup)).toBe(true);

    expect(useLayoutStore.getState().collapsedGroups)
      .toMatchObject([{ groupId: studyGroup, axis: 'width' }]);
    expect(dockview.api.getGroup(studyGroup)!.width).toBe(0);
    // Collapsing hides, it does not close: every tab is still there.
    expect(dockview.api.getGroup(studyGroup)!.panels.map(p => p.id))
      .toEqual(['study_default', 'commentary_default']);
  });

  it('gives the pane back the width it had before collapsing', () => {
    // The bug: expanding always sized the group at EXPANDED_GROUP_FRACTION of
    // the workbench, so a study pane the user had carefully dragged narrow (or
    // wide) came back at 35% regardless.
    seedDefaultLayout(dockview);
    const studyGroup = groupIdOf('study_default');
    dockview.api.getGroup(studyGroup)!.api.setSize({ width: 240 });
    const before = dockview.api.getGroup(studyGroup)!.width;
    expect(before).toBe(240);

    useLayoutStore.getState().collapseGroup(studyGroup);
    expect(dockview.api.getGroup(studyGroup)!.width).toBe(0);

    useLayoutStore.getState().expandCollapsedGroups();

    expect(dockview.api.getGroup(studyGroup)!.width).toBe(before);
    // 35% of the 1000px workbench would have been 350 - prove we did not take
    // the fallback path.
    expect(dockview.api.getGroup(studyGroup)!.width).not.toBe(350);
  });

  it('falls back to a sensible share when no width was recorded', () => {
    // The restored-session path: the saved layout has the group at zero and its
    // former width is simply not in there, so the fraction is all we have.
    seedDefaultLayout(dockview);
    const studyGroup = groupIdOf('study_default');

    useLayoutStore.getState().restoreCollapsedGroups([{ groupId: studyGroup, axis: 'width' }]);
    expect(dockview.api.getGroup(studyGroup)!.width).toBe(0);

    useLayoutStore.getState().expandCollapsedGroups();

    expect(dockview.api.getGroup(studyGroup)!.width).toBeGreaterThan(0);
  });

  it('refuses to collapse the last visible group', () => {
    seedDefaultLayout(dockview);
    const bibleGroup = groupIdOf('bible_default');
    const studyGroup = groupIdOf('study_default');
    useLayoutStore.getState().collapseGroup(studyGroup);

    expect(useLayoutStore.getState().canCollapseGroup(bibleGroup)).toBe(false);
    expect(useLayoutStore.getState().collapseGroup(bibleGroup)).toBe(false);

    expect(useLayoutStore.getState().collapsedGroups).toHaveLength(1);
    expect(dockview.api.getGroup(bibleGroup)!.width).toBeGreaterThan(0);
  });

  it('refuses when the workbench has only one group at all', () => {
    seedDefaultLayout(dockview);
    for (const panel of [...dockview.api.panels]) {
      if (panel.id !== 'bible_default') panel.api.close();
    }
    expect(dockview.api.groups).toHaveLength(1);

    expect(useLayoutStore.getState().collapseGroup(dockview.api.groups[0].id)).toBe(false);
    expect(useLayoutStore.getState().collapsedGroups).toEqual([]);
  });

  it('ignores a group that is already collapsed or does not exist', () => {
    seedDefaultLayout(dockview);
    const studyGroup = groupIdOf('study_default');
    useLayoutStore.getState().collapseGroup(studyGroup);

    expect(useLayoutStore.getState().collapseGroup(studyGroup)).toBe(false);
    expect(useLayoutStore.getState().collapseGroup('no-such-group')).toBe(false);
    expect(useLayoutStore.getState().collapsedGroups).toHaveLength(1);
  });

  it('is undone by the same expand action the preset collapse uses', () => {
    seedDefaultLayout(dockview);
    useLayoutStore.getState().collapseGroup(groupIdOf('study_default'));

    useLayoutStore.getState().expandCollapsedGroups();

    expect(useLayoutStore.getState().collapsedGroups).toEqual([]);
    expect(dockview.api.groups.every(g => g.width > 0)).toBe(true);
  });

  it('round-trips through the session serializer and restore path', () => {
    // Persistence rides the existing mechanism: a collapsed group serializes at
    // size 0 inside `dockviewState`, and DockviewLayout re-applies the
    // zero-width constraint on restore (it is not part of toJSON()). No new
    // storage key is involved.
    seedDefaultLayout(dockview);
    useLayoutStore.getState().collapseGroup(groupIdOf('study_default'));
    const saved = useLayoutStore.getState().serializeLayout()!;

    const restored = createDockview();
    try {
      restored.api.fromJSON(saved);
      useLayoutStore.getState().setDockviewApi(restored.api);
      const collapsed = zeroSizedGroupIds(saved).map(groupId => ({ groupId, axis: 'width' as const }));
      expect(collapsed).toHaveLength(1);
      useLayoutStore.getState().restoreCollapsedGroups(collapsed);

      expect(restored.api.groups.map(g => g.width)).toEqual([1000, 0]);
      expect(useLayoutStore.getState().collapsedGroups).toEqual(collapsed);
    } finally {
      restored.dispose();
    }
  });

  it('is superseded by a preset applied afterwards', () => {
    // Reconciliation rule: the preset is authoritative about which groups are
    // collapsed. Applying one rebuilds the grid from the preset definition, so
    // a manual collapse is expanded again unless the preset asks for it.
    seedDefaultLayout(dockview);
    useLayoutStore.getState().collapseGroup(groupIdOf('study_default'));

    return service.apply(STUDY_MODE.id).then(() => {
      expect(useLayoutStore.getState().collapsedGroups).toEqual([]);
      expect(dockview.api.groups.every(g => g.width > 0)).toBe(true);
    });
  });

  it('comes back when the user returns to the preset they collapsed it in', async () => {
    // The other half of the rule: a manual collapse made *while in* a preset is
    // part of that preset's remembered arrangement, so returning restores it.
    seedDefaultLayout(dockview);
    await service.apply(STUDY_MODE.id);
    useLayoutStore.getState().collapseGroup(dockview.api.getPanel('study_default')!.group.id);

    await service.apply(WRITER_MODE.id);
    expect(useLayoutStore.getState().collapsedGroups).toEqual([]);

    await service.apply(STUDY_MODE.id);
    expect(useLayoutStore.getState().collapsedGroups).toHaveLength(1);
  });
});

describe('preset round-tripping', () => {
  it('restores the arrangement a preset was left in', async () => {
    seedDefaultLayout(dockview);
    await service.apply(STUDY_MODE.id);

    // User adds a Notes pane of its own while in Study Mode.
    dockview.api.addPanel({
      id: 'notes_1', component: 'panelContent', title: 'Notes',
      params: { contentType: 'notes' }, position: { direction: 'right' },
    });
    const studyModeShape = shape(dockview).map(g => g.panels);
    expect(studyModeShape).toHaveLength(3);

    await service.apply(WRITER_MODE.id);
    expect(shape(dockview).map(g => g.panels)).not.toEqual(studyModeShape);

    await service.apply(STUDY_MODE.id);
    expect(shape(dockview).map(g => g.panels)).toEqual(studyModeShape);
  });

  it('files a pane opened elsewhere into the right group on return', async () => {
    seedDefaultLayout(dockview);
    await service.apply(STUDY_MODE.id);
    await service.apply(READING_MODE.id);

    dockview.api.addPanel({
      id: 'bible_john', component: 'panelContent', title: 'John 3',
      params: { contentType: 'bible', contentKey: 'KJV|43|3||reading' },
      position: { referenceGroup: dockview.api.groups[0], direction: 'within' },
    });

    await service.apply(STUDY_MODE.id);
    const bibleGroup = dockview.api.groups.find(g => g.panels.some(p => p.id === 'bible_default'))!;
    expect(bibleGroup.panels.map(p => p.id)).toContain('bible_john');
  });

  it('drops a pane closed while away instead of resurrecting it', async () => {
    seedDefaultLayout(dockview);
    await service.apply(STUDY_MODE.id);
    await service.apply(READING_MODE.id);
    dockview.api.getPanel('commentary_default')!.api.close();

    await service.apply(STUDY_MODE.id);
    // The closed pane is not resurrected: `commentary_default` and its state
    // are gone for good. Study Mode's `autoOpen` then opens a *fresh*
    // commentary pane, because the layout is named after a column that has
    // one - a different pane with a different id, not the one that was closed.
    expect(dockview.api.getPanel('commentary_default')).toBeUndefined();
    expect(dockview.api.panels.map(p => p.id)).toContain('bible_default');
    expect(dockview.api.panels.map(p => p.id)).toContain('study_default');
  });

  it('rebuilds from the definition when the same preset is re-applied', async () => {
    seedDefaultLayout(dockview);
    await service.apply(STUDY_MODE.id);
    dockview.api.addPanel({
      id: 'notes_1', component: 'panelContent', title: 'Notes',
      params: { contentType: 'notes' }, position: { direction: 'right' },
    });
    expect(dockview.api.groups).toHaveLength(3);

    // Re-applying the current preset is the "reset this layout" gesture; it
    // must not restore the arrangement it just recorded.
    await service.apply(STUDY_MODE.id);
    expect(dockview.api.groups).toHaveLength(2);
  });

  it('forceRebuild ignores a remembered arrangement', async () => {
    seedDefaultLayout(dockview);
    await service.apply(STUDY_MODE.id);
    dockview.api.addPanel({
      id: 'notes_1', component: 'panelContent', title: 'Notes',
      params: { contentType: 'notes' }, position: { direction: 'right' },
    });
    await service.apply(READING_MODE.id);

    await service.apply(STUDY_MODE.id, { forceRebuild: true });
    expect(dockview.api.groups).toHaveLength(2);
    expect(service.rememberedLayoutFor(STUDY_MODE.id)).toBeUndefined();
  });
});

describe('Reading Mode collapses the study area', () => {
  it('takes the study group to zero width, not a 100px sliver', async () => {
    seedDefaultLayout(dockview);
    await service.apply(READING_MODE.id);

    const groups = shape(dockview);
    expect(groups).toHaveLength(2);
    expect(groups[0].width).toBe(1000);
    expect(groups[1].width).toBe(0);
  });

  it('keeps the collapsed panes and records them for the restore control', async () => {
    seedDefaultLayout(dockview);
    await service.apply(READING_MODE.id);

    const collapsed = useLayoutStore.getState().collapsedGroups;
    expect(collapsed).toHaveLength(1);
    const group = dockview.api.getGroup(collapsed[0].groupId)!;
    expect(group.panels.map(p => p.id)).toEqual(['study_default', 'commentary_default']);
  });

  it('expandCollapsedGroups gives the pane its width back', async () => {
    seedDefaultLayout(dockview);
    await service.apply(READING_MODE.id);

    useLayoutStore.getState().expandCollapsedGroups();

    expect(useLayoutStore.getState().collapsedGroups).toEqual([]);
    const widths = shape(dockview).map(g => g.width);
    expect(widths[1]).toBeGreaterThan(100);
  });

  it('stays collapsed across a session save and restore', async () => {
    seedDefaultLayout(dockview);
    await service.apply(READING_MODE.id);
    const saved = dockview.api.toJSON();

    // What DockviewLayout does on restore. The zero-width constraint is not
    // part of the serialization, so without re-applying it the splitview
    // springs the group back to its 100px minimum.
    const restored = createDockview();
    try {
      restored.api.fromJSON(saved);
      useLayoutStore.getState().setDockviewApi(restored.api);
      const collapsed = zeroSizedGroupIds(saved).map(groupId => ({ groupId, axis: 'width' as const }));
      expect(collapsed).toHaveLength(1);
      useLayoutStore.getState().restoreCollapsedGroups(collapsed);

      expect(restored.api.groups.map(g => g.width)).toEqual([1000, 0]);
    } finally {
      restored.dispose();
    }
  });

  it('clears the collapsed record when a preset without collapse is applied', async () => {
    seedDefaultLayout(dockview);
    await service.apply(READING_MODE.id);
    expect(useLayoutStore.getState().collapsedGroups).toHaveLength(1);

    await service.apply(STUDY_MODE.id);
    expect(useLayoutStore.getState().collapsedGroups).toEqual([]);
    expect(shape(dockview).every(g => g.width > 0)).toBe(true);
  });
});

describe('adding a tab after a preset does not destroy a pane', () => {
  /** What NewTabPage does: create the replacement, then close the placeholder. */
  function replaceNewTab(newTabId: string, replacementId: string): string | null {
    const api = useLayoutStore.getState().dockviewApi!;
    const placeholder = api.getPanel(newTabId)!;
    const group = placeholder.group;
    const index = group.panels.indexOf(placeholder);
    const created = useLayoutStore.getState().addPanel(
      'bible', 'KJV|43|3||reading', 'John 3',
      { referenceGroup: group, direction: 'within', index },
      'KJV', replacementId,
    );
    if (created) placeholder.api.close();
    return created;
  }

  it('survives when the New Tab placeholder is the only panel in its group', async () => {
    seedDefaultLayout(dockview);
    await service.apply(STUDY_MODE.id);

    // Reduce the right-hand group to a single panel, then replace it. Closing
    // that panel first removed the group; dockview then accepted the dangling
    // group as a position and the replacement disappeared with the pane.
    for (const panel of [...dockview.api.panels]) {
      if (panel.id !== 'bible_default') panel.api.close();
    }
    expect(dockview.api.groups).toHaveLength(1);

    const bibleGroup = dockview.api.groups[0];
    useLayoutStore.getState().addPanel('newtab', undefined, 'New Tab', {
      referenceGroup: bibleGroup, direction: 'within',
    });
    dockview.api.getPanel('bible_default')!.api.close();
    const loneNewTab = dockview.api.panels[0].id;
    expect(dockview.api.groups[0].panels).toHaveLength(1);

    expect(replaceNewTab(loneNewTab, 'bible_john')).toBe('bible_john');
    expect(dockview.api.groups).toHaveLength(1);
    expect(dockview.api.panels.map(p => p.id)).toEqual(['bible_john']);
  });

  it('replaces the placeholder in place inside a shared group', async () => {
    seedDefaultLayout(dockview);
    await service.apply(STUDY_MODE.id);

    const studyGroup = dockview.api.getPanel('study_default')!.group;
    const before = studyGroup.panels.map(p => p.id);
    const newTabId = useLayoutStore.getState().addPanel('newtab', undefined, 'New Tab', {
      referenceGroup: studyGroup, direction: 'within',
    })!;

    expect(replaceNewTab(newTabId, 'bible_john')).toBe('bible_john');
    // The replacement takes the placeholder's slot at the end of the group;
    // every pane that was already there keeps its position.
    expect(studyGroup.panels.map(p => p.id)).toEqual([...before, 'bible_john']);
    expect(dockview.api.getPanel(newTabId)).toBeUndefined();
  });
});

describe('currentPresetId tracks manual layout changes (QA 4.4)', () => {
  it('is set once a preset is applied', async () => {
    seedDefaultLayout(dockview);
    expect(service.currentPresetId).toBeNull();

    await service.apply(STUDY_MODE.id);

    expect(service.currentPresetId).toBe(STUDY_MODE.id);
  });

  it('does not clear itself as a side effect of the fromJSON the apply performs', async () => {
    // The trap: applyPresetLayout's api.fromJSON(...) fires onDidLayoutChange,
    // the very event notifyManualLayoutChange() listens to. If the guard in
    // LayoutPresetService didn't work, currentPresetId would already be back
    // to null by the time apply() resolves.
    seedDefaultLayout(dockview);
    await service.apply(STUDY_MODE.id);
    expect(service.currentPresetId).toBe(STUDY_MODE.id);

    await service.apply(READING_MODE.id);
    expect(service.currentPresetId).toBe(READING_MODE.id);
  });

  it('is cleared by a manual layout change (add/move/close a panel outside apply())', async () => {
    seedDefaultLayout(dockview);
    await service.apply(STUDY_MODE.id);
    expect(service.currentPresetId).toBe(STUDY_MODE.id);

    // A manual change the user makes by hand (dragging, splitting, closing a
    // tab) - not routed through the preset service at all. dockview's
    // onDidLayoutChange is itself buffered via queueMicrotask (see the
    // `_applyingPreset` doc comment), so the effect isn't visible until the
    // next microtask tick.
    dockview.api.addPanel({
      id: 'notes_manual', component: 'panelContent', title: 'Notes',
      params: { contentType: 'notes' }, position: { direction: 'right' },
    });
    await Promise.resolve();

    expect(service.currentPresetId).toBeNull();
  });

  it('stays null across a manual change when no preset was active', async () => {
    seedDefaultLayout(dockview);
    expect(service.currentPresetId).toBeNull();

    dockview.api.getPanel('commentary_default')!.api.close();
    await Promise.resolve();

    expect(service.currentPresetId).toBeNull();
  });
});

describe('resolveStalePosition', () => {
  it('drops a position whose reference group has been removed', () => {
    seedDefaultLayout(dockview);
    const group = dockview.api.getPanel('study_default')!.group;
    dockview.api.getPanel('study_default')!.api.close();
    dockview.api.getPanel('commentary_default')!.api.close();

    expect(resolveStalePosition(dockview.api, { referenceGroup: group, direction: 'within' }))
      .toBeUndefined();
  });

  it('keeps a live position untouched', () => {
    seedDefaultLayout(dockview);
    const group = dockview.api.getPanel('study_default')!.group;
    const position = { referenceGroup: group, direction: 'within' };
    expect(resolveStalePosition(dockview.api, position)).toBe(position);
  });

  it('adds the panel somewhere visible rather than nowhere', () => {
    seedDefaultLayout(dockview);
    const group = dockview.api.getPanel('study_default')!.group;
    dockview.api.getPanel('study_default')!.api.close();
    dockview.api.getPanel('commentary_default')!.api.close();

    const created = useLayoutStore.getState().addPanel(
      'notes', undefined, 'Notes', { referenceGroup: group, direction: 'within' },
    );
    expect(created).not.toBeNull();
    expect(dockview.api.panels.map(p => p.id)).toContain(created);
  });
});
