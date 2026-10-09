/**
 * The room's private truth.
 *
 * This is deliberately *not* the wire format. Everything a viewer is allowed to
 * see is derived from here by projection, so the way to keep a secret is simply
 * not to project it. Fields that would be a leak if broadcast — the round
 * secret, every player's score, the buzz clamping bookkeeping — live here and
 * nowhere else.
 *
 * The whole structure is treated as immutable: the reducer returns a new object
 * rather than mutating this one, which is what lets a test hold onto an earlier
 * state and assert the transition rather than the destination.
 */

import type {
  AnswerValue,
  BuzzState,
  Controller,
  ControlRequest,
  JudgeRequest,
  JudgeSuggestion,
  PhaseName,
  PlayerId,
  RoomCode,
  RoomSettings,
  ServerTime,
  TeamId,
} from '../../../../src/modules/games/shared/protocol.js';
import type {
  AnswerPolicy,
  GameModule,
  Round,
  RoundOutcome,
  ScoredAnswer,
  Seat,
  Table,
} from '../../../../src/modules/games/shared/games.js';
import { DEFAULT_THEME } from '../../../../src/modules/games/shared/theme.js';

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export interface PlayerState {
  id: PlayerId;
  name: string;
  teamId: TeamId | null;
  connected: boolean;
  score: number;
  joinedAt: ServerTime;
  /**
   * Added to a client timestamp to express it in server time, as measured by
   * the clock handshake. Zero until that layer has a measurement, which is the
   * honest default: an unmeasured phone's buzz then clamps to arrival rather
   * than being trusted.
   */
  clockOffsetMs: number;
  /**
   * Total time taken over correct answers. Points are equal for everyone right
   * inside the window, so this exists only to break a tie in the standings —
   * never to change what a round is worth.
   */
  totalResponseMs: number;
  /**
   * What this player scored in every game before the one live now — folded in
   * by `startNewGame` the instant before it resets `score` to zero, so a
   * fresh game is a clean slate for the round-by-round standings without
   * losing the room's own running total. `overallScore` in `scoring.ts` is
   * this plus the current game's `score`; nothing reads this field alone.
   */
  allTimeScore: number;
}

// ---------------------------------------------------------------------------
// Round bookkeeping
// ---------------------------------------------------------------------------

export interface ReceivedAnswer {
  playerId: PlayerId;
  value: AnswerValue;
  at: ServerTime;
  /**
   * The round's opening as it stood when this answer arrived. Copied onto the
   * answer rather than read off the room at the reveal, because a pause after
   * the answer moves the room's opening and must not move this one.
   */
  openedAt: ServerTime;
  /** The host's ruling, once there is one. Absent means nobody ruled. */
  verdict?: 'correct' | 'incorrect';
}

/**
 * Content a host needs in order to adjudicate a buzz answer. A game that wants
 * host judging hangs this off its round secret; the room reads it structurally
 * and never interprets the rest of the secret.
 */
export interface JudgeContent {
  question: string;
  canonicalAnswer: string;
  accept: string[];
  contextNote: string | null;
}

export interface JudgingState {
  round: number;
  playerId: PlayerId;
  /** What the player typed, kept apart from the round's answer list because a
   *  second chance replaces it. */
  answerText: string;
  /** How much of the question the player had read when they buzzed. The prefix
   *  itself is sliced from the round at projection time. */
  charsSeen: number;
  requestedAt: ServerTime;
  /** A provider's opinion once it arrives. Never a verdict on its own. */
  suggestion: JudgeSuggestion | null;
}

// ---------------------------------------------------------------------------
// The room
// ---------------------------------------------------------------------------

/**
 * Credentials are deliberately absent. The transport issues the host token and
 * every session token, and it is the only layer that verifies one; holding a
 * copy of either here would put the same secret in two places and give a future
 * projection something to leak.
 */
export interface RoomState {
  code: RoomCode;
  settings: RoomSettings;
  players: PlayerState[];

  /**
   * Who is running the room. Not a credential: it is the public fact that a
   * named player is running the show, which the screen renders by name (see
   * `Controller` in the protocol). Starts and reverts to `{ kind: 'owner' }`.
   */
  controller: Controller;
  /** Phones asking to be handed control. Cleared whenever a grant is made. */
  controlRequests: ControlRequest[];
  /**
   * Players the current controller (or a controller before them) has denied,
   * and who have not asked again since. Private bookkeeping, not carried on
   * `ControlRequest` itself, which only ever holds an active request.
   */
  deniedControlPlayers: PlayerId[];
  /** Any screen connected. Written by the transport, like `connected`. */
  screenPresent: boolean;
  /** An owner-credentialled screen connected. Decides whether owner-held control is attended. */
  ownerPresent: boolean;

