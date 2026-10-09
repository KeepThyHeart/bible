/**
 * Dealing a turn's deck.
 *
 * A turn needs far fewer cards than a deck holds — a fast team gets through a
 * dozen in a minute — but running out mid-turn is a worse failure than a deck
 * that is mostly never seen, so every turn is dealt at least `DECK_SIZE`.
 *
 * Two pulls work against each other, and the order they are settled in is the
 * design:
 *
 * 1. **The room's familiarity comes first.** A room set to well-known material
 *    gets cards at or under that difficulty. Only when the ceiling holds fewer
 *    than a deck's worth is it raised, one step at a time, so a small pool is
 *    stretched as little as it can be rather than abandoned.
 * 2. **Then freshness.** Cards no earlier turn dealt go first. After those,
 *    cards come back in the order they are least likely to have been seen:
 *    the room keeps no record of how far into a deck a turn got, so a card
 *    that sat thirtieth in an earlier deck is treated as probably unseen and a
 *    card that sat second as almost certainly played.
 *
 * Every shuffle takes the room's own generator, so a room replayed from its
 * intents deals the same cards in the same order.
 */

import type { Round } from '../../../../../src/modules/games/shared/games.js';
import type { Familiarity } from '../../../../../src/modules/games/shared/protocol.js';
import { FAMILIARITY_CEILING, MAX_DIFFICULTY, promptCards } from '../../content/index.js';
import type { PromptCardRecord } from '../../content/index.js';

/** The fewest cards a turn is dealt, whenever the library holds that many. */
export const DECK_SIZE = 40;

/** One card as the game keeps it: what a describer reads, and nothing about its authoring. */
export interface DescribeItCard {
  id: string;
  concept: string;
  category: string;
  forbidden: string[];
}

/** What the deal needs to know about an earlier turn: the deck it was given. */
export interface DealtTurn {
  deck: readonly DescribeItCard[];
}

/** A Fisher–Yates shuffle on the room's generator. The input is left alone. */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    const held = copy[index] as T;
    copy[index] = copy[other] as T;
    copy[other] = held;
  }
  return copy;
}

/**
 * The cards within the room's familiarity, raised a step at a time until the
 * pool can fill a deck or there is nowhere higher to go. `any` means no
 * ceiling, which is the whole library.
 */
export function poolFor(familiarity: Familiarity): PromptCardRecord[] {
  let ceiling = FAMILIARITY_CEILING[familiarity] ?? MAX_DIFFICULTY;
  let pool = promptCards({ maxDifficulty: ceiling });
  while (pool.length < DECK_SIZE && ceiling < MAX_DIFFICULTY) {
    ceiling += 1;
    pool = promptCards({ maxDifficulty: ceiling });
  }
  return pool;
}

/** A card never dealt ranks above every position a dealt card can have held. */
const NEVER_DEALT = Number.MAX_SAFE_INTEGER;

/**
 * How far down any earlier deck each card ever sat, taking the nearest the top
 * it got — the place where it was most likely to have been played.
 */
function topmostPlaces(previous: readonly DealtTurn[]): Map<string, number> {
  const places = new Map<string, number>();
  for (const turn of previous) {
    turn.deck.forEach((card, place) => {
      const known = places.get(card.id);
      if (known === undefined || place < known) places.set(card.id, place);
    });
  }
  return places;
}

export function dealDeck(
  familiarity: Familiarity,
  random: () => number,
  previous: readonly DealtTurn[]
): DescribeItCard[] {
  const places = topmostPlaces(previous);
  const rank = (card: PromptCardRecord): number => places.get(card.id) ?? NEVER_DEALT;
  // Shuffled first and then sorted, and the sort is stable, so cards of equal
  // standing stay in the generator's order rather than the library's.
  const ordered = shuffled(poolFor(familiarity), random).sort((a, b) => rank(b) - rank(a));
  return ordered.slice(0, DECK_SIZE).map((card) => ({
    id: card.id,
    concept: card.concept,
    category: card.category,
    forbidden: [...card.forbidden],
  }));
}

/** Earlier turns' decks, read off the rounds the room has already built. */
export function dealtBefore(previous: readonly Round<DealtTurn>[]): DealtTurn[] {
  return previous.map((round) => round.secret);
}
