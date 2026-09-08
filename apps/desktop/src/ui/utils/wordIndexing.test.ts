/**
 * Unit tests for Word Indexing
 *
 * Tests the functionality of extracting words from Bible verse HTML,
 * particularly ensuring proper word boundary behavior with punctuation.
 *
 * KAN-10: Word break behavior should not include trailing punctuation in words.
 */
import { describe, it, expect } from 'vitest';
import { extractWords, extractWordsWithFormatting } from './wordIndexing';

describe('wordIndexing', () => {
  describe('extractWords', () => {
    it('should extract simple words', () => {
      const words = extractWords('For God so loved the world');
      expect(words).toEqual(['For', 'God', 'so', 'loved', 'the', 'world']);
    });

    it('should handle HTML tags', () => {
      const words = extractWords('<span class="christ-words">For God</span> so loved');
      expect(words).toEqual(['For', 'God', 'so', 'loved']);
    });

    /**
     * KAN-10: Trailing punctuation should NOT be included in words
     * Words like "Pharisees," should be extracted as "Pharisees" (without comma)
     */
    it('should NOT include trailing punctuation in words (KAN-10)', () => {
      const verse = 'There was a man of the Pharisees, named Nicodemus, a ruler of the Jews:';
      const words = extractWords(verse);

      // Punctuation should be separate from words
      expect(words).toContain('Pharisees');
      expect(words).not.toContain('Pharisees,');

      expect(words).toContain('Nicodemus');
      expect(words).not.toContain('Nicodemus,');

      expect(words).toContain('Jews');
      expect(words).not.toContain('Jews:');
    });

    it('should handle various punctuation marks (KAN-10)', () => {
      const verse = 'Jesus said, "I am the way." Peter asked: "How?"';
      const words = extractWords(verse);

      // Words should not include punctuation
      expect(words).toContain('said');
      expect(words).not.toContain('said,');

      expect(words).toContain('way');
      expect(words).not.toContain('way."');

      expect(words).toContain('asked');
      expect(words).not.toContain('asked:');
    });

    it('should handle contractions and apostrophes within words', () => {
      const verse = "He can't do it, but I'll try";
      const words = extractWords(verse);

      // Apostrophes within words should be preserved
      expect(words).toContain("can't");
      expect(words).toContain("I'll");
    });

    it('should handle parenthetical text', () => {
      const verse = 'The man (Nicodemus) came by night';
      const words = extractWords(verse);

      expect(words).toContain('Nicodemus');
      expect(words).not.toContain('(Nicodemus)');
    });
  });

  describe('extractWordsWithFormatting', () => {
    it('should track trailing spaces correctly', () => {
      const words = extractWordsWithFormatting('For God so loved');

      expect(words.length).toBe(4);
      expect(words[0].text).toBe('For');
      expect(words[0].hasTrailingSpace).toBe(true);
      expect(words[3].text).toBe('loved');
      expect(words[3].hasTrailingSpace).toBe(false);
    });

    it('should identify christ-words', () => {
      const words = extractWordsWithFormatting('<span class="christ-words">For God</span> so loved');

      expect(words[0].isChristWords).toBe(true);
      expect(words[1].isChristWords).toBe(true);
      expect(words[2].isChristWords).toBe(false);
      expect(words[3].isChristWords).toBe(false);
    });

    /**
     * KAN-10: Punctuation should be tracked separately from word text
     * - text: clean word for indexing/highlight matching
     * - displayText: full text with punctuation for rendering
     */
    it('should separate clean text from display text with punctuation (KAN-10)', () => {
      const words = extractWordsWithFormatting('Pharisees, named');

      // text should be clean (no punctuation) for highlight matching
      expect(words[0].text).toBe('Pharisees');
      expect(words[0].text).not.toBe('Pharisees,');

      // displayText should include punctuation for rendering
      expect(words[0].displayText).toBe('Pharisees,');
    });

    it('should preserve punctuation in displayText for full verse (KAN-10)', () => {
      const verse = 'There was a man of the Pharisees, named Nicodemus, a ruler of the Jews:';
      const words = extractWordsWithFormatting(verse);

      // Find the word "Pharisees"
      const phariseesWord = words.find(w => w.text === 'Pharisees');
      expect(phariseesWord).toBeDefined();
      expect(phariseesWord!.displayText).toBe('Pharisees,');

      // Find the word "Jews"
      const jewsWord = words.find(w => w.text === 'Jews');
      expect(jewsWord).toBeDefined();
      expect(jewsWord!.displayText).toBe('Jews:');
    });
  });
});
