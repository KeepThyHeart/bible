import type { GenealogyGraph } from './GenealogyGraph';
import type { GenealogyState } from './store';
import type { GraphLayout } from './types';
import { layoutLineage } from './layoutLineage';
import { layoutFamily } from './layoutFamily';
import { layoutTribes } from './layoutTribes';

/**
 * The one place that maps view state to a layout, so web and desktop cannot
 * drift. Pass it as `computeLayout` to `<GenealogyExplorer>`. The graph should
 * already carry the state's readings/showDisputed (the explorer rebuilds it).
 */
export function computeGenealogyLayout(g: GenealogyGraph, s: GenealogyState): GraphLayout {
  switch (s.view) {
    case 'family': {
      const focus = s.focusId ?? (g.has('jesus') ? 'jesus' : g.allPersons()[0]?.id);
      if (!focus) return { nodes: [], edges: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
      return layoutFamily(g, focus, {
        up: s.up, down: s.down, showMothers: s.showMothers,
        collapsed: s.collapsed, highlightLineToChrist: s.highlightLineToChrist,
      });
    }
    case 'tribes':
      return layoutTribes(g, {
        list: s.tribeList, collapsed: s.collapsed, highlightLineToChrist: s.highlightLineToChrist,
      });
    case 'line':
    default:
      return layoutLineage(g, {
        lineageIds: s.lineageIds.length ? s.lineageIds : undefined,
        highlightLineToChrist: s.highlightLineToChrist,
      });
  }
}
