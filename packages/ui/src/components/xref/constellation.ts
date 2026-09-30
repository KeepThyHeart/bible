/**
 * Pure layout for the constellation view (task 0068, wireframe D): the canon as a night sky.
 *
 * The outer ring is the whole canon, Genesis at the top running clockwise. The anchor is the centre star; hop 1
 * sits on an inner ring, hop 2 and 3 on rings beyond it, and every star's ANGLE is its place in the canon
 * (`canonPosition`), so a cluster low left is the Gospels. No physics: the layout is a deterministic function of
 * the graph and the stage size. Stars that would land on top of each other on a ring are staggered along the
 * radius (the angle is never changed, so the angle keeps its meaning).
 */
import { CHAPTER_COUNT, bookFirstChapterIndex, bookOf, canonPosition, sectionIndexOfBook, weightStep } from '@bible/core/browser';
import type { VerseId, XrefGraph } from '@bible/core/browser';
import { nodeRadius } from './webGraph';

export interface StarLayoutOptions {
  width: number;
  height: number;
  /** Stage margin around the canon ring, px. */
  margin?: number;
}

export interface Star {
  id: VerseId;
  endVerseId?: VerseId;
  hop: number;
  degree: number;
  /** Best edge weight (0..1) joining this star to the graph; 1 for the anchor. */
  weight: number;
  /** 1..5 display step of `weight`. */
  step: number;
  /** Position along the canon, 0..1. */
  position: number;
  /** Radians, -PI/2 (top) clockwise. */
  angle: number;
  x: number;
  y: number;
  radius: number;
  /** Where its label sits relative to the star: `end` means the text ends at the star (left side). */
  labelSide: 'start' | 'end' | 'above' | null;
}

export interface StarEdge {
  key: string;
  from: VerseId;
  to: VerseId;
  weight: number;
  step: number;
  /** SVG path: a curve bent toward the centre, as in the wireframe. */
  d: string;
}

export interface StarLayout {
  cx: number;
  cy: number;
  /** Radius of the canon ring. */
  ringRadius: number;
  /** Radius of each hop ring (index = hop, 0 unused). */
  hopRadii: number[];
  stars: Star[];
  edges: StarEdge[];
}

const TAU = Math.PI * 2;
export const RING_FRACTIONS: Record<number, number[]> = {
  1: [0, 0.7],
  2: [0, 0.5, 0.8],
  3: [0, 0.38, 0.64, 0.88],
};
const STAGGER_LEVELS = 3;
const MAX_LABELS = 16;

/** Angle in radians for a canon position: 0 at the top, clockwise. */
export function canonAngle(position: number): number {
  return -Math.PI / 2 + position * TAU;
}

export interface BookSegment {
  book: number;
  start: number;
  end: number;
  section: number;
}

/** One arc of the canon ring per book, as canon positions 0..1. */
export function bookSegments(): BookSegment[] {
  const out: BookSegment[] = [];
  for (let b = 1; b <= 66; b++) {
    const first = bookFirstChapterIndex(b);
    const next = b === 66 ? CHAPTER_COUNT : bookFirstChapterIndex(b + 1);
    out.push({ book: b, start: first / CHAPTER_COUNT, end: next / CHAPTER_COUNT, section: sectionIndexOfBook(b) });
  }
  return out;
}

/** Rough text width for label collision tests (px at the 11px label size). */
const labelWidth = (chars: number) => chars * 6.4 + 4;

interface Box { x0: number; y0: number; x1: number; y1: number }
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/**
 * Lay the ego graph out. `labelOf` gives the text each star would carry (used only to size label boxes).
 */
