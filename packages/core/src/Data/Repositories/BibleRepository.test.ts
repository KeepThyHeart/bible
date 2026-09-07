import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BibleRepository } from './BibleRepository';
import { KJVTestHelper } from '../../__tests__/helpers/KJVTestHelper';
import { Book, VerseIdHelper } from '../Core/Types';

// Probed at collection time so interlinear suites can skip themselves when the
// local KJV module was built without interlinear_word rows.
const KJV_HAS_INTERLINEAR = KJVTestHelper.hasInterlinearData();

describe('BibleRepository', () => {
  let repository: BibleRepository;

  beforeAll(() => {
    KJVTestHelper.initialize();
    repository = KJVTestHelper.getKJVRepository() as BibleRepository;
  });

  afterAll(() => {
    KJVTestHelper.cleanup();
  });

  // ==========================================================================
  // Module Info Tests
  // ==========================================================================

  describe('getModuleInfo', () => {
    it('should return module info for KJV', () => {
      const info = repository.getModuleInfo();

      expect(info).toBeDefined();
      expect(info?.abbreviation).toBe('KJV');
      expect(info?.fullName).toContain('King James');
      expect(info?.languageCode).toBe('en');
    });
  });

  // ==========================================================================
  // getVerse Tests
  // ==========================================================================

  describe('getVerse', () => {
    it('should get John 3:16', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);

      const verse = repository.getVerse(verseId);

      expect(verse).toBeDefined();
      expect(verse?.verseId).toBe(verseId);

      // Parse verseId to get book, chapter, verse
      const parsed = VerseIdHelper.parse(verse!.verseId);
      expect(parsed.bookNumber).toBe(Book.John);
      expect(parsed.chapter).toBe(3);
      expect(parsed.verse).toBe(16);
      expect(verse?.getPlainText()).toContain('God so loved the world');
    });

    it('should get Genesis 1:1', () => {
      const verseId = VerseIdHelper.calculate(Book.Genesis, 1, 1);

      const verse = repository.getVerse(verseId);

      expect(verse).toBeDefined();
      expect(verse?.getPlainText()).toContain('In the beginning');
    });

    it('should get Revelation 22:21', () => {
      const verseId = VerseIdHelper.calculate(Book.Revelation, 22, 21);

      const verse = repository.getVerse(verseId);

      expect(verse).toBeDefined();
      expect(verse?.text).toContain('grace');
    });

    it('should return undefined for non-existent verse', () => {
      const verseId = 99999999;

      const verse = repository.getVerse(verseId);

      expect(verse).toBeUndefined();
    });

    it('should include text (possibly with formatting)', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);

      const verse = repository.getVerse(verseId);

      expect(verse?.text).toBeDefined();
      expect(verse?.text.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // getVerseRange Tests
  // ==========================================================================

  describe('getVerseRange', () => {
    it('should get Romans 8:28-30', () => {
      const start = VerseIdHelper.calculate(Book.Romans, 8, 28);
      const end = VerseIdHelper.calculate(Book.Romans, 8, 30);

      const verses = repository.getVerseRange(start, end);

      expect(verses).toHaveLength(3);
      expect(verses[0].verseId).toBe(start);
      expect(verses[2].verseId).toBe(end);
    });

    it('should get single verse as range', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);

      const verses = repository.getVerseRange(verseId, verseId);

      expect(verses).toHaveLength(1);
      expect(verses[0].verseId).toBe(verseId);
    });

    it('should get verses in correct order', () => {
      const start = VerseIdHelper.calculate(Book.Psalms, 23, 1);
      const end = VerseIdHelper.calculate(Book.Psalms, 23, 3);

      const verses = repository.getVerseRange(start, end);

      expect(verses).toHaveLength(3);
      expect(VerseIdHelper.parse(verses[0].verseId).verse).toBe(1);
      expect(VerseIdHelper.parse(verses[1].verseId).verse).toBe(2);
      expect(VerseIdHelper.parse(verses[2].verseId).verse).toBe(3);
    });

    it('should handle cross-chapter range', () => {
      const start = VerseIdHelper.calculate(Book.John, 3, 35);
      const end = VerseIdHelper.calculate(Book.John, 4, 2);

      const verses = repository.getVerseRange(start, end);

      expect(verses.length).toBeGreaterThan(0);

      // Should have verses from chapter 3 and chapter 4
      const hasChapter3 = verses.some(v => VerseIdHelper.parse(v.verseId).chapter === 3);
      const hasChapter4 = verses.some(v => VerseIdHelper.parse(v.verseId).chapter === 4);

      expect(hasChapter3).toBe(true);
      expect(hasChapter4).toBe(true);
    });

    it('should return empty array for invalid range', () => {
      const start = VerseIdHelper.calculate(Book.John, 3, 16);
      const end = VerseIdHelper.calculate(Book.John, 3, 10); // End before start

      const verses = repository.getVerseRange(start, end);

      expect(verses).toHaveLength(0);
    });
  });

  // ==========================================================================
  // getChapter Tests
  // ==========================================================================

  describe('getChapter', () => {
    it('should get John chapter 3', () => {
      const verses = repository.getChapter(Book.John, 3);

      expect(verses.length).toBeGreaterThan(0);
      expect(verses.length).toBe(36); // John 3 has 36 verses

      // All verses should be from John 3
      verses.forEach(v => {
        const parsed = VerseIdHelper.parse(v.verseId);
        expect(parsed.bookNumber).toBe(Book.John);
        expect(parsed.chapter).toBe(3);
      });

      // Should be in order
      verses.forEach((v, i) => {
        const parsed = VerseIdHelper.parse(v.verseId);
        expect(parsed.verse).toBe(i + 1);
      });
    });

    it('should get Genesis chapter 1', () => {
      const verses = repository.getChapter(Book.Genesis, 1);

      expect(verses.length).toBe(31); // Genesis 1 has 31 verses
      expect(VerseIdHelper.parse(verses[0].verseId).verse).toBe(1);
      expect(verses[0].getPlainText()).toContain('In the beginning');
    });

    it('should get Psalm 23', () => {
      const verses = repository.getChapter(Book.Psalms, 23);

      expect(verses.length).toBe(6); // Psalm 23 has 6 verses

      // v2: `text` is clean prose. v1 stored presentation inline -
      // `The L<font size="-1">ORD</font> <i>is</i> my shepherd` - so a v1
      // assertion of "The LORD is my shepherd" was really asserting the
      // small-caps <font> tag. That markup is now a span, not text.
      expect(verses[0].getPlainText()).toContain('The Lord is my shepherd');
      expect(verses[0].getPlainText()).not.toContain('<font');

      // The distinction is preserved, not discarded: the divine name is still
      // identified, just as data the renderer styles rather than baked-in HTML.
      expect(verses[0].spansOfType('divine_name').length).toBeGreaterThan(0);
    });

    it('should return empty array for non-existent chapter', () => {
      const verses = repository.getChapter(Book.John, 999);

      expect(verses).toHaveLength(0);
    });

    it('should handle Psalm 119 (longest chapter)', () => {
      const verses = repository.getChapter(Book.Psalms, 119);

      expect(verses.length).toBe(176); // Psalm 119 has 176 verses
      expect(VerseIdHelper.parse(verses[0].verseId).verse).toBe(1);
      expect(VerseIdHelper.parse(verses[175].verseId).verse).toBe(176);
    });
  });

  // ==========================================================================
  // getBook Tests
  // ==========================================================================

  describe('getBook', () => {
    it('should get all verses in Ruth', () => {
      // Ruth is a short book, good for testing
      const verses = repository.getBook(Book.Ruth);

      expect(verses.length).toBeGreaterThan(0);

      // All verses should be from Ruth
      verses.forEach(v => {
        const parsed = VerseIdHelper.parse(v.verseId);
        expect(parsed.bookNumber).toBe(Book.Ruth);
      });

      // Should start with chapter 1, verse 1
      const firstVerse = VerseIdHelper.parse(verses[0].verseId);
      expect(firstVerse.chapter).toBe(1);
      expect(firstVerse.verse).toBe(1);
    });

    it('should get all verses in Philemon', () => {
      // Philemon is the shortest book with one chapter
      const verses = repository.getBook(Book.Philemon);

      expect(verses.length).toBe(25); // Philemon has 25 verses in one chapter

      // All should be chapter 1
      verses.forEach(v => {
        const parsed = VerseIdHelper.parse(v.verseId);
        expect(parsed.chapter).toBe(1);
      });
    });

    it('should get Genesis (first book)', () => {
      const verses = repository.getBook(Book.Genesis);

      expect(verses.length).toBeGreaterThan(0);
      const firstVerse = VerseIdHelper.parse(verses[0].verseId);
      expect(firstVerse.chapter).toBe(1);
      expect(firstVerse.verse).toBe(1);
      expect(verses[0].getPlainText()).toContain('In the beginning');
    });

    it('should return verses in correct order', () => {
      const verses = repository.getBook(Book.Jude);

      // Should be in sequential order
      for (let i = 1; i < verses.length; i++) {
        const prev = VerseIdHelper.parse(verses[i - 1].verseId);
        const curr = VerseIdHelper.parse(verses[i].verseId);

        // Either same chapter, next verse, or next chapter
        if (curr.chapter === prev.chapter) {
          expect(curr.verse).toBe(prev.verse + 1);
        } else {
          expect(curr.chapter).toBe(prev.chapter + 1);
          expect(curr.verse).toBe(1);
        }
      }
    });
  });

  // ==========================================================================
  // searchVerses Tests
  // ==========================================================================

  describe('searchVerses', () => {
    it('should search for "love"', () => {
      const verses = repository.searchVerses('love', { limit: 10 });

      expect(verses.length).toBeGreaterThan(0);
      expect(verses.length).toBeLessThanOrEqual(10);

      // At least some verses should contain "love"
      const hasLove = verses.some(v =>
        v.text.toLowerCase().includes('love')
      );
      expect(hasLove).toBe(true);
    });

    it('should search for "God"', () => {
      const verses = repository.searchVerses('God', { limit: 20 });

      expect(verses.length).toBeGreaterThan(0);
      verses.forEach(v => {
        const text = v.text.toLowerCase();
        expect(text.includes('god')).toBe(true);
      });
    });

    it('should respect limit option', () => {
      const verses = repository.searchVerses('the', { limit: 5 });

      expect(verses.length).toBeLessThanOrEqual(5);
    });

    it('should return empty array for no matches', () => {
      const verses = repository.searchVerses('xyzabc123notfound');

      expect(verses).toHaveLength(0);
    });

    it('should handle multi-word search', () => {
      const verses = repository.searchVerses('God loved', { limit: 10 });

      // Should find verses containing both words
      expect(verses.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // getVerseCount Tests
  // ==========================================================================

  describe('getVerseCount', () => {
    it('should return total verse count', () => {
      const count = repository.getVerseCount();

      // KJV has 31,102 verses
      expect(count).toBeGreaterThan(31000);
      expect(count).toBeLessThan(32000);
    });

    it('should be consistent', () => {
      const count1 = repository.getVerseCount();
      const count2 = repository.getVerseCount();

      expect(count1).toBe(count2);
    });
  });

  // ==========================================================================
  // getVersesWithHeadings Tests
  // ==========================================================================

  describe('getVersesWithHeadings', () => {
    it('should return verses that have headings (if present in database)', () => {
      const verses = repository.getVersesWithHeadings();

      // Note: KJV test database may not have section headings
      // This test documents the method behavior
      if (verses.length > 0) {
        // If headings exist, check that they have the expected property
        verses.forEach(v => {
          expect(v.formattingData?.sectionHeading).toBeDefined();
        });
      } else {
        // It's acceptable for this to return empty array if database has no headings
        expect(verses).toHaveLength(0);
      }
    });
  });

  // ==========================================================================
  // Interlinear Data Tests
  // ==========================================================================

  describe('hasInterlinearData', () => {
    it('should report whether the KJV fixture carries interlinear data', () => {
      const hasData = repository.hasInterlinearData();

      expect(hasData).toBe(KJV_HAS_INTERLINEAR);
    });

    // The interlinear_word table exists in the KJV schema but is only populated
    // in builds of the module that ship interlinear data. Skip the content
    // assertions when the local fixture has none.
    describe.skipIf(!KJV_HAS_INTERLINEAR)('with interlinear data present', () => {
      it('should have interlinear_word table with data', () => {
        // Direct query to verify table exists and has data
        const provider = KJVTestHelper.getKJVProvider();
        const result = provider.queryOne<{ count: number }>(
          'SELECT COUNT(*) as count FROM interlinear_word'
        );

        expect(result).toBeDefined();
        expect(result!.count).toBeGreaterThan(0);
        console.log(`KJV interlinear word count: ${result!.count}`);
      });

      it('should have Strong\'s numbers in interlinear data', () => {
        const provider = KJVTestHelper.getKJVProvider();

        // Check Genesis 1:1 interlinear (Hebrew)
        const hebrewWords = provider.queryAll<{ strongs_number: string }>(
          'SELECT strongs_number FROM interlinear_word WHERE verse_id = 1001001 AND strongs_number IS NOT NULL LIMIT 5'
        );

        expect(hebrewWords.length).toBeGreaterThan(0);
        // Hebrew Strong's numbers start with H
        const hasHebrewStrongs = hebrewWords.some(w => w.strongs_number?.startsWith('H'));
        expect(hasHebrewStrongs).toBe(true);

        // Check John 3:16 interlinear (Greek)
        const greekWords = provider.queryAll<{ strongs_number: string }>(
          'SELECT strongs_number FROM interlinear_word WHERE verse_id = 43003016 AND strongs_number IS NOT NULL LIMIT 5'
        );

        expect(greekWords.length).toBeGreaterThan(0);
        // Greek Strong's numbers start with G
        const hasGreekStrongs = greekWords.some(w => w.strongs_number?.startsWith('G'));
        expect(hasGreekStrongs).toBe(true);
      });

      // `original_word` is nullable and the shipped modules leave it NULL for
      // the ENTIRE Old Testament - Hebrew rows carry only Strong's/lemma/gloss.
      // The row and model types both declared it a required `string`, so it
      // arrived as a JS null and the first consumer to treat it as a string
      // (stripOsisTags in the desktop `bible:getInterlinearWordsForChapter`
      // handler) threw "Cannot read properties of null (reading 'replace')".
      // The handler's catch swallowed it and returned {}, silently dropping
      // interlinear data for every OT chapter.
      it('maps a NULL original_word to undefined rather than null', () => {
        const words = repository.getInterlinearWords(1001001); // Genesis 1:1

        expect(words.length).toBeGreaterThan(0);

        const provider = KJVTestHelper.getKJVProvider();
        const nullCount = provider.queryOne<{ count: number }>(
          'SELECT COUNT(*) as count FROM interlinear_word WHERE verse_id = 1001001 AND original_word IS NULL'
        );
        // Guard the guard: if a future module build populates Hebrew surface
        // forms this assertion is what tells us the fixture changed shape.
        expect(nullCount!.count).toBeGreaterThan(0);

        const fromNull = words.filter(w => w.originalWord === undefined);
        expect(fromNull.length).toBe(nullCount!.count);
        // Never null - consumers narrow on `undefined`, and `?? ''` / `|| ''`
        // both work, but `word.originalWord.replace(...)` must not be reachable.
        expect(words.every(w => w.originalWord !== null)).toBe(true);

        // The row is still worth rendering: the payload lives in the other columns.
        const [first] = fromNull;
        expect(first!.strongsNumber).toMatch(/^H/);
      });

      // The two shapes must agree; the chapter batch is the path that crashed.
      it('maps NULL original_word consistently in the chapter batch', () => {
        const wordsMap = repository.getInterlinearWordsForChapter(1, 1); // Genesis 1

        expect(wordsMap.size).toBeGreaterThan(0);

        const all = Array.from(wordsMap.values()).flat();
        expect(all.length).toBeGreaterThan(0);
        expect(all.every(w => w.originalWord !== null)).toBe(true);
        // The OT half of the fixture has no surface forms at all.
        expect(all.some(w => w.originalWord === undefined)).toBe(true);
      });
    });
  });

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe('Integration Tests', () => {
    it('should retrieve famous verse John 3:16 with correct text', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const verse = repository.getVerse(verseId);

      expect(verse).toBeDefined();
      expect(verse?.getPlainText()).toContain('God so loved the world');
      expect(verse?.getPlainText()).toContain('only begotten Son');
      expect(verse?.getPlainText()).toContain('everlasting life');
    });

    it('should retrieve multiple verses correctly', () => {
      // Get 1 Corinthians 13 (love chapter)
      const verses = repository.getChapter(Book.FirstCorinthians, 13);

      expect(verses.length).toBe(13);

      // Check first verse
      expect(verses[0].getPlainText()).toContain('charity');

      // Check last verse (greatest of these)
      expect(verses[12].getPlainText()).toContain('greatest');
      expect(verses[12].getPlainText()).toContain('charity');
    });

    it('should handle verse range across chapters', () => {
      // Get Matthew 5:1 through 7:29 (Sermon on the Mount)
      const start = VerseIdHelper.calculate(Book.Matthew, 5, 1);
      const end = VerseIdHelper.calculate(Book.Matthew, 7, 29);

      const verses = repository.getVerseRange(start, end);

      expect(verses.length).toBeGreaterThan(100); // Should be many verses

      // Check boundaries
      const firstParsed = VerseIdHelper.parse(verses[0].verseId);
      expect(firstParsed.chapter).toBe(5);
      expect(firstParsed.verse).toBe(1);

      const lastParsed = VerseIdHelper.parse(verses[verses.length - 1].verseId);
      expect(lastParsed.chapter).toBe(7);
      expect(lastParsed.verse).toBe(29);

      // Should have verses from chapters 5, 6, and 7
      const chapters = new Set(verses.map(v => VerseIdHelper.parse(v.verseId).chapter));
      expect(chapters.has(5)).toBe(true);
      expect(chapters.has(6)).toBe(true);
      expect(chapters.has(7)).toBe(true);
    });

    it('should work with verse ID helper round-trip', () => {
      // Create verse ID
      const verseId = VerseIdHelper.calculate(Book.Romans, 8, 28);

      // Get verse
      const verse = repository.getVerse(verseId);
      expect(verse).toBeDefined();

      // Parse back
      const parsed = VerseIdHelper.parse(verse!.verseId);

      expect(parsed.bookNumber).toBe(Book.Romans);
      expect(parsed.chapter).toBe(8);
      expect(parsed.verse).toBe(28);
    });

    it('should search and retrieve complete verses', () => {
      // Search for "faith" (common word that should have results)
      const verses = repository.searchVerses('faith', { limit: 5 });

      // Should find verses
      expect(verses.length).toBeGreaterThan(0);

      // Verses should be complete with all fields
      verses.forEach(v => {
        expect(v.verseId).toBeDefined();

        // Parse verseId to verify structure
        const parsed = VerseIdHelper.parse(v.verseId);
        expect(parsed.bookNumber).toBeGreaterThan(0);
        expect(parsed.chapter).toBeGreaterThan(0);
        expect(parsed.verse).toBeGreaterThan(0);

        expect(v.text).toBeDefined();
        expect(v.text.length).toBeGreaterThan(0);
      });
    });

    it('should handle edge cases gracefully', () => {
      // Test various edge cases
      const tests = [
        { book: Book.Genesis, chapter: 1, verse: 1 },    // First verse
        { book: Book.Revelation, chapter: 22, verse: 21 }, // Last verse
        { book: Book.Psalms, chapter: 119, verse: 176 },   // Longest chapter
        { book: Book.Jude, chapter: 1, verse: 25 },        // Single chapter book
      ];

      tests.forEach(test => {
        const verseId = VerseIdHelper.calculate(test.book, test.chapter, test.verse);
        const verse = repository.getVerse(verseId);

        expect(verse).toBeDefined();

        // Parse verseId to verify it matches expected values
        const parsed = VerseIdHelper.parse(verse!.verseId);
        expect(parsed.bookNumber).toBe(test.book);
        expect(parsed.chapter).toBe(test.chapter);
        expect(parsed.verse).toBe(test.verse);
      });
    });
  });
});
