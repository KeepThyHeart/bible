import { describe, it, expect } from 'vitest';
import { MAX_SWEEP_STEPS, highlightSpanForVerse, sweepStep } from '../highlight';
import type { HighlightRange } from '../protocol';

const V16 = 43003016;
const V17 = 43003017;
const V18 = 43003018;

describe('a highlight inside one verse', () => {
  it('lights the inclusive run of words', () => {
    const highlight: HighlightRange = { verseIdStart: V16, textStart: 2, textEnd: 5 };
    expect(highlightSpanForVerse(V16, 20, highlight)).toEqual({ from: 2, to: 5 });
  });

  it('lights a single word when there is no end index', () => {
    // A missing textEnd means one word, not "the rest of the verse". A
    // controller that means the rest says so.
    expect(highlightSpanForVerse(V16, 20, { verseIdStart: V16, textStart: 3 }))
      .toEqual({ from: 3, to: 3 });
  });

  it('lights nothing in a verse the range does not touch', () => {
    const highlight: HighlightRange = { verseIdStart: V16, textStart: 0, textEnd: 4 };
    expect(highlightSpanForVerse(V17, 20, highlight)).toBeNull();
    expect(highlightSpanForVerse(43003015, 20, highlight)).toBeNull();
  });
});

describe('a highlight spanning verses', () => {
  const highlight: HighlightRange = {
    verseIdStart: V16, textStart: 4,
    verseIdEnd: V18, textEnd: 2,
  };

  it('lights the first verse from the start word to its end', () => {
    expect(highlightSpanForVerse(V16, 10, highlight)).toEqual({ from: 4, to: 9 });
  });

  it('lights a verse in the middle entirely', () => {
    expect(highlightSpanForVerse(V17, 7, highlight)).toEqual({ from: 0, to: 6 });
  });

  it('lights the last verse from its start to the end word', () => {
    expect(highlightSpanForVerse(V18, 10, highlight)).toEqual({ from: 0, to: 2 });
  });

  it('lights nothing outside the range', () => {
    expect(highlightSpanForVerse(43003019, 10, highlight)).toBeNull();
  });

  it('lights the last verse whole when it has no end word', () => {
    const open: HighlightRange = { verseIdStart: V16, textStart: 4, verseIdEnd: V17 };
    expect(highlightSpanForVerse(V17, 6, open)).toEqual({ from: 0, to: 5 });
  });
});

describe('when the numbers do not match the text', () => {
  it('clamps rather than refusing to light anything', () => {
    // The controller may have measured a different translation, or a module
    // updated between the two. Slightly wrong words beat no words on a wall.
    expect(highlightSpanForVerse(V16, 5, { verseIdStart: V16, textStart: 2, textEnd: 99 }))
      .toEqual({ from: 2, to: 4 });
    expect(highlightSpanForVerse(V16, 5, { verseIdStart: V16, textStart: 40, textEnd: 99 }))
      .toEqual({ from: 4, to: 4 });
  });

  it('lights nothing in a verse with no words', () => {
    expect(highlightSpanForVerse(V16, 0, { verseIdStart: V16, textStart: 0 })).toBeNull();
  });

  it('lights nothing when there is no highlight at all', () => {
    expect(highlightSpanForVerse(V16, 10, null)).toBeNull();
  });
});

describe('the sweep', () => {
  const span = { from: 4, to: 20 };

  it('counts from the start of the highlight, not the verse', () => {
    expect(sweepStep(4, span)).toBe(0);
    expect(sweepStep(6, span)).toBe(2);
  });

  it('reports -1 outside the highlight, so nothing animates', () => {
    expect(sweepStep(3, span)).toBe(-1);
    expect(sweepStep(21, span)).toBe(-1);
    expect(sweepStep(0, null)).toBe(-1);
  });

  it('caps the delay so a long highlight still finishes promptly', () => {
    expect(sweepStep(20, span)).toBe(MAX_SWEEP_STEPS);
  });
});
