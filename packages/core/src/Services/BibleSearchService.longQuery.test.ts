/** B-169: a long query of significant words fanned out into astronomically many term combinations. */
import { describe, it, expect } from 'vitest';
import { BibleSearchService } from './BibleSearchService';

const combinations = (BibleSearchService as unknown as {
  combinations(n: number, k: number, limit?: number): number[][];
}).combinations;

describe('coverage-fuzzy term combinations (B-169)', () => {
  it('stops generating at the limit', () => {
    expect(combinations(22, 13, 30)).toHaveLength(30);
    expect(combinations(5, 2)).toHaveLength(10);
  });
});
