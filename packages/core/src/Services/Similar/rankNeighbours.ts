/**
 * Similar passages (task 0070): turn aggregated neighbour hits into the final list by applying
 * the adjacency, testament, section, cross-reference and per-book policies. Pure, browser-safe.
 */

import { consolidate, rangesOverlap } from '../Search/Consolidation';
import { bookOf, sectionKeyOfBook } from '../XrefGraph/canon';
import {
  DEFAULT_SIMILAR_OPTIONS,
} from './SimilarTypes';
import type {
  NeighbourHit,
  PassageRange,
  ResolvedSimilarOptions,
  SimilarOptions,
  SimilarPassage,
} from './SimilarTypes';

/** Fill defaults. Undefined values in `o` keep the default. */
export function resolveSimilarOptions(o?: SimilarOptions): ResolvedSimilarOptions {
  const out: Record<string, unknown> = { ...DEFAULT_SIMILAR_OPTIONS };
  if (o) {
    for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  }
  out.levels = [...(out.levels as unknown[])];
  out.sections = [...(out.sections as unknown[])];
  return out as unknown as ResolvedSimilarOptions;
}

/** Book-and-chapter key of a verse id (ids are book*1e6 + chapter*1e3 + verse). */
const chapterKey = (id: number): number => Math.floor(id / 1000);

function chapterKeys(r: PassageRange): number[] {
  const a = chapterKey(r.startVerseId);
  const b = chapterKey(r.endVerseId);
  return a === b ? [a] : [a, b];
}

function sharesChapter(a: PassageRange, b: PassageRange): boolean {
  const bk = chapterKeys(b);
  return chapterKeys(a).some((k) => bk.includes(k));
}

function sharesBook(a: PassageRange, b: PassageRange): boolean {
  const bb = [bookOf(b.startVerseId), bookOf(b.endVerseId)];
  return bb.includes(bookOf(a.startVerseId)) || bb.includes(bookOf(a.endVerseId));
}

/** Verses between the source and a non-overlapping candidate in the same chapter (nearest ends). */
function nearby(source: PassageRange, c: PassageRange, n: number): boolean {
  if (n <= 0) return false;
  let from: number;
  let to: number;
  if (c.endVerseId < source.startVerseId) {
    from = c.endVerseId;
    to = source.startVerseId;
  } else if (c.startVerseId > source.endVerseId) {
    from = source.endVerseId;
    to = c.startVerseId;
  } else {
    return true; // overlap: handled earlier, treat as near
  }
  if (chapterKey(from) !== chapterKey(to)) return false;
  return to - from <= n;
}

const isNT = (id: number): boolean => bookOf(id) >= 40;

export interface RankContext {
  crossRefs: PassageRange[];
  floor: number;
  via: 'table' | 'live';
}

/**
 * Order of work: overlap with the source (which also drops the source's own paragraph), nearby
 * same-chapter verses, same chapter/book, testament, sections; then the floor (max(ctx.floor, top1 * 0.8), or
 * o.minSimilarity), consolidate(), cross-reference policy, per-book cap, maxResults.
 */
export function rankNeighbours(
  source: PassageRange,
  cands: NeighbourHit[],
  o: ResolvedSimilarOptions,
  ctx: RankContext,
): SimilarPassage[] {
  const srcNT = isNT(source.startVerseId);
  let list = cands.filter((c) => {
    if (rangesOverlap(source, c)) return false;
    if (sharesChapter(source, c) && nearby(source, c, o.excludeNearby)) return false;
    if (o.excludeSameChapter && sharesChapter(source, c)) return false;
    if (o.excludeSameBook && sharesBook(source, c)) return false;
    const cNT = isNT(c.startVerseId);
    if (o.testament === 'ot' && cNT) return false;
    if (o.testament === 'nt' && !cNT) return false;
    if (o.testament === 'other' && cNT === srcNT) return false;
    if (o.sections.length > 0 && !o.sections.includes(sectionKeyOfBook(bookOf(c.startVerseId)))) return false;
    return true;
  });
  if (list.length === 0) return [];

  list = [...list].sort((a, b) => b.score - a.score);
  const top1 = list[0].score;
  const floor = o.minSimilarity ?? Math.max(ctx.floor, top1 * 0.8);
  list = list.filter((c) => c.score >= floor);

  // Order by the value emitted as `similarity` (consolidation orders by its boosted score).
  const merged = [...consolidate(list, Number.MAX_SAFE_INTEGER)].sort((a, b) => b.score - a.score);
  const out: SimilarPassage[] = [];
  const perBook = new Map<number, number>();
  for (const c of merged) {
    const isXref = ctx.crossRefs.some((x) => rangesOverlap(x, c));
    if (isXref && o.crossRefs === 'hide') continue;
    if (o.perBookCap > 0) {
      const b = bookOf(c.startVerseId);
      const n = perBook.get(b) ?? 0;
      if (n >= o.perBookCap) continue;
      perBook.set(b, n + 1);
    }
    out.push({
      startVerseId: c.startVerseId,
      endVerseId: c.endVerseId,
      level: c.level as SimilarPassage['level'],
      similarity: c.score,
      isCrossReference: o.crossRefs === 'ignore' ? false : isXref,
      crossesTestament: isNT(c.startVerseId) !== srcNT,
      via: ctx.via,
    });
    if (out.length >= o.maxResults) break;
  }
  return out;
}