  phase: PhaseName;
  /** An overlay, not a phase: pausing must not destroy where the round was. */
  paused: boolean;
  /** When the pause began, so every deadline can be shifted by the same amount. */
  pausedAt: ServerTime | null;

  roundIndex: number;
  rounds: Round[];
  /**
   * Answers for the current round only, in arrival order; cleared on every
   * round entry. How many a player may have depends on the answer policy.
   */
  answers: ReceivedAnswer[];
  /**
   * Who was at the table when the current round began. Frozen for the round so
   * that anything a game deals from it — a clue per seat, whose turn it is —
   * holds still while people come and go. Kept through the reveal and the
   * summary, which still render the last round; empty before the first.
   */
  roundSeats: Seat[];
  /** Kept so the reveal event and each personal result can be built from state. */
  lastOutcome: RoundOutcome | null;

  buzz: BuzzState | null;
  /** When the stream was frozen by a buzz, so resuming can restore its position. */
  streamFrozenAt: ServerTime | null;
  /** Where the reading phase was due to end, remembered across a freeze. */
  questionEndsAt: ServerTime | null;

  judging: JudgingState | null;

  phaseStartedAt: ServerTime;
  phaseEndsAt: ServerTime | null;
  revealAt: ServerTime | null;
  /**
   * When the current round started taking answers — or buzzes, for a buzz
   * round — moved by every stretch the room stopped the clock for, so that
   * anything paced from it keeps its place in the schedule.
   *
   * It is kept rather than derived from the deadline because the deadline is
   * not always the round's: a buzz round replaces it with each reader's own
   * window and clears it while the host listens. Null outside a round.
   */
  answeringOpenedAt: ServerTime | null;

  createdAt: ServerTime;
  lastActivity: ServerTime;

  /**
   * Every draw the room makes goes through this, so replaying the same intents
   * against the same seed rebuilds exactly the same game. It is a field rather
   * than a closure because the reducer has to stay a pure function of state.
   */
  rngSeed: number;

  closed: boolean;
}

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

export interface SeededRandom {
  random: () => number;
  /** The seed to store back once the draws for this step are done. */
  seedAfter: () => number;
}

/**
 * A small deterministic generator, so that "random" content is reproducible
 * from the room's seed alone. The reducer takes its draws through one of these
 * and writes the advanced seed back into state; nothing in the room ever calls
 * `Math.random`.
 */
