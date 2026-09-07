/**
 * The verse-HTML helpers shared by the reading pane and the hover preview.
 *
 * The preview used to flatten `text_html` with `replace(/<[^>]*>/g, '')`, so a
 * red-letter verse previewed in black next to a pane rendering it in red.
 * `toPreviewHtml` keeps exactly the two spans `formatVerseText` emits and
 * discards everything else — the tests below pin both halves of that, since
 * keeping too much is an injection surface and keeping too little is the bug.
 */
import { describe, it, expect } from 'vitest';
import { applyRedLetterSetting, tuckTrailingPunctuation, toPreviewHtml } from './verseHtml';

describe('applyRedLetterSetting', () => {
  it('leaves the christ-words span alone when red letter is on', () => {
    expect(applyRedLetterSetting('<span class="christ-words">I am</span> he', true))
      .toBe('<span class="christ-words">I am</span> he');
  });

  it('drops the class but keeps the span when red letter is off', () => {
    // Removing the tag would orphan its `</span>`; a bare span styles as
    // nothing and keeps the markup balanced.
    expect(applyRedLetterSetting('<span class="christ-words">I am</span> he', false))
      .toBe('<span>I am</span> he');
  });
});

describe('tuckTrailingPunctuation', () => {
  it('pulls punctuation that follows a closing tag inside it', () => {
    expect(tuckTrailingPunctuation('<span class="christ-words">Verily</span>, I say'))
      .toBe('<span class="christ-words">Verily,</span> I say');
  });
});

describe('toPreviewHtml', () => {
  it('keeps the christ-words span when red letter is on', () => {
    expect(toPreviewHtml('<span class="christ-words">I am</span> he', true))
      .toContain('class="christ-words"');
  });

  it('keeps the divine-name span regardless of the red-letter setting', () => {
    expect(toPreviewHtml('The <span class="divine-name">Lord</span> said', false))
      .toContain('class="divine-name"');
  });

  it('drops the christ-words class when red letter is off, keeping the words', () => {
    const html = toPreviewHtml('<span class="christ-words">I am</span> he', false);
    expect(html).not.toContain('christ-words');
    expect(html).toContain('I am');
  });

  it('strips every other tag, keeping its text', () => {
    expect(toPreviewHtml('<p>believeth<sup class="verse__footnote-marker">a</sup></p>', true))
      .toBe('believetha');
  });

  it('re-emits allowed spans rather than passing the source tag through', () => {
    // A module could carry any attribute on the span; only the recognised
    // class name survives, so nothing executable reaches innerHTML.
    const html = toPreviewHtml('<span class="christ-words" onmouseover="alert(1)">I am</span>', true);
    expect(html).toBe('<span class="christ-words">I am</span>');
  });

  it('drops an unrecognised span class without unbalancing the markup', () => {
    expect(toPreviewHtml('<span class="mystery">word</span>', true)).toBe('<span>word</span>');
  });

  it('collapses the whitespace a multi-line verse row carries', () => {
    expect(toPreviewHtml('  For God\n  so   loved  ', true)).toBe('For God so loved');
  });
});
