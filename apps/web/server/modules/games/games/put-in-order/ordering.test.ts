/**
 * The arithmetic of nearly right.
 *
 * What is worth pinning down here is less the numbers than the promises behind
 * them: a neighbouring swap costs little, a reversal earns nothing, a blind
 * guess earns little on average, and the order the items are shown in is never
 * an answer worth sending.
 */

import { describe, expect, it } from 'vitest';
import {
  SHUFFLE_ATTEMPTS,
  creditFor,
  displayOrder,
  gradeFor,
  isFairDisplay,
  pairCount,
  ranksOf,
  wrongPairs,
} from './ordering.js';

function seeded(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

/** Every ordering of `length` items, for claims about what a blind guess earns. */
function permutations(length: number): number[][] {
  if (length === 0) return [[]];
  const all: number[][] = [];
  for (const shorter of permutations(length - 1)) {
    for (let at = 0; at <= shorter.length; at += 1) {
      all.push([...shorter.slice(0, at), length - 1, ...shorter.slice(at)]);
    }
  }
  return all;
}

function reversed(ranks: readonly number[]): number[] {
  return [...ranks].reverse();
}

describe('counting pairs', () => {
  it('finds six small questions in four items and ten in five', () => {
    expect(pairCount(4)).toBe(6);
    expect(pairCount(5)).toBe(10);
  });

  it('counts a neighbouring swap as one wrong pair and a reversal as all of them', () => {
    expect(wrongPairs([0, 1, 2, 3])).toBe(0);
    expect(wrongPairs([1, 0, 2, 3])).toBe(1);
    expect(wrongPairs([3, 2, 1, 0])).toBe(6);
  });

  it('charges an item moved a long way for every pair it crosses', () => {
    expect(wrongPairs([1, 2, 3, 0])).toBe(3);
  });
});

describe('what an ordering earns', () => {
  it('pays in even steps from a perfect order down to chance', () => {
    expect(creditFor([0, 1, 2, 3])).toBe(1);
    expect(creditFor([1, 0, 2, 3])).toBeCloseTo(2 / 3);
    expect(creditFor([1, 0, 3, 2])).toBeCloseTo(1 / 3);
    expect(creditFor([1, 2, 3, 0])).toBe(0);
    expect(creditFor([1, 0, 2, 3, 4])).toBeCloseTo(0.8);
  });

  it('pays nothing for an order that is worse than chance', () => {
    expect(creditFor([3, 2, 1, 0])).toBe(0);
    expect(creditFor([4, 3, 2, 1, 0])).toBe(0);
  });

  it('pays a blind guess less than a fifth of the round on average', () => {
    for (const length of [4, 5]) {
      const every = permutations(length);
      const average = every.reduce((total, ranks) => total + creditFor(ranks), 0) / every.length;

      expect(average, `${length} items`).toBeLessThan(0.2);
    }
  });

  it('grades a single neighbouring swap as nearly right and nothing else', () => {
    expect(gradeFor([0, 1, 2, 3])).toBe('inOrder');
    expect(gradeFor([0, 2, 1, 3])).toBe('oneSwap');
    expect(gradeFor([1, 0, 3, 2])).toBe('partly');
    expect(gradeFor([1, 2, 3, 0])).toBe('furtherOff');
  });
});

describe('reading a submitted order', () => {
  const keys = ['C', 'A', 'D', 'B'];

  it('turns each key into the place it belongs', () => {
    expect(ranksOf(['C', 'A', 'D', 'B'], keys)).toEqual([0, 1, 2, 3]);
    expect(ranksOf(['B', 'D', 'A', 'C'], keys)).toEqual([3, 2, 1, 0]);
  });

  it('refuses anything that is not every item exactly once', () => {
    expect(ranksOf(['C', 'A'], keys)).toBeNull();
    expect(ranksOf(['C', 'A', 'D', 'B', 'E'], keys)).toBeNull();
    expect(ranksOf(['C', 'C', 'D', 'B'], keys)).toBeNull();
    expect(ranksOf(['C', 'A', 'D', 'Z'], keys)).toBeNull();
    expect(ranksOf(['C', 'A', 'D', 3], keys)).toBeNull();
    expect(ranksOf('CADB', keys)).toBeNull();
  });
});

describe('the order the items are shown in', () => {
  it('shows every item exactly once', () => {
    const shown = displayOrder(5, seeded(3));

    expect([...shown].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('never puts a list up already in order, or exactly backwards', () => {
    for (const length of [3, 4, 5, 6]) {
      for (let seed = 1; seed <= 200; seed += 1) {
        const shown = displayOrder(length, seeded(seed));

        expect(wrongPairs(shown), `${length} items, seed ${seed}`).not.toBe(0);
        expect(wrongPairs(shown), `${length} items, seed ${seed}`).not.toBe(pairCount(length));
      }
    }
  });

  it('earns at most a third of the round for tapping it top down or bottom up', () => {
    for (const length of [3, 4, 5]) {
      for (let seed = 1; seed <= 200; seed += 1) {
        const shown = displayOrder(length, seeded(seed));

        expect(isFairDisplay(shown)).toBe(true);
        expect(creditFor(shown)).toBeLessThanOrEqual(1 / 3);
        expect(creditFor(reversed(shown))).toBeLessThanOrEqual(1 / 3);
      }
    }
  });

  it('settles for the least telling shuffle when the generator never offers a fair one', () => {
    // A generator stuck on one value shuffles the same way every time, so the
    // cap is what stops the loop rather than luck.
    let calls = 0;
    const stuck = (): number => {
      calls += 1;
      return 0.999;
    };
    const shown = displayOrder(4, stuck);

    expect([...shown].sort()).toEqual([0, 1, 2, 3]);
    expect(calls).toBeLessThanOrEqual(SHUFFLE_ATTEMPTS * 3);
  });

  it('replays exactly, given the same generator', () => {
    expect(displayOrder(5, seeded(42))).toEqual(displayOrder(5, seeded(42)));
  });
});
