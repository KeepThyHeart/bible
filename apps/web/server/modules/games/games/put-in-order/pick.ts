/**
 * Which list a round puts up.
 *
 * The generator deals several handfuls from each story — five sets from the
 * days of creation, five from the life of Joseph — and neighbouring handfuls
 * share most of their items. Two creation lists back to back is the same
 * question asked twice with one card changed, so the choice here spreads a
 * game across stories before it comes back to one, and never follows a list
 * with another from the same story while a different story is available.
 *
 * Difficulty is capped by the room's familiarity, the same setting that caps
 * the verses in every other game, so a room set to the best-known material
 * does not get the order of the judges because the host changed game.
 */

import type { OrderedListRecord } from '../../content/index.js';

/**
 * The story a list was dealt from. Generated ids read
 * `put-in-order-<story>-<n>`; anything else was written by hand and counts as
 * a story of its own.
 */
export function timelineOf(listId: string): string {
  const match = /^put-in-order-(.+)-\d+$/u.exec(listId);
  return match?.[1] ?? listId;
}

/**
 * The lists a room may be shown, given its ceiling. `null` means no cap.
 *
 * When nothing sits under the ceiling the easiest lists there are stand in for
 * it. A room set to the most familiar material still plays, with the gentlest
 * lists on offer, which is the nearest honest reading of what the host asked
 * for; an empty screen would be the least helpful one.
 */
export function withinCeiling(
  lists: readonly OrderedListRecord[],
  ceiling: number | null
): OrderedListRecord[] {
  if (lists.length === 0) return [];
  if (ceiling === null) return [...lists];
  const under = lists.filter((list) => list.difficulty <= ceiling);
  if (under.length > 0) return under;
  const easiest = Math.min(...lists.map((list) => list.difficulty));
  return lists.filter((list) => list.difficulty === easiest);
}

/**
 * The next list, given the ids already played this game in order.
 *
 * Three preferences, each giving way only when it would leave nothing:
 *
 * - **a list not yet played.** When every list has been played, repeats are
 *   allowed. A game longer than the material is a real configuration, and a
 *   list seen an hour ago is better than a blank round.
 * - **a different story from the last round.**
 * - **the stories this game has used least**, so ten rounds visit ten stories
 *   before any story comes round a second time.
 */
export function chooseList(
  candidates: readonly OrderedListRecord[],
  played: readonly string[],
  random: () => number
): OrderedListRecord | null {
  if (candidates.length === 0) return null;

  const used = new Set(played);
  const fresh = candidates.filter((list) => !used.has(list.id));
  const unplayed = fresh.length > 0 ? fresh : [...candidates];

  const lastId = played[played.length - 1];
  const last = lastId === undefined ? null : timelineOf(lastId);
  const moved = unplayed.filter((list) => timelineOf(list.id) !== last);
  const elsewhere = moved.length > 0 ? moved : unplayed;

  const uses = new Map<string, number>();
  for (const id of played) uses.set(timelineOf(id), (uses.get(timelineOf(id)) ?? 0) + 1);
  const usesOf = (list: OrderedListRecord): number => uses.get(timelineOf(list.id)) ?? 0;
  const fewest = Math.min(...elsewhere.map(usesOf));
  const pool = elsewhere.filter((list) => usesOf(list) === fewest);

  return pool[Math.min(Math.floor(random() * pool.length), pool.length - 1)] ?? null;
}
