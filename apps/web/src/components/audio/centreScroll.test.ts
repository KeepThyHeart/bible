import { describe, it, expect } from 'vitest';
import { centreTarget } from './centreScroll';

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
});
