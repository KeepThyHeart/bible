/**
 * Which wrong names a round offers.
 *
 * The thing worth pinning down is the balance: the most plausible names are
 * the round, and the rest are there so the same question on a second evening
 * does not put up the same four names. Neither half may take over.
 */

import { describe, expect, it } from 'vitest';
import { DISTRACTORS_OFFERED, chooseDistractors, shuffled } from './options.js';

const RANKED = ['Rebekah', 'Rachel', 'Leah', 'Sarah', 'Hagar', 'Miriam', 'Deborah', 'Hannah'];
const LEADING = RANKED.slice(0, DISTRACTORS_OFFERED);

/**
 * A mixing generator rather than a bare linear one: neighbouring seeds of a
 * linear generator give nearly the same first value, so a loop over seeds would
 * test one draw many times.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe('choosing three wrong names', () => {
  it('keeps the three most plausible when the dice say so', () => {
    expect(chooseDistractors(RANKED, () => 0.99)).toEqual(LEADING);
  });

  it('can hand every slot to the tail, and then offers none of the leaders', () => {
    const chosen = chooseDistractors(RANKED, () => 0);

    expect(chosen).toHaveLength(DISTRACTORS_OFFERED);
    for (const name of chosen) {
      expect(LEADING).not.toContain(name);
      expect(RANKED).toContain(name);
    }
    expect(new Set(chosen).size).toBe(DISTRACTORS_OFFERED);
  });

  it('mostly offers the leaders, and sometimes something else', () => {
    let leaders = 0;
    let rounds = 0;
    const seen = new Set<string>();
    for (let seed = 1; seed <= 400; seed += 1) {
      const chosen = chooseDistractors(RANKED, seeded(seed));
      expect(new Set(chosen).size, `seed ${seed}`).toBe(DISTRACTORS_OFFERED);
      leaders += chosen.filter((name) => LEADING.includes(name)).length;
      rounds += 1;
      for (const name of chosen) seen.add(name);
    }

    // Three-quarters of each slot stays with its leader: about 2.25 a round.
    expect(leaders / rounds).toBeGreaterThan(2);
    expect(leaders / rounds).toBeLessThan(2.5);
    // And over enough replays the whole tail gets its turn.
    expect(seen).toEqual(new Set(RANKED));
  });

  it('keeps the leaders when there is no tail to vary them with', () => {
    expect(chooseDistractors(LEADING, () => 0)).toEqual(LEADING);
  });

  it('offers what it has when a question carries fewer than three', () => {
    expect(chooseDistractors(['Abel', 'Seth'], () => 0)).toEqual(['Abel', 'Seth']);
    expect(chooseDistractors([], () => 0)).toEqual([]);
  });

  it('replays exactly, given the same generator', () => {
    expect(chooseDistractors(RANKED, seeded(9))).toEqual(chooseDistractors(RANKED, seeded(9)));
  });
});

describe('shuffling the four names into place', () => {
  it('moves them without losing or copying one', () => {
    const names = ['Cain', 'Abel', 'Seth', 'Noah'];

    expect(shuffled(names, seeded(3)).sort()).toEqual([...names].sort());
    expect(names).toEqual(['Cain', 'Abel', 'Seth', 'Noah']);
  });

  it('stays inside the list even for a generator that returns one', () => {
    expect(shuffled(['a', 'b', 'c'], () => 1).sort()).toEqual(['a', 'b', 'c']);
  });
});
