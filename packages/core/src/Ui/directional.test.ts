import { describe, it, expect } from 'vitest';
import { anchorAtPointer, logicalArrow, logicalSwipe, scrollStart, setScrollStart } from './directional';

describe('logicalArrow', () => {
  it('maps arrows by direction', () => {
    expect(logicalArrow('ArrowRight', 'ltr')).toBe('next');
    expect(logicalArrow('ArrowLeft', 'ltr')).toBe('prev');
    expect(logicalArrow('ArrowRight', 'rtl')).toBe('prev');
    expect(logicalArrow('ArrowLeft', 'rtl')).toBe('next');
  });
  it('ignores other keys', () => {
    expect(logicalArrow('ArrowUp', 'rtl')).toBeNull();
    expect(logicalArrow('a', 'ltr')).toBeNull();
  });
});

describe('logicalSwipe', () => {
  it('a leftward swipe advances in LTR and goes back in RTL', () => {
    expect(logicalSwipe(-80, 'ltr')).toBe('next');
    expect(logicalSwipe(80, 'ltr')).toBe('prev');
    expect(logicalSwipe(-80, 'rtl')).toBe('prev');
    expect(logicalSwipe(80, 'rtl')).toBe('next');
    expect(logicalSwipe(0, 'rtl')).toBeNull();
  });
});

describe('scrollStart / setScrollStart', () => {
  const el = (scrollLeft: number) => ({ scrollLeft, scrollWidth: 1000, clientWidth: 400 });
  it('is scrollLeft in LTR', () => {
    expect(scrollStart(el(120), 'ltr')).toBe(120);
  });
  it('normalizes the spec (negative) RTL form', () => {
    expect(scrollStart(el(0), 'rtl')).toBe(0);
    expect(scrollStart(el(-150), 'rtl')).toBe(150);
  });
  it('sets and clamps', () => {
    const e = el(0);
    setScrollStart(e, 150, 'rtl');
    expect(e.scrollLeft).toBe(-150);
    setScrollStart(e, 9999, 'ltr');
    expect(e.scrollLeft).toBe(600);
    setScrollStart(e, -5, 'ltr');
    expect(e.scrollLeft).toBe(0);
  });
});

describe('anchorAtPointer', () => {
  it('unfolds in the reading direction', () => {
    expect(anchorAtPointer(100, 200, 1000, 'ltr')).toEqual({ insetInlineStart: 100 });
    // RTL: pointer at x=900 is 100px from the right (start) edge.
    expect(anchorAtPointer(900, 200, 1000, 'rtl')).toEqual({ insetInlineStart: 100 });
  });
  it('flips when there is no room', () => {
    expect(anchorAtPointer(950, 200, 1000, 'ltr')).toEqual({ insetInlineStart: 750 });
    expect(anchorAtPointer(50, 200, 1000, 'rtl')).toEqual({ insetInlineStart: 750 });
  });
  it('keeps edge padding', () => {
    expect(anchorAtPointer(5, 200, 1000, 'ltr', 10)).toEqual({ insetInlineStart: 10 });
    expect(anchorAtPointer(995, 200, 1000, 'ltr', 10)).toEqual({ insetInlineStart: 790 });
    expect(anchorAtPointer(900, 200, 1000, 'rtl', 10)).toEqual({ insetInlineStart: 100 });
  });
  it('clamps to the viewport', () => {
    expect(anchorAtPointer(100, 300, 250, 'ltr')).toEqual({ insetInlineStart: 0 });
  });
});
