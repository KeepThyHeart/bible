import { describe, it, expect } from 'vitest';
import { tokenizeVerse, verseWords } from '../tokenize';

/**
 * The contract these tests defend is agreement, not correctness in the
 * abstract: a highlight travels as word indices, so the controller and every
 * viewer must split a verse into the same words. Anything that changes the
 * numbering here silently repaints the wrong words on a wall.
 */

describe('splitting into words', () => {
  it('indexes plain text 0-based', () => {
    expect(verseWords('For God so loved the world')).toEqual(
      ['For', 'God', 'so', 'loved', 'the', 'world'],
    );
  });

  it('strips punctuation for indexing but keeps it for display', () => {
    const tokens = tokenizeVerse('loved, the world:');
    expect(tokens.map(t => t.text)).toEqual(['loved', 'the', 'world']);
    expect(tokens.map(t => t.displayText)).toEqual(['loved,', 'the', 'world:']);
  });

  it('keeps apostrophes inside a word', () => {
    // "can't" is one word, not two, and "Lord's" is not "Lord" plus "s".
    expect(verseWords("can't the Lord's own")).toEqual(["can't", 'the', "Lord's", 'own']);
  });

  it('keeps a punctuation-only run as its own token', () => {
    // It still has to be rendered, so dropping it would lose text from the wall.
    const tokens = tokenizeVerse('word -- word');
    expect(tokens.map(t => t.displayText)).toEqual(['word', '--', 'word']);
  });

  it('collapses runs of whitespace without producing empty words', () => {
    expect(verseWords('  For   God \n so  ')).toEqual(['For', 'God', 'so']);
  });

  it('is empty for empty input', () => {
    expect(tokenizeVerse('')).toEqual([]);
    expect(tokenizeVerse('   ')).toEqual([]);
  });
});

describe('markup does not change the numbering', () => {
  it('ignores tags when counting words', () => {
    // The whole point: formatting is a rendering concern, and a translation
    // that italicises a supplied word must not shift every index after it.
    expect(verseWords('<span class="christ-words">For God</span> so <i>loved</i>'))
      .toEqual(['For', 'God', 'so', 'loved']);
  });

  it('does not weld words together across a tag boundary', () => {
    // "God</span> so" must not become "Godso".
    const tokens = tokenizeVerse('<span class="christ-words">For God</span> so loved');
    expect(tokens.map(t => t.text)).toEqual(['For', 'God', 'so', 'loved']);
    expect(tokens[1].hasTrailingSpace).toBe(true);
  });

  it('splits a word broken by a tag, matching the desktop', () => {
    // `be<i>lo</i>ved` becomes three tokens, not one. That is arguably the
    // wrong answer in the abstract -- but it is what the desktop's
    // `extractWordsWithFormatting` produces, because it walks text nodes
    // independently, and agreeing with the existing convention matters far more
    // than being tidier than it. Diverging here would renumber every later word
    // in the verse relative to a highlight saved on the desktop.
    //
    // The rendered text is unaffected: the fragments carry no trailing space
    // and reassemble to "beloved".
    expect(verseWords('be<i>lo</i>ved')).toEqual(['be', 'lo', 'ved']);
    const rebuilt = tokenizeVerse('be<i>lo</i>ved')
      .map(t => t.displayText + (t.hasTrailingSpace ? ' ' : ''))
      .join('');
    expect(rebuilt).toBe('beloved');
  });

  it('survives an unterminated tag rather than printing it', () => {
    expect(verseWords('For God <span class="christ')).toEqual(['For', 'God']);
  });

  it('ignores tags it does not know', () => {
    expect(verseWords('<sup>x</sup>For <b>God</b> so')).toEqual(['x', 'For', 'God', 'so']);
  });
});

describe('formatting carried on each word', () => {
  it('marks the words of Christ', () => {
    const tokens = tokenizeVerse('<span class="christ-words">For God</span> so loved');
    expect(tokens.map(t => t.isChristWords)).toEqual([true, true, false, false]);
  });

  it('marks supplied words from either italic tag', () => {
    expect(tokenizeVerse('the <i>a</i> and <em>b</em>').map(t => t.isItalic))
      .toEqual([false, true, false, true]);
  });

  it('marks the divine name', () => {
    const tokens = tokenizeVerse('the <span class="divine-name">LORD</span> said');
    expect(tokens.map(t => t.isDivineName)).toEqual([false, true, false]);
  });

  it('handles the nesting core actually emits', () => {
    // christ-words is the outer span and divine-name the inner one.
    const tokens = tokenizeVerse(
      '<span class="christ-words">I am the <span class="divine-name">LORD</span> God</span>',
    );
    expect(tokens.map(t => t.text)).toEqual(['I', 'am', 'the', 'LORD', 'God']);
    expect(tokens.every(t => t.isChristWords)).toBe(true);
    expect(tokens.map(t => t.isDivineName)).toEqual([false, false, false, true, false]);
  });

  it('closes a nested span without closing the one outside it', () => {
    const tokens = tokenizeVerse(
      '<span class="christ-words">a <span class="divine-name">b</span> c</span> d',
    );
    expect(tokens.map(t => t.isChristWords)).toEqual([true, true, true, false]);
  });

  it('is not confused by extra classes on the span', () => {
    const tokens = tokenizeVerse('<span class="foo christ-words bar">word</span>');
    expect(tokens[0].isChristWords).toBe(true);
  });

  it('does not let a void tag swallow the formatting that follows', () => {
    // `<br>` has no closing partner; treating it as one would pop the wrong
    // entry off the stack and un-format the rest of the verse.
    const tokens = tokenizeVerse('<span class="christ-words">a<br/>b</span> c');
    expect(tokens.map(t => t.isChristWords)).toEqual([true, true, false]);
  });
});

describe('entities', () => {
  it('decodes the named entities this content uses', () => {
    expect(verseWords('Moses &amp; Aaron')).toEqual(['Moses', '&', 'Aaron']);
    expect(tokenizeVerse('the Lord&rsquo;s').map(t => t.text)).toEqual(['the', 'Lord’s']);
  });

  it('decodes numeric references in both bases', () => {
    expect(tokenizeVerse('a&#8212;b').map(t => t.displayText)).toEqual(['a—b']);
    expect(tokenizeVerse('a&#x2014;b').map(t => t.displayText)).toEqual(['a—b']);
  });

  it('leaves something it cannot decode exactly as written', () => {
    // Better a visible oddity than a replacement glyph in front of a room.
    expect(tokenizeVerse('a&notanentity;b').map(t => t.displayText)).toEqual(['a&notanentity;b']);
  });

  it('treats a non-breaking space as a word separator', () => {
    expect(verseWords('For&nbsp;God')).toEqual(['For', 'God']);
  });
});

describe('reassembling the text', () => {
  it('round-trips to the original spacing', () => {
    // This is what makes rendering word-by-word safe: the wall must look the
    // same as it did when the verse was one blob of HTML.
    const html = '<span class="christ-words">For God</span> so <i>loved</i> the world.';
    const rebuilt = tokenizeVerse(html)
      .map(t => t.displayText + (t.hasTrailingSpace ? ' ' : ''))
      .join('');
    expect(rebuilt).toBe('For God so loved the world.');
  });
});
