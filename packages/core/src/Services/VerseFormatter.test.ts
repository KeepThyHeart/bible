import { describe, it, expect } from 'vitest';
import { formatVerseText, stripOsisTags, highlightSearchTerms } from './VerseFormatter';
import { BibleVerse } from '../Data/Models/Bible/BibleVerse';

/** Helper to build a BibleVerse for testing */
function makeVerse(overrides: Partial<ConstructorParameters<typeof BibleVerse>[0]> = {}): BibleVerse {
  return new BibleVerse({
    verseId: 43003016,
    text: 'For God so loved the world',
    ...overrides,
  });
}

// ==========================================================================
// formatVerseText()
// ==========================================================================

describe('formatVerseText', () => {
  it('should return plain text unchanged when no special formatting exists', () => {
    const result = formatVerseText(makeVerse({ text: 'In the beginning God created' }));
    expect(result.textHtml).toBe('In the beginning God created');
    expect(result.isParagraphStart).toBe(false);
    expect(result.sectionHeading).toBeUndefined();
  });

  // --- Tag stripping ---

  it('should strip legacy <font> tags', () => {
    const verse = makeVerse({ text: '<font color="red">Jesus</font> said' });
    expect(formatVerseText(verse).textHtml).toBe('Jesus said');
  });

  it('should strip <font> tags with multiple attributes', () => {
    const verse = makeVerse({ text: '<font size="3" face="Arial">word</font>' });
    expect(formatVerseText(verse).textHtml).toBe('word');
  });

  it('should strip OSIS/SWORD XML tags', () => {
    const verse = makeVerse({
      text: 'the <transChange type="added">LORD</transChange> is my shepherd',
    });
    expect(formatVerseText(verse).textHtml).toBe('the LORD is my shepherd');
  });

  it('should strip multiple different OSIS tags (divineName becomes a styled span, not stripped)', () => {
    const verse = makeVerse({
      text: '<divineName>LORD</divineName> <catchWord>said</catchWord> unto <hi type="bold">Moses</hi>',
    });
    expect(formatVerseText(verse).textHtml).toBe(
      '<span class="divine-name">Lord</span> said unto Moses'
    );
  });

  it('should strip self-closing and nested OSIS tags', () => {
    const verse = makeVerse({
      text: '<note type="x-study">test</note><seg>word</seg>',
    });
    expect(formatVerseText(verse).textHtml).toBe('testword');
  });

  // --- Pilcrow / paragraph detection ---

  it('should detect pilcrow character and mark paragraph start', () => {
    const verse = makeVerse({ text: '\u00B6In the beginning' });
    const result = formatVerseText(verse);
    expect(result.isParagraphStart).toBe(true);
    expect(result.textHtml).not.toContain('\u00B6');
  });

  it('should detect pilcrow even in middle of text', () => {
    const verse = makeVerse({ text: 'And \u00B6 he said' });
    const result = formatVerseText(verse);
    expect(result.isParagraphStart).toBe(true);
    expect(result.textHtml).toBe('And  he said');
  });

  it('should detect paragraph start from formattingData (camelCase)', () => {
    const verse = makeVerse({
      text: 'Hello world',
      formattingData: { paragraphStart: true },
    });
    expect(formatVerseText(verse).isParagraphStart).toBe(true);
  });

  it('should detect paragraph start from formattingData (snake_case)', () => {
    const verse = makeVerse({
      text: 'Hello world',
      formattingData: { paragraph_start: true } as never,
    });
    expect(formatVerseText(verse).isParagraphStart).toBe(true);
  });

  it('should not mark paragraph start when formattingData is absent', () => {
    const verse = makeVerse({ text: 'No paragraph marker' });
    expect(formatVerseText(verse).isParagraphStart).toBe(false);
  });

  // --- Words of Christ ---

  it('should wrap Words of Christ in span tags (camelCase)', () => {
    const verse = makeVerse({
      text: 'He said I am the way the truth',
      formattingData: {
        wordsOfChrist: [{ start: 2, end: 6 }],
      },
    });
    const result = formatVerseText(verse);
    expect(result.textHtml).toContain('<span class="christ-words">');
    expect(result.textHtml).toContain('</span>');
    // "I am the way the truth" should be wrapped (words 2-6)
    expect(result.textHtml).toContain('I');
  });

  it('should wrap Words of Christ (snake_case)', () => {
    const verse = makeVerse({
      text: 'He said Follow me now',
      formattingData: {
        words_of_christ: [{ start: 2, end: 3 }],
      } as never,
    });
    const result = formatVerseText(verse);
    expect(result.textHtml).toContain('<span class="christ-words">');
  });

  it('should handle multiple Words of Christ ranges', () => {
    const verse = makeVerse({
      text: 'word0 word1 word2 word3 word4 word5',
      formattingData: {
        wordsOfChrist: [{ start: 1, end: 2 }, { start: 4, end: 5 }],
      },
    });
    const result = formatVerseText(verse);
    // Should have two separate spans
    const spanCount = (result.textHtml.match(/<span class="christ-words">/g) || []).length;
    expect(spanCount).toBe(2);
  });

  it('should not add Words of Christ span when array is empty', () => {
    const verse = makeVerse({
      text: 'Normal text here',
      formattingData: { wordsOfChrist: [] },
    });
    const result = formatVerseText(verse);
    expect(result.textHtml).not.toContain('christ-words');
  });

  // --- Section headings ---

  it('should extract section heading from formattingData', () => {
    const verse = makeVerse({
      text: 'For God so loved the world',
      formattingData: { sectionHeading: 'The Love of God' },
    });
    const result = formatVerseText(verse);
    expect(result.sectionHeading).toBe('The Love of God');
  });

  it('should strip HTML from section headings', () => {
    const verse = makeVerse({
      text: 'text',
      formattingData: { sectionHeading: '<title>The Heading</title>' },
    });
    const result = formatVerseText(verse);
    expect(result.sectionHeading).toBe('The Heading');
  });

  it('should return undefined for empty section heading after stripping tags', () => {
    const verse = makeVerse({
      text: 'text',
      formattingData: { sectionHeading: '<title></title>' },
    });
    const result = formatVerseText(verse);
    expect(result.sectionHeading).toBeUndefined();
  });

  it('should return undefined when no section heading exists', () => {
    const verse = makeVerse({ text: 'text' });
    expect(formatVerseText(verse).sectionHeading).toBeUndefined();
  });

  // --- Combined formatting ---

  it('should handle pilcrow + OSIS tags + font tags together', () => {
    const verse = makeVerse({
      text: '\u00B6<font color="red"><divineName>LORD</divineName></font> spoke',
    });
    const result = formatVerseText(verse);
    expect(result.textHtml).toBe('<span class="divine-name">Lord</span> spoke');
    expect(result.isParagraphStart).toBe(true);
  });

  // --- divineName (Tetragrammaton small-caps styling) ---

  it('should wrap divineName content in a styled span instead of stripping it', () => {
    const verse = makeVerse({
      text: 'the <divineName>LORD</divineName> is my shepherd',
    });
    expect(formatVerseText(verse).textHtml).toBe(
      'the <span class="divine-name">Lord</span> is my shepherd'
    );
  });

  it('should leave text unchanged when no divineName tag is present', () => {
    const verse = makeVerse({ text: 'In the beginning God created the heavens' });
    expect(formatVerseText(verse).textHtml).toBe('In the beginning God created the heavens');
  });

  it('should wrap multiple separate divineName occurrences, each in their own span', () => {
    const verse = makeVerse({
      text: '<divineName>LORD</divineName> said unto my <divineName>Lord</divineName>',
    });
    expect(formatVerseText(verse).textHtml).toBe(
      '<span class="divine-name">Lord</span> said unto my <span class="divine-name">Lord</span>'
    );
  });

  it('should strip nested OSIS tags found inside a divineName span', () => {
    const verse = makeVerse({
      text: 'the <divineName><hi type="bold">LORD</hi></divineName> reigns',
    });
    expect(formatVerseText(verse).textHtml).toBe(
      'the <span class="divine-name">Lord</span> reigns'
    );
  });

  it('should handle a divineName tag with attributes on the opening tag', () => {
    const verse = makeVerse({
      text: 'the <divineName type="x-yahweh">LORD</divineName> alone',
    });
    expect(formatVerseText(verse).textHtml).toBe(
      'the <span class="divine-name">Lord</span> alone'
    );
  });

  it('should preserve the divine-name span through Words of Christ word-rebuilding', () => {
    // Regression: the WoC block strips *actual* HTML tags via a blanket
    // `<[^>]*>` replace while splitting text into words, then rebuilds the
    // string purely from that word array. If divineName were converted to a
    // real <span> before that point, it would be silently discarded here.
    const verse = makeVerse({
      text: 'Hear, the <divineName>LORD</divineName> our God is one LORD',
      formattingData: {
        wordsOfChrist: [{ start: 0, end: 7 }],
      },
    });
    const result = formatVerseText(verse);
    expect(result.textHtml).toContain('<span class="divine-name">Lord</span>');
    expect(result.textHtml).toContain('<span class="christ-words">');
    // The divine-name span must survive *inside* the christ-words span, not be lost.
    expect(result.textHtml).toBe(
      '<span class="christ-words">Hear, the <span class="divine-name">Lord</span> our God is one LORD</span>'
    );
  });

  // --- divineName driven by word-indexed spans (module format v2) ---
  //
  // This is the path that actually fires for shipped modules. v2 stores clean,
  // markup-free text and carries the Tetragrammaton as a `divine_name` span in
  // `bible_verse.formatting` - e.g. KJV Gen 2:4 is stored as "...that the Lord
  // God made..." with a span at word 20. There is no literal <divineName> tag
  // to match, so the tag-based tests above never exercise this at all.

  it('should wrap a divine-name word range even with no markup in the text', () => {
    const verse = makeVerse({
      text: 'in the day that the Lord God made the earth',
      formattingData: { divineName: [{ start: 5, end: 5 }] },
    });
    expect(formatVerseText(verse).textHtml).toBe(
      'in the day that the <span class="divine-name">Lord</span> God made the earth'
    );
  });

  it('should wrap a multi-word divine-name range as one span', () => {
    const verse = makeVerse({
      text: 'the Lord God is my strength',
      formattingData: { divineName: [{ start: 1, end: 2 }] },
    });
    expect(formatVerseText(verse).textHtml).toBe(
      'the <span class="divine-name">Lord God</span> is my strength'
    );
  });

  it('should wrap several separate divine-name ranges independently', () => {
    const verse = makeVerse({
      text: 'the Lord said unto my Lord',
      formattingData: { divineName: [{ start: 1, end: 1 }, { start: 5, end: 5 }] },
    });
    expect(formatVerseText(verse).textHtml).toBe(
      'the <span class="divine-name">Lord</span> said unto my <span class="divine-name">Lord</span>'
    );
  });

  it('should nest a divine-name span inside an overlapping words-of-Christ span', () => {
    const verse = makeVerse({
      text: 'Hear O Israel the Lord our God',
      formattingData: {
        wordsOfChrist: [{ start: 0, end: 6 }],
        divineName: [{ start: 4, end: 4 }],
      },
    });
    expect(formatVerseText(verse).textHtml).toBe(
      '<span class="christ-words">Hear O Israel the <span class="divine-name">Lord</span> our God</span>'
    );
  });

  it('should split a divine-name span that straddles a words-of-Christ boundary', () => {
    // Legal nesting matters more than span count: leaving the inner span open
    // across the outer boundary would emit crossed tags that a browser silently
    // reinterprets, corrupting everything after it.
    const verse = makeVerse({
      text: 'said the Lord God almighty',
      formattingData: {
        wordsOfChrist: [{ start: 0, end: 2 }],
        divineName: [{ start: 2, end: 3 }],
      },
    });
    expect(formatVerseText(verse).textHtml).toBe(
      '<span class="christ-words">said the <span class="divine-name">Lord</span></span>' +
        ' <span class="divine-name">God</span> almighty'
    );
  });

  it('should clamp a divine-name range that runs past the end of the verse', () => {
    // A malformed range must not read past the word array or drop the verse;
    // it is truncated at the last word. (Both covered words get the casing
    // treatment, which is why "reigns" comes back capitalized here.)
    const verse = makeVerse({
      text: 'the Lord reigns',
      formattingData: { divineName: [{ start: 1, end: 99 }] },
    });
    expect(formatVerseText(verse).textHtml).toBe(
      'the <span class="divine-name">Lord Reigns</span>'
    );
  });

  it('should normalize divine-name casing regardless of how the source wrote it', () => {
    // CrossWire's KJV stores "Lord" and leaves the convention to the renderer;
    // other modules bake in "LORD". Both must come out identical, because the
    // stylesheet is a bare small-caps rule with no case handling of its own.
    const fromTitleCase = makeVerse({
      text: 'the Lord reigns',
      formattingData: { divineName: [{ start: 1, end: 1 }] },
    });
    const fromAllCaps = makeVerse({
      text: 'the LORD reigns',
      formattingData: { divineName: [{ start: 1, end: 1 }] },
    });
    const expected = 'the <span class="divine-name">Lord</span> reigns';
    expect(formatVerseText(fromTitleCase).textHtml).toBe(expected);
    expect(formatVerseText(fromAllCaps).textHtml).toBe(expected);
  });

  it('should capitalize the first letter past any leading punctuation', () => {
    const verse = makeVerse({
      text: 'cried "LORD save me',
      formattingData: { divineName: [{ start: 1, end: 1 }] },
    });
    expect(formatVerseText(verse).textHtml).toBe(
      'cried <span class="divine-name">"Lord</span> save me'
    );
  });

  it('should leave text untouched when the divine-name range list is empty', () => {
    const verse = makeVerse({
      text: 'the Lord reigns',
      formattingData: { divineName: [] },
    });
    expect(formatVerseText(verse).textHtml).toBe('the Lord reigns');
  });
});

