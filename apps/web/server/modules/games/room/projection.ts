/**
 * Turning room state into the snapshot one particular viewer is allowed to see.
 *
 * This is where the room's governing promise is actually kept: praise is
 * public, mistakes are private. A rule like that cannot live in a client,
 * because anything delivered to a device is readable on that device. So a
 * player's score, rank and personal result are assembled only into that
 * player's snapshot, and the host's standings are cut to a top three before
 * they are sent — the big screen physically cannot render a last place, because
 * the data for it never left this file.
 *
 * Projection is pure, which is what lets the guarantee be tested by asserting
 * that a field is *absent*.
 */

import type { GameModule } from '../../../../src/modules/games/shared/games.js';
import type {
  BuzzState,
  ControlPanel,
  HostChrome,
  ScreenSnapshot,
  PersonalResult,
  PlayerId,
  PlayerSnapshot,
  PublicBuzzState,
  PublicPlayer,
  RevealPayload,
  SnapshotCommon,
  Standing,
} from '../../../../src/modules/games/shared/protocol.js';
import { effectiveGame } from './groupVote.js';
import { phaseDurationOf } from './phases.js';
import {
  answerPolicyOf,
  currentRound,
  findPlayer,
  judgeRequestOf,
  tableOf,
  type PlayerState,
  type RoomState,
} from './state.js';
import {
  fullStandings,
  orderedPlayers,
  overallStandings,
  rankOf,
  teamStandings,
  toStanding,
} from './scoring.js';

/** A rank is worth showing only when it is a kindness to show it. */
const VISIBLE_RANKS = 3;

function toPublicPlayer(player: PlayerState): PublicPlayer {
  // Built field by field rather than by spreading, so that adding a private
  // field to PlayerState can never quietly widen what the room broadcasts.
  return {
    id: player.id,
    name: player.name,
    teamId: player.teamId,
    connected: player.connected,
  };
}

/**
 * What one viewer sees of the current round; `viewer` is null for the host.
 *
 * A game that computes views per viewer is the only source of them, so a
 * `hostView` it left on the round for some other purpose can never reach a
 * screen by falling through.
 */
function viewOf(state: RoomState, game: GameModule, viewer: PlayerId | null): unknown {
  const round = currentRound(state);
  if (!round) return null;
  if (game.viewFor) return game.viewFor(round, tableOf(state), viewer, state.phase);
  return viewer === null ? round.hostView : round.playerView;
}

/**
 * What the whole room may see of a buzz: everything `BuzzState` carries
 * except `spent` — naming a wrong answer to a screen the whole room is
 * watching is the leak ADR 0004 forbids. A player learns their own spent
 * status from `youAreSpent`; the controller learns everyone's from
 * `ControlPanel.spent`.
 */
function publicBuzz(buzz: BuzzState | null): PublicBuzzState | null {
  if (buzz === null) return null;
  const { queue, frozenAtChars, answerDeadline, secondChanceFor, confirmed } = buzz;
  return {
    queue,
    frozenAtChars,
    answerDeadline,
    secondChanceFor,
    ...(confirmed === undefined ? {} : { confirmed }),
  };
}

/**
 * The game's wording for the host's chrome, during a round only. Left out
 * everywhere else, so the lobby, the summary and every game that says nothing
 * keep the shell's own words.
 */
function chromeOf(state: RoomState, game: GameModule): HostChrome | null {
  const round = currentRound(state);
  if (!round || !game.hostChrome) return null;
  if (state.phase !== 'question' && state.phase !== 'answering' && state.phase !== 'reveal') {
    return null;
  }
  return game.hostChrome(round, tableOf(state), state.phase);
}

