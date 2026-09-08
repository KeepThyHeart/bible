import { describe, it, expect } from 'vitest';
import type { SerializedDockview } from 'dockview-react';
import {
  bucketTabs,
  buildPresetLayout,
  collectTabsFromLayout,
  reconcileRememberedLayout,
  zeroSizedGroupIds,
} from './PresetApplier';
import type { TabInfo } from './PresetApplier';
import type { LayoutPreset } from '../types/LayoutPreset';
import { STUDY_MODE } from '../presets/studyMode';
import { READING_MODE } from '../presets/readingMode';
import { STUDY_MODE_QUAD } from '../presets/studyModeQuad';

function tab(contentType: string, id?: string): TabInfo {
  return {
    panelId: id ?? `panel-${contentType}`,
    contentType,
    title: contentType,
  };
}

interface LeafSpec {
  id: string;
  views: string[];
  activeView?: string;
  size?: number;
}

/**
 * Build a `SerializedDockview` the way dockview's own `toJSON()` does - in
 * particular with `contentComponent`, the field its deserializer actually
 * reads.
 */
function layoutOf(
  leaves: LeafSpec[],
  panelTypes: Record<string, string>,
  extraParams: Record<string, Record<string, unknown>> = {},
): SerializedDockview {
  const panels: Record<string, unknown> = {};
  for (const [id, contentType] of Object.entries(panelTypes)) {
    panels[id] = {
      id,
      contentComponent: 'panelContent',
      title: id,
      params: { contentType, ...(extraParams[id] ?? {}) },
    };
  }
  return {
    grid: {
      root: {
        type: 'branch',
        size: 1000,
        data: leaves.map(l => ({
          type: 'leaf',
          size: l.size ?? 500,
          data: { id: l.id, views: l.views, activeView: l.activeView ?? l.views[0] },
        })),
      },
      width: 1000,
      height: 1000,
      orientation: 'HORIZONTAL',
    },
    panels,
  } as unknown as SerializedDockview;
}

/**
 * The grid tree as nested arrays: a branch becomes an array of its children, a
 * leaf becomes its list of views. Lets a test assert the *shape* of a grid
 * preset (rows of columns) rather than just the flattened leaf order.
 */
function gridShape(layout: SerializedDockview): unknown {
  const walk = (node: { type: string; data: unknown }): unknown => {
    if (node.type === 'branch') {
      return (node.data as { type: string; data: unknown }[]).map(walk);
    }
    return (node.data as { views: string[] }).views;
  };
  return walk(layout.grid.root as unknown as { type: string; data: unknown });
}

function leavesOf(layout: SerializedDockview): { id: string; views: string[]; activeView?: string; size: number }[] {
  const out: { id: string; views: string[]; activeView?: string; size: number }[] = [];
  const walk = (node: { type: string; data: unknown; size?: number }): void => {
    if (node.type === 'branch') {
      for (const child of node.data as { type: string; data: unknown; size?: number }[]) walk(child);
    } else {
      const data = node.data as { id: string; views: string[]; activeView?: string };
      out.push({ id: data.id, views: data.views, activeView: data.activeView, size: node.size ?? 0 });
    }
  };
  walk(layout.grid.root as unknown as { type: string; data: unknown; size?: number });
  return out;
}

