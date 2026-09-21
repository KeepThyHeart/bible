/**
 * The gate on approximate matches for a multi-word query.
 *
 * "God so loved the world" used to list Genesis 1:1 first among its approximate
 * matches, followed by verse after verse that merely contained "God": the
 * supplement searched each term on its own and kept anything any of them found
 * (and, because `escapeFts5Term` quotes a term containing `*`, the "prefix" it
 * built was really a plain word match, so one common word matched thousands of
 * verses, the first 20 in Bible order being kept).
 *
 * These run against a small in-memory stand-in for the FTS5 repository, so they
 * do not depend on module data being installed. The stand-in understands only
 * what the service sends: `a AND b` of bare/quoted words and `"stem"*` prefixes.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { BibleSearchService } from './BibleSearchService';
import { BibleVerse } from '../Data/Models/Bible/BibleVerse';
import { VerseIdHelper } from '../Data/Core/Types';
import type { IBibleRepository } from '../Data/Repositories/IBibleRepository';
import type { IBibleBookRepository } from '../Data/Repositories/IBibleBookRepository';

const id = (book: number, chapter: number, verse: number) => VerseIdHelper.calculate(book, chapter, verse);

const CORPUS: Array<[number, string]> = [
  [id(1, 1, 1), 'In the beginning God created the heaven and the earth.'],
  [id(1, 1, 3), 'And God said, Let there be light: and there was light.'],
  [id(1, 1, 4), 'And God saw the light, that it was good: and God divided the light from the darkness.'],
  [id(1, 1, 5), 'And God called the light Day, and the darkness he called Night.'],
  [id(1, 1, 6), 'And God said, Let there be a firmament in the midst of the waters.'],
  [id(1, 1, 7), 'And God made the firmament, and divided the waters.'],
  [id(1, 1, 8), 'And God called the firmament Heaven.'],
  [id(1, 1, 9), 'And God said, Let the waters under the heaven be gathered together.'],
  [id(1, 1, 10), 'And God called the dry land Earth; and the gathering together of the waters called he Seas: and God saw that it was good.'],
  [id(1, 1, 11), 'And God said, Let the earth bring forth grass.'],
  [id(1, 1, 12), 'And the earth brought forth grass, and God saw that it was good.'],
  [id(43, 1, 10), 'He was in the world, and the world was made by him, and the world knew him not.'],
  [id(43, 3, 16), 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.'],
  [id(43, 15, 19), 'If ye were of the world, the world would love his own: but because ye are not of the world, therefore the world hateth you.'],
  [id(62, 4, 11), 'Beloved, if God so loved us, we ought also to love one another.'],
];

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Just enough of FTS5 for the queries BibleSearchService builds. */
function matches(query: string, text: string): boolean {
  const tokens = words(text);
  return query.split(' AND ').every(part => {
    const prefix = part.match(/^"([^"]+)"\*$/);
    if (prefix) return tokens.some(t => t.startsWith(prefix[1].toLowerCase()));
    return words(part).every(w => tokens.includes(w));
  });
}

function makeRepo(): IBibleRepository {
  return {
    searchVersesWithHighlighting: (query: string, options?: { limit?: number }) =>
      CORPUS
        .filter(([, text]) => matches(query, text))
        .slice(0, options?.limit ?? 100)
        .map(([verseId, text]) => {
          const verse = new BibleVerse({ verseId, text, textPlain: text });
          return { verse, highlightedText: text, highlightedPlainText: text };
        }),
  } as unknown as IBibleRepository;
}

const bookRepo = {
  getByBookNumber: (n: number) => ({ bookName: `Book${n}` }),
} as unknown as IBibleBookRepository;

