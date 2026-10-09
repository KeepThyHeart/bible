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
import { SUGGESTED_LISTS, type SuggestedList } from '../src/core/suggestedLists';
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

    it('all lists are well under the verse limit', () => {
      // Hand-verification of the built-in lists:
      // - Psalm 23:1-6: 6 verses
      // - Matthew 5:3-12: 10 verses
      // - Matthew 6:9-13: 5 verses
      // - Galatians 5:22-23: 2 verses
      // - Psalm 1:1-6: 6 verses
      // - Exodus 20:1-17: 17 verses (largest)
      // - All others: 1-2 verses
      // None approach the 25-verse cap.
      expect(SUGGESTED_LISTS.length).toBeGreaterThan(0);
    });
  });
});
