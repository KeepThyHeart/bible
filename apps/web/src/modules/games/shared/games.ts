/**
 * The seam every game plugs into.
 *
 * A game contributes two things and nothing else: a server-side module that
 * builds rounds and scores answers, and a set of client views. The shell owns
 * the room, the clock, the roster, teams, the timer bar, reconnection and the
 * reveal chrome, so a new game is mostly content plus three small views.
 *
 * Keeping this interface narrow is what makes the games buildable in parallel:
 * each one owns its own directory and touches no shared file.
 *
 * Everything past `buildRound` and `scoreRound` is optional, and a game that
 * declares none of it plays exactly as the first games did: one answer per
 * player, the same view on every phone, standings on the big screen. The
 * options exist for games that need one of three things — a different view per
 * phone, answers that can change or accumulate, or a team deciding together —
 * and each is opted into separately.
 */

import type {
  AnswerValue,
  CatalogGame,
  GroupResult,
  HostChrome,
  PersonalResult,
  PhaseName,
  PlayerId,
  RevealAggregate,
  RoomSettings,
  ServerTime,
  TeamId,
} from './protocol.js';

/**
 * One round, as the server holds it. `secret` never leaves the server until
 * the reveal; `hostView` and `playerView` are what each side may see during
 * play, unless the game computes views per viewer with `viewFor`.
 */
export interface Round<Secret = unknown> {
  index: number;
  secret: Secret;
  hostView: unknown;
  playerView: unknown;
  /**
   * How long the answering phase should last, when the game wants something
   * other than the room's default.
   */
  answerWindowMs?: number;
  /**
   * Set when the round needs a reading phase before answers open: streamed
   * buzz questions, progressive clues, a "get ready" before a timed turn.
   */
  questionPhaseMs?: number;
}

export interface ScoredAnswer {
  playerId: PlayerId;
  value: AnswerValue;
  /** Server time the answer arrived, for use only as a tiebreaker. */
  at: ServerTime;
  /**
   * When the round opened for answers, as the room's schedule stood when this
   * answer arrived. A pause pushes the schedule back by its own length, so an
   * answer given after a pause carries the opening moved by that pause and one
   * given before it carries the original. A game that paces content inside the
   * window — clues that appear one by one — measures from here, never from its
   * own idea of when the round began.
   */
  openedAt: ServerTime;
  /**
   * The host's ruling on this answer, for a buzz round where the host heard it
   * and said so. Absent when nobody ruled: a host revealing while someone is
   * mid-sentence has not judged them, and a game must be able to tell that
   * apart from a ruling either way.
   */
  verdict?: 'correct' | 'incorrect';
}

/**
 * One place at the table. Seats are taken when a round begins and do not move
 * until the next one, so a game can deal from them — a clue per seat, a turn
 * to describe — and have the deal hold still while people join, leave or drop
 * signal. A player who joins mid-round has no seat until the next round.
 *
 * There are no names here on purpose: a game has no business putting one in
 * a view, and the client already has the roster to look an id up in.
 */
export interface Seat {
  playerId: PlayerId;
  /** Null for everyone when teams are off, so the whole room is one group. */
  teamId: TeamId | null;
}

/**
 * Who is playing this round and what they have sent so far — the only view of
 * the room a game is given.
 */
export interface Table {
  /** In the order the players joined the room. */
  seats: readonly Seat[];
  /**
   * This round's answers in arrival order, as the answer policy kept them: one
   * per player under `first` and `latest`, every accepted one under `log`.
   */
  log: readonly ScoredAnswer[];
}

/**
 * How the room collects answers for a round.
 *
 * - `first`: a player's first answer stands and later ones are ignored. The
 *   round reveals early once every connected player is in. The default.
 * - `latest`: a player may change their answer until time runs out; the
 *   latest one stands. There is no early reveal, because a vote that can still
 *   change is not in. The host's Reveal now still ends it.
 * - `log`: every accepted answer is kept, in order — taps in a turn, not
 *   answers to a question. No early reveal. The room stops accepting at
 *   `MAX_LOG_ENTRIES`, which no honest round comes near.
 *
 * A buzz round ignores this: the buzz queue decides who may answer.
 */
export type AnswerPolicy = 'first' | 'latest' | 'log';

/** A bound on a `log` round, so a stuck button cannot grow a room without limit. */
export const MAX_LOG_ENTRIES = 500;