describe('BibleSearchService approximate-match gate', () => {
  let service: BibleSearchService;

  beforeAll(() => {
    service = new BibleSearchService(new Map([['kjv', makeRepo()]]), bookRepo);
  });

  const search = (query: string, fuzzyGate?: 'any-term' | 'coverage') =>
    service.search(query, { modules: ['kjv'], maxResults: 200, fuzzyGate });

  describe("fuzzyGate: 'coverage'", () => {
    it('keeps the exact match first and does not pull in verses that only share "God"', async () => {
      const results = await search('God so loved the world', 'coverage');

      expect(results[0].verseId).toBe(id(43, 3, 16));
      expect(results[0].type).toBe('exact');

      const approximate = results.filter(r => r.type === 'fuzzy').map(r => r.verseId);
      expect(approximate).not.toContain(id(1, 1, 1));          // God only
      expect(approximate).not.toContain(id(1, 1, 3));          // God only
      expect(approximate).not.toContain(id(43, 1, 10));        // world only
    });

    it('offers verses that match enough of the significant terms', async () => {
      const results = await search('God so loved the world', 'coverage');
      const approximate = results.filter(r => r.type === 'fuzzy').map(r => r.verseId);

      // God + loved (2 of 3 significant terms), and loved-as-"love" + world.
      expect(approximate).toContain(id(62, 4, 11));
      expect(approximate).toContain(id(43, 15, 19));
    });

    it('ignores stop words: a stop word alone never qualifies a verse', async () => {
      // "the" and "so" are in nearly every verse; without the gate they would
      // qualify all of them.
      const results = await search('so the world', 'coverage');
      const ids = results.map(r => r.verseId);
      // "world" is the only significant term, so all terms are required.
      for (const verseId of ids) {
        const text = CORPUS.find(([v]) => v === verseId)![1].toLowerCase();
        expect(text).toContain('world');
      }
    });

    it('requires every term when the query is only stop words plus one word', async () => {
      const results = await search('God so', 'coverage');
      // Verses with "God" but no "so" (Genesis 1:x) must not appear.
      expect(results.map(r => r.verseId)).not.toContain(id(1, 1, 1));
      expect(results.map(r => r.verseId).sort()).toEqual([id(43, 3, 16), id(62, 4, 11)].sort());
    });

    it('ranks approximate matches by term coverage, then by how close the matches sit', async () => {
      // Three significant terms: God, loved, world.
      const results = await search('God so loved world', 'coverage');
      const approximate = results.filter(r => r.type === 'fuzzy');
      for (let i = 1; i < approximate.length; i++) {
        const prev = approximate[i - 1];
        const cur = approximate[i];
        expect(prev.termCoverage!).toBeGreaterThanOrEqual(cur.termCoverage!);
      }
      expect(approximate.every(r => r.termCoverage! >= 2 / 3)).toBe(true);
    });

    it('lists exact matches before approximate ones', async () => {
      const results = await search('God so loved the world', 'coverage');
      const firstFuzzy = results.findIndex(r => r.type === 'fuzzy');
      const lastExact = results.map(r => r.type).lastIndexOf('exact');
      expect(lastExact).toBeLessThan(firstFuzzy === -1 ? Infinity : firstFuzzy);
    });

    it('does not alter exact results or phrase search', async () => {
      const gated = await search('God so loved the world', 'coverage');
      const plain = await search('God so loved the world', 'any-term');
      const exact = (rs: typeof gated) => rs.filter(r => r.type === 'exact').map(r => r.verseId);
      expect(exact(gated)).toEqual(exact(plain));

      const phrase = await search('"so loved the world"', 'coverage');
      expect(phrase.map(r => r.verseId)).toEqual([id(43, 3, 16)]);
    });

    it('adds nothing when the exact search already found enough', async () => {
      // Ten or more exact matches: the supplement does not run at all.
      const results = await search('God', 'coverage');
      expect(results.filter(r => r.type === 'fuzzy')).toHaveLength(0);
    });
  });

  describe('default gate (unchanged behaviour)', () => {
    it('still accepts a verse that matches any one term', async () => {
      // Documents what callers that do not opt in (the desktop app) keep
      // getting: a lone common word is enough.
      const results = await search('God so loved the world');
      const approximate = results.filter(r => r.type === 'fuzzy').map(r => r.verseId);
      expect(approximate).toContain(id(1, 1, 1));
    });
  });
});