describe('bucketTabs', () => {
  it('places a bible tab into the bible-accepting group', () => {
    const buckets = bucketTabs(STUDY_MODE, [tab('bible')]);
    expect(buckets.get(0)).toHaveLength(1);
    expect(buckets.get(0)![0].contentType).toBe('bible');
    expect(buckets.get(1)).toHaveLength(0);
  });

  it('places a commentary tab into the study group', () => {
    const buckets = bucketTabs(STUDY_MODE, [tab('commentary')]);
    expect(buckets.get(0)).toHaveLength(0);
    expect(buckets.get(1)).toHaveLength(1);
  });

  it('places multiple tabs into correct groups', () => {
    const tabs = [tab('bible', 'b1'), tab('commentary', 'c1'), tab('notes', 'n1'), tab('bible', 'b2')];
    const buckets = bucketTabs(STUDY_MODE, tabs);
    expect(buckets.get(0)).toHaveLength(2);
    expect(buckets.get(1)).toHaveLength(2);
  });

  it('falls back to unknown-accepting group for unrecognized types', () => {
    const buckets = bucketTabs(STUDY_MODE, [tab('newtab', 'nt1')]);
    expect(buckets.get(1)).toHaveLength(1);
    expect(buckets.get(1)![0].contentType).toBe('newtab');
  });

  it('handles extension content types via unknown bucket', () => {
    const buckets = bucketTabs(STUDY_MODE, [tab('ext:my-ext.panel', 'ext1')]);
    expect(buckets.get(1)).toHaveLength(1);
    expect(buckets.get(1)![0].contentType).toBe('ext:my-ext.panel');
  });

  it('handles zero tabs', () => {
    const buckets = bucketTabs(STUDY_MODE, []);
    expect(buckets.get(0)).toHaveLength(0);
    expect(buckets.get(1)).toHaveLength(0);
  });

  it('round-robins unmatched tabs across multiple unknown-accepting groups', () => {
    const preset: LayoutPreset = {
      id: 'test',
      name: { key: 'test' },
      groups: [
        { accepts: ['bible'], sizeWeight: 50 },
        { accepts: ['unknown'], sizeWeight: 25 },
        { accepts: ['unknown'], sizeWeight: 25 },
      ],
    };
    const tabs = [tab('newtab', 'a'), tab('newtab', 'b'), tab('newtab', 'c')];
    const buckets = bucketTabs(preset, tabs);
    expect(buckets.get(0)).toHaveLength(0);
    expect(buckets.get(1)).toHaveLength(2);
    expect(buckets.get(2)).toHaveLength(1);
  });

  it('orders a group by its declared content-type order', () => {
    // Study Mode's right-hand column is specified as Study -> Commentary ->
    // Topics -> Dictionary -> Notes; without `order` it came out in whatever
    // order the session happened to have the panes open in.
    const tabs = [
      tab('notes'), tab('dictionary'), tab('topics'), tab('commentary'), tab('study'),
    ];
    const buckets = bucketTabs(STUDY_MODE, tabs);
    expect(buckets.get(1)!.map(t => t.contentType))
      .toEqual(['study', 'commentary', 'topics', 'dictionary', 'notes']);
  });

  it('keeps unlisted types behind the declared ones, in their original order', () => {
    const tabs = [
      tab('search', 'search-1'),
      tab('notes'),
      tab('book', 'book-1'),
      tab('study'),
    ];
    const buckets = bucketTabs(STUDY_MODE, tabs);
    expect(buckets.get(1)!.map(t => t.panelId))
      .toEqual(['panel-study', 'panel-notes', 'search-1', 'book-1']);
  });

  it('leaves a group with no declared order alone', () => {
    // The Bible group declares none, so its tabs keep session order.
    const tabs = [tab('bible', 'b2'), tab('bible', 'b1')];
    const buckets = bucketTabs(STUDY_MODE, tabs);
    expect(buckets.get(0)!.map(t => t.panelId)).toEqual(['b2', 'b1']);
  });

  it('places wildcard-accepting groups last for unmatched tabs', () => {
    const buckets = bucketTabs(READING_MODE, [tab('bible'), tab('commentary')]);
    expect(buckets.get(0)).toHaveLength(1);
    expect(buckets.get(0)![0].contentType).toBe('bible');
    expect(buckets.get(1)).toHaveLength(1);
    expect(buckets.get(1)![0].contentType).toBe('commentary');
  });

  it('buckets quad preset correctly', () => {
    // Group order is the grid order: Bible is the first cell (row 1, col 1),
    // matching every other preset - listing it second would slide the Bible
    // pane to the other side of the window on switching to Quad.
    const tabs = [
      tab('commentary', 'c1'),
      tab('bible', 'b1'),
      tab('dictionary', 'd1'),
      tab('notes', 'n1'),
    ];
    const buckets = bucketTabs(STUDY_MODE_QUAD, tabs);
    expect(buckets.get(0)!.map(t => t.contentType)).toEqual(['bible']);
    expect(buckets.get(1)!.map(t => t.contentType)).toEqual(['commentary']);
    expect(buckets.get(2)!.map(t => t.contentType)).toEqual(['dictionary']);
    expect(buckets.get(3)!.map(t => t.contentType)).toEqual(['notes']);
  });
});

describe('collectTabsFromLayout', () => {
  it('reads tabs in grid order with their params', () => {
    const current = layoutOf(
      [
        { id: 'g1', views: ['b1'] },
        { id: 'g2', views: ['s1', 'c1'] },
      ],
      { b1: 'bible', s1: 'study', c1: 'commentary' },
      { c1: { contentKey: 'mhc' } },
    );
    const tabs = collectTabsFromLayout(current);
    expect(tabs.map(t => t.panelId)).toEqual(['b1', 's1', 'c1']);
    expect(tabs[2].contentKey).toBe('mhc');
  });

  it('keeps panels the grid does not reference', () => {
    const current = layoutOf([{ id: 'g1', views: ['b1'] }], { b1: 'bible', orphan: 'notes' });
    expect(collectTabsFromLayout(current).map(t => t.panelId)).toEqual(['b1', 'orphan']);
  });
});

