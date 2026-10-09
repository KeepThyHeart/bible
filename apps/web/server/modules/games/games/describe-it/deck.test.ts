/**
 * Dealing a turn's deck.
 *
 * What matters is the order the two pulls are settled in: the room's
 * familiarity first, stretched only as far as a deck needs, and then cards no
 * earlier turn dealt ahead of ones it did.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContentDatabase,
  ContentLibrary,
  ModuleCatalog,
  importContent,
  useContent,
} from '../../content/index.js';
import { DECK_SIZE, dealDeck, shuffled } from './deck.js';

/** A fixed sequence, so a deal from it can be asserted on. */
function sequence(values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

const RANDOM = [0.12, 0.87, 0.45, 0.03, 0.66, 0.31, 0.94, 0.58];

let library: ContentLibrary;
let previous: ContentLibrary | null;

/** `count` cards at one difficulty, named so a test can read the tier back. */
function cards(difficulty: number, count: number, tag = 'tier'): unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    concept: `${tag} ${difficulty} card ${index}`,
    category: 'event',
    difficulty,
    forbidden: ['alpha', 'beta', 'gamma', 'delta'],
  }));
}

function stock(...groups: unknown[][]): void {
  const report = importContent(library.db, { promptCards: groups.flat() });
  expect(report.rejected).toEqual([]);
}

function tierOf(concept: string): number {
  return Number(concept.split(' ')[1]);
}

beforeEach(() => {
  library = ContentLibrary.of(ModuleCatalog.of([]), ContentDatabase.openInMemory(), 'FIX');
  previous = useContent(library);
});

afterEach(() => {
  useContent(previous);
  library.close();
});

describe('the size of a deck', () => {
  it('is a full deck when the library holds more', () => {
    stock(cards(1, 60));
    expect(dealDeck('core', sequence(RANDOM), [])).toHaveLength(DECK_SIZE);
  });

  it('is everything there is when the library holds less, rather than nothing', () => {
    stock(cards(1, 7));
    expect(dealDeck('core', sequence(RANDOM), [])).toHaveLength(7);
  });

  it('is empty, not an error, when no cards are installed', () => {
    expect(dealDeck('broad', sequence(RANDOM), [])).toEqual([]);
  });
});

describe('the familiarity ceiling', () => {
  it('holds when there are enough cards under it', () => {
    stock(cards(1, 45), cards(3, 30));
    const deck = dealDeck('core', sequence(RANDOM), []);
    expect(deck.every((card) => tierOf(card.concept) === 1)).toBe(true);
  });

  it('is raised one step at a time, and only as far as a deck needs', () => {
    stock(cards(1, 20), cards(2, 25), cards(3, 30));
    const deck = dealDeck('core', sequence(RANDOM), []);
    expect(deck).toHaveLength(DECK_SIZE);
    expect(new Set(deck.map((card) => tierOf(card.concept)))).toEqual(new Set([1, 2]));
  });

  it('is not there at all for a room that asked for anything', () => {
    stock(cards(5, 45));
    expect(dealDeck('any', sequence(RANDOM), [])).toHaveLength(DECK_SIZE);
  });
});

describe('a later turn', () => {
  it('gets cards no earlier turn was dealt, before any that were', () => {
    stock(cards(1, 60));
    const first = dealDeck('core', sequence(RANDOM), []);
    const second = dealDeck('core', sequence(RANDOM), [{ deck: first }]);
    const earlier = new Set(first.map((card) => card.id));

    expect(second.slice(0, 20).some((card) => earlier.has(card.id))).toBe(false);
    expect(second.slice(20).every((card) => earlier.has(card.id))).toBe(true);
  });

  it('reuses the cards that sat deepest in an earlier deck first, since those were least likely reached', () => {
    stock(cards(1, 60));
    const first = dealDeck('core', sequence(RANDOM), []);
    const second = dealDeck('core', sequence(RANDOM), [{ deck: first }]);

    expect(second.slice(20).map((card) => card.id)).toEqual(
      first
        .slice(20)
        .reverse()
        .map((card) => card.id)
    );
  });
});

describe('dealing', () => {
  it('deals the same deck from the same generator', () => {
    stock(cards(1, 60));
    expect(dealDeck('core', sequence(RANDOM), [])).toEqual(dealDeck('core', sequence(RANDOM), []));
  });

  it('keeps only what a describer reads', () => {
    stock(cards(1, 1));
    expect(Object.keys(dealDeck('core', sequence(RANDOM), [])[0] ?? {}).sort()).toEqual([
      'category',
      'concept',
      'forbidden',
      'id',
    ]);
  });

  it('shuffles a copy and leaves the original alone', () => {
    const original = [1, 2, 3, 4, 5];
    const result = shuffled(original, sequence(RANDOM));
    expect(original).toEqual([1, 2, 3, 4, 5]);
    expect([...result].sort()).toEqual(original);
  });
});
