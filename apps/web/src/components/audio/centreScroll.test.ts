import { describe, it, expect } from 'vitest';
import { centreTarget, endPadding, ANCHOR } from './centreScroll';

const base = { scrollTop: 500, scrollerTop: 100, clientHeight: 400, verseHeight: 40, scrollHeight: 2000 };

describe('centreTarget', () => {
  it('centres a mid-chapter verse exactly', () => {
    // verse at viewport 300 -> 200px below scroller top; centred means 180px below.
    expect(centreTarget({ ...base, verseTop: 300 })).toBe(520);
  });
  it('clamps a near-top verse to 0', () => {
    expect(centreTarget({ ...base, scrollTop: 0, verseTop: 110 })).toBe(0);
  });
  it('clamps a near-bottom verse to the maximum', () => {
    expect(centreTarget({ ...base, scrollTop: 1550, verseTop: 480 })).toBe(1600);
  });
  it('top-aligns (minus 8) a verse taller than the viewport', () => {
    expect(centreTarget({ ...base, verseHeight: 600, verseTop: 300 })).toBe(692);
  });
  it('puts the verse middle on a higher anchor line', () => {
    // anchor 0.25 of 400 = 100; verse (40 high) at 200 below the scroller top -> scroll by 200 - (100 - 20).
    expect(centreTarget({ ...base, verseTop: 300, anchor: 0.25 })).toBe(500 + 200 - 80);
  });
  it('lets the first and last verses reach the anchor line when the ends are padded', () => {
    const pad = endPadding(400, ANCHOR.popup);
    expect(pad).toEqual({ top: 132, bottom: 268 });
    // First verse sits `pad.top` below the top of the content, scrolled to 0: it can move up to the line.
    const scrollHeight = pad.top + 40 + pad.bottom;
    expect(centreTarget({ ...base, scrollTop: 0, scrollerTop: 0, verseTop: pad.top, scrollHeight, anchor: ANCHOR.popup })).toBe(20);
    // Last verse: reaches the line as far as the padding allows.
    const total = 2000 + pad.top + pad.bottom;
    const t = centreTarget({ ...base, scrollTop: 0, scrollerTop: 0, verseTop: total - pad.bottom - 40, scrollHeight: total, anchor: ANCHOR.popup });
    expect(total - pad.bottom - 40 - t + 20).toBeCloseTo(400 * ANCHOR.popup, 0);
  });
});