/**
 * How a game takes part in group voting.
 *
 * With group voting in effect, the room collects answers under `latest` and
 * scores the round itself, around the game's own `scoreRound`:
 *
 * 1. Each team's latest votes are counted by `key`. A player's vote is one
 *    whose key is not null; anything else is refused when it is sent.
 * 2. A clear majority is the team's answer. The game scores it once for every
 *    member of the team — voters, dissenters and those who never voted alike —
 *    so everyone on a team earns the same.
 * 3. A tie scores nobody on that team. The answer is still shown.
 * 4. The big screen's aggregates, correct label and detail come from the game
 *    scoring everyone's real votes, so they read as they always did.
 *
 * Each phone's result says what that player voted and what their team chose.
 * Teams off, the whole room is one team.
 *
 * The game itself scores plainly, one answer at a time, as if there were no
 * teams. Everything about majorities and ties belongs to the room.
 */
export interface GroupVoteSpec<Secret = unknown> {
  /**
   * `optional`: the host switches it on in the lobby (`RoomSettings.groupVote`).
   * `always`: the game is only played this way.
   */
  mode: 'optional' | 'always';
  /**
   * False for settings under which the game cannot be voted on — a typed
   * answer has no options to count. Leave it out when the answer is always a
   * choice.
   */
  supports?(settings: RoomSettings): boolean;
  /**
   * What makes two votes the same vote, or null for a value that is not a vote
   * at all. Two players choosing the same person at different clues cast the
   * same vote, so a key names the option and ignores the rest.
   */
  key(value: AnswerValue, round: Round<Secret>): string | null;
  /**
   * How the big screen names a vote — "Moses", not "2". Only called on values
   * whose key is not null.
   */
  label(value: AnswerValue, round: Round<Secret>): string;
  /**
   * Which vote stands for a team once its answer is decided, for a game where
   * the moment of the vote is part of what it earns. `backing` is every
   * standing vote for the decided answer within the team, in the order they
   * arrived; `seated` is how many sit at the team, voters or not. The game
   * then scores the returned vote, value and timing, for every member.
   *
   * Return undefined — or leave this out — for the room's own reading, the
   * latest of them: the moment the answer had all its support. The room keeps
   * each player's standing vote only, so a player who backed the answer, moved
   * off it and came back is counted from when they came back.
   */
  represent?(backing: readonly ScoredAnswer[], seated: number): ScoredAnswer | undefined;
}

/**
 * Whether a game with this spec is being played as a group vote under these
 * settings. The room decides with this, and a game whose rules change under a
 * vote — a lockout that no longer makes sense — can ask the same question of
 * its own settings and get the same answer.
 */
export function groupVoteApplies<Secret>(
  spec: GroupVoteSpec<Secret> | undefined,
  settings: RoomSettings
): boolean {
  if (spec === undefined) return false;
  if (spec.supports !== undefined && !spec.supports(settings)) return false;
  return spec.mode === 'always' || settings.groupVote;
}

/**
 * The result of scoring one round.
 *
 * Speed is deliberately not a scoring input beyond a tiebreak: everyone who is
 * right inside the window earns the same, so a slow typist on a slow phone is
 * not punished for either.
 */
export interface RoundOutcome {
  /**
   * One result per player the round means something to. A player left out
   * gets no result on their phone — not a zero — which is right for someone
   * who was only watching.
   */
  perPlayer: Map<PlayerId, PersonalResult>;
  /** Unattributed counts for the big screen. */
  aggregates: RevealAggregate[];
  correctLabel: string;
  /** Anything else the reveal view wants. */
  detail: unknown;
  /** Filled in by the room for a group vote. A game never sets this. */
  groups?: GroupResult[];
}

export interface RoundBuildContext<Secret = unknown> {
  settings: RoomSettings;
  /** Deterministic per room, so a replay of the same room is reproducible. */
  random: () => number;
  /**
   * The rounds already built for this game, in order.
   *
   * A game that must not ask the same thing twice reads its own secrets here.
   * It matters more than it looks: drawing from the whole canon, a repeat
   * inside ten rounds was a one-in-three-thousand curiosity; drawing from a
   * curated pool of a few dozen verses, it is the common case.
   */
  previous: readonly Round<Secret>[];
  /**
   * What the host picked for this round, or null when they did not pick and
   * the game should choose for itself. It arrives exactly as the host's screen
   * sent it, so a game must check it against its own `openChoices` rather than
   * trust it; an unusable choice is treated as no choice.
   */
  choice: string | null;
}

