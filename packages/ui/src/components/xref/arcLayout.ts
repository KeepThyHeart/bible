/**
 * Pure layout logic for the canon arcs view (task 0068): chapter index <-> x, hit testing, bucketing packed chapter
 * pairs by weight, arc geometry, filtering, partner ranking and tick heights. No DOM, no React.
 *
 * Packed pairs are `[a, b, weightx1000, count] * n` (a < b, chapter indexes 0..1188), as in `ChapterArcs.pairs`.
 */
import { CHAPTER_COUNT, chapterFromIndex, bookFirstChapterIndex, sectionIndexOfBook } from '@bible/core/browser';

export const PAIR_STRIDE = 4;
export const BOOK_COUNT = 66;
export const SECTION_COUNT = 10;
/** Upper bound on arcs drawn by default, so the picture does not become a grey smear. */
export const DEFAULT_MAX_ARCS = 20000;
/** Number of weight buckets (alpha/width levels). */
export const WEIGHT_LEVELS = 4;

// ---------------------------------------------------------------- x <-> chapter

/** Centre x of a chapter across `width` pixels. */
export function chapterToX(index: number, width: number): number {
  return ((index + 0.5) / CHAPTER_COUNT) * width;
}

/** Chapter under x (clamped to the ends), or -1 when the width is not positive. */
export function xToChapter(x: number, width: number): number {
  if (!(width > 0)) return -1;
  const i = Math.floor((x / width) * CHAPTER_COUNT);
  return Math.min(CHAPTER_COUNT - 1, Math.max(0, i));
}

export interface BookSegment {
  book: number;
  firstChapter: number;
  chapterCount: number;
  x0: number;
  x1: number;
}

export function bookSegments(width: number): BookSegment[] {
  const out: BookSegment[] = [];
  for (let b = 1; b <= BOOK_COUNT; b++) {
    const first = bookFirstChapterIndex(b);
    const next = b === BOOK_COUNT ? CHAPTER_COUNT : bookFirstChapterIndex(b + 1);
    out.push({ book: b, firstChapter: first, chapterCount: next - first, x0: (first / CHAPTER_COUNT) * width, x1: (next / CHAPTER_COUNT) * width });
  }
  return out;
}

export function bookOfIndex(index: number): number {
  return chapterFromIndex(index).book;
}

export function sectionOfIndex(index: number): number {
  return sectionIndexOfBook(bookOfIndex(index));
}

/** Table chapter index -> section index, computed once. */
let SECTION_TABLE: Uint8Array | null = null;
export function sectionTable(): Uint8Array {
  if (!SECTION_TABLE) {
    const t = new Uint8Array(CHAPTER_COUNT);
    for (let b = 1; b <= BOOK_COUNT; b++) {
      const first = bookFirstChapterIndex(b);
      const next = b === BOOK_COUNT ? CHAPTER_COUNT : bookFirstChapterIndex(b + 1);
      t.fill(sectionIndexOfBook(b), first, next);
    }
    SECTION_TABLE = t;
  }
  return SECTION_TABLE;
}

/** Chapter index to jump to for PageUp/PageDown: the start of the next book, or of this (or the previous) book. */
export function jumpBook(index: number, dir: 1 | -1): number {
  const book = bookOfIndex(index);
  const first = bookFirstChapterIndex(book);
  if (dir === 1) return book >= BOOK_COUNT ? CHAPTER_COUNT - 1 : bookFirstChapterIndex(book + 1);
  if (index > first) return first;
  return book <= 1 ? 0 : bookFirstChapterIndex(book - 1);
}

// ---------------------------------------------------------------- weights, floor, filtering

export function maxPairWeight(pairs: Uint32Array): number {
  let max = 0;
  for (let i = 0; i + PAIR_STRIDE <= pairs.length; i += PAIR_STRIDE) if (pairs[i + 2] > max) max = pairs[i + 2];
  return max;
}

/** Smallest weight floor (x1000) that leaves at most `maxArcs` pairs; 0 when everything fits. */
export function defaultWeightFloor(pairs: Uint32Array, maxArcs = DEFAULT_MAX_ARCS): number {
  const n = Math.floor(pairs.length / PAIR_STRIDE);
  if (n <= maxArcs) return 0;
  const w = new Uint32Array(n);
  for (let i = 0; i < n; i++) w[i] = pairs[i * PAIR_STRIDE + 2];
  w.sort();
  // ascending: the maxArcs+1 heaviest start at n-maxArcs-1; drop everything up to and including the weight just outside.
  return w[n - maxArcs - 1] + 1;
}

