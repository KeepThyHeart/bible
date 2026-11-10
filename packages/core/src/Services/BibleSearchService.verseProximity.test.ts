import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BibleSearchService } from './BibleSearchService';
import { KJVTestHelper } from '../__tests__/helpers/KJVTestHelper';
import { VerseId, VerseIdHelper } from '../Data/Core/Types';
import { IBibleBookRepository } from '../Data/Repositories/IBibleBookRepository';

/**
 * W-003: verse-proximity search (`a b ~Nv`) compared every first-term verse
 * with every verse of every other term - O(n^2) over up to 10,000 hits a term,
 * synchronously, so `the and of ~3v` held the event loop for ~8 s on the KJV.
 * The constellation step now looks neighbours up in per-book sorted arrays.
 * These tests pin that it finds exactly what the old pairwise scan found.
 */

/** Small deterministic PRNG, so a failure reproduces. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Chapter -> verse count per book. Book 3 has no chapter info at all (the old code's Infinity fallback). */
const CHAPTERS: Record<number, number[]> = {
  1: [31, 25, 24, 26, 32, 22, 24, 22, 29, 32],
  2: [5, 1, 3, 40, 2],
  3: [],
  4: [12, 12, 12],
};

const fakeBookRepo = {
  getChapterInfoByBookNumber: (book: number) =>
    (CHAPTERS[book] ?? []).map((verseCount, i) => ({ chapter: i + 1, verseCount })),
} as unknown as IBibleBookRepository;

// The pre-W-003 code, kept verbatim (bar `this`) as the reference: the
// service's countVersesBetween / isWithinVerseDistance and the pairwise scan.
function countVersesBetween(verseId1: VerseId, verseId2: VerseId): number {
  const v1 = VerseIdHelper.parse(verseId1);
  const v2 = VerseIdHelper.parse(verseId2);
  if (v1.bookNumber !== v2.bookNumber) return Infinity;
  if (v1.chapter === v2.chapter) return Math.abs(v1.verse - v2.verse);
  const [first, second] = v1.chapter < v2.chapter ? [v1, v2] : [v2, v1];
  const list = fakeBookRepo.getChapterInfoByBookNumber(first.bookNumber);
  if (list.length === 0) return Infinity;
  const chapterMap = new Map<number, number>(list.map(i => [i.chapter, i.verseCount]));
  let distance = 0;
  distance += (chapterMap.get(first.chapter) ?? 0) - first.verse;
  for (let ch = first.chapter + 1; ch < second.chapter; ch++) distance += chapterMap.get(ch) ?? 0;
  distance += second.verse;
  return distance;
}

function isWithinVerseDistance(verseId1: VerseId, verseId2: VerseId, maxDistance: number): boolean {
  const a = VerseIdHelper.parse(verseId1);
  const b = VerseIdHelper.parse(verseId2);
  if (a.bookNumber !== b.bookNumber) return false;
  if (Math.abs(a.chapter - b.chapter) > maxDistance) return false;
  return countVersesBetween(verseId1, verseId2) <= maxDistance;
}

function oldMatches(_service: unknown, sets: Set<VerseId>[], distance: number): Set<VerseId> {
  const matching = new Set<VerseId>();
  for (const base of sets[0]) {
    let all = true;
    for (let i = 1; i < sets.length; i++) {
      if (!Array.from(sets[i]).some(o => isWithinVerseDistance(base, o, distance))) {
        all = false;
        break;
      }
    }
    if (all) {
      matching.add(base);
      for (const s of sets) {
        for (const v of s) {
          if (isWithinVerseDistance(base, v, distance)) matching.add(v);
        }
      }
    }
  }
  return matching;
}

function randomSet(next: () => number, size: number): Set<VerseId> {
  const out = new Set<VerseId>();
  const books = Object.keys(CHAPTERS).map(Number);
  for (let i = 0; i < size; i++) {
    const book = books[Math.floor(next() * books.length)];
    const counts = CHAPTERS[book].length > 0 ? CHAPTERS[book] : [20, 20, 20];
    const chapter = 1 + Math.floor(next() * counts.length);
    const verse = 1 + Math.floor(next() * counts[chapter - 1]);
    out.add(VerseIdHelper.calculate(book, chapter, verse));
  }
  return out;
}

const sorted = (s: Set<VerseId>) => Array.from(s).sort((a, b) => a - b);

describe('BibleSearchService verse proximity (W-003)', () => {
  it('matches the old pairwise scan on random fixtures', () => {
    const service = new BibleSearchService(new Map(), fakeBookRepo) as any;
    const next = rng(20261104);
    for (let round = 0; round < 300; round++) {
      const termCount = 2 + Math.floor(next() * 3);
      const sets = Array.from({ length: termCount }, () => randomSet(next, 1 + Math.floor(next() * 40)));
      const distance = Math.floor(next() * 45);
      const expected = sorted(oldMatches(service, sets, distance));
      const actual = sorted(service.findVerseProximityMatches(sets, distance));
      expect(actual, `round ${round}, distance ${distance}`).toEqual(expected);
    }
  });

  it('handles one term, empty terms and the same set passed twice', () => {
    const service = new BibleSearchService(new Map(), fakeBookRepo) as any;
    const a = new Set<VerseId>([VerseIdHelper.calculate(1, 1, 1), VerseIdHelper.calculate(1, 2, 1)]);
    expect(sorted(service.findVerseProximityMatches([a], 3))).toEqual(sorted(oldMatches(service, [a], 3)));
    expect(sorted(service.findVerseProximityMatches([a, new Set()], 3))).toEqual([]);
    expect(sorted(service.findVerseProximityMatches([a, a], 0))).toEqual(sorted(a));
    // Across a chapter boundary: Gen 1:31 and Gen 2:1 are one verse apart.
    const b = new Set<VerseId>([VerseIdHelper.calculate(1, 2, 2)]);
    expect(sorted(service.findVerseProximityMatches([a, b], 1))).toEqual(sorted(oldMatches(service, [a, b], 1)));
  });
});

const KJV_AVAILABLE = KJVTestHelper.isAvailable();

describe.skipIf(!KJV_AVAILABLE)('BibleSearchService verse proximity on the KJV (W-003)', () => {
  let searchService: BibleSearchService;

  beforeAll(() => {
    KJVTestHelper.initialize();
    const modules = new Map();
    modules.set('kjv', KJVTestHelper.getKJVRepository());
    searchService = new BibleSearchService(modules, KJVTestHelper.getBibleBookRepository());
  });

  afterAll(() => {
    KJVTestHelper.cleanup();
  });

  it('answers a three-common-word query quickly', async () => {
    const t = performance.now();
    const results = await searchService.search('the and of ~3v', { modules: ['kjv'], maxResults: 200 });
    const ms = performance.now() - t;
    console.log(`[W-003] "the and of ~3v": ${results.length} results in ${ms.toFixed(0)} ms`);
    expect(results.length).toBeGreaterThan(0);
    // Was ~8 s; the bound leaves room for a busy machine.
    expect(ms).toBeLessThan(4000);
  });

  it('still finds ordinary constellations', async () => {
    const t = performance.now();
    const results = await searchService.search('faith hope ~5v', { modules: ['kjv'], maxResults: 500 });
    console.log(`[W-003] "faith hope ~5v": ${results.length} results in ${(performance.now() - t).toFixed(0)} ms`);
    expect(results.length).toBeGreaterThan(0);
  });
});
