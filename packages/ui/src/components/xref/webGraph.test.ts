import type { XrefEdge, XrefGraph, XrefNode } from '@bible/core/browser';
import { FOCUS_MAX_ZOOM, MAX_ZOOM, edgeWidth, fitAllView, focusView, labelScale, mergeGraph, zoomAt, neighbourInDirection, nodeRadius, rankedNeighbours, truncateLabel } from './webGraph';
import type { SimNode } from './webGraph';

const A = 1001001;
const B = 1001002;
const C = 1001003;
const D = 2001001;

const node = (verseId: number, hop: number, degree = 3): XrefNode => ({ verseId, hop, degree });
const edge = (from: number, to: number, weight = 0.5, direction: XrefEdge['direction'] = 'out'): XrefEdge =>
  ({ from, to, weight, sources: [], direction });
const graph = (anchor: number, nodes: XrefNode[], edges: XrefEdge[]): XrefGraph => ({ anchor, nodes, edges, truncated: false });

describe('mergeGraph', () => {
  it('keeps object identity and position of persisting nodes, drops vanished ones', () => {
    const first = mergeGraph([], graph(A, [node(A, 0), node(B, 1), node(C, 1)], [edge(A, B), edge(A, C)]));
    const a = first.nodes.find((n) => n.id === A)!;
    a.x = 100; a.y = -40; a.vx = 3; a.fx = 100;
    const second = mergeGraph(first.nodes, graph(A, [node(A, 0, 9), node(B, 1)], [edge(A, B)]));
    expect(second.nodes.map((n) => n.id).sort()).toEqual([A, B]);
    const a2 = second.nodes.find((n) => n.id === A)!;
    expect(a2).toBe(a);
    expect([a2.x, a2.y, a2.vx, a2.fx]).toEqual([100, -40, 3, 100]);
    expect(a2.degree).toBe(9);
    expect(second.links).toHaveLength(1);
  });

  it('spawns a new node near an already placed neighbour', () => {
    const first = mergeGraph([], graph(A, [node(A, 0), node(B, 1)], [edge(A, B)]));
    const b = first.nodes.find((n) => n.id === B)!;
    b.x = 300; b.y = 300;
    const second = mergeGraph(first.nodes, graph(A, [node(A, 0), node(B, 1), node(D, 2)], [edge(A, B), edge(B, D)]));
    const d = second.nodes.find((n) => n.id === D)!;
    expect(Math.hypot(d.x - 300, d.y - 300)).toBeLessThan(40);
  });

  it('spawns near the anchor when no neighbour is placed, and at the origin with nothing', () => {
    const first = mergeGraph([], graph(A, [node(A, 0)], []));
    expect(first.nodes[0]).toMatchObject({ x: 0, y: 0 });
    first.nodes[0].x = 50; first.nodes[0].y = 50;
    const second = mergeGraph(first.nodes, graph(A, [node(A, 0), node(D, 1)], []));
    const d = second.nodes.find((n) => n.id === D)!;
    expect(Math.hypot(d.x - 50, d.y - 50)).toBeLessThan(40);
  });

  it('drops links to missing nodes, self links and duplicates', () => {
    const { links } = mergeGraph([], graph(A, [node(A, 0), node(B, 1)], [edge(A, B), edge(A, B), edge(A, A), edge(A, C)]));
    expect(links).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('radius grows with degree; anchor is larger, far hops smaller', () => {
    expect(nodeRadius(20, 1)).toBeGreaterThan(nodeRadius(1, 1));
    expect(nodeRadius(5, 0)).toBeGreaterThan(nodeRadius(5, 1));
    expect(nodeRadius(5, 2)).toBeLessThan(nodeRadius(5, 1));
    expect(nodeRadius(100000, 1)).toBeLessThanOrEqual(16);
  });

  it('edge width grows with weight step', () => {
    expect(edgeWidth(0.1)).toBeLessThan(edgeWidth(0.5));
    expect(edgeWidth(0.5)).toBeLessThan(edgeWidth(1));
  });

  it('truncates labels', () => {
    expect(truncateLabel('John 3:16')).toBe('John 3:16');
    const t = truncateLabel('1 Thessalonians 4:16-17', 12);
    expect(t.length).toBeLessThanOrEqual(12);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('neighbourInDirection', () => {
  const mk = (id: number, x: number, y: number): SimNode => ({ id, x, y, vx: 0, vy: 0, hop: 1, degree: 1 });
  const nodes = [mk(A, 0, 0), mk(B, 50, 5), mk(C, 200, 0), mk(D, -30, 40)];
  it('picks the nearest in the direction', () => {
    expect(neighbourInDirection(nodes, A, 'right')).toBe(B);
    expect(neighbourInDirection(nodes, A, 'left')).toBe(D);
    expect(neighbourInDirection(nodes, A, 'down')).toBe(D);
    expect(neighbourInDirection(nodes, B, 'right')).toBe(C);
  });
  it('returns undefined when nothing lies that way', () => {
    expect(neighbourInDirection(nodes, A, 'up')).toBeUndefined();
    expect(neighbourInDirection(nodes, C, 'right')).toBeUndefined();
  });
});

describe('rankedNeighbours', () => {
  it('lists the anchor neighbours strongest first with direction from the anchor', () => {
    const g = graph(A, [node(A, 0), node(B, 1), node(C, 1), node(D, 2)], [
      edge(A, B, 0.3, 'out'), edge(C, A, 0.9, 'out'), edge(B, D, 0.99), edge(A, D, 0.5, 'both'),
    ]);
    const r = rankedNeighbours(g);
    expect(r.map((x) => x.verseId)).toEqual([C, D, B]);
    expect(r[0].direction).toBe('in');
    expect(r[1].direction).toBe('both');
    expect(r[2].direction).toBe('out');
  });
});

describe('web camera', () => {
  const mk = (id: number, x: number, y: number, hop: number): SimNode => ({ id, x, y, hop, degree: 3, vx: 0, vy: 0 });

  it('focus view centres on the anchor and zooms in on a small graph', () => {
    const v = focusView([mk(1, 10, 20, 0), mk(2, 60, 20, 1)], 1, 800, 500);
    expect(v.k).toBeGreaterThan(1);
    expect(v.tx).toBeCloseTo(-10 * v.k);
    expect(v.ty).toBeCloseTo(-20 * v.k);
  });

  it('focus view never shrinks below 1 and never exceeds its ceiling', () => {
    expect(focusView([mk(1, 0, 0, 0), mk(2, 2000, 0, 1)], 1, 800, 500).k).toBe(1);
    expect(focusView([mk(1, 0, 0, 0)], 1, 800, 500).k).toBe(FOCUS_MAX_ZOOM);
  });

  it('fit-all zooms out until every node is inside the stage', () => {
    const nodes = [mk(1, -1500, 0, 0), mk(2, 1500, 400, 2)];
    const v = fitAllView(nodes, 800, 500);
    expect(v.k).toBeLessThan(0.4);
    for (const n of nodes) {
      expect(Math.abs(n.x * v.k + v.tx)).toBeLessThan(400);
      expect(Math.abs(n.y * v.k + v.ty)).toBeLessThan(250);
    }
  });

  it('zoomAt keeps the pointer position fixed and clamps', () => {
    const v = zoomAt({ k: 1, tx: 0, ty: 0 }, 2, 100, 50);
    expect(v.k).toBe(2);
    expect(100 * v.k + v.tx).toBeCloseTo(100); // world point 100 stays under the pointer at 100
    expect(zoomAt({ k: 5, tx: 0, ty: 0 }, 10, 0, 0).k).toBe(MAX_ZOOM);
  });

  it('label scale keeps labels between 0.6x and 1.6x on screen', () => {
    expect(labelScale(1)).toBe(1);
    expect(labelScale(0.2) * 0.2).toBeCloseTo(0.6);
    expect(labelScale(4) * 4).toBeCloseTo(1.6);
  });
});