describe('buildPresetLayout', () => {
  const current = layoutOf(
    [
      { id: 'g1', views: ['b1', 'b2'], activeView: 'b2' },
      { id: 'g2', views: ['s1', 'c1'], activeView: 'c1' },
    ],
    { b1: 'bible', b2: 'bible', s1: 'study', c1: 'commentary' },
  );

  it('carries the live panel entries over verbatim', () => {
    // Regression: synthesising `{ component: 'panelContent' }` entries would
    // corrupt every pane - dockview's deserializer reads `contentComponent`,
    // so each one would come back as the component named 'unknown', a blank
    // pane, and the corruption would then be written into the saved session.
    const { layout } = buildPresetLayout(STUDY_MODE, current);
    const panels = layout.panels as unknown as Record<string, { contentComponent?: string }>;
    for (const id of ['b1', 'b2', 's1', 'c1']) {
      expect(panels[id]).toBeDefined();
      expect(panels[id].contentComponent).toBe('panelContent');
    }
    expect(panels.b1).toBe((current.panels as unknown as Record<string, unknown>).b1);
  });

  it('does not drop any open pane', () => {
    const { layout } = buildPresetLayout(STUDY_MODE, current);
    const placed = leavesOf(layout).flatMap(l => l.views);
    expect(placed.sort()).toEqual(['b1', 'b2', 'c1', 's1']);
  });

  it('keeps the previously visible tab visible in its new group', () => {
    const { layout } = buildPresetLayout(STUDY_MODE, current);
    const leaves = leavesOf(layout);
    expect(leaves[0].activeView).toBe('b2');
    expect(leaves[1].activeView).toBe('c1');
  });

  it('omits preset groups that have nothing to hold', () => {
    // A materialised empty group is where the "adding a tab makes a pane
    // vanish" bug came from - its New Tab placeholder was the group's only
    // panel, so replacing it took the group with it.
    const bibleOnly = layoutOf([{ id: 'g1', views: ['b1'] }], { b1: 'bible' });
    const { layout } = buildPresetLayout(STUDY_MODE_QUAD, bibleOnly);
    const leaves = leavesOf(layout);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].views).toEqual(['b1']);
  });

  it('collapses the Reading Mode study group to zero instead of a sliver', () => {
    const { layout, collapsedGroups } = buildPresetLayout(READING_MODE, current);
    const leaves = leavesOf(layout);
    expect(leaves).toHaveLength(2);
    expect(leaves[0].size).toBeGreaterThan(0);
    expect(leaves[1].size).toBe(0);
    expect(collapsedGroups).toEqual([{ groupId: leaves[1].id, axis: 'width' }]);
  });

  it('activates a group that is actually visible', () => {
    const { layout } = buildPresetLayout(READING_MODE, current);
    const leaves = leavesOf(layout);
    expect(layout.activeGroup).toBe(leaves[0].id);
  });

  it('produces no collapsed groups for presets that do not ask for any', () => {
    expect(buildPresetLayout(STUDY_MODE, current).collapsedGroups).toEqual([]);
  });
});

describe('buildPresetLayout: Study Mode (Quad)', () => {
  const allFour = layoutOf(
    [{ id: 'g1', views: ['b1', 'c1', 'd1', 'n1'] }],
    { b1: 'bible', c1: 'commentary', d1: 'dictionary', n1: 'notes' },
  );

  it('builds a genuine 2x2 when every cell has content', () => {
    // The reported symptom was "Quad just flips left and right": with only
    // Bible and Study/Commentary open, both bottom cells were pruned and the
    // second row disappeared. Given content for all four, the grid machinery
    // does produce a real 2x2 - rows of columns.
    const { layout } = buildPresetLayout(STUDY_MODE_QUAD, allFour);
    expect(gridShape(layout)).toEqual([[['b1'], ['c1']], [['d1'], ['n1']]]);
    expect(leavesOf(layout)).toHaveLength(4);
    // Rows stack vertically; the columns inside each row are the horizontal axis.
    expect(layout.grid.orientation).toBe('VERTICAL');
  });

  it('puts Bible in row 1, col 1', () => {
    const { layout } = buildPresetLayout(STUDY_MODE_QUAD, allFour);
    const rows = gridShape(layout) as string[][][];
    expect(rows[0][0]).toEqual(['b1']);
  });

  it('does not move Bible off the left when the bottom row degrades away', () => {
    // Auto-open can fail (no dictionary module installed, say). Quad then
    // degrades to a single row - but Bible must still be the left-hand pane,
    // exactly where Study Mode and Reading Mode leave it.
    const twoPanes = layoutOf(
      [{ id: 'g1', views: ['b1', 'c1'] }],
      { b1: 'bible', c1: 'commentary' },
    );
    const quad = buildPresetLayout(STUDY_MODE_QUAD, twoPanes);
    expect(gridShape(quad.layout)).toEqual([[['b1'], ['c1']]]);

    const study = buildPresetLayout(STUDY_MODE, twoPanes);
    expect(leavesOf(study.layout)[0].views).toEqual(['b1']);
    expect(leavesOf(quad.layout)[0].views).toEqual(leavesOf(study.layout)[0].views);
  });
});

