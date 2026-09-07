/**
 * The four note-insertion shapes.
 *
 * These are the formats a sermon manuscript actually wants, so the assertions
 * are about *structure* - is it a blockquote, is each verse its own paragraph,
 * did the heading level follow the option - rather than about exact strings.
 * The verse text itself is `formatHelpers`' job and is tested with the copy
 * formats.
 */
import { describe, it, expect } from 'vitest';
import {
  renderPassageMarkup,
  passageMarkupToHtml,
  passageMarkupToText,
  passageMarkupToMarkdown,
  passageMarkupToSourceText,
  resolvePassageMarkupOptions,
  isPassageMarkupFormat,
  DEFAULT_PASSAGE_MARKUP_OPTIONS,
  type PassageInsertOptions,
} from './passageMarkup';
import type { PassageVerse, VerseContext } from './types';

const CONTEXT: VerseContext = { bookName: 'John', chapter: 3, translation: 'KJV' };

const V16: PassageVerse = {
  verse_id: 43003016,
  book_number: 43,
  chapter: 3,
  verse: 16,
  text: 'For God so loved the world',
  text_html: 'For God so loved the world',
};
const V17: PassageVerse = {
  ...V16,
  verse_id: 43003017,
  verse: 17,
  text: 'For God sent not his Son',
  text_html: 'For God sent not his Son',
};
/** Starts a new paragraph in the source text. */
const V18: PassageVerse = {
  ...V16,
  verse_id: 43003018,
  verse: 18,
  text: 'He that believeth on him',
  text_html: 'He that believeth on him',
  is_paragraph_start: true,
};

const PLAIN: PassageInsertOptions = { displayVersionNumber: true, wordsOfChristInRed: false };

function html(formatId: Parameters<typeof renderPassageMarkup>[2], options: PassageInsertOptions, verses = [V16, V17]) {
  return passageMarkupToHtml(renderPassageMarkup(verses, CONTEXT, formatId, options));
}

describe('isPassageMarkupFormat', () => {
  it('recognises the four note formats and nothing else', () => {
    expect(isPassageMarkupFormat('blockquote')).toBe(true);
    expect(isPassageMarkupFormat('heading-per-verse')).toBe(true);
    // The clipboard formats are a separate family with a separate renderer.
    expect(isPassageMarkupFormat('standard')).toBe(false);
    expect(isPassageMarkupFormat('inline')).toBe(false);
  });
});

describe('blockquote', () => {
  it('is one quote, with the verses run together', () => {
    const out = html('blockquote', PLAIN);
    expect(out).toContain('<blockquote>');
    expect(out).toContain('For God so loved the world For God sent not his Son');
    // Defaults: no verse numbers, reference cited underneath.
    expect(out).not.toContain('(16)');
    expect(out).toContain('— John 3:16-17 (KJV)');
  });

  it('breaks only where the source text marks a paragraph', () => {
    const out = html('blockquote', PLAIN, [V16, V17, V18]);
    const paragraphs = out.match(/<p>/g) ?? [];
    // Two verses in the first paragraph, v18 starting the second, plus the
    // reference line outside the quote.
    expect(paragraphs).toHaveLength(3);
    expect(out).toContain('<p>He that believeth on him</p>');
  });

  it('takes verse numbers and a leading reference when asked', () => {
    const out = html('blockquote', { ...PLAIN, verseNumbers: 'parenthetical', referencePosition: 'before' });
    expect(out).toContain('(16) For God so loved the world');
    expect(out.indexOf('John 3:16-17 (KJV)')).toBeLessThan(out.indexOf('<blockquote>'));
    expect(out).not.toContain('—');
  });

  it('drops the reference entirely on request', () => {
    const out = html('blockquote', { ...PLAIN, referencePosition: 'none' });
    expect(out).not.toContain('John 3');
  });
});

describe('blockquote-numbered', () => {
  it('gives every verse its own line inside one quote, not its own paragraph', () => {
    const out = html('blockquote-numbered', PLAIN);
    // `<br>`, not `</p><p>`: each verse needs its own line because it carries
    // its own number, but they are still one paragraph. A `<p>` per verse
    // pastes into TipTap or Word as a blank line between every verse.
    expect(out).toContain('<blockquote><p>(16) For God so loved the world<br>(17) For God sent not his Son</p></blockquote>');
  });

  it('still starts a new paragraph where the source text marks one', () => {
    const out = html('blockquote-numbered', PLAIN, [V16, V17, V18]);
    expect(out).toContain(
      '<blockquote><p>(16) For God so loved the world<br>(17) For God sent not his Son</p><p>(18) He that believeth on him</p></blockquote>',
    );
  });

  it('renders superscript numbers when chosen', () => {
    const out = html('blockquote-numbered', { ...PLAIN, verseNumbers: 'superscript' });
    expect(out).toContain('<sup>16</sup> For God so loved the world');
  });

  it('carries the chapter in the label when the passage crosses one', () => {
    const nextChapter: PassageVerse = { ...V16, verse_id: 43004001, chapter: 4, verse: 1, text: 'When therefore', text_html: 'When therefore' };
    const out = html('blockquote-numbered', PLAIN, [V16, nextChapter]);
    // A bare "(1)" would say nothing about which chapter it came from.
    expect(out).toContain('(3:16)');
    expect(out).toContain('(4:1)');
  });
});

