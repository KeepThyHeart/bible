import { describe, it, expect } from 'vitest';
import type { SerializedDockview } from 'dockview-react';
import { sanitizeDockviewState } from './LayoutStateSanitizer';

interface LeafSpec {
  id: string;
  views: string[];
  activeView?: string;
  size?: number;
}

interface PanelSpec {
  contentComponent?: string;
  contentType?: string;
  contentKey?: string;
  /** Omit params entirely (simulates a panel with no params object at all). */
  noParams?: boolean;
}

/**
 * Build a `SerializedDockview` the way dockview's own `toJSON()` does. Mirrors
 * the equivalent helper in `PresetApplier.test.ts`.
 */
function layoutOf(
  leaves: LeafSpec[],
  panelSpecs: Record<string, PanelSpec>,
  activeGroup?: string,
): SerializedDockview {
  const panels: Record<string, unknown> = {};
  for (const [id, spec] of Object.entries(panelSpecs)) {
    panels[id] = {
      id,
      contentComponent: spec.contentComponent,
      title: id,
      params: spec.noParams
        ? undefined
        : { contentType: spec.contentType, contentKey: spec.contentKey },
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
    ...(activeGroup ? { activeGroup } : {}),
  } as unknown as SerializedDockview;
}

function leavesOf(layout: SerializedDockview): { id: string; views: string[]; activeView?: string }[] {
  const out: { id: string; views: string[]; activeView?: string }[] = [];
  const walk = (node: { type: string; data: unknown }): void => {
    if (node.type === 'branch') {
      for (const child of node.data as { type: string; data: unknown }[]) walk(child);
    } else {
      const data = node.data as { id: string; views: string[]; activeView?: string };
      out.push({ id: data.id, views: data.views, activeView: data.activeView });
    }
  };
  walk(layout.grid.root as unknown as { type: string; data: unknown });
  return out;
}

describe('sanitizeDockviewState', () => {
  it('passes a healthy layout through untouched (same reference, no repairs)', () => {
    const layout = layoutOf(
      [{ id: 'g1', views: ['bible_default'] }, { id: 'g2', views: ['study_default'] }],
      {
        bible_default: { contentComponent: 'panelContent', contentType: 'bible' },
        study_default: { contentComponent: 'panelContent', contentType: 'study' },
      },
    );

    const result = sanitizeDockviewState(layout);

    expect(result.repairs).toEqual([]);
    expect(result.layout).toBe(layout); // same object, not a rebuilt copy
  });

  it('repairs a panel with the known corrupted contentComponent using params.contentType', () => {
    // This is the actual shape the fixed bug produced: contentComponent lost
    // (defaults to 'unknown' on fromJSON), params.contentType untouched.
    const layout = layoutOf(
      [{ id: 'g1', views: ['bible_default'] }, { id: 'g2', views: ['study_default', 'commentary_default'] }],
      {
        bible_default: { contentComponent: 'unknown', contentType: 'bible' },
        study_default: { contentComponent: 'unknown', contentType: 'study' },
        commentary_default: { contentComponent: 'unknown', contentType: 'commentary', contentKey: 'kjv' },
      },
    );

    const result = sanitizeDockviewState(layout);

    expect(result.layout).not.toBeNull();
    expect(result.repairs).toHaveLength(3);
    expect(result.repairs.every(r => r.action === 'repaired')).toBe(true);
    expect(result.repairs.every(r => r.viaPanelIdInference === false)).toBe(true);

    const panels = result.layout!.panels as unknown as Record<string, { contentComponent: string; params: { contentType: string; contentKey?: string } }>;
    expect(panels.bible_default.contentComponent).toBe('panelContent');
    expect(panels.study_default.contentComponent).toBe('panelContent');
    expect(panels.commentary_default.contentComponent).toBe('panelContent');
    expect(panels.commentary_default.params.contentType).toBe('commentary');
    expect(panels.commentary_default.params.contentKey).toBe('kjv'); // preserved, not clobbered

    // Grid structure (leaves/views) is unchanged - nothing was dropped.
    expect(leavesOf(result.layout!)).toEqual(leavesOf(layout));
  });

  it('infers content type from the panel id when params are missing entirely', () => {
    const layout = layoutOf(
      [{ id: 'g1', views: ['study_1700000000-ab12cd'] }],
      { 'study_1700000000-ab12cd': { contentComponent: 'unknown', noParams: true } },
    );

    const result = sanitizeDockviewState(layout);

    expect(result.layout).not.toBeNull();
    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0].action).toBe('repaired');
    expect(result.repairs[0].viaPanelIdInference).toBe(true);
    expect(result.repairs[0].contentType).toBe('study');

    const panels = result.layout!.panels as unknown as Record<string, { contentComponent: string; params: { contentType: string } }>;
    expect(panels['study_1700000000-ab12cd'].contentComponent).toBe('panelContent');
    expect(panels['study_1700000000-ab12cd'].params.contentType).toBe('study');
  });

  it('drops a panel that is genuinely unrecoverable, keeping the rest', () => {
    const layout = layoutOf(
      [
        { id: 'g1', views: ['bible_default'] },
        { id: 'g2', views: ['garbage-panel-1'] },
      ],
      {
        bible_default: { contentComponent: 'panelContent', contentType: 'bible' },
        // No recognizable content type in params and no recognizable id prefix.
        'garbage-panel-1': { contentComponent: 'unknown', contentType: 'not-a-real-type' },
      },
      'g2',
    );

    const result = sanitizeDockviewState(layout);

    expect(result.layout).not.toBeNull();
    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0]).toMatchObject({ panelId: 'garbage-panel-1', action: 'dropped' });

    const panels = result.layout!.panels as unknown as Record<string, unknown>;
    expect(Object.keys(panels)).toEqual(['bible_default']);

    const leaves = leavesOf(result.layout!);
    expect(leaves).toHaveLength(1); // the now-empty g2 group is pruned away too
    expect(leaves[0].id).toBe('g1');
    expect(leaves[0].views).toEqual(['bible_default']);

    // activeGroup pointed at the dropped group's leaf - re-pointed at a survivor.
    expect(result.layout!.activeGroup).toBe('g1');
  });

  it('falls back to null (caller uses the default layout) when nothing survives', () => {
    const layout = layoutOf(
      [{ id: 'g1', views: ['garbage-1', 'garbage-2'] }],
      {
        'garbage-1': { contentComponent: 'unknown', contentType: 'nonsense' },
        'garbage-2': { contentComponent: 'unknown', noParams: true },
      },
    );

    const result = sanitizeDockviewState(layout);

    expect(result.layout).toBeNull();
    expect(result.repairs).toHaveLength(2);
    expect(result.repairs.every(r => r.action === 'dropped')).toBe(true);
  });

  it('leaves layouts with no panel map alone (defers to the existing fromJSON try/catch)', () => {
    const layout = { grid: {}, panels: [] } as unknown as SerializedDockview;
    const result = sanitizeDockviewState(layout);
    expect(result.layout).toBe(layout);
    expect(result.repairs).toEqual([]);
  });

  it('treats null/undefined input as nothing to sanitize', () => {
    expect(sanitizeDockviewState(null)).toEqual({ layout: null, repairs: [] });
    expect(sanitizeDockviewState(undefined)).toEqual({ layout: null, repairs: [] });
  });
});