export interface GameModule<Secret = unknown> {
  readonly id: string;
  readonly name: string;
  /**
   * Content-based label for how hard the set is, never a label for the person:
   * "Gospels", "Minor Prophets", "Whole Bible".
   */
  readonly scopeLabel?: string;
  /** True when the game can be played alone with the host advancing itself. */
  readonly supportsSolo: boolean;
  /**
   * Whether this game's rounds are shaped by `RoomSettings.familiarity`,
   * `.translation` and `.setId` respectively — true (shown) when left out,
   * since most games read all three. A lobby settings screen uses these to
   * hide a control that would otherwise change nothing for the game chosen:
   * a setting a host can see and touch but that does nothing is worse than
   * one that is simply not there for that game.
   */
  readonly usesFamiliarity?: boolean;
  readonly usesTranslation?: boolean;
  readonly usesSet?: boolean;
  /** True when the game reuses the buzz queue rather than collecting answers. */
  readonly usesBuzz?: boolean;
  /**
   * True when a host's "correct" is one confirmation among several rather than
   * the end of the round. The confirmed player leaves the queue, the next one
   * is heard, and when nobody is left the room goes back to looking until the
   * timer or the host ends the round. Sword drill works this way: everyone the
   * host hears read the verse aloud has found it, not only the first.
   */
  readonly confirmsEveryBuzz?: boolean;
  /** How answers are collected. `first` when left out; see `AnswerPolicy`. */
  readonly answerPolicy?: AnswerPolicy;
  /**
   * Offers group voting. A game that declares this still plays normally
   * whenever group voting is not in effect, under its own `answerPolicy`; in
   * effect, the room collects under `latest` whatever the game declared.
   */
  readonly groupVote?: GroupVoteSpec<Secret>;
  /**
   * Keeps standings off the big screen until the game is over, for a game
   * where a running score would spoil it. Phones still show their own total.
   */
  readonly standingsAtSummaryOnly?: boolean;

  /**
   * The choices a host may make for the next round, given the rounds already
   * played. A game that leaves this out takes no choices, and the room ignores
   * a choice made for it. The room refuses anything not on this list before
   * the game is asked to build from it, so a stale tap on a tile that has
   * already been played changes nothing.
   */
  openChoices?(previous: readonly Round<Secret>[]): readonly string[];

  /**
   * What one viewer sees of the round: a player's phone, or the host's screen
   * when `viewer` is null. When a game defines this it is the only source of
   * every view, and `hostView` and `playerView` are never sent.
   *
   * It runs on every snapshot, so it must be pure and cheap, and it must strip
   * the secret itself. Draw any randomness in `buildRound` and keep it in the
   * secret. It must never put one player's private view or answer in another
   * player's view, and never put a phone-only secret in the host's. A viewer
   * without a seat — someone who joined mid-round — still gets a view, which
   * should tell them they are in from the next round.
   *
   * `phase` is where the round stands. Something a phone must not have before
   * answers open — a card the describer would start on during the get-ready —
   * is withheld here rather than hidden by the phone, because a payload can be
   * read whether or not the screen draws it.
   */
  viewFor?(round: Round<Secret>, table: Table, viewer: PlayerId | null, phase: PhaseName): unknown;
  /**
   * Whether the round has nothing left to take, asked each time the room keeps
   * an answer. True ends the round there, as if the host had pressed Reveal
   * now: a card turn whose deck has run out has nothing left to play for.
   *
   * It sees only the round and the table, so a replay of the same intents ends
   * at the same answer. It is never asked before an answer is kept, so a round
   * with nothing in it from the start still waits for the timer or the host.
   */
  roundComplete?(round: Round<Secret>, table: Table): boolean;
  /**
   * Words for the host's chrome during a round, for a game whose rounds are
   * not questions: "Turn 3 / 8", "End turn", "Start Blue's turn". Asked on
   * every host snapshot in play, so it must be pure and cheap. Leave it out to
   * keep the shell's own words; see `HostChrome`.
   */
  hostChrome?(round: Round<Secret>, table: Table, phase: PhaseName): HostChrome;
  /**
   * Whether the room should take this answer from this player now, given what
   * has been sent so far. A refused answer changes nothing and is not an
   * error: it is how a stale tap, a tap from the wrong player or a second tap
   * on a card that has moved on is ignored. Leave it out to accept every answer
   * the answer policy allows.
   */
  accepts?(round: Round<Secret>, table: Table, playerId: PlayerId, value: AnswerValue): boolean;

  buildRound(context: RoundBuildContext<Secret>, index: number): Round<Secret>;
  /**
   * `answers` is `table.log` sorted by arrival. The table is there for a game
   * that scores by seat or by team; a game that scores one answer at a time
   * can ignore it.
   */
  scoreRound(round: Round<Secret>, answers: ScoredAnswer[], table: Table): RoundOutcome;
}

/** Registry lookups are by id; the shell never hard-codes a game. */
export interface GameRegistry {
  get(id: string): GameModule | undefined;
  list(): GameModule[];
}

/** What the host's lobby is told about a game. */
export function catalogEntryFor(game: GameModule): CatalogGame {
  return {
    id: game.id,
    name: game.name,
    ...(game.scopeLabel === undefined ? {} : { scopeLabel: game.scopeLabel }),
    supportsSolo: game.supportsSolo,
    groupVote: game.groupVote?.mode ?? 'none',
    usesFamiliarity: game.usesFamiliarity ?? true,
    usesTranslation: game.usesTranslation ?? true,
    usesSet: game.usesSet ?? true,
  };
}
