/**
 * Chapter-pair index encoding: `[a, b, weightx1000, count] * n` as a Uint32Array, plus a
 * byte form (little-endian) for static files and IPC. Pure.
 */
import type { ChapterArcs } from './types';
import { CHAPTER_COUNT } from './canon';

export const PAIR_STRIDE = 4;

export interface ChapterPair {
  a: number;
  b: number;
  /** Summed link weight x 1000. */
  weight: number;
  count: number;
}

export function packPairs(pairs: ChapterPair[]): Uint32Array {
  const out = new Uint32Array(pairs.length * PAIR_STRIDE);
  pairs.forEach((p, i) => {
    out[i * PAIR_STRIDE] = p.a;
    out[i * PAIR_STRIDE + 1] = p.b;
    out[i * PAIR_STRIDE + 2] = p.weight;
    out[i * PAIR_STRIDE + 3] = p.count;
  });
  return out;
}

export function unpackPairs(packed: Uint32Array): ChapterPair[] {
  const out: ChapterPair[] = [];
  for (let i = 0; i + PAIR_STRIDE <= packed.length; i += PAIR_STRIDE) {
    out.push({ a: packed[i], b: packed[i + 1], weight: packed[i + 2], count: packed[i + 3] });
  }
  return out;
}

/** Pairs at or above `minWeight` (0..1 of the heaviest pair). */
export function filterPairs(arcs: ChapterArcs, minWeight: number): Uint32Array {
  if (minWeight <= 0) return arcs.pairs;
  let max = 0;
  for (let i = 0; i < arcs.pairs.length; i += PAIR_STRIDE) max = Math.max(max, arcs.pairs[i + 2]);
  const floor = minWeight * max;
  const kept: number[] = [];
  for (let i = 0; i < arcs.pairs.length; i += PAIR_STRIDE) {
    if (arcs.pairs[i + 2] >= floor) kept.push(arcs.pairs[i], arcs.pairs[i + 1], arcs.pairs[i + 2], arcs.pairs[i + 3]);
  }
  return Uint32Array.from(kept);
}

/** Little-endian bytes, independent of platform endianness. */
export function uint32ToBytes(values: Uint32Array): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) view.setUint32(i * 4, values[i], true);
  return out;
}

export function bytesToUint32(bytes: Uint8Array): Uint32Array {
  const n = Math.floor(bytes.length / 4);
  const out = new Uint32Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < n; i++) out[i] = view.getUint32(i * 4, true);
  return out;
}

/** Chapter arcs as one byte block: `[chapterTotals (CHAPTER_COUNT), pairs...]`. The fingerprint travels separately. */
export function encodeChapterArcs(arcs: ChapterArcs): Uint8Array {
  const all = new Uint32Array(arcs.chapterTotals.length + arcs.pairs.length);
  all.set(arcs.chapterTotals, 0);
  all.set(arcs.pairs, arcs.chapterTotals.length);
  return uint32ToBytes(all);
}

export function decodeChapterArcs(bytes: Uint8Array, fingerprint: string): ChapterArcs {
  const all = bytesToUint32(bytes);
  if (all.length < CHAPTER_COUNT || (all.length - CHAPTER_COUNT) % PAIR_STRIDE !== 0) {
    throw new Error('Malformed chapter-arc data');
  }
  return {
    chapterCount: CHAPTER_COUNT,
    chapterTotals: all.slice(0, CHAPTER_COUNT),
    pairs: all.slice(CHAPTER_COUNT),
    fingerprint,
  };
}
