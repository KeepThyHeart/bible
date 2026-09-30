import { CHAPTER_COUNT, bookFirstChapterIndex } from '@bible/core/browser';
import {
  chapterToX, xToChapter, bookSegments, jumpBook, defaultWeightFloor, filterArcs, bucketArcs, arcGeometry,
  buildPartnerIndex, topPartners, connectionCount, topChapters, tickHeights, floorFromSlider, sliderFromFloor,
  maxPairWeight, sectionOfIndex, WEIGHT_LEVELS, DEFAULT_MAX_ARCS,
} from './arcLayout';

const pack = (rows: number[][]) => Uint32Array.from(rows.flat());
const GEN = bookFirstChapterIndex(1);
const PSALMS = bookFirstChapterIndex(19);
const JOHN = bookFirstChapterIndex(43);
const REV = bookFirstChapterIndex(66);

const sample = pack([
  [GEN, JOHN, 900, 5],
  [GEN + 1, JOHN, 500, 3],
  [PSALMS, JOHN + 2, 300, 2],
  [PSALMS + 1, REV, 100, 1],
  [JOHN, REV, 700, 4],
]);

describe('x <-> chapter', () => {
  it('round trips every chapter through its centre', () => {
    for (const w of [640, 1189, 2000]) {
      for (let i = 0; i < CHAPTER_COUNT; i++) expect(xToChapter(chapterToX(i, w), w)).toBe(i);
    }
  });
  it('hit tests both ends and clamps outside', () => {
    expect(xToChapter(0, 800)).toBe(0);
    expect(xToChapter(-20, 800)).toBe(0);
    expect(xToChapter(799.9, 800)).toBe(CHAPTER_COUNT - 1);
    expect(xToChapter(5000, 800)).toBe(CHAPTER_COUNT - 1);
    expect(xToChapter(10, 0)).toBe(-1);
  });
  it('book segments tile the width', () => {
    const segs = bookSegments(1000);
    expect(segs).toHaveLength(66);
    expect(segs[0].x0).toBe(0);
    expect(segs[65].x1).toBeCloseTo(1000);
    for (let i = 1; i < segs.length; i++) expect(segs[i].x0).toBeCloseTo(segs[i - 1].x1);
    expect(segs[0].chapterCount).toBe(50);
  });
  it('jumps between books', () => {
    expect(jumpBook(GEN + 3, 1)).toBe(bookFirstChapterIndex(2));
    expect(jumpBook(GEN + 3, -1)).toBe(GEN);
    expect(jumpBook(GEN, -1)).toBe(0);
    expect(jumpBook(bookFirstChapterIndex(2), -1)).toBe(GEN);
    expect(jumpBook(REV + 2, 1)).toBe(CHAPTER_COUNT - 1);
  });
});

describe('floor and filters', () => {
  it('keeps everything under the cap', () => {
    expect(defaultWeightFloor(sample, 10)).toBe(0);
  });
  it('limits the arc count for a 100k pair input', () => {
    const rows: number[] = [];
    for (let i = 0; i < 100000; i++) rows.push(i % 1000, 1000 + (i % 188), 1 + ((i * 7919) % 5000), 1);
    const pairs = Uint32Array.from(rows);
    const floor = defaultWeightFloor(pairs);
    expect(floor).toBeGreaterThan(0);
    const { pairs: kept } = filterArcs(pairs);
    expect(kept.length / 4).toBeLessThanOrEqual(DEFAULT_MAX_ARCS);
    expect(kept.length / 4).toBeGreaterThan(DEFAULT_MAX_ARCS / 2);
  });
  it('handles ties at the cap', () => {
    const rows: number[] = [];
    for (let i = 0; i < 50; i++) rows.push(i, i + 100, 7, 1);
    expect(filterArcs(Uint32Array.from(rows), { maxArcs: 10 }).pairs.length / 4).toBeLessThanOrEqual(10);
  });
  it('filters by chapter, ignoring the floor', () => {
    const r = filterArcs(sample, { chapter: JOHN, floor: 800 });
    expect(r.pairs.length / 4).toBe(3);
  });
  it('filters by book (either end)', () => {
    const r = filterArcs(sample, { book: 43, floor: 0 });
    expect(r.pairs.length / 4).toBe(4);
    expect(filterArcs(sample, { book: 19, floor: 0 }).pairs.length / 4).toBe(2);
  });
  it('applies an explicit floor and section toggles', () => {
    expect(filterArcs(sample, { floor: 500 }).pairs.length / 4).toBe(3);
    const off = Array(10).fill(true);
    off[sectionOfIndex(REV)] = false;
    expect(filterArcs(sample, { sections: off, floor: 0 }).pairs.length / 4).toBe(3);
  });
  it('maps the slider both ways', () => {
    expect(floorFromSlider(0, 900)).toBe(0);
    expect(floorFromSlider(1000, 900)).toBe(900);
    expect(floorFromSlider(sliderFromFloor(225, 900), 900)).toBeGreaterThan(215);
    expect(maxPairWeight(sample)).toBe(900);
  });
});