function common(state: RoomState, game: GameModule): SnapshotCommon {
  const chrome = chromeOf(state, game);
  return {
    code: state.code,
    phase: state.phase,
    paused: state.paused,
    // The same index intents carry, so a client can echo it back without
    // translating; a lobby has not reached a round yet.
    round: state.roundIndex,
    totalRounds: state.rounds.length || state.settings.rounds,
    settings: state.settings,
    players: state.players.map(toPublicPlayer),
    phaseEndsAt: state.phaseEndsAt,
    phaseDurationMs: phaseDurationOf(state, game),
    revealAt: state.revealAt,
    // Projection takes no clock of its own; the last moment the reducer
    // observed is the only time the room can honestly claim to know.
    serverTime: state.lastActivity,
    controller: state.controller,
    questionOnScreen: state.screenPresent,
    // Common to both viewers: none of a game's chrome words are secret (a
    // round word, a button label), so a phone gets them too — see
    // `SnapshotCommon.chrome`.
    ...(chrome === null ? {} : { chrome }),
  };
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

/**
 * Takes the game the room is playing because a view can depend on who is
 * asking. Group voting is applied here from the settings, as the reducer
 * applies it, so the two can never disagree about how a round is played.
 */
export function projectForPlayer(
  state: RoomState,
  playerId: PlayerId,
  installed: GameModule
): PlayerSnapshot {
  const game = effectiveGame(installed, state.settings);
  const policy = answerPolicyOf(game);
  const player = findPlayer(state, playerId);
  const you: PublicPlayer = player
    ? toPublicPlayer(player)
    : { id: playerId, name: '', teamId: null, connected: false };

  const rank = player ? rankOf(state, playerId) : null;

  const own = state.answers.filter((answer) => answer.playerId === playerId);

  const isController = state.controller.kind === 'player' && state.controller.playerId === playerId;

  return {
    ...common(state, game),
    viewer: 'player',
    you,
    yourScore: player?.score ?? 0,
    youAnswered: own.length > 0,
    // Null outside the top three. A player who is last must never be able to
    // learn it from their own phone either.
    yourRank: rank !== null && rank <= VISIBLE_RANKS ? rank : null,
    // Always the player view, even at the reveal: the answer travels in the
    // separate reveal event, so there is no phase in which this field could
    // carry something the game module has not already stripped.
    view: viewOf(state, game, playerId),
    // Read from this player's own entries and nobody else's. Only a vote that
    // can change needs echoing: a first answer is locked on the phone that
    // sent it, and a log is a sequence of taps rather than a choice.
    yourAnswer: policy === 'latest' ? (own[own.length - 1]?.value ?? null) : null,
    canChangeAnswer: policy !== 'first',
    buzz: publicBuzz(state.buzz),
    // This player's own status, and never anyone else's — see
    // `PublicBuzzState`'s own doc comment for why `spent` itself is absent.
    youAreSpent: state.buzz?.spent.includes(playerId) ?? false,
    // Present only on the phone that currently holds control — see
    // `controlPanel`'s own doc comment for what it carries.
    ...(isController ? { control: controlPanel(state, game) } : {}),
    yourControlRequest: state.controlRequests.some((request) => request.playerId === playerId)
      ? 'pending'
      : state.deniedControlPlayers.includes(playerId)
        ? 'denied'
        : null,
  };
}

// ---------------------------------------------------------------------------
// Host / screen
// ---------------------------------------------------------------------------

/**
 * Standings for the big screen. Trimmed here rather than in the host view,
 * because a rendering bug in a room full of teenagers is a social injury and
 * not a cosmetic defect.
 */
export function visibleStandings(state: RoomState): Standing[] {
  const ordered = orderedPlayers(state).map(toStanding);
  return state.settings.showIndividualScores ? ordered : ordered.slice(0, VISIBLE_RANKS);
}

/**
 * Everything running the room needs that is either private or absent from
 * the device's own snapshot, in one block addressed to whichever socket
 * actually holds control (§4.2 of the design). Built the same way whether
 * that socket is a screen or a phone, so the two can never drift apart in
 * what a controller is allowed to see.
 */
function controlPanel(state: RoomState, game: GameModule): ControlPanel {
  const request = judgeRequestOf(state);
  // A game where a running score would spoil the play keeps the leaderboard
  // for the end. Left out rather than hidden, like every other trim here.
  const standingsHidden = game.standingsAtSummaryOnly === true && state.phase !== 'summary';
  return {
    pendingJudge: request ? { ...request, suggestion: state.judging?.suggestion ?? null } : null,
    requests: state.controlRequests,
    // A count, never a list: how many answered is a fact about the group. It
    // counts people, because a changed vote or a run of taps is still one
    // person in.
    answeredCount: new Set(state.answers.map((answer) => answer.playerId)).size,
    standings: standingsHidden ? [] : visibleStandings(state),
    teamStandings: standingsHidden ? [] : teamStandings(state),
    overallStandings: overallStandings(state),
    spent: state.buzz?.spent ?? [],
  };
}

/**
 * `owner` is the transport handing over a fact it proved from a token,
 * exactly as it already hands over a `playerId` for a player's own
 * projection — proved by which credential opened the stream, not asked of
 * the room. Projection stays a pure function of its arguments.
 */
export function projectForScreen(state: RoomState, installed: GameModule, owner: boolean): ScreenSnapshot {
  const game = effectiveGame(installed, state.settings);
  // A game where a running score would spoil the play keeps the leaderboard
  // for the end. Left out rather than hidden, like every other trim here.
  const standingsHidden = game.standingsAtSummaryOnly === true && state.phase !== 'summary';

  return {
    ...common(state, game),
    viewer: 'screen',
    standings: standingsHidden ? [] : visibleStandings(state),
    teamStandings: standingsHidden ? [] : teamStandings(state),
    // Unlike the per-round standings above, never hidden by
    // `standingsAtSummaryOnly`: this is a cumulative, whole-session figure
    // the host opens on request, not a running score a game asked to keep
    // off the screen until it ends.
    overallStandings: overallStandings(state),
    answeredCount: new Set(state.answers.map((answer) => answer.playerId)).size,
    // The host screen may show the question and its answer during play; the
    // players' snapshots never carry this.
    view: viewOf(state, game, null),
    buzz: publicBuzz(state.buzz),
    // Present only on the screen whose credential is the room's owner token
    // (`owner`, proved by the transport), and only while that credential
    // holds control. A display-token screen never carries it, whatever else
    // is happening in the room — see `ScreenSnapshot.control`'s own comment.
    ...(owner && state.controller.kind === 'owner' ? { control: controlPanel(state, game) } : {}),
  };
}

/**
 * The complete ordering, including whoever is last. It has exactly one caller —
 * the explicit host request — and is kept out of the snapshot builders so that
 * it cannot reach the big screen by accident.
 */
export function projectFullStandings(state: RoomState): Standing[] {
  return fullStandings(state);
}

// ---------------------------------------------------------------------------
// Reveal
// ---------------------------------------------------------------------------

/**
 * The public half of a reveal: what the answer was, and unattributed counts.
 * There is no shape here that can carry who answered what.
 */
export function projectReveal(state: RoomState): RevealPayload | null {
  const outcome = state.lastOutcome;
  if (!outcome) return null;
  return {
    round: state.roundIndex,
    correctLabel: outcome.correctLabel,
    aggregates: outcome.aggregates,
    detail: outcome.detail,
    // Counts per team and nothing more; see the group-vote scoring.
    ...(outcome.groups === undefined ? {} : { groups: outcome.groups }),
  };
}

/** The private half, addressed to one phone. */
export function projectPersonalResult(
  state: RoomState,
  playerId: PlayerId
): PersonalResult | null {
  return state.lastOutcome?.perPlayer.get(playerId) ?? null;
}
