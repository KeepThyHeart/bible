import { describe, it, expect } from 'vitest';
import { fillTemplate, goBack, hopTo, initialState, jumpTo, resetTrail } from './hopperTrail';

describe('hopperTrail', () => {
  const s0 = initialState(1001001);
  it('hops and pushes the previous verse', () => {
    const s1 = hopTo(s0, 2002002);
    expect(s1).toEqual({ current: 2002002, trail: [1001001] });
    expect(hopTo(s1, 2002002)).toBe(s1);
  });
  it('goes back and stops at the start', () => {
    const s2 = hopTo(hopTo(s0, 2), 3);
    expect(goBack(s2)).toEqual({ current: 2, trail: [1001001] });
    expect(goBack(s0)).toBe(s0);
  });
  it('jumps and truncates', () => {
    const s3 = hopTo(hopTo(hopTo(s0, 2), 3), 4);
    expect(jumpTo(s3, 1)).toEqual({ current: 2, trail: [1001001] });
    expect(jumpTo(s3, 9)).toBe(s3);
  });
  it('resets to the first verse', () => {
    expect(resetTrail(hopTo(hopTo(s0, 2), 3))).toEqual({ current: 1001001, trail: [] });
    expect(resetTrail(s0)).toBe(s0);
  });
  it('builds from an initial trail without repeating the anchor', () => {
    expect(initialState(5, [1, 2, 5])).toEqual({ current: 5, trail: [1, 2] });
  });
  it('fills templates', () => {
    expect(fillTemplate('strength {n} of 5', { n: 4 })).toBe('strength 4 of 5');
    expect(fillTemplate('{x}', {})).toBe('{x}');
  });
});