describe('reconcileRememberedLayout', () => {
  const remembered = layoutOf(
    [
      { id: 'r1', views: ['b1'], size: 700 },
      { id: 'r2', views: ['s1', 'c1'], activeView: 'c1', size: 300 },
    ],
    { b1: 'bible', s1: 'study', c1: 'commentary' },
  );

  it('restores the remembered arrangement when nothing changed', () => {
    const current = layoutOf(
      [{ id: 'x', views: ['b1', 's1', 'c1'] }],
      { b1: 'bible', s1: 'study', c1: 'commentary' },
    );
    const { layout } = reconcileRememberedLayout(STUDY_MODE, remembered, current);
    const leaves = leavesOf(layout);
    expect(leaves.map(l => l.views)).toEqual([['b1'], ['s1', 'c1']]);
    expect(leaves[0].size).toBe(700);
    expect(leaves[1].size).toBe(300);
  });

  it('uses the CURRENT panel entries, not the remembered ones', () => {
    const current = layoutOf(
      [{ id: 'x', views: ['b1', 's1', 'c1'] }],
      { b1: 'bible', s1: 'study', c1: 'commentary' },
      { b1: { contentKey: 'KJV|43|3||reading' } },
    );
    const { layout } = reconcileRememberedLayout(STUDY_MODE, remembered, current);
    const panels = layout.panels as unknown as Record<string, { params: { contentKey?: string } }>;
    expect(panels.b1.params.contentKey).toBe('KJV|43|3||reading');
  });

  it('drops panes that were closed while away', () => {
    const current = layoutOf([{ id: 'x', views: ['b1', 's1'] }], { b1: 'bible', s1: 'study' });
    const { layout } = reconcileRememberedLayout(STUDY_MODE, remembered, current);
    const leaves = leavesOf(layout);
    expect(leaves.map(l => l.views)).toEqual([['b1'], ['s1']]);
  });

  it('removes a remembered group that lost every pane', () => {
    const current = layoutOf([{ id: 'x', views: ['b1'] }], { b1: 'bible' });
    const { layout } = reconcileRememberedLayout(STUDY_MODE, remembered, current);
    expect(leavesOf(layout)).toHaveLength(1);
  });

  it('files panes opened while away into the group the preset would pick', () => {
    const current = layoutOf(
      [{ id: 'x', views: ['b1', 's1', 'c1', 'n1', 'b2'] }],
      { b1: 'bible', s1: 'study', c1: 'commentary', n1: 'notes', b2: 'bible' },
    );
    const { layout } = reconcileRememberedLayout(STUDY_MODE, remembered, current);
    const leaves = leavesOf(layout);
    expect(leaves[0].views).toEqual(['b1', 'b2']);
    expect(leaves[1].views).toEqual(['s1', 'c1', 'n1']);
  });

  it('falls back to a fresh arrangement when nothing remembered survives', () => {
    const current = layoutOf([{ id: 'x', views: ['n9'] }], { n9: 'notes' });
    const { layout } = reconcileRememberedLayout(STUDY_MODE, remembered, current);
    expect(leavesOf(layout).flatMap(l => l.views)).toEqual(['n9']);
  });

  it('re-collapses a group the user left collapsed', () => {
    const collapsedRemembered = layoutOf(
      [
        { id: 'r1', views: ['b1'], size: 1000 },
        { id: 'r2', views: ['c1'], size: 0 },
      ],
      { b1: 'bible', c1: 'commentary' },
    );
    const current = layoutOf([{ id: 'x', views: ['b1', 'c1'] }], { b1: 'bible', c1: 'commentary' });
    const { collapsedGroups } = reconcileRememberedLayout(READING_MODE, collapsedRemembered, current);
    expect(collapsedGroups).toEqual([{ groupId: 'r2', axis: 'width' }]);
  });
});

describe('zeroSizedGroupIds', () => {
  it('finds groups serialized at zero size', () => {
    const layout = layoutOf(
      [
        { id: 'a', views: ['b1'], size: 1000 },
        { id: 'b', views: ['c1'], size: 0 },
      ],
      { b1: 'bible', c1: 'commentary' },
    );
    expect(zeroSizedGroupIds(layout)).toEqual(['b']);
  });

  it('returns nothing for a layout with no grid', () => {
    expect(zeroSizedGroupIds({} as SerializedDockview)).toEqual([]);
  });
});
