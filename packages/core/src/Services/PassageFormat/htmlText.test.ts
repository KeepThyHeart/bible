/**
 * The string HTML handling, pinned to the DOM round-trip it replaced.
 *
 * `getCleanVerseText` and `getVerseTextWithRed` used to strip and normalise
 * markup by assigning to `innerHTML` and reading `textContent` / `innerHTML`
 * back. That kept the format engine trapped in a renderer. The expectations
 * below are not invented: every one of them was produced by running the input
 * through the *old* jsdom implementation and recording what came out, so this
 * file is the record of what the rewrite had to preserve.
 *
 * The four inputs that matter are the ones real module text actually contains
 * - `VerseFormatter.formatVerseText()` writes `<span class="christ-words">`
 * and `<span class="divine-name">`, older conversions leave
 * `<font color="red">`, and SWORD sources leave `<transChange>` added-word
 * markup and `<note>` footnotes. A scan of every `bible_*.db` in the repo's
 * module set finds no HTML entity in any verse and only two stray literal
 * tags, so the entity cases below are guards, not the common path.
 *
 * Three deliberate divergences are asserted as such at the bottom.
 */
import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities, escapeStrayMarkup, stripHtmlTags } from './htmlText';
import { getCleanVerseText, getVerseTextWithRed, stripHtml } from './formatHelpers';
import type { PassageVerse } from './types';

/** A verse carrying `html` as its markup, for the red-letter path. */
function withHtml(html: string): PassageVerse {
  return { verse_id: 43003016, book_number: 43, chapter: 3, verse: 16, text: '', text_html: html };
}

/** A verse carrying `text` only, for the plain path. */
function withText(text: string): PassageVerse {
  return { verse_id: 43003016, book_number: 43, chapter: 3, verse: 16, text };
}

describe('stripHtml — parity with the DOM textContent read', () => {
  // input -> what the jsdom implementation produced
  const CASES: ReadonlyArray<readonly [string, string]> = [
    ['<b>bold</b> text', 'bold text'],
    ['<div><span>nested</span></div>', 'nested'],
    ['  multiple   spaces  ', 'multiple spaces'],
    ['¶ For God so loved the world', 'For God so loved the world'],
    ['one ¶ two', 'one two'],
    // Words of Christ: the class is dropped along with the tag.
    [
      'that whosoever <span class="christ-words">believeth in him</span> should not perish',
      'that whosoever believeth in him should not perish',
    ],
    // Divine name, as VerseFormatter writes it.
    ['Then said <span class="divine-name">Lord</span> unto him', 'Then said Lord unto him'],
    // Italics / added words, both the HTML and the OSIS spelling.
    ['And God said, <i>Let</i> there be light', 'And God said, Let there be light'],
    ['and the <transChange type="added">is</transChange> word', 'and the is word'],
    // Footnotes: the marker goes, and so does an inline note body - the tag is
    // removed and its content kept, which is what the parser did too.
    ['the Lord<sup class="footnote-marker">a</sup> spake', 'the Lorda spake'],
    ['the Lord<note n="a">footnote body</note> spake', 'the Lordfootnote body spake'],
    // Entities are decoded, because this returns text.
    ['Q&A and R&amp;D', 'Q&A and R&D'],
    ['less &lt; than &gt; greater', 'less < than > greater'],
    ['non&nbsp;breaking', 'non breaking'],
    ['numeric &#8212; and hex &#x2014;', 'numeric — and hex —'],
    ['&frac12; and &eacute;', '½ and é'],
    // A "<" that begins no tag is character data, not markup.
    ['a < b > c', 'a < b > c'],
  ];

  for (const [input, expected] of CASES) {
    it(`renders ${JSON.stringify(input)} as ${JSON.stringify(expected)}`, () => {
      expect(stripHtml(input)).toBe(expected);
      expect(getCleanVerseText(withText(input))).toBe(expected);
    });
  }
});

