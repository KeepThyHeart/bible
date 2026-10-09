/**
 * Who holds which clue.
 *
 * Clues are dealt within a group — a team, or the whole room with teams off —
 * so that every group holds the whole case between them and can solve it
 * without the other teams. Seat order within the group decides the deal, and
 * the round's offset turns the deck so the first phone to join is not always
 * handed the same clue. With more phones in a group than clues, the deal comes
 * round again and some phones share one.
 *
 * Everything here is a pure function of the seats and the offset, because the
 * deal is recomputed on every snapshot and must come out the same each time.
 */

import type { Seat } from '../../../../../src/modules/games/shared/games.js';
import type { PlayerId } from '../../../../../src/modules/games/shared/protocol.js';

/** Where a phone's clue sits in the round's list of dealt clues, or null for no seat. */
export function dealtIndexFor(
  seats: readonly Seat[],
  playerId: PlayerId,
  clueCount: number,
  offset: number
): number | null {
  if (clueCount <= 0) return null;
  const seat = seats.find((candidate) => candidate.playerId === playerId);
  if (seat === undefined) return null;
  const group = seats.filter((candidate) => candidate.teamId === seat.teamId);
  return (group.indexOf(seat) + offset) % clueCount;
}

/**
 * How many phones in this player's group hold the same clue, the player
 * included. A count, so a phone can say "another phone has this one too"
 * without learning whose.
 */
export function holdersOf(
  seats: readonly Seat[],
  playerId: PlayerId,
  clueCount: number,
  offset: number
): number {
  const mine = dealtIndexFor(seats, playerId, clueCount, offset);
  if (mine === null) return 0;
  const seat = seats.find((candidate) => candidate.playerId === playerId);
  return seats.filter(
    (candidate) =>
      candidate.teamId === seat?.teamId &&
      dealtIndexFor(seats, candidate.playerId, clueCount, offset) === mine
  ).length;
}

/**
 * The dealt clues at least one phone was given, anywhere in the room. A group
 * smaller than the deck leaves some clues in it, and the reveal says so rather
 * than implying the room had evidence it never saw.
 */
export function dealtAnywhere(seats: readonly Seat[], clueCount: number, offset: number): Set<number> {
  const dealt = new Set<number>();
  for (const seat of seats) {
    const index = dealtIndexFor(seats, seat.playerId, clueCount, offset);
    if (index !== null) dealt.add(index);
  }
  return dealt;
}
