/**
 * Unit tests for Word Indexing
 *
 * Tests the functionality of extracting words from Bible verse HTML,
 * particularly ensuring proper word boundary behavior with punctuation.
 *
 * KAN-10: Word break behavior should not include trailing punctuation in words.
 */
import { describe, it, expect } from 'vitest';
import { extractWords, extractWordsWithFormatting, countWordsInRange } from './WordIndexing';

/** Verse HTML shapes the formatter actually emits. */
const FIXTURES: Array<[name: string, html: string]> = [
  ['plain text', 'In the beginning God created the heaven and the earth.'],
  ['empty string', ''],
  ['words of Christ', 'He said <span class="christ-words">I am the way</span> to them.'],
  ['divine name', 'the <span class="divine-name">Lord</span> is my shepherd'],
  [
    'divine name nested in words of Christ',
    '<span class="christ-words">I am the <span class="divine-name">Lord</span> your God</span>',
  ],
  ['punctuation', 'Jesus wept. And they said, "Behold!"'],
  ['leading and trailing whitespace', '   spaced out   '],
  ['whitespace split across element boundaries', '<span class="christ-words">Come</span> <span>unto me</span>'],
  ['adjacent spans with no space between', '<span class="christ-words">Come</span><span>unto</span>'],
  ['multiple spaces between words', 'a  b   c'],
  ['newlines as whitespace', 'first\nsecond\tthird'],
  ['em dash inside a word run', 'life — and that more abundantly'],
  ['numeric and punctuation-only tokens', '3:16 — "..." ;'],
];

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

describe('extractWordsWithFormatting - formatting flags and spacing', () => {
  it('splits plain text into one entry per word', () => {
    const words = extractWordsWithFormatting('In the beginning God');

    expect(words.map(w => w.text)).toEqual(['In', 'the', 'beginning', 'God']);
    expect(words.every(w => !w.isChristWords && !w.isDivineName)).toBe(true);
  });

  it('returns nothing for empty input', () => {
    expect(extractWordsWithFormatting('')).toEqual([]);
  });

  it('strips punctuation from `text` but keeps it in `displayText`', () => {
    // The two forms exist for different jobs: matching against Strong's data
    // uses `text`, rendering uses `displayText`.
    const [wept, and] = extractWordsWithFormatting('wept. And');

    expect(wept.text).toBe('wept');
    expect(wept.displayText).toBe('wept.');
    expect(and.text).toBe('And');
  });

  it('flags only the words inside a christ-words span', () => {
    const words = extractWordsWithFormatting('He said <span class="christ-words">I am</span> there');

    expect(words.filter(w => w.isChristWords).map(w => w.text)).toEqual(['I', 'am']);
  });

  it('flags the divine name separately from words of Christ', () => {
    const words = extractWordsWithFormatting(
      '<span class="christ-words">I am the <span class="divine-name">Lord</span></span>',
    );

    expect(words.map(w => w.text)).toEqual(['I', 'am', 'the', 'Lord']);
    expect(words.every(w => w.isChristWords)).toBe(true);
    expect(words.filter(w => w.isDivineName).map(w => w.text)).toEqual(['Lord']);
  });

  it('records the space that separates two spans', () => {
    // Element boundaries split a single space across two text nodes, so the
    // space belongs to the *previous* word. Losing it runs the words together
    // when the tokens are re-rendered.
    const words = extractWordsWithFormatting('<span class="christ-words">Come</span> <span>unto me</span>');

    expect(words.map(w => w.text)).toEqual(['Come', 'unto', 'me']);
    expect(words[0].hasTrailingSpace).toBe(true);
    expect(words[words.length - 1].hasTrailingSpace).toBe(false);
  });

  it('does not invent a space between adjacent spans', () => {
    const words = extractWordsWithFormatting('<span class="christ-words">Come</span><span>unto</span>');

    expect(words[0].hasTrailingSpace).toBe(false);
  });

  it('ignores runs of whitespace rather than emitting empty words', () => {
    expect(extractWordsWithFormatting('a  b   c').map(w => w.text)).toEqual(['a', 'b', 'c']);
    expect(extractWordsWithFormatting('   ').map(w => w.text)).toEqual([]);
  });
});


describe('extractWordsWithFormatting - fixtures', () => {
  // Every shape the formatter emits must tokenise into well-formed words.
  it.each(FIXTURES)('tokenises %s without throwing', (_name, html) => {
    for (const word of extractWordsWithFormatting(html)) {
      expect(typeof word.text).toBe('string');
      expect(word.text).not.toBe('');
    }
  });
});

// The interlinear index space is the token sequence, so the string walk has to
// agree with what an HTML parser would have produced for these markup shapes.
describe('extractWordsWithFormatting - markup handling (DOM-free)', () => {
  const texts = (html: string) => extractWordsWithFormatting(html).map(w => w.text);

  it('ignores tags and comments but splits text at them', () => {
    expect(texts('<sup>16</sup> For <!-- note --> God <em>so</em>loved')).toEqual(['16', 'For', 'God', 'so', 'loved']);
  });

  it('decodes entities the way a parser would', () => {
    expect(texts('Tom &amp; Jerry&nbsp;ran')).toEqual(['Tom', '&', 'Jerry', 'ran']);
  });

  it('treats a < that starts no tag as text', () => {
    expect(texts('2 < 3 and 4 > 1')).toEqual(['2', '<', '3', 'and', '4', '>', '1']);
  });

  it('reads class lists, single-quoted and unquoted classes', () => {
    const flags = (html: string) => extractWordsWithFormatting(html).map(w => [w.isChristWords, w.isDivineName]);
    expect(flags("<span class='x christ-words'>a</span> b")).toEqual([[true, false], [false, false]]);
    expect(flags('<span class=divine-name>a</span>')).toEqual([[false, true]]);
    expect(flags('<span class="christ-words-not">a</span>')).toEqual([[false, false]]);
  });

  it('does not open an element for void tags', () => {
    const words = extractWordsWithFormatting('a<br class="christ-words">b');
    expect(words.map(w => w.isChristWords)).toEqual([false, false]);
  });

  it('closes flags at the matching end tag and ignores a stray one', () => {
    const words = extractWordsWithFormatting('</span><span class="christ-words">a</span> b');
    expect(words.map(w => w.isChristWords)).toEqual([true, false]);
  });

  it('keeps the flag through nested inner elements', () => {
    const words = extractWordsWithFormatting('<span class="christ-words">a <i>b</i> c</span> d');
    expect(words.map(w => w.isChristWords)).toEqual([true, true, true, false]);
  });
});

describe('countWordsInRange', () => {
  it('sums the words across verses', () => {
    expect(countWordsInRange(['For God', '<i>so</i> loved the world', ''])).toBe(6);
    expect(countWordsInRange([])).toBe(0);
  });
});