describe('heading-per-verse', () => {
  it('defaults to H3 with the verse quoted beneath', () => {
    const out = html('heading-per-verse', PLAIN);
    expect(out).toContain('<h3>Verse 16</h3><blockquote><p>(16) For God so loved the world</p></blockquote>');
    expect(out).toContain('<h3>Verse 17</h3>');
  });

  it('follows the chosen heading level', () => {
    const out = html('heading-per-verse', { ...PLAIN, headingLevel: 2 });
    expect(out).toContain('<h2>Verse 16</h2>');
    expect(out).not.toContain('<h3>');
  });

  it('uses the localized heading template', () => {
    const markup = renderPassageMarkup([V16], CONTEXT, 'heading-per-verse', PLAIN, {
      verseHeading: 'Versículo {verse}',
      commentPlaceholder: '[Comentarios sobre {reference}]',
    });
    expect(passageMarkupToHtml(markup)).toContain('<h3>Versículo 16</h3>');
  });

  it('leaves a prompt under each verse when comment placeholders are on', () => {
    const markup = renderPassageMarkup(
      [V16, V17],
      CONTEXT,
      'heading-per-verse',
      { ...PLAIN, commentPlaceholders: true },
    );
    const out = passageMarkupToHtml(markup);
    expect(out).toContain('<p><em>[Comments for John 3:16]</em></p>');
    expect(out).toContain('<p><em>[Comments for John 3:17]</em></p>');
  });

  it('uses the localized placeholder template', () => {
    const markup = renderPassageMarkup(
      [V16],
      CONTEXT,
      'heading-per-verse',
      { ...PLAIN, commentPlaceholders: true },
      { verseHeading: 'Versículo {verse}', commentPlaceholder: '[Notas: {reference}]' },
    );
    expect(passageMarkupToHtml(markup)).toContain('<p><em>[Notas: John 3:16]</em></p>');
  });

  // The expansion fingerprint is taken over `passageMarkupToText`. A
  // placeholder exists to be typed over, so counting it would make every
  // passage read as edited the moment the writer used it - which withdraws the
  // offer to re-format the passage.
  it('keeps placeholders out of the text the fingerprint is taken over', () => {
    const markup = renderPassageMarkup(
      [V16],
      CONTEXT,
      'heading-per-verse',
      { ...PLAIN, commentPlaceholders: true },
    );
    expect(passageMarkupToText(markup)).not.toContain('[Comments for');
  });
});

describe('inline-quote', () => {
  it('is a single run with no block of its own', () => {
    const markup = renderPassageMarkup([V16, V17], CONTEXT, 'inline-quote', PLAIN);
    expect(markup.inline).toBe(true);
    const out = passageMarkupToHtml(markup);
    expect(out).not.toContain('<p>');
    expect(out).toBe('John 3:16-17 (KJV): “For God so loved the world For God sent not his Son”');
  });

  it('can be forced into a paragraph, for a passage appended below a sentence', () => {
    const markup = renderPassageMarkup([V16], CONTEXT, 'inline-quote', PLAIN);
    expect(passageMarkupToHtml(markup, { forceBlock: true })).toMatch(/^<p>.*<\/p>$/);
  });

  it('honours the quote-mark and reference-position options', () => {
    const out = html('inline-quote', { ...PLAIN, quoteMarks: 'none', referencePosition: 'after' }, [V16]);
    // 'appended', so the translation does not bring a second pair of brackets.
    expect(out).toBe('For God so loved the world (John 3:16, KJV)');
  });

  it('numbers the later verses only, since the reference already gave the first', () => {
    const out = html('inline-quote', { ...PLAIN, verseNumbers: 'parenthetical' });
    expect(out).toContain('“For God so loved the world (17) For God sent not his Son”');
  });
});

describe('universal options', () => {
  it('drops the translation label when display-translation is off', () => {
    const out = html('blockquote-numbered', { ...PLAIN, displayVersionNumber: false });
    expect(out).toContain('John 3:16-17');
    expect(out).not.toContain('KJV');
  });

  it('keeps the red-letter markup when that option is on', () => {
    const redVerse: PassageVerse = {
      ...V16,
      text_html: '<span class="christ-words">Verily I say</span>',
    };
    const out = html('blockquote', { ...PLAIN, wordsOfChristInRed: true }, [redVerse]);
    expect(out).toContain('<span style="color: #B71C1C;">Verily I say</span>');
  });

  it('escapes the text when red letters are off, so an ampersand survives', () => {
    const tricky: PassageVerse = { ...V16, text: 'Alpha & Omega', text_html: 'Alpha &amp; Omega' };
    const out = html('blockquote', PLAIN, [tricky]);
    expect(out).toContain('Alpha &amp; Omega');
  });
});

