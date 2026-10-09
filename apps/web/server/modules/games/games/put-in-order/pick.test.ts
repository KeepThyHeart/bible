/**
 * Choosing the next list.
 *
 * A game of put-in-order is ten or so lists, and the material is five handfuls
 * from each of seventeen stories. The failure worth guarding against is not a
 * crash but a dull game: the same list twice, or three lists about Joseph in a
 * row.
 */

import { describe, expect, it } from 'vitest';
import type { OrderedListRecord } from '../../content/index.js';
import { chooseList, timelineOf, withinCeiling } from './pick.js';

function seeded(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function listOf(id: string, difficulty = 2): OrderedListRecord {
  return {
    id,
    title: id,
    instructions: null,
    source: null,
    reviewedBy: null,
    difficulty,
    audience: 'all',
    book: null,
    section: null,
    tags: [],
    items: ['one', 'two', 'three', 'four'].map((label) => ({ label, verseId: null, note: null })),
  };
}

/** Three handfuls from each of three stories, as the generator deals them. */
const DEALT: OrderedListRecord[] = ['creation', 'joseph', 'exodus'].flatMap((story) =>
  [1, 2, 3].map((n) => listOf(`put-in-order-${story}-${n}`))
);

/** Plays a whole game of choices, feeding each one back as history. */
function playGame(candidates: readonly OrderedListRecord[], rounds: number, seed: number): string[] {
  const random = seeded(seed);
  const played: string[] = [];
  for (let round = 0; round < rounds; round += 1) {
    const chosen = chooseList(candidates, played, random);
    if (chosen === null) break;
    played.push(chosen.id);
  }
  return played;
}

describe('telling which story a list came from', () => {
  it('reads the story out of a generated id', () => {
    expect(timelineOf('put-in-order-creation-3')).toBe('creation');
    expect(timelineOf('put-in-order-elijah-elisha-12')).toBe('elijah-elisha');
    expect(timelineOf('put-in-order-books-old-1')).toBe('books-old');
  });

  it('treats a list written by hand as a story of its own', () => {
    expect(timelineOf('the-good-samaritan')).toBe('the-good-samaritan');
    expect(timelineOf('put-in-order-')).toBe('put-in-order-');
  });
});

describe('the room’s ceiling', () => {
  const mixed = [listOf('easy', 1), listOf('middling', 3), listOf('hard', 5)];

  it('keeps to lists at or under it', () => {
    expect(withinCeiling(mixed, 3).map((list) => list.id)).toEqual(['easy', 'middling']);
    expect(withinCeiling(mixed, 1).map((list) => list.id)).toEqual(['easy']);
  });

  it('offers everything when the room set no cap', () => {
    expect(withinCeiling(mixed, null)).toHaveLength(3);
  });

  it('falls back to the easiest lists there are rather than to nothing', () => {
    const harder = [listOf('a', 3), listOf('b', 2), listOf('c', 2), listOf('d', 5)];

    expect(withinCeiling(harder, 1).map((list) => list.id)).toEqual(['b', 'c']);
  });

  it('has nothing to offer from nothing', () => {
    expect(withinCeiling([], 3)).toEqual([]);
    expect(withinCeiling([], null)).toEqual([]);
  });
});

describe('choosing the next list', () => {
  it('has nothing to choose from an empty library', () => {
    expect(chooseList([], [], seeded(1))).toBeNull();
  });

  it('does not put up the same list twice while others remain', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const played = playGame(DEALT, DEALT.length, seed);

      expect(new Set(played).size, `seed ${seed}`).toBe(DEALT.length);
    }
  });

  it('never follows a list with another from the same story', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const stories = playGame(DEALT, DEALT.length, seed).map(timelineOf);

      for (let round = 1; round < stories.length; round += 1) {
        expect(stories[round], `seed ${seed}, round ${round}`).not.toBe(stories[round - 1]);
      }
    }
  });

  it('visits every story once before coming back to any of them', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const stories = playGame(DEALT, 3, seed).map(timelineOf);

      expect(new Set(stories).size, `seed ${seed}`).toBe(3);
    }
  });

  it('comes back round to a played list rather than showing nothing', () => {
    const played = playGame(DEALT, DEALT.length + 4, 7);

    expect(played).toHaveLength(DEALT.length + 4);
  });

  it('puts up a list from the same story when that story is all there is', () => {
    const oneStory = [listOf('put-in-order-joseph-1'), listOf('put-in-order-joseph-2')];

    expect(playGame(oneStory, 2, 5).sort()).toEqual([
      'put-in-order-joseph-1',
      'put-in-order-joseph-2',
    ]);
  });

  it('chooses the same way given the same generator', () => {
    expect(playGame(DEALT, 6, 11)).toEqual(playGame(DEALT, 6, 11));
  });
});
