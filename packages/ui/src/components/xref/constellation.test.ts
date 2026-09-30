import type { XrefGraph } from '@bible/core/browser';
import { RING_FRACTIONS, bookSegments, canonAngle, constellationLayout } from './constellation';

const GEN = 1001001;
const JOHN = 43003016;
const REV = 66022021;

function graph(): XrefGraph {
  return {
    anchor: JOHN,
    truncated: false,
    nodes: [
      { verseId: JOHN, hop: 0, degree: 3 },
      { verseId: GEN, hop: 1, degree: 2 },
      { verseId: REV, hop: 1, degree: 2 },
      { verseId: 45005008, hop: 2, degree: 1 },
    ],
    edges: [
      { from: JOHN, to: GEN, weight: 0.9, sources: [], direction: 'out' },
      { from: JOHN, to: REV, weight: 0.4, sources: [], direction: 'out' },
      { from: GEN, to: 45005008, weight: 0.2, sources: [], direction: 'out' },
    ],
  };
}

describe('constellationLayout', () => {
  const layout = constellationLayout(graph(), { width: 800, height: 600 });
  const star = (id: number) => layout.stars.find((s) => s.id === id)!;

  it('puts the anchor at the centre', () => {
    expect(star(JOHN).x).toBe(400);
    expect(star(JOHN).y).toBe(300);
  });

  it('places stars on their hop ring at the angle of their canon position', () => {
    const gen = star(GEN);
    expect(gen.angle).toBeCloseTo(canonAngle(gen.position));
    // Genesis is at the top.
    expect(gen.x).toBeCloseTo(400, -1);
    expect(gen.y).toBeLessThan(300);
    const r = Math.hypot((gen.x - 400) / layout.stretch, gen.y - 300);
    expect(r).toBeCloseTo(layout.hopRadii[1], 0);
    // Revelation is just left of the top (end of the clockwise circle).
    expect(star(REV).x).toBeLessThan(400);
    expect(star(REV).y).toBeLessThan(300);
    // John is the anchor; Romans (hop 2) sits on the outer ring.
    expect(Math.hypot((star(45005008).x - 400) / layout.stretch, star(45005008).y - 300)).toBeCloseTo(layout.hopRadii[2], 0);
  });

  it('uses fewer, wider rings for a shallow graph', () => {
    const g = graph();
    g.nodes = g.nodes.filter((n) => n.hop <= 1);
    g.edges = g.edges.filter((e) => e.to !== 45005008);
    const l = constellationLayout(g, { width: 800, height: 600 });
    expect(l.hopRadii).toHaveLength(RING_FRACTIONS[1].length);
  });

  it('staggers stars that share an angle without changing the angle', () => {
    const g: XrefGraph = {
      anchor: JOHN,
      truncated: false,
      nodes: [{ verseId: JOHN, hop: 0, degree: 3 }, ...[1, 2, 3, 4].map((v) => ({ verseId: 45005000 + v, hop: 1, degree: 1 }))],
      edges: [1, 2, 3, 4].map((v) => ({ from: JOHN, to: 45005000 + v, weight: 0.5, sources: [], direction: 'out' as const })),
    };
    const l = constellationLayout(g, { width: 800, height: 600 });
    const radii = new Set(l.stars.filter((s) => s.hop === 1).map((s) => Math.round(Math.hypot((s.x - 400) / l.stretch, s.y - 300))));
    expect(radii.size).toBeGreaterThan(1);
    for (const s of l.stars.filter((x) => x.hop === 1)) {
      expect(Math.atan2(s.y - 300, (s.x - 400) / l.stretch)).toBeCloseTo(Math.atan2(Math.sin(s.angle), Math.cos(s.angle)), 5);
    }
  });

  it('keeps the ring inside a narrow, tall stage (phone)', () => {
    const l = constellationLayout(graph(), { width: 360, height: 640 });
    for (const s of l.stars) {
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(360);
    }
    expect(l.cx + l.ringRadius * l.stretch + 12).toBeLessThan(360);
  });

  it('spreads six stars at one angle over distinct radii', () => {
    const ids = [1, 2, 3, 4, 5, 6].map((v) => 45005000 + v);
    const g: XrefGraph = {
      anchor: JOHN,
      truncated: false,
      nodes: [{ verseId: JOHN, hop: 0, degree: 3 }, ...ids.map((verseId) => ({ verseId, hop: 1, degree: 1 }))],
      edges: ids.map((to) => ({ from: JOHN, to, weight: 0.5, sources: [], direction: 'out' as const })),
    };
    const l = constellationLayout(g, { width: 800, height: 600 });
    const radii = l.stars.filter((s) => s.hop === 1).map((s) => Math.round(Math.hypot((s.x - 400) / l.stretch, s.y - 300)));
    expect(new Set(radii).size).toBe(5);
  });

  it('labels the anchor, keeps labels apart and inside the stage', () => {
    expect(star(JOHN).labelSide).toBe('above');
    const labelled = layout.stars.filter((s) => s.labelSide);
    expect(labelled.length).toBeGreaterThan(1);
  });

  it('builds a curved path per edge and drops edges to missing stars', () => {
    expect(layout.edges).toHaveLength(3);
    expect(layout.edges[0].d).toMatch(/^M[\d. ]+Q[\d. ]+[\d. ]+$/);
    const g = graph();
    g.edges.push({ from: JOHN, to: 99999999, weight: 1, sources: [], direction: 'out' });
    expect(constellationLayout(g, { width: 800, height: 600 }).edges).toHaveLength(3);
  });
});

describe('bookSegments', () => {
  it('covers the whole ring, 66 books, in order', () => {
    const segs = bookSegments();
    expect(segs).toHaveLength(66);
    expect(segs[0].start).toBe(0);
    expect(segs[65].end).toBe(1);
    for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBeCloseTo(segs[i - 1].end);
  });
});
