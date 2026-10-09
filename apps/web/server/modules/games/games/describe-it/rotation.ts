/**
 * Whose turn it is to describe.
 *
 * Nobody picks the describer. A leader choosing who goes next, in front of the
 * room, is a leader choosing who is put on the spot, and the quiet teenager is
 * the one who never gets chosen or always does. So the turn passes by rule:
 * from team to team, and within each team through its players in the order
 * they joined, the same way every time.
 *
 * Everything here reads the round's seats, which the room freezes when a turn
 * begins, so the describer cannot change halfway through a turn because
 * somebody walked in.
 */

import type { Seat } from '../../../../../src/modules/games/shared/games.js';
import type { TeamId } from '../../../../../src/modules/games/shared/protocol.js';
import { TEAM_IDS } from '../../../../../src/modules/games/shared/protocol.js';

/**
 * The groups that have anyone in them, in the teams' own order. With teams off
 * every seat carries a null team, so the whole room is one group and the turn
 * simply goes round everybody. Players left on no team while teams are on sit
 * together as a last group rather than never being asked to describe.
 */
export function groupsAtTable(seats: readonly Seat[]): (TeamId | null)[] {
  return [...TEAM_IDS, null].filter((teamId) => seats.some((seat) => seat.teamId === teamId));
}

/**
 * The describer for one turn. Turn `t` belongs to group `t mod G`, and that
 * group's `floor(t / G)`-th player in join order, wrapping round. A team of
 * one describes every one of its turns; a team of five waits five of its own
 * turns to come back to the same person, which is what "uneven" costs and all
 * it costs.
 */
export function describerFor(turn: number, seats: readonly Seat[]): Seat | null {
  const groups = groupsAtTable(seats);
  if (groups.length === 0) return null;
  const group = groups[turn % groups.length];
  const members = seats.filter((seat) => seat.teamId === group);
  return members[Math.floor(turn / groups.length) % members.length] ?? null;
}
