import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BibleSearchService } from './BibleSearchService';
import { KJVTestHelper } from '../__tests__/helpers/KJVTestHelper';
import { SearchOptions } from '../types/search';
import { Book, VerseIdHelper } from '../Data/Core/Types';

// Gated so a checkout without module data skips with a warning rather than
// erroring in beforeAll. See __tests__/helpers/testData.ts.
const KJV_AVAILABLE = KJVTestHelper.isAvailable();

describe.skipIf(!KJV_AVAILABLE)('BibleSearchService', () => {
  let searchService: BibleSearchService;

  beforeAll(() => {
    // Initialize real KJV database connection
    KJVTestHelper.initialize();

    // Create the service over the real KJV repository.
    const kjvRepo = KJVTestHelper.getKJVRepository();
    const bibleBookRepo = KJVTestHelper.getBibleBookRepository();

    // Create Bible modules map with KJV
    const bibleModules = new Map();
    bibleModules.set('kjv', kjvRepo);

    searchService = new BibleSearchService(bibleModules, bibleBookRepo);
  });

  afterAll(() => {
    // Clean up database connections
    KJVTestHelper.cleanup();
  });

  // ==========================================================================
  // Multi-Word Search Tests
  // ==========================================================================

  describe('Multi-Word Search', () => {
    it('should find verses with all search terms (AND logic)', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 100,
      };

      const results = await searchService.search('God loved world', options);

      // Should find John 3:16
      expect(results.length).toBeGreaterThan(0);

      const john316 = results.find(r =>
        r.verseId === VerseIdHelper.calculate(Book.John, 3, 16)
      );

      expect(john316).toBeDefined();
      expect(john316?.text).toContain('God');
      expect(john316?.text).toContain('loved');
      expect(john316?.text).toContain('world');
    });

    it('should only return verses containing ALL terms', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 100,
        autoFuzzy: false, // Disable fuzzy fallback to test strict AND logic
      };

      const results = await searchService.search('faith works justified', options);

      // Every result should contain all three terms
      for (const result of results) {
        const text = result.text.toLowerCase();
        expect(text).toContain('faith');
        expect(text).toContain('work'); // "works" or "worketh"
        expect(text).toContain('justif'); // "justified" or "justifieth"
      }
    });

    it('should handle single term search', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 10,
      };

      const results = await searchService.search('charity', options);

      expect(results.length).toBeGreaterThan(0);

      // Should find 1 Corinthians 13 verses
      const cor13_13 = results.find(r =>
        r.verseId === VerseIdHelper.calculate(Book.FirstCorinthians, 13, 13)
      );

      expect(cor13_13).toBeDefined();
    });

    it('should respect maxResults limit', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 5,
      };

      const results = await searchService.search('love', options);

      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should prioritize exact phrase matches above scattered term matches', async () => {
      // "wrestle not" should rank Ephesians 6:12 (contains "wrestle not") above
      // Genesis 32:25 (contains "wrestled" and "not" separately)
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 50,
        autoFuzzy: false,
      };

      const results = await searchService.search('wrestle not', options);
      expect(results.length).toBeGreaterThan(0);

      const eph612 = VerseIdHelper.calculate(Book.Ephesians, 6, 12);
      const eph612Index = results.findIndex(r => r.verseId === eph612);

      // Ephesians 6:12 must be found and ranked first (exact phrase "wrestle not")
      expect(eph612Index).toBe(0);
    });
  });

  // ==========================================================================
  // Phrase Search Tests
  // ==========================================================================

  describe('Phrase Search', () => {
    it('should find exact phrase matches', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 100,
      };

      const results = await searchService.search('"For God so loved"', options);

      // Should find John 3:16
      expect(results.length).toBeGreaterThan(0);

      const john316 = results.find(r =>
        r.verseId === VerseIdHelper.calculate(Book.John, 3, 16)
      );

      expect(john316).toBeDefined();
      expect(john316?.text.toLowerCase()).toContain('for god so loved');
    });

    it('should find phrase "greatest of these"', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 50,
      };

      const results = await searchService.search('"greatest of these"', options);

      // Should find 1 Corinthians 13:13
      const cor13_13 = results.find(r =>
        r.verseId === VerseIdHelper.calculate(Book.FirstCorinthians, 13, 13)
      );

      expect(cor13_13).toBeDefined();
      expect(cor13_13?.text.toLowerCase()).toContain('greatest of these');
    });

    it('should not match partial phrase', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 10,
      };

      // Exact phrase search should not find verses with words in different order
      const results = await searchService.search('"world loved God"', options);

      // This exact phrase doesn't exist (John 3:16 is "God so loved the world")
      expect(results.length).toBe(0);
    });

    it('should be case-insensitive by default', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 10,
      };

      const results1 = await searchService.search('"in the beginning"', options);
      const results2 = await searchService.search('"In The Beginning"', options);

      expect(results1.length).toBe(results2.length);
      expect(results1.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Proximity Search Tests (Word-Based)
  // ==========================================================================

  // Word-proximity search relies on `book_search_index`, a DERIVED index that
  // buildBookIndex() writes into the module database.
  //
  // v2 removed those tables from the shipped schema (they held zero rows in all
  // 53 bible modules) and a v2 module is an immutable artifact carrying a
  // content_sha256, so a read-only module has nowhere to put the index. These
  // tests therefore assert the DOCUMENTED behaviour: proximity search degrades
  // to no results rather than throwing.
  //
  // They previously wrapped everything in try/catch and accepted
  // `SQLITE_READONLY` as a pass, which meant they passed whether the feature
  // worked or not. It never worked here - it threw. See R-12: giving the index a
  // writable home is an open decision, and when it lands these assertions should
  // become real result checks.
  describe('Proximity Search (Word-Based)', () => {
    it('degrades to no results on a read-only module instead of throwing', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 100,
      };

      // "ant" and "sluggard" appear together in Proverbs 6:6 - this would match
      // if the index were available.
      const results = await searchService.search('ant sluggard ~20w', options);

      expect(Array.isArray(results)).toBe(true);
      expect(results).toHaveLength(0);
    });

    it('does not throw when a proximity query triggers auto-indexing', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 50,
      };

      const results = await searchService.search('faith hope ~30w', options);

      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle multi-verse proximity matches', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 100,
      };

      // Terms that span multiple verses. Shape-only while the index is
      // unavailable: every returned multi-verse result must carry a snippet.
      const results = await searchService.search('ant sluggard ~100w', options);

      const multiVerseResult = results.find(r => r.verseIds && r.verseIds.length > 1);
      if (multiVerseResult) {
        expect(multiVerseResult.snippet).toBeDefined();
      }
    });

    it('should create snippets for long multi-verse matches', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 50,
      };

      const results = await searchService.search('wisdom understanding ~200w', options);

      // Shape-only while the index is unavailable: any snippet produced must be
      // an abbreviation of the full text, never longer than it.
      const withSnippet = results.find(r => r.snippet !== undefined);
      if (withSnippet) {
        expect(withSnippet.snippet!.length).toBeLessThan(withSnippet.text.length);
      }
    });
  });

  // ==========================================================================
  // Verse Proximity Search Tests
  // ==========================================================================

  describe('Verse Proximity Search', () => {
    it('should find terms within verse distance', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 100,
      };

      // Look for "faith" and "hope" within 5 verses
      const results = await searchService.search('faith hope ~5v', options);

      expect(results.length).toBeGreaterThan(0);

      // Verify all results have both terms within verse distance
      for (const result of results) {
        const text = result.text.toLowerCase();
        const hasFaith = text.includes('faith');
        const hasHope = text.includes('hope');

        // At least one of the constellation verses should contain each term
        // (the result may show multiple verses)
        expect(hasFaith || hasHope).toBe(true);
      }
    });

    it('should group consecutive verses in results', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 50,
      };

      const results = await searchService.search('Paul Timothy ~3v', options);

      // Check for verse range formatting (e.g., "2 Timothy 1:1-3")
      const hasRange = results.some(r => r.reference.includes('-'));

      if (hasRange) {
        const rangeResult = results.find(r => r.reference.includes('-'));
        expect(rangeResult?.verseIds).toBeDefined();
        expect(rangeResult?.verseIds!.length).toBeGreaterThan(1);
      }
    });

    it('should handle cross-chapter verse proximity', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 100,
      };

      // Use larger verse distance to potentially span chapters
      const results = await searchService.search('Jesus disciples ~10v', options);

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);

      // Check if any results span chapters (reference like "Matthew 4:23-5:2")
      const crossChapter = results.find(r => {
        const match = r.reference.match(/(\d+):(\d+)-(\d+):(\d+)/);
        return match && match[1] !== match[3]; // Different start and end chapters
      });

      // Cross-chapter results are possible but not required
      if (crossChapter) {
        expect(crossChapter.verseIds).toBeDefined();
      }
    });
  });

  // ==========================================================================
  // Result Highlighting Tests
  // ==========================================================================

  describe('Result Highlighting', () => {
    it('should highlight matched terms', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 10,
      };

      const results = await searchService.search('love', options);

      expect(results.length).toBeGreaterThan(0);

      const firstResult = results[0];

      // Highlighted text should contain <strong><u> tags
      expect(firstResult.text).toContain('<strong><u>');
      expect(firstResult.text).toContain('</u></strong>');
    });

    it('should highlight all occurrences of search terms', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 10,
        autoFuzzy: false, // Disable fuzzy fallback
      };

      // Use a query that will actually find verses with both terms
      const results = await searchService.search('love God', options);

      expect(results.length).toBeGreaterThan(0);

      const firstResult = results[0];
      const text = firstResult.text.toLowerCase();

      // First result should contain both terms since we're using AND logic
      expect(text).toContain('love');
      expect(text).toContain('god');

      // Both terms should be highlighted
      const highlightCount = (firstResult.text.match(/<strong><u>/g) || []).length;
      expect(highlightCount).toBeGreaterThanOrEqual(2);
    });

    it('should provide match positions', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 10,
      };

      const results = await searchService.search('God', options);

      expect(results.length).toBeGreaterThan(0);

      const firstResult = results[0];

      expect(firstResult.matches).toBeDefined();
      expect(firstResult.matches.length).toBeGreaterThan(0);

      const match = firstResult.matches[0];
      expect(match.term).toBeDefined();
      expect(match.startPos).toBeGreaterThanOrEqual(0);
      expect(match.endPos).toBeGreaterThan(match.startPos);
    });
  });

  // ==========================================================================
  // Reference Formatting Tests
  // ==========================================================================

  describe('Reference Formatting', () => {
    it('should format single verse reference correctly', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 10,
      };

      const results = await searchService.search('"For God so loved"', options);

      const john316 = results.find(r =>
        r.verseId === VerseIdHelper.calculate(Book.John, 3, 16)
      );

      expect(john316?.reference).toBe('John 3:16');
    });

    it('should format verse range correctly', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 50,
      };

      // Search that may produce range results
      const results = await searchService.search('faith hope love ~5v', options);

      // Find any result with a range
      const rangeResult = results.find(r => r.reference.includes('-'));

      if (rangeResult) {
        // Should be formatted like "1 Corinthians 13:1-3"
        expect(rangeResult.reference).toMatch(/\d+:\d+-\d+/);
      }
    });

    it('should use correct book names', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 10,
      };

      // Search in Genesis
      const results1 = await searchService.search('beginning God created', options);
      const genesis = results1.find(r => r.reference.startsWith('Genesis'));
      expect(genesis).toBeDefined();

      // Search in Revelation
      const results2 = await searchService.search('Alpha Omega', options);
      const revelation = results2.find(r => r.reference.startsWith('Revelation'));
      expect(revelation).toBeDefined();
    });
  });

  // ==========================================================================
  // Result Deduplication Tests
  // ==========================================================================

  describe('Result Deduplication', () => {
    it('should deduplicate same verse from search results', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 100,
      };

      const results = await searchService.search('God love', options);

      // Count unique verse IDs
      const uniqueVerseIds = new Set(results.map(r => r.verseId));

      // Should have no duplicates
      expect(uniqueVerseIds.size).toBe(results.length);
    });
  });

  // ==========================================================================
  // Result Ranking Tests
  // ==========================================================================

  describe('Result Ranking', () => {
    it('should rank exact matches before fuzzy matches', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 50,
        autoFuzzy: true,
      };

      const results = await searchService.search('love', options);

      // All exact matches should come before fuzzy
      let foundFuzzy = false;
      for (const result of results) {
        if (result.type === 'fuzzy') {
          foundFuzzy = true;
        } else if (foundFuzzy && result.type === 'exact') {
          // Found exact after fuzzy - ranking is wrong
          expect(true).toBe(false); // Fail test
        }
      }
    });

    it('should order results by Bible verse order', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 50,
      };

      const results = await searchService.search('God', options);

      // Verify verse IDs are in ascending order (within same match type)
      let prevExactVerseId = 0;
      for (const result of results) {
        if (result.type === 'exact') {
          expect(result.verseId).toBeGreaterThanOrEqual(prevExactVerseId);
          prevExactVerseId = result.verseId;
        }
      }
    });
  });

  // ==========================================================================
  // Auto-Fuzzy Fallback Tests
  // ==========================================================================

  describe('Auto-Fuzzy Fallback', () => {
    it('should not add fuzzy results when enough exact matches', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 100,
        autoFuzzy: true,
      };

      // "love" should have many exact matches
      const results = await searchService.search('love', options);

      // With many results, should not need fuzzy fallback
      const fuzzyResults = results.filter(r => r.type === 'fuzzy');
      expect(fuzzyResults.length).toBe(0);
    });

    it('should add fuzzy matches when results < 10', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 100,
        autoFuzzy: true,
      };

      // Search for uncommon misspelling that might have few results
      // (Note: this test is tricky since KJV might not have few results for most terms)
      const results = await searchService.search('neig', options); // Partial word

      // The old body computed `hasFuzzy`, discarded it, and asserted
      // `expect(results).toBeDefined()` inside an `if` - so it checked nothing
      // whatever the search returned.
      //
      // What is true regardless of how many exact matches KJV holds for this
      // fragment: with `autoFuzzy` on, every result is one of the two kinds the
      // service produces, and a fuzzy one only appears alongside its query.
      expect(results.every(r => r.type === 'exact' || r.type === 'fuzzy')).toBe(true);
      for (const result of results.filter(r => r.type === 'fuzzy')) {
        expect(result.text.length).toBeGreaterThan(0);
      }
    });

    it('should respect autoFuzzy=false option', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 100,
        autoFuzzy: false,
      };

      const results = await searchService.search('love', options);

      // Should have no fuzzy results when disabled
      const fuzzyResults = results.filter(r => r.type === 'fuzzy');
      expect(fuzzyResults.length).toBe(0);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle search with no results', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 100,
      };

      // Search for something that definitely doesn't exist
      const results = await searchService.search('xyzabc123notfound', options);

      expect(results).toEqual([]);
    });

    it('should handle very long search terms', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 10,
      };

      const longTerm = 'a'.repeat(100);
      const results = await searchService.search(longTerm, options);

      // Should not crash, just return empty results
      expect(results).toEqual([]);
    });

    it('should handle special characters in search', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 10,
      };

      // Search with apostrophe (common in KJV)
      const results = await searchService.search("God's", options);

      // Should handle gracefully (may or may not find results)
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe('Integration - Real Search Scenarios', () => {
    it('should find famous verse John 3:16', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 50,
      };

      const results = await searchService.search('"For God so loved the world"', options);

      const john316 = results.find(r =>
        r.verseId === VerseIdHelper.calculate(Book.John, 3, 16)
      );

      expect(john316).toBeDefined();
      expect(john316?.reference).toBe('John 3:16');
      expect(john316?.module).toBe('kjv');
      expect(john316?.text).toContain('God');
      expect(john316?.text).toContain('loved');
      expect(john316?.text).toContain('world');
    });

    it('should find faith/works passages in James', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 100,
        autoFuzzy: false, // Disable fuzzy fallback to get accurate count
        range: {
          startBook: Book.James,
          endBook: Book.James,
        },
      };

      const results = await searchService.search('faith works', options);

      // Should find some verses with both terms
      expect(results.length).toBeGreaterThan(0);

      // All results should be from James
      for (const result of results) {
        const { bookNumber } = VerseIdHelper.parse(result.verseId);
        expect(bookNumber).toBe(Book.James);
      }
    });

    it('should search across Old and New Testament', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 100,
      };

      const results = await searchService.search('Messiah', options);

      if (results.length > 0) {
        // May have results from both testaments
        expect(results.length).toBeGreaterThan(0);
      }
    });
  });

  // ==========================================================================
  // FTS5 Stemmed Highlighting Tests
  // ==========================================================================

  describe('FTS5 Stemmed Highlighting', () => {
    it('should highlight stemmed variants when searching "walk"', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 10,
      };

      const results = await searchService.search('walk', options);

      expect(results.length).toBeGreaterThan(0);

      // Find a result with "walking" (Genesis 3:8)
      const walkingResult = results.find(r =>
        r.text.toLowerCase().includes('walking')
      );

      if (walkingResult) {
        // Should have the stemmed variant "walking" highlighted
        expect(walkingResult.text).toMatch(/<strong><u>walking<\/u><\/strong>/i);
      }

      // Find a result with "walked" (Genesis 5:22)
      const walkedResult = results.find(r =>
        r.text.toLowerCase().includes('walked')
      );

      if (walkedResult) {
        // Should have the stemmed variant "walked" highlighted
        expect(walkedResult.text).toMatch(/<strong><u>walked<\/u><\/strong>/i);
      }
    });

    it('should highlight stemmed variants when searching "love"', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 10,
      };

      const results = await searchService.search('love', options);

      expect(results.length).toBeGreaterThan(0);

      // Find a result with "loved" (Genesis 24:67)
      const lovedResult = results.find(r =>
        r.text.toLowerCase().includes('loved')
      );

      if (lovedResult) {
        // Should have the stemmed variant "loved" highlighted
        expect(lovedResult.text).toMatch(/<strong><u>loved<\/u><\/strong>/i);
      }

      // Find a result with "loveth"
      const lovethResult = results.find(r =>
        r.text.toLowerCase().includes('loveth')
      );

      if (lovethResult) {
        // Should have the stemmed variant "loveth" highlighted
        expect(lovethResult.text).toMatch(/<strong><u>loveth<\/u><\/strong>/i);
      }
    });

    it('should highlight fuzzy matches with wildcard prefix', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 10,
      };

      // Search with wildcard for prefix matching
      const results = await searchService.search('believ*', options);

      expect(results.length).toBeGreaterThan(0);

      // Should find and highlight various forms: believe, believed, believers, etc.
      const variants = ['believe', 'believed', 'believers', 'believeth', 'believing'];
      let foundVariants = 0;

      for (const result of results) {
        for (const variant of variants) {
          if (result.text.toLowerCase().includes(variant)) {
            // Should be highlighted
            const highlightRegex = new RegExp(`<strong><u>${variant}<\\/u><\\/strong>`, 'i');
            if (highlightRegex.test(result.text)) {
              foundVariants++;
              break; // Count this result only once
            }
          }
        }
      }

      // Should find at least a few highlighted variants
      expect(foundVariants).toBeGreaterThan(0);
    });

    it('should extract match positions from highlighted text', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 5,
      };

      const results = await searchService.search('walk', options);

      expect(results.length).toBeGreaterThan(0);

      // Check that matches array is populated
      for (const result of results) {
        expect(result.matches).toBeDefined();
        expect(Array.isArray(result.matches)).toBe(true);
        expect(result.matches.length).toBeGreaterThan(0);

        // Each match should have the actual matched term (not just the search term)
        for (const match of result.matches) {
          expect(match.term).toBeDefined();
          expect(match.startPos).toBeGreaterThanOrEqual(0);
          expect(match.endPos).toBeGreaterThan(match.startPos);

          // The matched term should be a stemmed variant of "walk"
          const normalizedTerm = match.term.toLowerCase();
          expect(
            normalizedTerm === 'walk' ||
            normalizedTerm === 'walked' ||
            normalizedTerm === 'walking' ||
            normalizedTerm === 'walketh' ||
            normalizedTerm === 'walks'
          ).toBe(true);
        }
      }
    });

    it('should highlight multi-word searches with stemming', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 10,
      };

      const results = await searchService.search('faith love', options);

      expect(results.length).toBeGreaterThan(0);

      // Check that both terms (or their stemmed variants) are highlighted
      for (const result of results) {
        // Should contain highlighting tags
        expect(result.text).toMatch(/<strong><u>/);

        // Should have matches for both search terms
        const matchTerms = result.matches.map(m => m.term.toLowerCase());

        // Should have at least one match related to "faith"
        const hasFaithMatch = matchTerms.some(term =>
          term.includes('faith')
        );

        // Should have at least one match related to "love"
        const hasLoveMatch = matchTerms.some(term =>
          term.includes('love')
        );

        expect(hasFaithMatch).toBe(true);
        expect(hasLoveMatch).toBe(true);
      }
    });
  });

  // ==========================================================================
  // Character Variant Search Tests (KAN-35)
  // ==========================================================================

  describe('Character Variant Search', () => {
    it('should find "Ænon" (John 3:23) when searching "aenon"', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 100,
        autoFuzzy: false,
      };

      const results = await searchService.search('aenon', options);
      expect(results.length).toBeGreaterThan(0);

      const john323 = results.find(r =>
        r.verseId === VerseIdHelper.calculate(Book.John, 3, 23)
      );
      expect(john323).toBeDefined();
    });

    it('should find "Ænon" (John 3:23) when searching "Aenon"', async () => {
      const options: SearchOptions = {
        modules: ['kjv'],
        maxResults: 100,
        autoFuzzy: false,
      };

      const results = await searchService.search('Aenon', options);
      expect(results.length).toBeGreaterThan(0);

      const john323 = results.find(r =>
        r.verseId === VerseIdHelper.calculate(Book.John, 3, 23)
      );
      expect(john323).toBeDefined();
    });
  });

  // ==========================================================================
  // Boolean Search
  // ==========================================================================
  //
  // `searchBoolean` used to run `expression.left` as an ordinary multi-word
  // search and discard the operator and the right-hand side entirely, so
  // `(Jerusalem OR Zion)` returned only the Jerusalem verses and
  // `(faith NOT works)` returned verses containing both. The expression is now
  // compiled to an FTS5 MATCH expression, which implements all three operators
  // natively. These cases assert the operator is honoured, not merely that
  // something came back.
  describe('Boolean Search', () => {
    const options: SearchOptions = { modules: ['kjv'], maxResults: 200, autoFuzzy: false };

    it('returns matches for the right-hand side of an OR, not just the left', async () => {
      const results = await searchService.search('(Jerusalem OR Zion)', options);
      expect(results.length).toBeGreaterThan(0);

      const zionOnly = results.filter(
        r => /zion/i.test(r.text) && !/jerusalem/i.test(r.text)
      );
      expect(zionOnly.length).toBeGreaterThan(0);
    });

    it('excludes the negated term with the binary NOT form', async () => {
      const results = await searchService.search('(faith NOT works)', options);
      expect(results.length).toBeGreaterThan(0);

      for (const result of results) {
        expect(result.text).toMatch(/faith/i);
        expect(result.text).not.toMatch(/works/i);
      }
    });

    it('excludes the negated term when NOT is applied inside an AND', async () => {
      const results = await searchService.search('(faith AND NOT works)', options);
      expect(results.length).toBeGreaterThan(0);

      for (const result of results) {
        expect(result.text).not.toMatch(/works/i);
      }
    });

    it('honours grouping in a nested expression', async () => {
      const results = await searchService.search('(faith AND (hope OR love))', options);
      expect(results.length).toBeGreaterThan(0);

      for (const result of results) {
        expect(result.text).toMatch(/faith/i);
        expect(result.text).toMatch(/hope|love/i);
      }
    });

    it('returns nothing for a bare negation rather than its opposite', async () => {
      // FTS5's NOT is binary and there is no "every verse" operand to subtract
      // from. The old code returned the matches for `wicked` here - the exact
      // opposite of the query.
      const results = await searchService.search('(NOT wicked)', options);
      expect(results).toEqual([]);
    });
  });
});