export function constellationLayout(
  graph: XrefGraph,
  { width, height, margin = 40 }: StarLayoutOptions,
  labelOf: (id: VerseId, end?: VerseId) => string = (id) => String(id),
): StarLayout {
  const cx = width / 2;
  const cy = height / 2;
  const ringRadius = Math.max(60, Math.min(width, height) / 2 - margin);
  const maxHop = Math.min(3, Math.max(1, ...graph.nodes.map((n) => n.hop)));
  const fractions = RING_FRACTIONS[maxHop];
  const hopRadii = fractions.map((f) => f * ringRadius);

  // Best weight per verse: the strongest edge it shares with the graph.
  const best = new Map<VerseId, number>();
  for (const e of graph.edges) {
    best.set(e.from, Math.max(best.get(e.from) ?? 0, e.weight));
    best.set(e.to, Math.max(best.get(e.to) ?? 0, e.weight));
  }

  const stars: Star[] = graph.nodes.map((n) => {
    const position = canonPosition(n.verseId);
    const weight = n.hop === 0 ? 1 : best.get(n.verseId) ?? 0;
    return {
      id: n.verseId,
      endVerseId: n.endVerseId,
      hop: n.hop,
      degree: n.degree,
      weight,
      step: weightStep(weight),
      position,
      angle: canonAngle(position),
      x: cx,
      y: cy,
      radius: Math.max(3.5, nodeRadius(n.degree, n.hop) * (n.hop === 0 ? 0.9 : 0.62)),
      labelSide: null,
    };
  });

  // Stagger stars that share (nearly) an angle on one ring, radially: 0, +step, -step, 0 ...
  for (let hop = 1; hop <= maxHop; hop++) {
    const ring = stars.filter((s) => s.hop === hop).sort((a, b) => a.position - b.position || a.id - b.id);
    const base = hopRadii[Math.min(hop, hopRadii.length - 1)];
    const step = Math.min(14, Math.max(8, ringRadius * 0.045));
    let level = 0;
    let prevAngle = -Infinity;
    for (const s of ring) {
      const minGap = (s.radius * 2 + 3) / Math.max(1, base);
      level = s.angle - prevAngle < minGap ? (level + 1) % STAGGER_LEVELS : 0;
      prevAngle = s.angle;
      const r = base + [0, 1, -1][level] * step;
      s.x = cx + Math.cos(s.angle) * r;
      s.y = cy + Math.sin(s.angle) * r;
    }
  }

  // Labels: the anchor, then the strongest stars first, each only if its box is free.
  const placed: Box[] = [];
  const box = (s: Star, side: 'start' | 'end' | 'above', text: string): Box => {
    const w = labelWidth(text.length);
    if (side === 'above') return { x0: s.x - w / 2, x1: s.x + w / 2, y0: s.y - s.radius - 16, y1: s.y - s.radius - 3 };
    const x0 = side === 'start' ? s.x + s.radius + 4 : s.x - s.radius - 4 - w;
    return { x0, x1: x0 + w, y0: s.y - 7, y1: s.y + 7 };
  };
  const order = [...stars].sort((a, b) => (a.hop === 0 ? -1 : b.hop === 0 ? 1 : b.weight - a.weight || a.id - b.id));
  let labelled = 0;
  for (const s of order) {
    if (labelled >= MAX_LABELS) break;
    const text = labelOf(s.id, s.endVerseId);
    const preferred: Array<'start' | 'end' | 'above'> = s.hop === 0
      ? ['above']
      : Math.cos(s.angle) >= 0 ? ['start', 'end'] : ['end', 'start'];
    for (const side of preferred) {
      const b = box(s, side, text);
      if (b.x0 < 2 || b.x1 > width - 2 || b.y0 < 2 || b.y1 > height - 2) continue;
      if (placed.some((p) => overlaps(p, b))) continue;
      placed.push(b);
      s.labelSide = side;
      labelled += 1;
      break;
    }
  }

  const at = new Map(stars.map((s) => [s.id, s]));
  const edges: StarEdge[] = [];
  const seen = new Set<string>();
  for (const e of graph.edges) {
    const a = at.get(e.from);
    const b = at.get(e.to);
    if (!a || !b || a === b) continue;
    const key = `${e.from}>${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const qx = mx + (cx - mx) * 0.35;
    const qy = my + (cy - my) * 0.35;
    edges.push({
      key,
      from: e.from,
      to: e.to,
      weight: e.weight,
      step: weightStep(e.weight),
      d: `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`,
    });
  }
  return { cx, cy, ringRadius, hopRadii, stars, edges };
}

/** Book the star belongs to (for colours and the accessible name). */
export const starBook = (s: Pick<Star, 'id'>) => bookOf(s.id);