export function seededRandom(seed: number): SeededRandom {
  let s = seed >>> 0;
  return {
    random(): number {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    seedAfter: () => s,
  };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS: RoomSettings = {
  gameId: 'fill-in-the-blank',
  setId: null,
  // Familiar verses plus a reach: a room nobody configured should feel like a
  // Bible study, not like a seminary exam and not like a nursery rhyme.
  familiarity: 'broad',
  translation: 'KJV',
  teamsEnabled: false,
  rounds: 10,
  answerWindowMs: 20_000,
  // Off by design: the big screen shows a top three, never a bottom.
  showIndividualScores: false,
  solo: false,
  groupVote: false,
  gameOptions: {},
  theme: DEFAULT_THEME,
};

export interface CreateRoomOptions {
  code: RoomCode;
  settings?: Partial<RoomSettings>;
  now: ServerTime;
  seed: number;
}

export function createRoom(options: CreateRoomOptions): RoomState {
  return {
    code: options.code,
    settings: { ...DEFAULT_SETTINGS, ...options.settings },
    players: [],
    controller: { kind: 'owner' },
    controlRequests: [],
    deniedControlPlayers: [],
    screenPresent: false,
    ownerPresent: false,
    phase: 'lobby',
    paused: false,
    pausedAt: null,
    roundIndex: -1,
    rounds: [],
    answers: [],
    roundSeats: [],
    lastOutcome: null,
    buzz: null,
    streamFrozenAt: null,
    questionEndsAt: null,
    judging: null,
    phaseStartedAt: options.now,
    phaseEndsAt: null,
    revealAt: null,
    answeringOpenedAt: null,
    createdAt: options.now,
    lastActivity: options.now,
    rngSeed: options.seed,
    closed: false,
  };
}

// ---------------------------------------------------------------------------
// Small pure accessors, shared by the reducer and the projection
// ---------------------------------------------------------------------------

export function findPlayer(state: RoomState, playerId: PlayerId): PlayerState | null {
  return state.players.find((player) => player.id === playerId) ?? null;
}

export function currentRound(state: RoomState): Round | null {
  return state.rounds[state.roundIndex] ?? null;
}

/**
 * Everyone in the room, as seats for a round about to begin, in join order.
 * With teams off every seat is teamless, even for a player who picked a team
 * while they were on, so the whole room counts as one group.
 */
export function seatsOf(state: RoomState): Seat[] {
  return state.players.map((player) => ({
    playerId: player.id,
    teamId: state.settings.teamsEnabled ? player.teamId : null,
  }));
}

/**
 * The current round's answers as a game receives them, sorted by arrival. The
 * sort is stable, so a log keeps its order even when two taps share a moment.
 */
export function scoredAnswersOf(state: RoomState): ScoredAnswer[] {
  return [...state.answers]
    .sort((a, b) => a.at - b.at)
    .map((answer) => ({
      playerId: answer.playerId,
      value: answer.value,
      at: answer.at,
      openedAt: answer.openedAt,
      ...(answer.verdict === undefined ? {} : { verdict: answer.verdict }),
    }));
}

export function answerPolicyOf(game: GameModule): AnswerPolicy {
  return game.answerPolicy ?? 'first';
}

/** The round as a game is allowed to see the room. */
export function tableOf(state: RoomState): Table {
  return { seats: state.roundSeats, log: scoredAnswersOf(state) };
}

/** Replaces one player, leaving the rest of the roster untouched. */
export function replacePlayer(state: RoomState, updated: PlayerState): RoomState {
  return {
    ...state,
    players: state.players.map((player) => (player.id === updated.id ? updated : player)),
  };
}

/**
 * The clock layer writes each measured offset here. Buzz ordering reads it, so
 * a room whose clock sync has not completed still behaves — those buzzes simply
 * clamp to their arrival time.
 */
export function withClockOffset(
  state: RoomState,
  playerId: PlayerId,
  clockOffsetMs: number
): RoomState {
  const player = findPlayer(state, playerId);
  if (!player) return state;
  return replacePlayer(state, { ...player, clockOffsetMs });
}

/** Marks a player's stream as up or down without disturbing anything else. */
export function withConnected(
  state: RoomState,
  playerId: PlayerId,
  connected: boolean
): RoomState {
  const player = findPlayer(state, playerId);
  if (!player) return state;
  return replacePlayer(state, { ...player, connected });
}

/**
 * Screen presence, following `withConnected`'s own precedent: not an intent,
 * nobody asked for it, and it must not enter the intent stream. The
 * transport calls this on a screen stream's subscribe and close.
 */
export function withScreenPresence(
  state: RoomState,
  presence: { anyScreen: boolean; ownerScreen: boolean }
): RoomState {
  return { ...state, screenPresent: presence.anyScreen, ownerPresent: presence.ownerScreen };
}

// ---------------------------------------------------------------------------
// Judge content
// ---------------------------------------------------------------------------

/**
 * Reads adjudication content off a round secret if the game put it there.
 * Structural rather than typed because the room must not know what any
 * particular game's secret contains.
 */
export function judgeContentOf(round: Round | null): JudgeContent | null {
  if (!round) return null;
  const secret = round.secret as { judge?: unknown } | null | undefined;
  if (!secret || typeof secret !== 'object') return null;
  const judge = secret.judge as Partial<JudgeContent> | undefined;
  if (!judge || typeof judge.question !== 'string') return null;
  return {
    question: judge.question,
    canonicalAnswer: typeof judge.canonicalAnswer === 'string' ? judge.canonicalAnswer : '',
    accept: Array.isArray(judge.accept) ? judge.accept.filter((a) => typeof a === 'string') : [],
    contextNote: typeof judge.contextNote === 'string' ? judge.contextNote : null,
  };
}

export function judgeRequestOf(state: RoomState): (JudgeRequest & { playerId: PlayerId }) | null {
  const judging = state.judging;
  if (!judging) return null;
  const content = judgeContentOf(currentRound(state));
  return {
    playerId: judging.playerId,
    question: content?.question ?? '',
    canonicalAnswer: content?.canonicalAnswer ?? '',
    accept: content?.accept ?? [],
    contextNote: content?.contextNote ?? null,
    seenPrefix: content ? content.question.slice(0, judging.charsSeen) : '',
    playerAnswer: judging.answerText,
  };
}
