/**
 * `highlightAttrsForWord` is the single place classes, inline styles and
 * markup ids are derived for a word span. Two renderers consume it - the
 * HTML-string path (`applyHighlightsToVerse`, used by Standard/Reading and by
 * Study mode's plain text) and the JSX path in `study/InterlinearDisplay.tsx`.
 *
 * These tests pin the two together. A second, diverging copy of this logic is
 * how Study mode ended up unhighlightable for so long, so the load-bearing
 * assertion here is that the string path emits exactly the classes the
 * resolver returns.
 */
import { describe, it, expect } from 'vitest';
import { UserTextMarkup } from '@bible/core';
import { applyHighlightsToVerse, highlightAttrsForWord } from './HighlightRenderer';

const VERSE_ID = 43003016;

function markup(overrides: Partial<ConstructorParameters<typeof UserTextMarkup>[0]> = {}): UserTextMarkup {
  return new UserTextMarkup({
    markupId: 1,
    moduleId: 7,
    verseIdStart: VERSE_ID,
    textStart: 0,
    textEnd: 1,
    color: '#FFF3A3',
    metadata: { markupType: 'highlight', version: 1 },
    ...overrides,
  });
}

const PLAIN_CONTEXT = {
  isChristWords: false,
  hasTrailingSpace: true,
  nextWordIndex: null as number | null,
};

describe('highlightAttrsForWord', () => {
  it('returns a bare word class and no markup id when nothing covers the word', () => {
    const attrs = highlightAttrsForWord(VERSE_ID, 5, [markup()], PLAIN_CONTEXT);
    expect(attrs.className).toBe('word');
    expect(attrs.markupIds).toBeUndefined();
    expect(attrs.style).toBeUndefined();
    expect(attrs.spaceInsideSpan).toBe(false);
  });

  it('adds the formatting classes for the word itself', () => {
    const attrs = highlightAttrsForWord(VERSE_ID, 5, [], {
      ...PLAIN_CONTEXT,
      isChristWords: true,
      isDivineName: true,
    });
    expect(attrs.className.split(' ').sort()).toEqual(['christ-words', 'divine-name', 'word']);
  });

  it('resolves a palette highlight to a colour *name* class, not a raw hex', () => {
    const attrs = highlightAttrsForWord(VERSE_ID, 0, [markup()], PLAIN_CONTEXT);
    expect(attrs.className).toContain('highlighted');
    expect(attrs.className).toContain('highlight-yellow');
    // A raw-hex class would match no CSS rule and paint nothing while still
    // satisfying a naive "has a class" assertion.
    expect(attrs.className).not.toContain('#');
    expect(attrs.style).toBeUndefined();
    expect(attrs.markupIds).toBe('1');
  });

  it('paints a non-palette colour inline, since no stylesheet rule can key off it', () => {
    const attrs = highlightAttrsForWord(VERSE_ID, 0, [markup({ color: '#123456' })], PLAIN_CONTEXT);
    expect(attrs.className).not.toContain('highlight-');
    expect(attrs.style?.backgroundColor).toBe('#123456');
  });

  it('emits both the style and colour classes for a palette underline', () => {
    const attrs = highlightAttrsForWord(
      VERSE_ID,
      0,
      [markup({
        metadata: {
          markupType: 'underline',
          underlineStyle: 'dotted',
          underlineColor: 'blue',
          version: 1,
        },
      })],
      PLAIN_CONTEXT
    );
    expect(attrs.className).toContain('underline-dotted');
    expect(attrs.className).toContain('underline-color-blue');
    expect(attrs.style).toBeUndefined();
  });

  it('inlines text-decoration-color for a non-palette underline colour', () => {
    // Coupled path: the line/style come from the `underline-{style}` class
    // while the colour has to be inline. Both must be present or the underline
    // renders in the inherited text colour.
    const attrs = highlightAttrsForWord(
      VERSE_ID,
      0,
      // `metadata` is JSON on disk, so a colour outside the six-name palette
      // can genuinely be stored there even though the declared type narrows it
      // to a palette name. The cast reproduces that stored shape.
      [markup({
        metadata: {
          markupType: 'underline',
          underlineStyle: 'wavy',
          underlineColor: '#0F0F0F',
          version: 1,
        } as unknown as UserTextMarkup['metadata'],
      })],
      PLAIN_CONTEXT
    );
    expect(attrs.className).toContain('underline-wavy');
    expect(attrs.className).not.toContain('underline-color-');
    expect(attrs.style?.textDecorationColor).toBe('#0F0F0F');
  });

  it('re-states the decoration inline when a highlight and an underline share a word', () => {
    const attrs = highlightAttrsForWord(
      VERSE_ID,
      0,
      [markup({
        metadata: {
          markupType: 'both',
          underlineStyle: 'solid',
          underlineColor: 'yellow',
          version: 1,
        },
      })],
      PLAIN_CONTEXT
    );
    expect(attrs.className).toContain('highlight-yellow');
    expect(attrs.className).toContain('underline-solid');
    // The background wash would otherwise be free to swallow the decoration.
    expect(attrs.style?.textDecorationLine).toBe('underline');
    expect(attrs.style?.textDecorationStyle).toBe('solid');
  });

  it('combines a highlight and a separate underline markup on the same word', () => {
    const attrs = highlightAttrsForWord(
      VERSE_ID,
      0,
      [
        markup({ markupId: 1 }),
        markup({
          markupId: 2,
          metadata: {
            markupType: 'underline',
            underlineStyle: 'dashed',
            underlineColor: 'red',
            version: 1,
          },
        }),
      ],
      PLAIN_CONTEXT
    );
    expect(attrs.className).toContain('highlight-yellow');
    expect(attrs.className).toContain('underline-dashed');
    expect(attrs.className).toContain('underline-color-red');
    expect(attrs.markupIds).toBe('1,2');
  });

  it('puts the trailing space inside the span only while the same markup continues', () => {
    const highlights = [markup({ textStart: 0, textEnd: 1 })];
    expect(
      highlightAttrsForWord(VERSE_ID, 0, highlights, { ...PLAIN_CONTEXT, nextWordIndex: 1 }).spaceInsideSpan
    ).toBe(true);
    // Last word of the range: the space stays outside so the wash stops here.
    expect(
      highlightAttrsForWord(VERSE_ID, 1, highlights, { ...PLAIN_CONTEXT, nextWordIndex: 2 }).spaceInsideSpan
    ).toBe(false);
    // No next word at all (end of a run, or an interlinear cell boundary).
    expect(
      highlightAttrsForWord(VERSE_ID, 0, highlights, { ...PLAIN_CONTEXT, nextWordIndex: null }).spaceInsideSpan
    ).toBe(false);
  });
});

