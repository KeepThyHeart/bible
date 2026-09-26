/**
 * `wordRenderAttrs` is the single place classes, inline styles and markup
 * ids are derived for a word span. Two renderers consume it - the
 * HTML-string path (`renderVerseWords`, used by Standard/Reading and by
 * Study mode's plain text) and the JSX path in `study/InterlinearDisplay.tsx`.
 *
 * These tests pin the two together. A second, diverging copy of this logic is
 * how Study mode ended up unhighlightable for so long, so the load-bearing
 * assertion here is that the string path emits exactly the classes the
 * resolver returns.
 *
 * Task 0036 (P0.1a, amendment A1) folded extension decorations and
 * find-in-page into this same resolver - a `paint` argument and a `find`
 * context field - so this file also pins THOSE down: a user highlight, a
 * user underline, an extension tint, an extension underline and a find
 * match must all be able to land on one word at once, each on its own CSS
 * property (amendment A2's ownership table).
 */
import { describe, it, expect } from 'vitest';
import { UserTextMarkup } from '@bible/core';
import { wordRenderAttrs, renderVerseWords, type VerseFindState } from './HighlightRenderer';
import { extractWordsWithFormatting } from '@bible/core/browser';
import type { WordPaint } from '../../extensions/decorationResolver';

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

describe('wordRenderAttrs', () => {
  it('returns a bare word class and no markup id when nothing covers the word', () => {
    const attrs = wordRenderAttrs(VERSE_ID, 5, [markup()], PLAIN_CONTEXT);
    expect(attrs.className).toBe('word');
    expect(attrs.markupIds).toBeUndefined();
    expect(attrs.style).toBeUndefined();
    expect(attrs.spaceInsideSpan).toBe(false);
  });

  it('adds the formatting classes for the word itself', () => {
    const attrs = wordRenderAttrs(VERSE_ID, 5, [], {
      ...PLAIN_CONTEXT,
      isChristWords: true,
      isDivineName: true,
    });
    expect(attrs.className.split(' ').sort()).toEqual(['christ-words', 'divine-name', 'word']);
  });

  it('resolves a palette highlight to a colour *name* class, not a raw hex', () => {
    const attrs = wordRenderAttrs(VERSE_ID, 0, [markup()], PLAIN_CONTEXT);
    expect(attrs.className).toContain('highlighted');
    expect(attrs.className).toContain('highlight-yellow');
    // A raw-hex class would match no CSS rule and paint nothing while still
    // satisfying a naive "has a class" assertion.
    expect(attrs.className).not.toContain('#');
    expect(attrs.style).toBeUndefined();
    expect(attrs.markupIds).toBe('1');
  });

  it('paints a non-palette colour inline, since no stylesheet rule can key off it', () => {
    const attrs = wordRenderAttrs(VERSE_ID, 0, [markup({ color: '#123456' })], PLAIN_CONTEXT);
    expect(attrs.className).not.toContain('highlight-');
    expect(attrs.style?.backgroundColor).toBe('#123456');
  });

  it('emits both the style and colour classes for a palette underline', () => {
    const attrs = wordRenderAttrs(
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
    const attrs = wordRenderAttrs(
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
    const attrs = wordRenderAttrs(
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
    const attrs = wordRenderAttrs(
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
      wordRenderAttrs(VERSE_ID, 0, highlights, { ...PLAIN_CONTEXT, nextWordIndex: 1 }).spaceInsideSpan
    ).toBe(true);
    // Last word of the range: the space stays outside so the wash stops here.
    expect(
      wordRenderAttrs(VERSE_ID, 1, highlights, { ...PLAIN_CONTEXT, nextWordIndex: 2 }).spaceInsideSpan
    ).toBe(false);
    // No next word at all (end of a run, or an interlinear cell boundary).
    expect(
      wordRenderAttrs(VERSE_ID, 0, highlights, { ...PLAIN_CONTEXT, nextWordIndex: null }).spaceInsideSpan
    ).toBe(false);
  });

  // --- Task 0036 (P0.1a): extension paint + find-in-page -------------------

  function tintPaint(sourceKey = 'ext.acme::deco#0'): WordPaint {
    return {
      tint: { color: 'rgb(1 2 3 / 0.32)' },
      underlines: [],
      bold: false,
      badges: [],
      sourceKeys: [sourceKey],
    };
  }

  it('adds ext-deco and the background-image custom properties for a tint', () => {
    const attrs = wordRenderAttrs(VERSE_ID, 0, [], PLAIN_CONTEXT, tintPaint());
    expect(attrs.className).toContain('ext-deco');
    expect(attrs.style?.['--ext-bg-image' as keyof typeof attrs.style]).toBeDefined();
  });

  it('a user highlight, a user underline, an extension tint, an extension underline and a find match all land on one word, each on its own property', () => {
    const paint: WordPaint = {
      tint: { color: 'rgb(9 9 9 / 0.32)' },
      underlines: [{ color: 'rgb(8 8 8)', style: 'solid', thickness: 'medium', offset: 0 }],
      bold: false,
      badges: [],
      sourceKeys: ['ext.acme::deco#0'],
    };
    const attrs = wordRenderAttrs(
      VERSE_ID,
      0,
      [
        markup({ markupId: 1, color: '#123456' }), // user highlight - non-palette, forces inline backgroundColor
        markup({
          markupId: 2,
          metadata: { markupType: 'underline', underlineStyle: 'dashed', underlineColor: 'red', version: 1 },
        }),
      ],
      { ...PLAIN_CONTEXT, find: 'match' },
      paint,
    );
    // User highlight: background-color (inline, non-palette colour).
    expect(attrs.style?.backgroundColor).toBe('#123456');
    // User underline: classes, the stylesheet's own decoration.
    expect(attrs.className).toContain('underline-dashed');
    // Extension paint: background-image custom properties + its own class.
    expect(attrs.className).toContain('ext-deco');
    expect(attrs.style?.['--ext-bg-image' as keyof typeof attrs.style]).toBeDefined();
    // Find: its own class, not fighting either of the above.
    expect(attrs.className).toContain('find-match');
  });

  it('find-match-current implies find-match too', () => {
    const attrs = wordRenderAttrs(VERSE_ID, 0, [], { ...PLAIN_CONTEXT, find: 'current' });
    expect(attrs.className).toContain('find-match');
    expect(attrs.className).toContain('find-match-current');
  });

  it('extends spaceInsideSpan across a phrase sharing an extension tint sourceKey', () => {
    const paint = tintPaint('ext.acme::deco#0');
    const attrs = wordRenderAttrs(VERSE_ID, 0, [], {
      ...PLAIN_CONTEXT,
      nextWordIndex: 1,
      nextWordSourceKeys: ['ext.acme::deco#0'],
    }, paint);
    expect(attrs.spaceInsideSpan).toBe(true);
  });

  it('does not extend spaceInsideSpan when the next word has a DIFFERENT sourceKey', () => {
    const paint = tintPaint('ext.acme::deco#0');
    const attrs = wordRenderAttrs(VERSE_ID, 0, [], {
      ...PLAIN_CONTEXT,
      nextWordIndex: 1,
      nextWordSourceKeys: ['ext.other::deco#0'],
    }, paint);
    expect(attrs.spaceInsideSpan).toBe(false);
  });
});

describe('renderVerseWords uses the same resolver', () => {
  const HTML = 'For God so loved';
  const words = () => extractWordsWithFormatting(HTML);

  function classesOf(html: string, wordIndex: number): string {
    const container = document.createElement('div');
    container.innerHTML = html;
    return container.querySelector(`[data-word-index="${wordIndex}"]`)?.className ?? '';
  }

  it('emits exactly the classes the resolver returns, for every word', () => {
    const highlights = [markup({ textStart: 1, textEnd: 2 })];
    const html = renderVerseWords(VERSE_ID, words(), highlights);

    for (let index = 0; index < 4; index++) {
      const expected = wordRenderAttrs(VERSE_ID, index, highlights, {
        isChristWords: false,
        hasTrailingSpace: index < 3,
        nextWordIndex: index < 3 ? index + 1 : null,
      });
      expect(classesOf(html, index)).toBe(expected.className);
    }
  });

  it('serialises the resolver style object back to a CSS declaration', () => {
    const html = renderVerseWords(VERSE_ID, words(), [
      markup({ textStart: 0, textEnd: 0, color: '#123456' }),
    ]);
    expect(html).toContain('style="background-color:#123456"');
  });

  it('keeps christ-words on unhighlighted words', () => {
    const html = renderVerseWords(
      VERSE_ID,
      extractWordsWithFormatting('<span class="christ-words">For God</span> so loved'),
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
    const html = renderVerseWords(
      VERSE_ID,
      extractWordsWithFormatting('The <span class="divine-name">Lord</span> is my shepherd'),
      []
    );
    expect(classesOf(html, 0)).toBe('word');
    expect(classesOf(html, 1)).toBe('word divine-name');
  });

  it('keeps divine-name on a word that is also highlighted', () => {
    const html = renderVerseWords(
      VERSE_ID,
      extractWordsWithFormatting('The <span class="divine-name">Lord</span> is my shepherd'),
      [markup({ textStart: 1, textEnd: 1, color: '#FFF3A3' })]
    );
    expect(classesOf(html, 1)).toContain('divine-name');
    expect(classesOf(html, 1)).toContain('highlighted');
  });

  // --- Task 0036 (P0.1a) ----------------------------------------------------

  it('paints an extension tint from a resolved verse, per word', () => {
    const resolved = {
      words: new Map([[0, {
        tint: { color: 'rgb(1 2 3 / 0.32)' },
        underlines: [],
        bold: false,
        badges: [],
        sourceKeys: ['ext.acme::deco#0'],
      } as WordPaint]]),
    };
    const html = renderVerseWords(VERSE_ID, words(), [], resolved);
    expect(classesOf(html, 0)).toContain('ext-deco');
    expect(classesOf(html, 1)).not.toContain('ext-deco');
  });

  it('renders find-match and find-match-current from a VerseFindState', () => {
    const find: VerseFindState = { matchWordIndexes: new Set([0, 2]), currentWordIndex: 2 };
    const html = renderVerseWords(VERSE_ID, words(), [], undefined, find);
    expect(classesOf(html, 0)).toContain('find-match');
    expect(classesOf(html, 0)).not.toContain('find-match-current');
    expect(classesOf(html, 2)).toContain('find-match-current');
    expect(classesOf(html, 1)).not.toContain('find-match');
  });

  it('a badge survives sanitizeHtml (DOMPurify keeps a well-formed style attribute by default)', async () => {
    const { sanitizeHtml } = await import('../../utils/sanitize');
    const resolved = {
      words: new Map([[0, {
        underlines: [],
        bold: false,
        badges: [{ label: 'G26 "quote"', color: 'rgb(1 2 3)' }],
        sourceKeys: ['ext.acme::deco#0'],
      } as WordPaint]]),
    };
    const html = renderVerseWords(VERSE_ID, words(), [], resolved);
    const sanitized = sanitizeHtml(html);
    const container = document.createElement('div');
    container.innerHTML = sanitized;
    const word = container.querySelector('[data-word-index="0"]') as HTMLElement | null;
    expect(word).not.toBeNull();
    expect(word!.className).toContain('ext-badge');
    // The badge's own label text never appears as selectable text content -
    // it only exists inside the `--ext-badge` custom property, consumed by
    // `::after { content: var(--ext-badge) }` in CSS, which this jsdom
    // environment does not render - the assertion that matters is that
    // sanitisation did not strip the whole `style` attribute (which would
    // mean the quote inside the label broke the HTML structure).
    expect(word!.getAttribute('style')).toBeTruthy();
    expect(word!.textContent).not.toContain('quote');
  });
});
