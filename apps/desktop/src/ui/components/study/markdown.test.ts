/**
 * Unit tests for the Study pane's Markdown renderer.
 *
 * The shapes exercised here are the ones the shipped `SYNTHESIS` commentary
 * actually emits (Setext H1/H2, ATX H3, two-space-indented `*` bullets, `*em*`
 * and `**strong**`), plus the safety properties the rendering pipeline depends
 * on.
 */
import { describe, it, expect } from 'vitest';
import { markdownToHtml, markdownToPlainText, looksLikeMarkdown } from './markdown';

/** A trimmed-down entry in the exact shape the synthesis module ships. */
const SYNTHESIS_ENTRY = [
  'John 3:16 Commentary Synthesis',
  '==============================',
  '',
  'Overall Verse Notes',
  '-------------------',
  '  * Luther describes John 3:16 as "the Bible in miniature".',
  '  * Burkitt observes that God’s love is *demonstrated* by giving His Son.',
  '',
  'Word and Phrase Notes',
  '---------------------',
  '### "For God"',
  '  * The verse begins by establishing God the Father as the origin.',
].join('\n');

describe('markdownToHtml', () => {
  describe('block constructs', () => {
    it('renders a Setext level-2 heading', () => {
      expect(markdownToHtml('Overall Verse Notes\n-------------------')).toBe(
        '<h2>Overall Verse Notes</h2>'
      );
    });

    it('renders an ATX heading at the right level', () => {
      expect(markdownToHtml('### "For God"')).toBe('<h3>"For God"</h3>');
    });

    it('renders indented asterisk bullets as a list', () => {
      const html = markdownToHtml('  * first\n  * second');
      expect(html).toContain('<ul>');
      expect(html).toContain('<li>first</li>');
      expect(html).toContain('<li>second</li>');
      expect(html).toContain('</ul>');
    });

    it('renders numbered items as an ordered list', () => {
      const html = markdownToHtml('1. first\n2. second');
      expect(html).toContain('<ol>');
      expect(html).toContain('<li>first</li>');
      expect(html).toContain('</ol>');
    });

    it('folds a wrapped bullet back into one item', () => {
      const html = markdownToHtml('  * a claim that runs\n    onto a second line');
      expect(html).toContain('<li>a claim that runs<br />onto a second line</li>');
      expect(html).not.toContain('<li>onto a second line</li>');
    });

    it('does not swallow the next heading into a bullet', () => {
      const html = markdownToHtml('  * a bullet\nWord and Phrase Notes\n---------------------');
      expect(html).toContain('<li>a bullet</li>');
      expect(html).toContain('<h2>Word and Phrase Notes</h2>');
    });

    it('reads three dashes as a thematic break, not a bullet', () => {
      expect(markdownToHtml('para\n\n---\n\npara2')).toContain('<hr />');
    });

    it('wraps loose text in a paragraph', () => {
      expect(markdownToHtml('Just some prose.')).toBe('<p>Just some prose.</p>');
    });

    it('returns an empty string for empty input', () => {
      expect(markdownToHtml('')).toBe('');
    });
  });

  describe('inline marks', () => {
    it('renders strong and emphasis', () => {
      expect(markdownToHtml('a **bold** and *italic* word')).toBe(
        '<p>a <strong>bold</strong> and <em>italic</em> word</p>'
      );
    });

    it('leaves emphasis marks inside a code span alone', () => {
      expect(markdownToHtml('`a * b * c`')).toBe('<p><code>a * b * c</code></p>');
    });

    it('quote-escapes a link href so it cannot break out of the attribute', () => {
      const html = markdownToHtml('[x](http://e.com/a"onmouseover=x)');
      expect(html).toContain('<a href="http://e.com/a%22onmouseover=x">x</a>');
      expect(html).not.toContain('onmouseover="');
    });
  });

  describe('leading heading', () => {
    it('drops the redundant title heading by default', () => {
      const html = markdownToHtml(SYNTHESIS_ENTRY);
      expect(html).not.toContain('Commentary Synthesis');
      expect(html.startsWith('<h2>Overall Verse Notes</h2>')).toBe(true);
    });

    it('keeps the heading when asked to', () => {
      const html = markdownToHtml(SYNTHESIS_ENTRY, { stripLeadingHeading: false });
      expect(html).toContain('<h1>John 3:16 Commentary Synthesis</h1>');
    });
  });

  describe('escaping contract', () => {
    it('leaves text nodes unescaped for the link processor to escape', () => {
      // Escaping here as well would double-encode into a visible `&amp;quot;`.
      expect(markdownToHtml('He said "hi" & left')).toBe('<p>He said "hi" & left</p>');
    });

    it('does not itself invent markup from angle brackets', () => {
      // Raw text passes through untouched; the downstream escape in
      // reprocessCommentaryLinks and DOMPurify neutralise it.
      expect(markdownToHtml('a < b')).toBe('<p>a < b</p>');
    });
  });

  it('renders a full synthesis entry into structured HTML', () => {
    const html = markdownToHtml(SYNTHESIS_ENTRY);
    expect(html).toContain('<h2>Overall Verse Notes</h2>');
    expect(html).toContain('<h2>Word and Phrase Notes</h2>');
    expect(html).toContain('<h3>"For God"</h3>');
    expect(html).toContain('<em>demonstrated</em>');
    // None of the raw markers survive.
    expect(html).not.toContain('===');
    expect(html).not.toContain('---');
    expect(html).not.toContain('  * ');
  });
});

describe('markdownToPlainText', () => {
  it('strips every marker from a synthesis entry', () => {
    const text = markdownToPlainText(SYNTHESIS_ENTRY);
    expect(text).not.toContain('=');
    expect(text).not.toContain('#');
    expect(text).not.toContain('*');
    expect(text.startsWith('John 3:16 Commentary Synthesis')).toBe(true);
    expect(text).toContain('the Bible in miniature');
  });

  it('returns an empty string for empty input', () => {
    expect(markdownToPlainText('')).toBe('');
  });
});

describe('looksLikeMarkdown', () => {
  it('recognises a synthesis entry', () => {
    expect(looksLikeMarkdown(SYNTHESIS_ENTRY)).toBe(true);
  });

  it('rejects HTML commentary content', () => {
    expect(looksLikeMarkdown('<p>Verse 1. <b>The beginning</b> of all things.</p>')).toBe(false);
  });

  it('rejects HTML even when it contains list-shaped text', () => {
    expect(looksLikeMarkdown('<p>a * b</p><p># not a heading</p>')).toBe(false);
  });

  it('rejects plain prose', () => {
    expect(looksLikeMarkdown('Just a sentence with no markup at all.')).toBe(false);
  });

  it('rejects empty input', () => {
    expect(looksLikeMarkdown('')).toBe(false);
  });
});
