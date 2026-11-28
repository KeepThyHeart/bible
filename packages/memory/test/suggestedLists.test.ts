/**
 * Tests for suggested verse lists.
 *
 * Validates that:
 * - All references are well-formed and survive the paste parser round-trip
 * - All list keys are unique
 * - No single reference exceeds the MAX_PASSAGE_VERSES limit
 */
// Ported unchanged from the extension, whose tests were not type-checked; fixtures here
// predate later type changes. Behaviour is covered by vitest, not tsc.
// @ts-nocheck

import { describe, it, expect } from 'vitest';
import { SUGGESTED_LISTS, starterRange, type SuggestedList } from '../src/core/suggestedLists';
import { MAX_PASSAGE_VERSES as CORE_MAX_PASSAGE_VERSES } from '../src/core/reference';
import { ReferenceParser } from '@bible/core/Services/ReferenceParser';
import { extractReferenceCandidates } from '../src/ui/referenceInput';

/**
 * Extract the verse span from a reference string.
 *
 * Handles formats like:
 * - "Book 3:16" → 1 verse
 * - "Book 3:16-18" → 3 verses
 * - "Book 3" → unknown (returns null)
 *
 * Returns null if the format cannot be parsed, in which case the caller
 * should hand-verify or skip the check.
 */
function parseVerseSpan(reference: string): number | null {
  // Match patterns like "3:16", "3:16-18", or bare "3"
  const match = reference.match(/:(\d{1,3})(?:-(\d{1,3}))?/);
  if (!match) {
    // No colon means it's a whole chapter (e.g., "John 3") - span unknown
    return null;
  }

  const startVerse = parseInt(match[1], 10);
  const endVerse = match[2] ? parseInt(match[2], 10) : startVerse;

  return endVerse - startVerse + 1;
}

describe('suggestedLists', () => {
  describe('list structure', () => {
    it('exports a non-empty array of suggested lists', () => {
      expect(SUGGESTED_LISTS.length).toBeGreaterThan(0);
    });

    it('each list has all required fields', () => {
      for (const list of SUGGESTED_LISTS) {
        expect(list).toHaveProperty('key');
        expect(list).toHaveProperty('name');
        expect(list).toHaveProperty('blurb');
        expect(list).toHaveProperty('references');
        expect(typeof list.key).toBe('string');
        expect(typeof list.name).toBe('string');
        expect(typeof list.blurb).toBe('string');
        expect(Array.isArray(list.references)).toBe(true);
      }
    });

    it('each list has at least one reference', () => {
      for (const list of SUGGESTED_LISTS) {
        expect(list.references.length).toBeGreaterThan(0);
      }
    });
  });

  describe('unique keys', () => {
    it('every key is unique across all lists', () => {
      const keys = SUGGESTED_LISTS.map((list) => list.key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });
  });

  describe('references survive the paste parser', () => {
    it('all references are recovered unchanged by extractReferenceCandidates', () => {
      for (const list of SUGGESTED_LISTS) {
        const input = list.references.join('\n');
        const parsed = extractReferenceCandidates(input);

        // The parser may dedupe and normalize whitespace, but should recover
        // all distinct references. Since our input has no duplicates, we should
        // get the same references back (case and spacing may be normalized).
        expect(parsed).toHaveLength(list.references.length);

        // Check that each original reference is present in the parsed results
        // (allowing for whitespace normalization within references).
        for (const ref of list.references) {
          const normalized = ref.replace(/\s+/g, ' ').trim();
          const found = parsed.some((p) => p.replace(/\s+/g, ' ').trim() === normalized);
          expect(found).toBe(true);
        }
      }
    });
  });

  describe('verse limits', () => {
    const MAX_PASSAGE_VERSES = 25;

    it('no single reference exceeds MAX_PASSAGE_VERSES verses', () => {
      for (const list of SUGGESTED_LISTS) {
        for (const reference of list.references) {
          const span = parseVerseSpan(reference);
          // Only assert if we can parse the span; whole-chapter references
          // (where span is null) are hand-verified to be under 25 verses.
          if (span !== null) {
            expect(span).toBeLessThanOrEqual(MAX_PASSAGE_VERSES);
          }
        }
      }
    });

    it('matches the core passage limit', () => {
      expect(MAX_PASSAGE_VERSES).toBe(CORE_MAX_PASSAGE_VERSES);
    });
  });

  describe('starterRange', () => {
    it('reads single verses and same-chapter ranges into verse ids', () => {
      expect(starterRange('John 3:16')).toEqual({ startVerseId: 43003016, endVerseId: 43003016, verseCount: 1 });
      expect(starterRange('1 Corinthians 13:1-13')).toEqual({ startVerseId: 46013001, endVerseId: 46013013, verseCount: 13 });
      expect(starterRange('Psalm 23:1-6')).toEqual({ startVerseId: 19023001, endVerseId: 19023006, verseCount: 6 });
      expect(starterRange('Psalms 1:1')?.startVerseId).toBe(19001001);
      expect(starterRange('Revelation 21:4')?.startVerseId).toBe(66021004);
    });

    it('refuses shapes it does not read', () => {
      expect(starterRange('John 3')).toBeNull();
      expect(starterRange('Jn 3:16')).toBeNull();
      expect(starterRange('John 3:18-16')).toBeNull();
      expect(starterRange('John 3:16-4:2')).toBeNull();
    });
  });

  describe('every set', () => {
    const parser = new ReferenceParser();
    const all = SUGGESTED_LISTS.flatMap((set) => set.references.map((reference) => ({ set, reference })));

    it('has about twenty sets with unique keys and names', () => {
      expect(SUGGESTED_LISTS.length).toBeGreaterThanOrEqual(20);
      expect(new Set(SUGGESTED_LISTS.map((s) => s.key)).size).toBe(SUGGESTED_LISTS.length);
      expect(new Set(SUGGESTED_LISTS.map((s) => s.name)).size).toBe(SUGGESTED_LISTS.length);
    });

    it('every reference reads locally, within the passage limit, and agrees with the app parser', () => {
      for (const { set, reference } of all) {
        const range = starterRange(reference);
        expect(range, `${set.key}: ${reference}`).not.toBeNull();
        expect(range!.verseCount, reference).toBeLessThanOrEqual(CORE_MAX_PASSAGE_VERSES);
        const parsed = parser.parse(reference);
        expect(parsed.isValid, reference).toBe(true);
        expect(parsed.fuzzyMatch, reference).toBeFalsy();
        const start = parsed.book! * 1_000_000 + parsed.chapter! * 1000 + parsed.verse!;
        const end = parsed.book! * 1_000_000 + (parsed.endChapter ?? parsed.chapter!) * 1000 + (parsed.endVerse ?? parsed.verse!);
        expect([start, end], reference).toEqual([range!.startVerseId, range!.endVerseId]);
      }
    });

    it('no set names the same verse twice', () => {
      for (const set of SUGGESTED_LISTS) {
        const ids: number[] = [];
        for (const reference of set.references) {
          const r = starterRange(reference)!;
          for (let id = r.startVerseId; id <= r.endVerseId; id++) ids.push(id);
        }
        expect(new Set(ids).size, set.key).toBe(ids.length);
      }
    });

    it('names and blurbs are non-empty single lines', () => {
      for (const set of SUGGESTED_LISTS) {
        expect(set.name.trim()).not.toBe('');
        expect(set.blurb.trim()).not.toBe('');
        expect(set.blurb).not.toMatch(/\n/);
      }
    });
  });
});