describe('bucketing', () => {
  it('keeps every arc exactly once, coloured by the lower endpoint section', () => {
    const buckets = bucketArcs(sample, 900);
    const total = buckets.reduce((n, b) => n + b.ends.length / 2, 0);
    expect(total).toBe(5);
    for (const b of buckets) {
      expect(b.level).toBeGreaterThanOrEqual(0);
      expect(b.level).toBeLessThan(WEIGHT_LEVELS);
      for (let i = 0; i < b.ends.length; i += 2) expect(sectionOfIndex(Math.min(b.ends[i], b.ends[i + 1]))).toBe(b.section);
    }
    const gen = buckets.filter(b => b.section === sectionOfIndex(GEN));
    expect(gen.reduce((n, b) => n + b.ends.length / 2, 0)).toBe(2);
  });
  it('puts heavier arcs in higher levels', () => {
    const [heavy] = bucketArcs(pack([[1, 2, 1000, 1]]), 1000);
    const [light] = bucketArcs(pack([[1, 2, 10, 1]]), 1000);
    expect(heavy.level).toBeGreaterThan(light.level);
  });
});

describe('geometry', () => {
  it('scales with span and is clamped', () => {
    const near = arcGeometry(10, 20, 1189, 200, 150);
    const far = arcGeometry(10, 900, 1189, 200, 150);
    expect(far.peak).toBeGreaterThan(near.peak);
    expect(far.peak).toBe(150);
    expect(far.cy).toBe(200 - 300);
    expect(arcGeometry(20, 10, 1189, 200, 150).x1).toBe(near.x1);
    expect(near.cx).toBeCloseTo((near.x1 + near.x2) / 2);
  });
});

describe('partners', () => {
  const idx = buildPartnerIndex(sample);
  it('counts connections and ranks by weight', () => {
    expect(connectionCount(idx, JOHN)).toBe(3);
    expect(connectionCount(idx, 5)).toBe(0);
    expect(topPartners(idx, JOHN).map(p => p.chapter)).toEqual([GEN, REV, GEN + 1]);
  });
  it('honours the limit', () => {
    expect(topPartners(idx, JOHN, 2)).toHaveLength(2);
    expect(topPartners(idx, JOHN, 0)).toEqual([]);
    expect(topPartners(idx, -1)).toEqual([]);
  });
  it('ranks the most connected chapters', () => {
    const totals = new Uint32Array(CHAPTER_COUNT);
    totals[5] = 10; totals[9] = 40; totals[2] = 40;
    expect(topChapters(totals, 2)).toEqual([2, 9]);
  });
});

describe('ticks', () => {
  it('scales heights', () => {
    const totals = new Uint32Array([0, 100, 25, 1]);
    const h = tickHeights(totals, 20);
    expect(h[0]).toBe(0);
    expect(h[1]).toBeCloseTo(20);
    expect(h[2]).toBeCloseTo(10);
    expect(h[3]).toBeGreaterThanOrEqual(1);
  });
});