describe('getVerseTextWithRed — parity with the DOM innerHTML round-trip', () => {
  const RED = '<span style="color: #B71C1C;">';

  // input -> what the jsdom implementation produced
  const CASES: ReadonlyArray<readonly [string, string]> = [
    ['<b>bold</b> text', '<b>bold</b> text'],
    ['  multiple   spaces  ', 'multiple spaces'],
    ['¶ For God so loved the world', 'For God so loved the world'],
    [
      'that whosoever <span class="christ-words">believeth in him</span> should not perish',
      `that whosoever ${RED}believeth in him</span> should not perish`,
    ],
    ['<span CLASS="Christ-Words">test words</span>', `${RED}test words</span>`],
    ['<font color="red">red text</font>', `${RED}red text</span>`],
    ['<font color="#FF0000">red text</font>', `${RED}red text</span>`],
    [
      'Then said <span class="divine-name">Lord</span> unto him',
      'Then said <span class="divine-name">Lord</span> unto him',
    ],
    ['And God said, <i>Let</i> there be light', 'And God said, <i>Let</i> there be light'],
    [
      'the Lord<sup class="footnote-marker">a</sup> spake',
      'the Lord<sup class="footnote-marker">a</sup> spake',
    ],
    ['the Lord<note n="a">footnote body</note> spake', 'the Lord<note n="a">footnote body</note> spake'],
    // A stray ampersand is escaped; one already spelling an entity is not.
    ['Q&A and R&amp;D', 'Q&amp;A and R&amp;D'],
    ['non&nbsp;breaking', 'non&nbsp;breaking'],
    [
      '<span class="christ-words">Verily, verily</span>, I say unto thee &amp; more',
      `${RED}Verily, verily</span>, I say unto thee &amp; more`,
    ],
  ];

  for (const [input, expected] of CASES) {
    it(`renders ${JSON.stringify(input)} as ${JSON.stringify(expected)}`, () => {
      expect(getVerseTextWithRed(withHtml(input))).toBe(expected);
    });
  }

  it('falls back to the text field when there is no markup field', () => {
    expect(getVerseTextWithRed(withText('plain text only'))).toBe('plain text only');
  });
});

describe('where the string implementation cannot match the parser', () => {
  // Each of these is a case the DOM round-trip handled by *reconstructing* the
  // document. A string transform has no document to reconstruct. None occurs in
  // module text - `VerseFormatter` writes balanced spans and no entities - and
  // in every case the divergent output renders identically in a browser.

  it('does not close an unclosed tag (the parser did)', () => {
    // jsdom produced: 'unclosed <span style="color: #B71C1C;">tag</span>'
    expect(getVerseTextWithRed(withHtml('unclosed <span class="christ-words">tag'))).toBe(
      'unclosed <span style="color: #B71C1C;">tag',
    );
  });

  it('leaves a named entity as written instead of re-encoding its character', () => {
    // jsdom produced: '½ and é'
    expect(getVerseTextWithRed(withHtml('&frac12; and &eacute;'))).toBe('&frac12; and &eacute;');
  });

  it('leaves a bare ">" unescaped, and does not lower-case a tag name', () => {
    // jsdom produced: 'a &lt; b &gt; c' and '<transchange type="added">'
    expect(getVerseTextWithRed(withHtml('a < b > c'))).toBe('a &lt; b > c');
    expect(getVerseTextWithRed(withHtml('the <transChange type="added">is</transChange> word'))).toBe(
      'the <transChange type="added">is</transChange> word',
    );
  });
});

describe('the pieces underneath', () => {
  it('decodes numeric entities in both bases and leaves unknown names alone', () => {
    expect(decodeHtmlEntities('&#65;&#x42;&nosuchentity;')).toBe('AB&nosuchentity;');
  });

  it('refuses a lone surrogate rather than emitting one', () => {
    expect(decodeHtmlEntities('&#xD800;')).toBe('&#xD800;');
  });

  it('strips only things shaped like tags', () => {
    expect(stripHtmlTags('2 < 3 and <b>4</b> > 1')).toBe('2 < 3 and 4 > 1');
    expect(stripHtmlTags('<!-- comment -->kept')).toBe('kept');
  });

  it('escapes only the markup characters doing no markup job', () => {
    expect(escapeStrayMarkup('<b>a & b</b> &amp; c &#39;d&#39; 2<3')).toBe(
      '<b>a &amp; b</b> &amp; c &#39;d&#39; 2&lt;3',
    );
  });
});