describe('applyHighlightsToVerse uses the same resolver', () => {
  const HTML = 'For God so loved';

  function classesOf(html: string, wordIndex: number): string {
    const container = document.createElement('div');
    container.innerHTML = html;
    return container.querySelector(`[data-word-index="${wordIndex}"]`)?.className ?? '';
  }

  it('emits exactly the classes the resolver returns, for every word', () => {
    const highlights = [markup({ textStart: 1, textEnd: 2 })];
    const html = applyHighlightsToVerse(VERSE_ID, HTML, highlights);

    for (let index = 0; index < 4; index++) {
      const expected = highlightAttrsForWord(VERSE_ID, index, highlights, {
        isChristWords: false,
        hasTrailingSpace: index < 3,
        nextWordIndex: index < 3 ? index + 1 : null,
      });
      expect(classesOf(html, index)).toBe(expected.className);
    }
  });

  it('serialises the resolver style object back to a CSS declaration', () => {
    const html = applyHighlightsToVerse(VERSE_ID, HTML, [
      markup({ textStart: 0, textEnd: 0, color: '#123456' }),
    ]);
    expect(html).toContain('style="background-color:#123456"');
  });

  it('keeps christ-words on unhighlighted words', () => {
    const html = applyHighlightsToVerse(
      VERSE_ID,
      '<span class="christ-words">For God</span> so loved',
      []
    );
    expect(classesOf(html, 0)).toBe('word christ-words');
    expect(classesOf(html, 2)).toBe('word');
  });

  it('keeps divine-name on unhighlighted words', () => {
    // This function rebuilds the verse from flattened words, so the incoming
    // `<span class="divine-name">` wrapper does not survive - the class has to
    // be re-applied per word or the Tetragrammaton's small-caps treatment is
    // lost. It renders through here in Standard, Reading AND Study mode, so
    // dropping it means small caps appear nowhere at all.
    const html = applyHighlightsToVerse(
      VERSE_ID,
      'The <span class="divine-name">Lord</span> is my shepherd',
      []
    );
    expect(classesOf(html, 0)).toBe('word');
    expect(classesOf(html, 1)).toBe('word divine-name');
  });

  it('keeps divine-name on a word that is also highlighted', () => {
    const html = applyHighlightsToVerse(
      VERSE_ID,
      'The <span class="divine-name">Lord</span> is my shepherd',
      [markup({ textStart: 1, textEnd: 1, color: '#FFF3A3' })]
    );
    expect(classesOf(html, 1)).toContain('divine-name');
    expect(classesOf(html, 1)).toContain('highlighted');
  });
});