/** Slider value 0..1000 <-> weight floor. Quadratic, so the light end of the range has resolution. */
export function floorFromSlider(value: number, maxWeight: number): number {
  const t = Math.min(1, Math.max(0, value / 1000));
  return Math.round(t * t * maxWeight);
}
export function sliderFromFloor(floor: number, maxWeight: number): number {
  if (maxWeight <= 0) return 0;
  return Math.round(Math.sqrt(Math.min(1, Math.max(0, floor / maxWeight))) * 1000);
}

export interface ArcFilter {
  /** Only arcs touching a chapter of this book (1..66). */
  book?: number | null;
  /** Only arcs touching this chapter index. Ignores the floor. */
  chapter?: number | null;
  /** Per section on/off; an arc is kept only when both endpoints are in enabled sections. */
  sections?: readonly boolean[];
  /** Explicit floor (x1000). Absent: {@link defaultWeightFloor} over the arcs left by the other filters. */
  floor?: number | null;
  maxArcs?: number;
}

export interface FilteredArcs {
  pairs: Uint32Array;
  /** The floor that was applied. */
  floor: number;
}

export function filterArcs(pairs: Uint32Array, f: ArcFilter = {}): FilteredArcs {
  const sect = sectionTable();
  const first = f.book ? bookFirstChapterIndex(f.book) : 0;
  const last = f.book ? (f.book === BOOK_COUNT ? CHAPTER_COUNT : bookFirstChapterIndex(f.book + 1)) : CHAPTER_COUNT;
  const chapter = f.chapter ?? -1;
  const sections = f.sections && f.sections.some(s => !s) ? f.sections : null;
  const kept: number[] = [];
  for (let i = 0; i + PAIR_STRIDE <= pairs.length; i += PAIR_STRIDE) {
    const a = pairs[i];
    const b = pairs[i + 1];
    if (f.book && !((a >= first && a < last) || (b >= first && b < last))) continue;
    if (chapter >= 0 && a !== chapter && b !== chapter) continue;
    if (sections && (!sections[sect[a]] || !sections[sect[b]])) continue;
    kept.push(a, b, pairs[i + 2], pairs[i + 3]);
  }
  const subset = Uint32Array.from(kept);
  const floor = chapter >= 0 ? 0 : f.floor ?? defaultWeightFloor(subset, f.maxArcs ?? DEFAULT_MAX_ARCS);
  if (floor <= 0) return { pairs: subset, floor: 0 };
  const out: number[] = [];
  for (let i = 0; i + PAIR_STRIDE <= subset.length; i += PAIR_STRIDE) {
    if (subset[i + 2] >= floor) out.push(subset[i], subset[i + 1], subset[i + 2], subset[i + 3]);
  }
  return { pairs: Uint32Array.from(out), floor };
}

// ---------------------------------------------------------------- bucketing

export interface ArcBucket {
  /** Section of the lower-index endpoint. */
  section: number;
  /** 0 (lightest) .. levels-1 (heaviest). */
  level: number;
  /** Packed `[a, b] * n`. */
  ends: Uint32Array;
}

/** Weight level 0..levels-1, sqrt scaled against the heaviest pair. */
export function weightLevel(weight: number, maxWeight: number, levels = WEIGHT_LEVELS): number {
  if (maxWeight <= 0) return 0;
  return Math.min(levels - 1, Math.floor(Math.sqrt(Math.min(1, weight / maxWeight)) * levels));
}

