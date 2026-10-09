/**
 * How near an ordering is to the right one, and what that is worth.
 *
 * The measure is pairs. Any two items in a list are either the right way round
 * or the wrong way round, so a four-item list is six small questions — did the
 * flood come before Babel, did Babel come before Abraham — and a player who got
 * five of them knew most of the story. Swapping two neighbours costs one pair;
 * putting the first event last costs every pair it touches, which is the right
 * price for thinking the Exodus came after the Judges.
 *
 * Two alternatives were weighed and set aside:
 *
 * - **items in their exact slot.** One early slip shifts everything after it,
 *   so a player who had the whole story right but started one place late
 *   scores nothing. That marks the handwriting, not the knowledge.
 * - **the longest run already in order.** Kinder to one item moved a long way,
 *   but on a four-item list a blind guess lands three in order more than a
 *   third of the time, which leaves "nearly right" meaning nothing.
 *
 * Pairs share that weakness in a milder form: a shuffle gets half of them right
 * on average. So credit starts above chance rather than at zero. A perfect
 * order earns everything, an order no better than a coin toss earns nothing,
 * and the points climb evenly between: on four items that is all, two thirds,
 * one third and then nothing, and on four or five items a blind guess averages
 * under a fifth of the round.
 */

/** How many pairs a list of this length holds, each one a small question. */
export function pairCount(length: number): number {
  return (length * (length - 1)) / 2;
}

/**
 * Pairs the wrong way round. `ranks` is each item's true position, listed in
 * the order the player put them.
 */
export function wrongPairs(ranks: readonly number[]): number {
  let wrong = 0;
  for (let first = 0; first < ranks.length; first += 1) {
    for (let second = first + 1; second < ranks.length; second += 1) {
      if ((ranks[first] ?? 0) > (ranks[second] ?? 0)) wrong += 1;
    }
  }
  return wrong;
}

/**
 * The share of a round an ordering earns: 1 when every pair is right, 0 at or
 * below what a shuffle gets by chance, and even steps between.
 *
 * A list too short to hold a pair has nothing to get wrong. The importer never
 * lets one through, but the answer to "how right is it" is still "entirely".
 */
export function creditFor(ranks: readonly number[]): number {
  const pairs = pairCount(ranks.length);
  if (pairs === 0) return 1;
  return Math.max(0, (pairs - 2 * wrongPairs(ranks)) / pairs);
}

/**
 * How a submission reads on the reveal. `oneSwap` is the "nearly" the room is
 * told about: one neighbouring pair the wrong way round and nothing else, which
 * is the mistake a person makes when they know the story and misremember one
 * detail of it.
 */
export type Grade = 'inOrder' | 'oneSwap' | 'partly' | 'furtherOff' | 'unreadable';

export function gradeFor(ranks: readonly number[]): Grade {
  const wrong = wrongPairs(ranks);
  if (wrong === 0) return 'inOrder';
  if (wrong === 1) return 'oneSwap';
  return creditFor(ranks) > 0 ? 'partly' : 'furtherOff';
}

/**
 * Each submitted key's true position, in the order the player sent them, or
 * null when the submission is not a complete ordering of exactly these items.
 *
 * A partial order is refused rather than scored on what it holds. Scoring the
 * two items somebody did send would pay them for sending less, and the phone
 * never sends a partial order of its own accord.
 */
export function ranksOf(order: unknown, canonicalKeys: readonly string[]): number[] | null {
  if (!Array.isArray(order) || order.length !== canonicalKeys.length) return null;
  const position = new Map(canonicalKeys.map((key, index) => [key, index]));
  const seen = new Set<unknown>();
  const ranks: number[] = [];
  for (const key of order) {
    const rank = typeof key === 'string' ? position.get(key) : undefined;
    if (rank === undefined || seen.has(key)) return null;
    seen.add(key);
    ranks.push(rank);
  }
  return ranks;
}

// ---------------------------------------------------------------------------
// The order the items are shown in
// ---------------------------------------------------------------------------

/**
 * Shuffles to try before settling for the fairest one seen. A fair shuffle
 * turns up at least half the time on four or five items, so the cap is only
 * ever reached by a generator that is misbehaving, and it keeps that from
 * spinning.
 */
export const SHUFFLE_ATTEMPTS = 24;

/**
 * How strongly an order reads as an answer one way up or the other: the gap
 * between the pairs it has right and the pairs it has wrong. Nought is a list
 * that says nothing whichever end it is read from.
 */
export function lean(ranks: readonly number[]): number {
  return Math.abs(pairCount(ranks.length) - 2 * wrongPairs(ranks));
}

/**
 * Whether an order may go up on the screen.
 *
 * The order the items are shown in is itself an answer somebody can send, by
 * tapping from the top down or from the bottom up without reading a word. So
 * the shuffle is kept to one that would earn at most a third of the round
 * either way round, which also rules out the list appearing already in order
 * or exactly backwards.
 */
export function isFairDisplay(ranks: readonly number[]): boolean {
  return 3 * lean(ranks) <= pairCount(ranks.length);
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const list = [...items];
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swap = Math.min(Math.floor(random() * (index + 1)), index);
    const held = list[index] as T;
    list[index] = list[swap] as T;
    list[swap] = held;
  }
  return list;
}

/**
 * The true position of the item shown in each slot, top to bottom: a shuffle
 * that passes `isFairDisplay`, or the least telling of the ones tried.
 */
export function displayOrder(length: number, random: () => number): number[] {
  const canonical = Array.from({ length }, (_, index) => index);
  let best = shuffled(canonical, random);
  for (let attempt = 1; attempt < SHUFFLE_ATTEMPTS && !isFairDisplay(best); attempt += 1) {
    const next = shuffled(canonical, random);
    if (lean(next) < lean(best)) best = next;
  }
  return best;
}