// ==========================================================================
// stripOsisTags()
// ==========================================================================

describe('stripOsisTags', () => {
  it('should strip divineName tags', () => {
    expect(stripOsisTags('the <divineName>LORD</divineName>')).toBe('the LORD');
  });

  it('should strip transChange tags with attributes', () => {
    expect(stripOsisTags('<transChange type="added">added</transChange>')).toBe('added');
  });

  it('should strip multiple different tags', () => {
    const input = '<hi type="bold">bold</hi> and <foreign>foreign</foreign>';
    expect(stripOsisTags(input)).toBe('bold and foreign');
  });

  it('should strip the OSIS word tag, including the self-closing form', () => {
    // Verbatim from bible_kjv's interlinear data for Romans 4:18. `w` was
    // missing from the tag alternation, so this returned unchanged and the
    // raw markup rendered as literal text in the interlinear view.
    const input = '<w savlm="strong:G3588 lemma.TR:το" src="8"/><w savlm="strong:G3739 lemma.TR:ος" src="1">Who';
    expect(stripOsisTags(input)).toBe('Who');
  });

  it('should strip a closing w tag', () => {
    expect(stripOsisTags('<w lemma="strong:G2316">God</w>')).toBe('God');
  });

  it('should not mistake a tag whose name merely starts with w', () => {
    expect(stripOsisTags('<word>kept</word>')).toBe('<word>kept</word>');
  });

  it('should not strip non-OSIS HTML tags', () => {
    expect(stripOsisTags('<p>paragraph</p>')).toBe('<p>paragraph</p>');
    expect(stripOsisTags('<div>div</div>')).toBe('<div>div</div>');
  });

  it('should return empty string for empty input', () => {
    expect(stripOsisTags('')).toBe('');
  });

  it('should return text unchanged if no OSIS tags present', () => {
    expect(stripOsisTags('plain text')).toBe('plain text');
  });

  it('should handle all known OSIS tag names', () => {
    const tags = ['divineName', 'transChange', 'catchWord', 'rdg', 'seg', 'hi', 'foreign',
      'inscription', 'mentioned', 'name', 'note', 'title', 'q'];
    for (const tag of tags) {
      expect(stripOsisTags(`<${tag}>x</${tag}>`)).toBe('x');
    }
  });
});