/** Group pairs by (section of the lower endpoint, weight level). Every arc lands in exactly one bucket. */
export function bucketArcs(pairs: Uint32Array, maxWeight: number, levels = WEIGHT_LEVELS): ArcBucket[] {
  const sect = sectionTable();
  const lists: number[][] = Array.from({ length: SECTION_COUNT * levels }, () => []);
  for (let i = 0; i + PAIR_STRIDE <= pairs.length; i += PAIR_STRIDE) {
    const a = pairs[i];
    const b = pairs[i + 1];
    const lo = a < b ? a : b;
    lists[sect[lo] * levels + weightLevel(pairs[i + 2], maxWeight, levels)].push(a, b);
  }
  const out: ArcBucket[] = [];
  for (let s = 0; s < SECTION_COUNT; s++) {
    for (let l = 0; l < levels; l++) {
      const list = lists[s * levels + l];
      if (list.length) out.push({ section: s, level: l, ends: Uint32Array.from(list) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- geometry

export interface ArcGeometry {
  x1: number;
  x2: number;
  /** Quadratic control point. */
  cx: number;
  cy: number;
  /** Height of the curve's apex above the baseline. */
  peak: number;
}

/** Arc between two chapters over `width`, rising from `baseY` at most `maxHeight`; height proportional to span. */
export function arcGeometry(a: number, b: number, width: number, baseY: number, maxHeight: number): ArcGeometry {
  const x1 = chapterToX(Math.min(a, b), width);
  const x2 = chapterToX(Math.max(a, b), width);
  const span = x2 - x1;
  const peak = Math.max(1, Math.min(maxHeight, span * 0.5));
  // a quadratic bezier peaks at half the control point's offset
  return { x1, x2, cx: (x1 + x2) / 2, cy: baseY - 2 * peak, peak };
}

// ---------------------------------------------------------------- partners

export interface PartnerIndex {
  offsets: Uint32Array;
  partner: Uint32Array;
  weight: Uint32Array;
  count: Uint32Array;
}

/** Adjacency (CSR) over all pairs, both directions. */
export function buildPartnerIndex(pairs: Uint32Array, chapterCount = CHAPTER_COUNT): PartnerIndex {
  const offsets = new Uint32Array(chapterCount + 1);
  const n = Math.floor(pairs.length / PAIR_STRIDE);
  for (let i = 0; i < n; i++) {
    offsets[pairs[i * PAIR_STRIDE] + 1]++;
    offsets[pairs[i * PAIR_STRIDE + 1] + 1]++;
  }
  for (let c = 0; c < chapterCount; c++) offsets[c + 1] += offsets[c];
  const cursor = offsets.slice(0, chapterCount);
  const partner = new Uint32Array(n * 2);
  const weight = new Uint32Array(n * 2);
  const count = new Uint32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = pairs[i * PAIR_STRIDE];
    const b = pairs[i * PAIR_STRIDE + 1];
    const w = pairs[i * PAIR_STRIDE + 2];
    const k = pairs[i * PAIR_STRIDE + 3];
    let p = cursor[a]++;
    partner[p] = b; weight[p] = w; count[p] = k;
    p = cursor[b]++;
    partner[p] = a; weight[p] = w; count[p] = k;
  }
  return { offsets, partner, weight, count };
}

export interface Partner {
  chapter: number;
  weight: number;
  count: number;
}

export function connectionCount(index: PartnerIndex, chapter: number): number {
  if (chapter < 0 || chapter + 1 >= index.offsets.length) return 0;
  return index.offsets[chapter + 1] - index.offsets[chapter];
}

/** Partner chapters of `chapter`, heaviest first (ties: more links, then canon order), at most `limit`. */
export function topPartners(index: PartnerIndex, chapter: number, limit = 10): Partner[] {
  if (chapter < 0 || chapter + 1 >= index.offsets.length) return [];
  const out: Partner[] = [];
  for (let p = index.offsets[chapter]; p < index.offsets[chapter + 1]; p++) {
    out.push({ chapter: index.partner[p], weight: index.weight[p], count: index.count[p] });
  }
  out.sort((x, y) => y.weight - x.weight || y.count - x.count || x.chapter - y.chapter);
  return out.slice(0, Math.max(0, limit));
}

/** Most connected chapters by total weight (for the list shown before anything is selected). */
export function topChapters(totals: Uint32Array, limit = 10): number[] {
  const idx: number[] = [];
  for (let i = 0; i < totals.length; i++) if (totals[i] > 0) idx.push(i);
  idx.sort((x, y) => totals[y] - totals[x] || x - y);
  return idx.slice(0, Math.max(0, limit));
}

// ---------------------------------------------------------------- ticks

/** Tick heights in px per chapter: sqrt scaled against the largest total, at least 1 for any linked chapter. */
export function tickHeights(totals: Uint32Array, maxPx: number): Float32Array {
  let max = 0;
  for (let i = 0; i < totals.length; i++) if (totals[i] > max) max = totals[i];
  const out = new Float32Array(totals.length);
  if (max <= 0) return out;
  for (let i = 0; i < totals.length; i++) {
    if (totals[i] > 0) out[i] = Math.max(1, Math.sqrt(totals[i] / max) * maxPx);
  }
  return out;
}