describe('plain-text and Markdown renderings', () => {
  it('gives the document text with no decoration, which is what the fingerprint hashes', () => {
    const markup = renderPassageMarkup([V16, V17], CONTEXT, 'blockquote-numbered', PLAIN);
    expect(passageMarkupToText(markup)).toBe(
      'John 3:16-17 (KJV)\n(16) For God so loved the world\n(17) For God sent not his Son',
    );
  });

  it('renders the same shapes as Markdown for a clipboard consumer', () => {
    const markup = renderPassageMarkup([V16], CONTEXT, 'heading-per-verse', { ...PLAIN, headingLevel: 2 });
    const md = passageMarkupToMarkdown(markup);
    expect(md).toContain('## Verse 16');
    expect(md).toContain('> (16) For God so loved the world');
  });

  /**
   * The clipboard's own two questions, which the copy dialog puts to these
   * shapes exactly as it always has to the Standard one: is this Markdown, and
   * is the quote decorated at all?
   */
  describe('as clipboard source text', () => {
    const headings = (options: Partial<PassageInsertOptions> = {}) =>
      renderPassageMarkup([V16], CONTEXT, 'heading-per-verse', { ...PLAIN, ...options });

    it('sets a quote off with an indent when it is not Markdown', () => {
      const text = passageMarkupToSourceText(headings());
      expect(text).toContain('    (16) For God so loved the world');
      // A plain-text consumer has no `#`, so the heading is just its own line.
      expect(text).toContain('\nVerse 16\n');
      expect(text).not.toContain('#');
    });

    it('drops the decoration entirely for the Inline text format', () => {
      const text = passageMarkupToSourceText(headings(), { blockQuote: false });
      expect(text).toContain('(16) For God so loved the world');
      expect(text).not.toContain('    (16)');
    });

    it('keeps the Markdown headings when the quote is undecorated', () => {
      const text = passageMarkupToSourceText(headings(), { markdown: true, blockQuote: false });
      expect(text).toContain('### Verse 16');
      expect(text).not.toContain('> (16)');
    });

    // The same asymmetry `renderPassageCopy` has: HTML when red letters are on,
    // raw text when they are off, so the consumer's "is this HTML?" rule needs
    // no special case for these formats.
    it('emits the HTML flavour of each line only when asked', () => {
      const red = renderPassageMarkup([V16], CONTEXT, 'blockquote', {
        displayVersionNumber: false,
        wordsOfChristInRed: false,
      });
      expect(passageMarkupToSourceText(red, { richText: true })).toContain(
        'For God so loved the world',
      );
    });

    /**
     * A numbered quote's verses are lines within a paragraph, so one
     * `PassageMarkupLine` is now several physical lines. Whatever marks a line
     * as quoted has to reach every one of them.
     */
    it('indents every verse of a numbered quote, not just the first', () => {
      const markup = renderPassageMarkup([V16, V17, V18], CONTEXT, 'blockquote-numbered', PLAIN);
      const text = passageMarkupToSourceText(markup);
      expect(text).toContain('    (16) For God so loved the world\n    (17) For God sent not his Son');
      // The paragraph V18 opens is a real break, so it is a separate quote line.
      expect(text).toContain('\n    (18) He that believeth on him');
    });

    it('separates the verses of a numbered quote with a Markdown hard break', () => {
      const markup = renderPassageMarkup([V16, V17, V18], CONTEXT, 'blockquote-numbered', PLAIN);
      const md = passageMarkupToMarkdown(markup);
      // Two trailing spaces end the line without ending the paragraph...
      expect(md).toContain('> (16) For God so loved the world  \n> (17) For God sent not his Son');
      // ...whereas a genuine paragraph break is a blank quoted line.
      expect(md).toContain('\n>\n> (18) He that believeth on him');
    });

    it('is what passageMarkupToMarkdown is, fully decorated', () => {
      const markup = headings();
      expect(passageMarkupToMarkdown(markup)).toBe(
        passageMarkupToSourceText(markup, { markdown: true, blockQuote: true }),
      );
    });
  });
});

describe('resolvePassageMarkupOptions', () => {
  it('fills every missing field from that format’s own defaults', () => {
    const resolved = resolvePassageMarkupOptions('inline-quote', PLAIN);
    expect(resolved).toEqual({
      ...DEFAULT_PASSAGE_MARKUP_OPTIONS['inline-quote'],
      wordsOfChristInRed: false,
    });
  });

  it('falls back wholesale when there is nothing saved', () => {
    expect(resolvePassageMarkupOptions('blockquote', null)).toEqual(
      DEFAULT_PASSAGE_MARKUP_OPTIONS.blockquote,
    );
  });

  it('renders an empty passage rather than throwing', () => {
    const markup = renderPassageMarkup([], CONTEXT, 'blockquote', PLAIN);
    expect(markup.blocks).toEqual([]);
    expect(passageMarkupToHtml(markup)).toBe('');
  });
});
