/**
 * Pure helpers for the genealogy view (no React): level of detail, node shapes,
 * edge paths and keyboard navigation between nodes. Layout coordinates: a node's
 * (x, y) is its CENTRE and (w, h) its size.
 */
import type { LayoutNode, LayoutPoint } from '@bible/core/browser';

export type NodeShape = 'group' | 'female' | 'male' | 'neutral';

/** Zoom thresholds above which importance 1 and 2 nodes are labelled. importance 0 is always labelled. */
export const LOD_THRESHOLDS: readonly [number, number, number] = [0, 0.5, 0.9];

export function labelVisible(importance: 0 | 1 | 2, k: number): boolean {
  return k >= LOD_THRESHOLDS[importance];
}

export function shapeOf(node: LayoutNode): NodeShape {
  if (node.flags.group) return 'group';
  if (node.sex === 'female') return 'female';
  if (node.sex === 'male') return 'male';
  return 'neutral';
}

/** SVG path data through a polyline. */
export function pathData(points: LayoutPoint[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(' ');
}

/** Offset a polyline sideways by `d` (world units) along each segment's normal, for "double" edges. */
export function offsetPoints(points: LayoutPoint[], d: number): LayoutPoint[] {
  if (points.length < 2) return points;
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (-dy / len) * d, y: p.y + (dx / len) * d };
  });
}

/** Hexagon points for a node of size w x h centred on the origin. */
export function hexagonPoints(w: number, h: number): string {
  const x = w / 2, y = h / 2, c = Math.min(h / 2, w / 4);
  return [[-x + c, -y], [x - c, -y], [x, 0], [x - c, y], [-x + c, y], [-x, 0]].map(([a, b]) => `${round(a)},${round(b)}`).join(' ');
}

export type Direction = 'left' | 'right' | 'up' | 'down';

/**
 * The nearest node from `fromId` in a direction, by layout coordinates. A candidate must lie in the
 * direction's half-plane; the score is distance along the axis plus twice the off-axis distance, so a
 * node roughly straight ahead beats a closer one off to the side.
 */
export function nearestInDirection(nodes: LayoutNode[], fromId: string, dir: Direction): LayoutNode | undefined {
  const from = nodes.find((n) => n.id === fromId);
  if (!from) return undefined;
  let best: LayoutNode | undefined;
  let bestScore = Infinity;
  for (const n of nodes) {
    if (n.id === fromId) continue;
    const dx = n.x - from.x, dy = n.y - from.y;
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 0) continue;
    const score = along + 2 * across;
    if (score < bestScore) { bestScore = score; best = n; }
  }
  return best;
}

function round(n: number): number { return Math.round(n * 100) / 100; }
