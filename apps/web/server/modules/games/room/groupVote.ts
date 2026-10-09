/**
 * Group voting, carried out by the room around an ordinary game.
 *
 * A game that offers group voting scores plainly, one answer at a time. What a
 * majority is, what a tie costs and how a team's choice reaches each member
 * are decided here, once, so every game that offers a vote plays by the same
 * rules and none of them has to get the arithmetic right for itself.
 *
 * The wrapper is applied per call from the room's settings rather than stored
 * anywhere. That keeps the game module the only thing a room holds, and keeps
 * a replay of the same intents playing the same way.
 */

import type {
  GameModule,
  GroupVoteSpec,
  Round,
  RoundOutcome,
  ScoredAnswer,
  Seat,
  Table,
} from '../../../../src/modules/games/shared/games.js';
import { groupVoteApplies } from '../../../../src/modules/games/shared/games.js';
import type {
  AnswerValue,
  GroupResult,
  PersonalResult,
  PlayerId,
  RevealAggregate,
  RoomSettings,
  TeamId,
} from '../../../../src/modules/games/shared/protocol.js';
import { TEAM_IDS } from '../../../../src/modules/games/shared/protocol.js';

/**
 * The game as this room plays it: wrapped for group voting when the game
 * offers it and the settings call for it, and exactly the game otherwise.
 *
 * Safe to apply twice. The wrapped module no longer declares a vote, so a
 * second pass finds nothing to wrap.
 */
export function effectiveGame(game: GameModule, settings: RoomSettings): GameModule {
  const spec = game.groupVote;
  if (spec === undefined || !groupVoteApplies(spec, settings)) return game;
  return withGroupVote(game, spec);
}

/** Writable only while the wrapper is being put together. */
type Assembling<T> = { -readonly [K in keyof T]: T[K] };

