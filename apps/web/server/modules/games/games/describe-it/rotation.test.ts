/**
 * Who describes each turn.
 *
 * The promise is that nobody chooses: the turn goes from team to team, and
 * through each team in join order, whatever the sizes. Uneven teams are the
 * case worth pinning, because that is where a rotation that looks right on
 * two teams of two quietly skips somebody.
 */

import { describe, expect, it } from 'vitest';
import type { Seat } from '../../../../../src/modules/games/shared/games.js';
import type { TeamId } from '../../../../../src/modules/games/shared/protocol.js';
import { describerFor, groupsAtTable } from './rotation.js';

function seat(playerId: string, teamId: TeamId | null = null): Seat {
  return { playerId, teamId };
}

function describers(seats: readonly Seat[], turns: number): (string | null)[] {
  return Array.from({ length: turns }, (_, turn) => describerFor(turn, seats)?.playerId ?? null);
}

describe('the rotation', () => {
  it('goes round everybody in join order when teams are off', () => {
    const seats = [seat('zed'), seat('amy'), seat('kit')];
    expect(describers(seats, 7)).toEqual(['zed', 'amy', 'kit', 'zed', 'amy', 'kit', 'zed']);
  });

  it('alternates two even teams and works through each', () => {
    const seats = [seat('ann', 'red'), seat('bo', 'blue'), seat('cy', 'red'), seat('di', 'blue')];
    expect(describers(seats, 5)).toEqual(['ann', 'bo', 'cy', 'di', 'ann']);
  });

  it('keeps alternating across uneven teams, so a team of one describes every one of its turns', () => {
    const seats = [seat('r1', 'red'), seat('r2', 'red'), seat('b1', 'blue'), seat('r3', 'red')];
    expect(describers(seats, 7)).toEqual(['r1', 'b1', 'r2', 'b1', 'r3', 'b1', 'r1']);
  });

  it('works through three teams of different sizes without skipping anyone', () => {
    const seats = [
      seat('g1', 'green'),
      seat('r1', 'red'),
      seat('g2', 'green'),
      seat('b1', 'blue'),
      seat('b2', 'blue'),
      seat('b3', 'blue'),
    ];
    // Red, blue, green is the teams' own order, whoever joined first.
    expect(describers(seats, 9)).toEqual(['r1', 'b1', 'g1', 'r1', 'b2', 'g2', 'r1', 'b3', 'g1']);
  });

  it('asks players left on no team to describe too, after the teams', () => {
    const seats = [seat('loose'), seat('ann', 'red'), seat('bo', 'blue')];
    expect(groupsAtTable(seats)).toEqual(['red', 'blue', null]);
    expect(describers(seats, 3)).toEqual(['ann', 'bo', 'loose']);
  });

  it('names nobody at an empty table', () => {
    expect(describerFor(0, [])).toBeNull();
  });
});
