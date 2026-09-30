/**
 * Whole-canon aggregates for the arc and ring views (task 0068): one pass over every link.
 * Fingerprinted like the study cache so a cache can tell when it is stale.
 */
import type { ICrossReferenceRepository } from '../../Data/Repositories/ICrossReferenceRepository';
import type { AggregationModule } from '../StudyOverview/types';
import { BOOKS, CHAPTER_COUNT, bookOf, chapterIndex } from './canon';
import { baseWeight } from './edgeWeight';
import type { ChapterArcs, XrefGraphIndex, VerseDegrees } from './types';
import { packPairs } from './chapterPairs';
import type { ChapterPair } from './chapterPairs';

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export class XrefGraphIndexBuilder {
  /** Changes when a module is added, removed, upgraded or its link count changes. */
  fingerprint(modules: AggregationModule<ICrossReferenceRepository>[]): string {
    const parts = modules
      .map(m => `${m.abbreviation}|${m.repository.getModuleInfo()?.version ?? ''}|${m.repository.getLinkCount()}`)
      .sort();
    return fnv1a(parts.join(';'));
  }

  build(modules: AggregationModule<ICrossReferenceRepository>[]): XrefGraphIndex {
    const pairs = new Map<number, ChapterPair>();
    const totals = new Uint32Array(CHAPTER_COUNT);
    const books: number[][] = Array.from({ length: BOOKS }, () => new Array<number>(BOOKS).fill(0));
    const degree = new Map<number, [number, number, number]>();
    let linkCount = 0;

    const bump = (verse: number, slot: 0 | 1, w1000: number) => {
      let d = degree.get(verse);
      if (!d) { d = [0, 0, 0]; degree.set(verse, d); }
      d[slot] += 1;
      d[2] += w1000;
    };

    for (const mod of modules) {
      mod.repository.forEachLink(link => {
        linkCount++;
        const w = baseWeight({ source: mod.abbreviation, kind: 'ranked', rank: link.rank });
        const w1000 = Math.round(w * 1000);
        const a = chapterIndex(link.sourceVerseIdStart);
        const b = chapterIndex(link.targetVerseIdStart);
        if (a < 0 || b < 0) return;
        bump(link.sourceVerseIdStart, 0, w1000);
        bump(link.targetVerseIdStart, 1, w1000);
        totals[a] += w1000;
        totals[b] += w1000;
        const bookA = bookOf(link.sourceVerseIdStart) - 1;
        const bookB = bookOf(link.targetVerseIdStart) - 1;
        books[bookA][bookB] += w;
        if (bookA !== bookB) books[bookB][bookA] += w;
        if (a === b) return;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const key = lo * CHAPTER_COUNT + hi;
        const pair = pairs.get(key);
        if (pair) { pair.weight += w1000; pair.count += 1; }
        else pairs.set(key, { a: lo, b: hi, weight: w1000, count: 1 });
      });
    }

    const sorted = [...pairs.values()].sort((x, y) => x.a - y.a || x.b - y.b);
    const fingerprint = this.fingerprint(modules);
    const arcs: ChapterArcs = {
      chapterCount: CHAPTER_COUNT,
      pairs: packPairs(sorted),
      chapterTotals: totals,
      fingerprint,
    };
    const ids = [...degree.keys()].sort((x, y) => x - y);
    const degrees: VerseDegrees = {
      verseIds: Uint32Array.from(ids),
      out: Uint32Array.from(ids, v => degree.get(v)![0]),
      in: Uint32Array.from(ids, v => degree.get(v)![1]),
      weighted: Uint32Array.from(ids, v => degree.get(v)![2]),
    };
    return {
      fingerprint,
      arcs,
      books: books.map(row => row.map(x => Math.round(x * 100) / 100)),
      degrees,
      linkCount,
    };
  }
}