export function withGroupVote<Secret>(
  game: GameModule<Secret>,
  spec: GroupVoteSpec<Secret>
): GameModule<Secret> {
  const wrapped: Assembling<GameModule<Secret>> = {
    ...game,
    // A vote that could not change would make the first tap the only one that
    // counted, and a team talking it over would have nothing to talk over.
    answerPolicy: 'latest',
    accepts(round, table, playerId, value) {
      // A vote from someone without a seat belongs to no team, so it could
      // only ever be counted by accident.
      if (!table.seats.some((seat) => seat.playerId === playerId)) return false;
      if (spec.key(value, round) === null) return false;
      return game.accepts?.(round, table, playerId, value) ?? true;
    },
    scoreRound(round, answers, table) {
      return scoreByGroup(game, spec, round, answers, table);
    },
  };
  delete wrapped.groupVote;
  return wrapped;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

interface Tally {
  /** The standing votes for this option, in the order they arrived. */
  backing: ScoredAnswer[];
  /** The latest of them: when the option had all the support it would get. */
  latest: ScoredAnswer;
}

const NO_RESULT: PersonalResult = { correct: false, pointsAwarded: 0, submitted: null, note: null };

function scoreByGroup<Secret>(
  game: GameModule<Secret>,
  spec: GroupVoteSpec<Secret>,
  round: Round<Secret>,
  answers: ScoredAnswer[],
  table: Table
): RoundOutcome {
  const votes = votesOf(spec, round, answers, table.seats);
  // The big screen reads as it always has: the answer, and how the room split,
  // from the game scoring everybody's real votes. Only the per-player results
  // of this pass are thrown away.
  const room = game.scoreRound(round, [...votes.values()].sort((a, b) => a.at - b.at), table);

  const perPlayer = new Map<PlayerId, PersonalResult>();
  const groups: GroupResult[] = [];
  for (const [teamId, members] of groupsOf(table.seats)) {
    const tallies = tally(spec, round, members, votes);
    const winner = majorityOf(tallies);
    const split = splitOf(spec, round, tallies);
    const ownVote = (playerId: PlayerId): AnswerValue | null => votes.get(playerId)?.value ?? null;

    if (winner === null) {
      const note = tallies.size === 0 ? noVotesNote(teamId) : splitNote(teamId);
      for (const seat of members) {
        perPlayer.set(seat.playerId, { ...NO_RESULT, submitted: ownVote(seat.playerId), note });
      }
      groups.push({ teamId, split, decided: null, correct: null });
      continue;
    }

    // One synthetic answer per member, all carrying the group's choice, so a
    // dissenter and someone who never voted score exactly what the voters do.
    // Which vote stands for the group is the game's to say when timing matters
    // to it; otherwise it is the latest, when the answer had all its support.
    const chosen = spec.represent?.(winner.backing, members.length) ?? winner.latest;
    const decided = spec.label(chosen.value, round);
    const scored = game.scoreRound(
      round,
      members.map((seat) => ({
        playerId: seat.playerId,
        value: chosen.value,
        at: chosen.at,
        openedAt: chosen.openedAt,
      })),
      table
    );
    let correct = false;
    for (const seat of members) {
      const result = scored.perPlayer.get(seat.playerId) ?? NO_RESULT;
      correct = correct || result.correct;
      perPlayer.set(seat.playerId, {
        ...result,
        submitted: ownVote(seat.playerId),
        note: withGameNote(choseNote(teamId, decided), result.note),
      });
    }
    groups.push({ teamId, split, decided, correct });
  }

  return {
    perPlayer,
    aggregates: room.aggregates,
    correctLabel: room.correctLabel,
    detail: room.detail,
    groups,
  };
}

/** Each seated player's standing vote. Anything that is not a vote is ignored. */
function votesOf<Secret>(
  spec: GroupVoteSpec<Secret>,
  round: Round<Secret>,
  answers: ScoredAnswer[],
  seats: readonly Seat[]
): Map<PlayerId, ScoredAnswer> {
  const seated = new Set(seats.map((seat) => seat.playerId));
  const votes = new Map<PlayerId, ScoredAnswer>();
  for (const answer of [...answers].sort((a, b) => a.at - b.at)) {
    if (!seated.has(answer.playerId)) continue;
    if (spec.key(answer.value, round) === null) continue;
    votes.set(answer.playerId, answer);
  }
  return votes;
}

/**
 * Seats grouped by team, in the teams' own order, with anyone on no team last.
 * Teams off, that is one group holding everybody.
 */
function groupsOf(seats: readonly Seat[]): [TeamId | null, Seat[]][] {
  const order: (TeamId | null)[] = [...TEAM_IDS, null];
  const groups: [TeamId | null, Seat[]][] = [];
  for (const teamId of order) {
    const members = seats.filter((seat) => seat.teamId === teamId);
    if (members.length > 0) groups.push([teamId, members]);
  }
  return groups;
}

function tally<Secret>(
  spec: GroupVoteSpec<Secret>,
  round: Round<Secret>,
  members: readonly Seat[],
  votes: Map<PlayerId, ScoredAnswer>
): Map<string, Tally> {
  const tallies = new Map<string, Tally>();
  for (const seat of members) {
    const vote = votes.get(seat.playerId);
    if (vote === undefined) continue;
    const key = spec.key(vote.value, round);
    if (key === null) continue;
    const existing = tallies.get(key);
    if (existing === undefined) {
      tallies.set(key, { backing: [vote], latest: vote });
      continue;
    }
    existing.backing.push(vote);
    if (vote.at >= existing.latest.at) existing.latest = vote;
  }
  // Members were visited in seat order, and a game reading the backing wants
  // the order the votes came in. The sort is stable, so votes that share a
  // moment keep their seat order.
  for (const entry of tallies.values()) entry.backing.sort((a, b) => a.at - b.at);
  return tallies;
}

/** The one option with more votes than any other, or null for a tie or no votes. */
function majorityOf(tallies: Map<string, Tally>): Tally | null {
  let best: Tally | null = null;
  let tied = false;
  for (const entry of tallies.values()) {
    if (best === null || entry.backing.length > best.backing.length) {
      best = entry;
      tied = false;
    } else if (entry.backing.length === best.backing.length) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/**
 * Largest first, then by label, so the order says nothing about who voted
 * first.
 */
function splitOf<Secret>(
  spec: GroupVoteSpec<Secret>,
  round: Round<Secret>,
  tallies: Map<string, Tally>
): RevealAggregate[] {
  return [...tallies.values()]
    .map((entry) => ({ label: spec.label(entry.latest.value, round), count: entry.backing.length }))
    .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

function choseNote(teamId: TeamId | null, decided: string): string {
  return teamId === null ? `The room chose ${decided}` : `Your team chose ${decided}`;
}

/**
 * The team's line first, then the game's own about the answer the team gave —
 * "Got it at clue 2" — when it has one. The team's choice is what the phone
 * most needs to hear, but what that choice earned is the game's to say.
 */
function withGameNote(teamLine: string, gameNote: string | null): string {
  return gameNote === null ? teamLine : `${teamLine}. ${gameNote}`;
}

function splitNote(teamId: TeamId | null): string {
  return teamId === null ? 'The room was split' : 'Your team was split';
}

function noVotesNote(teamId: TeamId | null): string {
  return teamId === null ? 'Nobody voted' : 'Nobody on your team voted';
}