// ==========================================================================
// highlightSearchTerms()
// ==========================================================================

describe('highlightSearchTerms', () => {
  it('should wrap matching terms in <strong><u> tags', () => {
    const result = highlightSearchTerms('For God so loved the world', ['God']);
    expect(result).toBe('For <strong><u>God</u></strong> so loved the world');
  });

  it('should be case-insensitive', () => {
    const result = highlightSearchTerms('For God so loved', ['god']);
    expect(result).toContain('<strong><u>God</u></strong>');
  });

  it('should handle multiple terms', () => {
    const result = highlightSearchTerms('For God so loved the world', ['God', 'world']);
    expect(result).toContain('<strong><u>God</u></strong>');
    expect(result).toContain('<strong><u>world</u></strong>');
  });

  it('should match only whole words (word boundaries)', () => {
    const result = highlightSearchTerms('Godly and God and ungodly', ['God']);
    // Should only match standalone "God", not "Godly" or "ungodly"
    expect(result).toBe('Godly and <strong><u>God</u></strong> and ungodly');
  });

  it('should handle duplicate terms without double-wrapping', () => {
    const result = highlightSearchTerms('God is God', ['God', 'God']);
    const count = (result.match(/<strong><u>/g) || []).length;
    expect(count).toBe(2); // Two instances of "God"
  });

  it('should return original html when terms array is empty', () => {
    const html = 'some text';
    expect(highlightSearchTerms(html, [])).toBe(html);
  });

  it('should return original html when terms is undefined-like', () => {
    expect(highlightSearchTerms('text', [])).toBe('text');
  });

  it('should escape regex special characters in terms without throwing', () => {
    // Regex special chars like $, ., etc. are escaped so they don't break the regex.
    // Note: \b word boundary may not match around non-word chars like $,
    // so we just verify it doesn't throw and returns a string.
    expect(() => highlightSearchTerms('price is $100.00 today', ['$100.00'])).not.toThrow();
  });

  it('should highlight terms containing regex metacharacters when at word boundaries', () => {
    // Parentheses and brackets are regex special chars
    const result = highlightSearchTerms('the word (test) here', ['test']);
    expect(result).toContain('<strong><u>test</u></strong>');
  });

  it('should handle multiple occurrences of the same term', () => {
    const result = highlightSearchTerms('love your love for love', ['love']);
    const count = (result.match(/<strong><u>/g) || []).length;
    expect(count).toBe(3);
  });
});
