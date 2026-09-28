/**
 * Framework-free checks for the pure word-rendering helpers. The full
 * class/style matrix (highlight + underline + decoration + find on one word,
 * DOM-parsed HTML) is pinned by desktop's `HighlightRenderer.test.tsx`; these
 * cover what core owns on its own: no React, no DOM, plain-data inputs.
 */
import { describe, it, expect } from 'vitest';
import { UserTextMarkup } from '../Data/Models/User/UserTextMarkup';
import { extractWordsWithFormatting } from '../Services/WordIndexing';
import {
  computeVerseFindState,
  escapeForAttribute,
  findHighlightsForWord,
  getVerseHighlightInfo,
  renderVerseWords,
  styleToCssText,
  wordRenderAttrs,
} from './WordRendering';

const VERSE_ID = 43003016;

function markup(overrides: Partial<ConstructorParameters<typeof UserTextMarkup>[0]> = {}): UserTextMarkup {
  return new UserTextMarkup({
    markupId: 1,
    moduleId: 7,
    verseIdStart: VERSE_ID,
    textStart: 1,
    textEnd: 2,
    color: '#FFF3A3',
    metadata: { markupType: 'highlight', version: 1 },
    ...overrides,
  });
}

describe('styleToCssText / escapeForAttribute', () => {
  it('kebab-cases camelCase properties and passes custom properties through', () => {
    expect(styleToCssText({ backgroundColor: '#fff', '--ext-badge': '"x"', textDecorationThickness: 2 })).toBe(
      'background-color:#fff;--ext-badge:"x";text-decoration-thickness:2',
    );
  });

  it('escapes ampersands and double quotes', () => {
    expect(escapeForAttribute('a"b&c')).toBe('a&quot;b&amp;c');
  });
});

describe('findHighlightsForWord / getVerseHighlightInfo', () => {
  it('matches only the words inside the markup range', () => {
    const h = markup();
    expect(findHighlightsForWord(0, VERSE_ID, [h])).toHaveLength(0);
    expect(findHighlightsForWord(1, VERSE_ID, [h])).toHaveLength(1);
    expect(findHighlightsForWord(2, VERSE_ID, [h])).toHaveLength(1);
    expect(findHighlightsForWord(3, VERSE_ID, [h])).toHaveLength(0);
  });

  it('reports the word range for a single-verse markup and none outside it', () => {
    const h = markup();
    expect(getVerseHighlightInfo(VERSE_ID, h)).toEqual({ highlighted: true, wordStart: 1, wordEnd: 2 });
    expect(getVerseHighlightInfo(VERSE_ID + 1, h)).toEqual({ highlighted: false });
  });

  it('treats middle verses of a multi-verse markup as fully highlighted', () => {
    const h = markup({ verseIdEnd: VERSE_ID + 2, textStart: 3, textEnd: 4 });
    expect(getVerseHighlightInfo(VERSE_ID, h)).toEqual({ highlighted: true, wordStart: 3, wordEnd: null });
    expect(getVerseHighlightInfo(VERSE_ID + 1, h)).toEqual({ highlighted: true, wordStart: 0, wordEnd: null });
    expect(getVerseHighlightInfo(VERSE_ID + 2, h)).toEqual({ highlighted: true, wordStart: 0, wordEnd: 4 });
  });
});

describe('wordRenderAttrs / renderVerseWords', () => {
  const words = extractWordsWithFormatting('For God so loved the world');

  it('gives an unmarked word a bare class and no style', () => {
    const attrs = wordRenderAttrs(VERSE_ID, 0, [], { isChristWords: false, hasTrailingSpace: true, nextWordIndex: 1 });
    expect(attrs).toEqual({ className: 'word', spaceInsideSpan: false });
  });

  it('keeps the space inside the span while one highlight continues', () => {
    const attrs = wordRenderAttrs(VERSE_ID, 1, [markup()], { isChristWords: false, hasTrailingSpace: true, nextWordIndex: 2 });
    expect(attrs.className).toContain('highlighted');
    expect(attrs.markupIds).toBe('1');
    expect(attrs.spaceInsideSpan).toBe(true);
  });

  it('renders every word as a span, with find classes from plain data', () => {
    const find = computeVerseFindState(VERSE_ID, true, [{ verseId: VERSE_ID, wordIndex: 2 }], 0);
    const html = renderVerseWords(VERSE_ID, words, [markup()], null, find);
    expect(html.match(/<span class="word/g)).toHaveLength(words.length);
    expect(html).toContain('data-word-index="1"');
    expect(html).toContain('find-match find-match-current');
    expect(html).toContain('data-markup-id="1"');
  });
});

describe('computeVerseFindState', () => {
  const matches = [
    { verseId: 1, wordIndex: 3 },
    { verseId: 2, wordIndex: 0 },
    { verseId: 2, wordIndex: 5 },
  ];

  it('is undefined when hidden, empty or nothing matches this verse', () => {
    expect(computeVerseFindState(2, false, matches, 0)).toBeUndefined();
    expect(computeVerseFindState(2, true, [], 0)).toBeUndefined();
    expect(computeVerseFindState(9, true, matches, 0)).toBeUndefined();
  });

  it('collects this verse\'s matches and locates the current one by global index', () => {
    const state = computeVerseFindState(2, true, matches, 2);
    expect([...state!.matchWordIndexes]).toEqual([0, 5]);
    expect(state!.currentWordIndex).toBe(5);
    expect(computeVerseFindState(2, true, matches, 0)!.currentWordIndex).toBeNull();
  });
});
