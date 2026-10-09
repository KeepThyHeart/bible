import { describe, it, expect } from 'vitest';
import { rangeBetween, readTapTarget, tapIntent, wordIsHighlighted } from '../words';
import type { HighlightRange } from '../../protocol';

const V16 = 43003016;
const V17 = 43003017;
const V18 = 43003018;

describe('rangeBetween', () => {
  it('orders the ends whichever was picked first', () => {
    expect(rangeBetween({ verseId: V16, index: 5 }, { verseId: V16, index: 2 }))
      .toEqual({ verseIdStart: V16, textStart: 2, textEnd: 5 });
  });

  it('a single word always carries textEnd', () => {
    expect(rangeBetween({ verseId: V16, index: 3 }, { verseId: V16, index: 3 }))
      .toEqual({ verseIdStart: V16, textStart: 3, textEnd: 3 });
  });

  it('crosses verses in document order', () => {
    expect(rangeBetween({ verseId: V17, index: 1 }, { verseId: V16, index: 8 }))
      .toEqual({ verseIdStart: V16, textStart: 8, verseIdEnd: V17, textEnd: 1 });
  });
});

describe('wordIsHighlighted', () => {
  const single: HighlightRange = { verseIdStart: V16, textStart: 2, textEnd: 4 };
  const oneWord: HighlightRange = { verseIdStart: V16, textStart: 7 };
  const multi: HighlightRange = { verseIdStart: V16, textStart: 10, verseIdEnd: V18, textEnd: 1 };

  it('within a single-verse range, inclusive', () => {
    expect(wordIsHighlighted([single], { verseId: V16, index: 2 })).toBe(true);
    expect(wordIsHighlighted([single], { verseId: V16, index: 4 })).toBe(true);
    expect(wordIsHighlighted([single], { verseId: V16, index: 5 })).toBe(false);
    expect(wordIsHighlighted([single], { verseId: V17, index: 3 })).toBe(false);
  });

  it('a missing textEnd on a single verse means one word', () => {
    expect(wordIsHighlighted([oneWord], { verseId: V16, index: 7 })).toBe(true);
    expect(wordIsHighlighted([oneWord], { verseId: V16, index: 8 })).toBe(false);
  });

  it('across verses: from the start word, all of the middle verse, up to the end word', () => {
    expect(wordIsHighlighted([multi], { verseId: V16, index: 9 })).toBe(false);
    expect(wordIsHighlighted([multi], { verseId: V16, index: 40 })).toBe(true);
    expect(wordIsHighlighted([multi], { verseId: V17, index: 0 })).toBe(true);
    expect(wordIsHighlighted([multi], { verseId: V17, index: 99 })).toBe(true);
    expect(wordIsHighlighted([multi], { verseId: V18, index: 1 })).toBe(true);
    expect(wordIsHighlighted([multi], { verseId: V18, index: 2 })).toBe(false);
  });
});

describe('tapIntent', () => {
  const lit: HighlightRange[] = [{ verseIdStart: V16, textStart: 2, textEnd: 4 }];

  it('a tap on a lit word removes it (sent as the one word; the reducer drops any overlap)', () => {
    expect(tapIntent({ word: { verseId: V16, index: 3 }, verse: 16 }, lit, 16)).toEqual({
      type: 'removeHighlight', highlight: { verseIdStart: V16, textStart: 3, textEnd: 3 },
    });
  });

  it('removing wins over moving, for a lit word in another verse', () => {
    expect(tapIntent({ word: { verseId: V16, index: 2 }, verse: 16 }, lit, 17)?.type).toBe('removeHighlight');
  });

  it('a tap on another verse moves to it', () => {
    expect(tapIntent({ word: { verseId: V17, index: 0 }, verse: 17 }, lit, 16)).toEqual({ type: 'goTo', index: 17 });
    expect(tapIntent({ word: null, verse: 15 }, [], 16)).toEqual({ type: 'goTo', index: 15 });
  });

  it('a tap on an unlit word of the current verse, or on nothing, does nothing', () => {
    expect(tapIntent({ word: { verseId: V16, index: 0 }, verse: 16 }, lit, 16)).toBeNull();
    expect(tapIntent({ word: null, verse: null }, lit, 16)).toBeNull();
  });
});

describe('readTapTarget', () => {
  it('reads the word and verse off the rendered attributes, from a text node or an element', () => {
    document.body.innerHTML = `
      <p data-verse-id="${V17}" data-verse="17"><span class="pv-versenum">17</span>
        <span><span data-word-index="0">For </span><span data-word-index="1">God</span></span></p>`;
    const god = document.querySelector('[data-word-index="1"]')!;
    expect(readTapTarget(god.firstChild)).toEqual({ word: { verseId: V17, index: 1 }, verse: 17 });
    expect(readTapTarget(god)).toEqual({ word: { verseId: V17, index: 1 }, verse: 17 });
    expect(readTapTarget(document.querySelector('.pv-versenum'))).toEqual({ word: null, verse: 17 });
    expect(readTapTarget(document.body)).toEqual({ word: null, verse: null });
  });
});
