/**
 * Turning a game's round outcome into scores, and scores into the orderings the
 * projection is allowed to publish.
 *
 * The one rule that shapes all of this: everyone who is right inside the window
 * earns the same. A game module decides how many points a round is worth and
 * how partial credit divides it; nothing here adds a speed bonus. Response time
 * is accumulated only so that two players on identical scores can be separated
 * without a coin toss.
 */

import type {
  PlayerId,
  Standing,
  TeamId,
  TeamStanding,
} from '../../../../src/modules/games/shared/protocol.js';
import { TEAM_IDS } from '../../../../src/modules/games/shared/protocol.js';
import type { RoundOutcome } from '../../../../src/modules/games/shared/games.js';
import type { PlayerState, RoomState } from './state.js';

/**
 * Applies a scored round. Points come straight from the game module; the room
 * only adds them up and records how long each correct answer took.
 *
 * The time is measured from the opening the answer carries, not from when the
 * phase began: a pause moves that opening on by its own length, so time the
 * room spent paused is never charged to anyone's tiebreak. Where a player has
 * more than one answer on file, the last one is the one that stood.
 */
export function applyOutcome(state: RoomState, outcome: RoundOutcome): RoomState {
  const responseTimes = new Map(
    state.answers.map((answer) => [answer.playerId, answer.at - answer.openedAt])
  );
  const players = state.players.map((player) => {
    const result = outcome.perPlayer.get(player.id);
    if (!result) return player;
    const taken = responseTimes.get(player.id);
    const responseMs = result.correct && taken !== undefined ? taken : 0;
    return {
      ...player,
      score: player.score + result.pointsAwarded,
      totalResponseMs: player.totalResponseMs + Math.max(0, responseMs),
    };
  });
  return { ...state, players };
}

/**
 * Full ordering, highest first. Ties fall to the faster player, then to
 * whoever joined first, then to the id — the last two only so that a repeated
 * projection of the same state never reshuffles under a viewer.
 */
export function orderedPlayers(state: RoomState): PlayerState[] {
  return [...state.players].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.totalResponseMs !== b.totalResponseMs) return a.totalResponseMs - b.totalResponseMs;
    if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function toStanding(player: PlayerState): Standing {
  return {
    playerId: player.id,
    name: player.name,
    teamId: player.teamId,
    score: player.score,
  };
}

/**
 * The complete leaderboard. Only the explicit host request may send this, so it
 * is kept out of the snapshot builders on purpose — see the projection module.
 */
export function fullStandings(state: RoomState): Standing[] {
  return orderedPlayers(state).map(toStanding);
}

/**
 * What a player has scored across the whole room, this game included:
 * everything folded into `allTimeScore` by earlier games, plus the one live
 * now. Nothing reads `allTimeScore` alone — a player mid-game is still
 * carrying points nobody has folded in yet.
 */
export function overallScore(player: PlayerState): number {
  return player.allTimeScore + player.score;
}

/** The whole room's session, highest overall score first, same tie-breaks as `orderedPlayers`. */
export function orderedByOverallScore(state: RoomState): PlayerState[] {
  return [...state.players].sort((a, b) => {
    const diff = overallScore(b) - overallScore(a);
    if (diff !== 0) return diff;
    if (a.totalResponseMs !== b.totalResponseMs) return a.totalResponseMs - b.totalResponseMs;
    if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function toOverallStanding(player: PlayerState): Standing {
  return {
    playerId: player.id,
    name: player.name,
    teamId: player.teamId,
    score: overallScore(player),
  };
}

const VISIBLE_OVERALL_WINNERS = 3;

/**
 * Top three across the whole session. Always a top three, whatever
 * `showIndividualScores` says — see `ScreenSnapshot.overallStandings`.
 */
export function overallStandings(state: RoomState): Standing[] {
  return orderedByOverallScore(state).slice(0, VISIBLE_OVERALL_WINNERS).map(toOverallStanding);
}

/**
 * One-based position in the full ordering, or null for someone with no score
 * history at all. Callers decide whether a rank is worth showing; this only
 * says what it is.
 */
export function rankOf(state: RoomState, playerId: PlayerId): number | null {
  const index = orderedPlayers(state).findIndex((player) => player.id === playerId);
  return index < 0 ? null : index + 1;
}

/**
 * Teams aggregate scores because an aggregate names nobody: a team can be last
 * on the big screen without any individual being shown as last.
 */
export function teamStandings(state: RoomState): TeamStanding[] {
  if (!state.settings.teamsEnabled) return [];
  const totals = new Map<TeamId, { score: number; playerCount: number }>();
  for (const player of state.players) {
    if (!player.teamId) continue;
    const entry = totals.get(player.teamId) ?? { score: 0, playerCount: 0 };
    entry.score += player.score;
    entry.playerCount += 1;
    totals.set(player.teamId, entry);
  }
  const rows: TeamStanding[] = [];
  for (const teamId of TEAM_IDS) {
    const entry = totals.get(teamId);
    if (entry) rows.push({ teamId, score: entry.score, playerCount: entry.playerCount });
  }
  return rows.sort((a, b) => b.score - a.score);
}
