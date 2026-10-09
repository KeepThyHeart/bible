/**
 * The wire contract between the game server and every client.
 *
 * Three rules hold this design together, and breaking any of them tends to
 * break the game in ways that only show up on real phones:
 *
 * 1. The server is the clock and the source of truth. Every instruction that
 *    involves time is expressed as an absolute `ServerTime`; clients convert
 *    using the offset they measured. Nothing is ever "in 5 seconds from when
 *    you read this".
 * 2. Every phase transition carries a full snapshot. A phone that just woke
 *    from lock, or a browser that just reloaded, renders correctly from the
 *    first message it receives. There is no delta stream to replay.
 * 3. Snapshots are projected per viewer. A player's own score reaches only
 *    that player's socket. The filtering happens on the server, so a bug in
 *    the client cannot leak it.
 */

import type { ThemeTokens } from './theme.js';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** Room join code, canonical uppercase. Ambiguous glyphs are excluded. */
export type RoomCode = string;

/**
 * The code alphabet and length, shared so the join form can validate before
 * a round trip rather than only after one. `server/transport/codes.ts` is
 * the source of truth for *generating* a code (it explains the uniformity
 * requirement this alphabet's length satisfies); this is the same values,
 * exported where the client can read them too — a code is read off a
 * projector and typed on a phone, so a glyph the alphabet does not use is
 * always a typo, not a code that merely does not exist yet.
 */
export const ROOM_CODE_ALPHABET = '23456789CDEFHJKM';
export const ROOM_CODE_LENGTH = 5;

export type PlayerId = string;

/**
 * Opaque per-player secret, stored in the phone's localStorage. Presenting it
 * on a fresh connection rejoins as the *same* player rather than creating a
 * new one, which is what makes reload-and-rejoin invisible to the group.
 */
export type SessionToken = string;

/**
 * Grants owner authority over one room. Issued once, at room creation, and
 * never displayed to the room. Kept by the device that created the room; it
 * opens a screen stream and it can always `reclaimControl`. Named for the
 * credential it is rather than for the person holding it — after this
 * design, "host" is the human running the show, and control may be held by
 * any player's own session instead.
 */
export type HostToken = string;

/** Stable identifier for a game, e.g. `fill-in-the-blank`. */
export type GameId = string;

export type TeamId = 'red' | 'blue' | 'green' | 'gold';

export const TEAM_IDS: readonly TeamId[] = ['red', 'blue', 'green', 'gold'];

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Milliseconds on the server's monotonic-ish wall clock (`Date.now()`). */
export type ServerTime = number;

/** Milliseconds on a client's own clock, before offset correction. */
export type ClientTime = number;

/** One round trip of the clock-sync handshake. */
export interface TimeSyncRequest {
  t0: ClientTime;
}

export interface TimeSyncResponse {
  t0: ClientTime;
  tServer: ServerTime;
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

/**
 * `question` shows the prompt without accepting input: it is what streaming
 * buzz questions and progressive clue reveals live in. Games with nothing to
 * read first go straight to `answering`.
 *
 * `paused` is not a phase. It is an overlay flag on the room, so that pausing
 * does not destroy the phase a round is in.
 */
export type PhaseName = 'lobby' | 'question' | 'answering' | 'reveal' | 'summary';

// ---------------------------------------------------------------------------
// Players and teams
// ---------------------------------------------------------------------------

/** Player fields that everyone in the room may see. */
export interface PublicPlayer {
  id: PlayerId;
  name: string;
  teamId: TeamId | null;
  connected: boolean;
}

/**
 * One line of a leaderboard. Sent only where naming someone is a kindness:
 * a top three, a host's private adjustment panel. Never a full ordering to
 * the big screen unless the host has explicitly turned that on.
 */
export interface Standing {
  playerId: PlayerId;
  name: string;
  teamId: TeamId | null;
  score: number;
}

export interface TeamStanding {
  teamId: TeamId;
  score: number;
  playerCount: number;
}

// ---------------------------------------------------------------------------
// Room settings
// ---------------------------------------------------------------------------

/**
 * How far past the best-known verses a room is willing to draw.
 *
 * This is a property of the *material*, never of the people playing: `deep`
 * does not mean the group is clever, it means the verses come from further in.
 * It belongs to the shell rather than to `gameOptions` because every game that
 * asks about a verse needs it and they should all mean the same thing by it —
 * a room set to `core` should not become obscure because the host changed game.
 *
 * `any` is the whole canon drawn uniformly, which is a real choice for a group
 * that wants Obadiah, and is also what a server with no curated pool falls back
 * to. It was once the only behaviour, and it made the game about Job.
 */
export type Familiarity = 'core' | 'familiar' | 'broad' | 'deep' | 'any';

export const FAMILIARITIES: readonly Familiarity[] = [
  'core',
  'familiar',
  'broad',
  'deep',
  'any',
];

/** Host-facing wording. The scale is about the verse, so the labels are too. */
export const FAMILIARITY_LABELS: Readonly<Record<Familiarity, string>> = {
  core: 'Verses everyone knows',
  familiar: 'Well-known verses',
  broad: 'Familiar and further afield',
  deep: 'For a group that reads',
  any: 'Anywhere in the Bible',
};

export interface RoomSettings {
  gameId: GameId;
  /** Content set the host chose, or null for a generated set. */
  setId: string | null;
  /** Which slice of the curated verse pool the games may draw from. */
  familiarity: Familiarity;
  /** Module abbreviation, e.g. `KJV`. */
  translation: string;
  teamsEnabled: boolean;
  rounds: number;
  /** Milliseconds allowed for the answering phase. */
  answerWindowMs: number;
  /**
   * Off by default, and deliberately so: the big screen shows aggregates and a
   * top three, never a bottom of the leaderboard.
   */
  showIndividualScores: boolean;
  /**
   * Solo play is a room with one player who is also the host, advancing itself.
   * It is a flag rather than a second application.
   */
  solo: boolean;
  /**
   * Group voting: each team — or the whole room, with teams off — agrees one
   * answer by majority, and everyone in it scores what the majority chose.
   *
   * A room mode rather than a game option, because the room is what carries it
   * out: it changes how answers are collected and how a round is scored, not
   * what a round asks. A game offers it through `GameModule.groupVote`; for a
   * game that does not, or that plays that way always, this flag changes
   * nothing. Fixed once the rounds are built, like the game itself, so a round
   * is never collected under one rule and scored under another.
   */
  groupVote: boolean;
  /**
   * Settings that mean something to one game and nothing to the shell —
   * difficulty, whether references are typed or tapped, a passage to draw from.
   *
   * Deliberately opaque strings. Naming each game's options here would make
   * this type grow with every game and would put the shell in the position of
   * knowing what a difficulty is, which is exactly the coupling the game seam
   * exists to prevent. A game reads the keys it understands and ignores the
   * rest, so an option left over from a previous game is inert rather than an
   * error.
   */
  gameOptions: Record<string, string>;
  /**
   * The room's default palette. Values, not a fixed enum: a preset is just a
   * value set for this same field, and the host can edit any token without
   * that being a different kind of setting. A joining player starts here; a
   * player may then override it locally without this ever changing (see
   * `src/shared/theme.ts`).
   */
  theme: ThemeTokens;
}

// ---------------------------------------------------------------------------
// Intents: everything that can change a room
// ---------------------------------------------------------------------------

export type HostCommand =
  | { cmd: 'start' }
  | { cmd: 'pause' }
  | { cmd: 'resume' }
  | { cmd: 'skip' }
  | { cmd: 'revealNow' }
  | { cmd: 'nextRound' }
  | { cmd: 'kick'; playerId: PlayerId }
  | { cmd: 'adjust'; playerId: PlayerId; delta: number }
  | { cmd: 'end' }
  /**
   * Ends the current game but keeps the room open: every connected player's
   * session and stream survive, the room drops back to `lobby`, and the host
   * is free to pick a different game (or the same one again) through
   * `setSettings`. Scores reset to zero — a new game is a clean slate, not a
   * continuation — but the room itself, and everyone in it, stays put. `end`
   * remains the way to close the room outright.
   */
  | { cmd: 'newGame' }
  | { cmd: 'setSettings'; settings: Partial<RoomSettings> }
  | { cmd: 'requestFullStandings' }
  /**
   * The host picks what the next round asks — a tile on the category board —
   * and the room goes straight to it. What a choice means belongs to the game;
   * the room only checks it is one the game is offering.
   */
  | { cmd: 'choose'; choice: string }
  /** Adjudication of the player currently at the head of the buzz queue. */
  | { cmd: 'judge'; verdict: 'correct' | 'incorrect' | 'askToBeSpecific' }
  /**
   * The host puts a connected player at the buzzer on their behalf — sword
   * drill's "the host announces the reference and calls on whoever found it"
   * mode, for a room where individual phone buttons would rather not be the
   * mechanic (see `gameOptions.buzzMode` on the game that reads it). Reaches
   * the reducer exactly as if that player had buzzed themselves this instant:
   * it queues behind whoever the room is already listening to, same as a
   * second phone tapping "Found it" while the first is reading. Refused for a
   * player who is not connected, already spent, already confirmed, or
   * already in the queue — the same rules an ordinary buzz already applies.
   */
  | { cmd: 'callOn'; playerId: PlayerId }
  /** Hand control to a player: approves a request, or moves it with no request at all. */
  | { cmd: 'grantControl'; playerId: PlayerId }
  | { cmd: 'denyControl'; playerId: PlayerId }
  /** The owner credential takes control back. The one command it may always send. */
  | { cmd: 'reclaimControl' };

/**
 * Who submitted an intent. The reducer trusts this; the transport proves it.
 *
 * `owner` is the room's owner credential, presented once at creation and kept
 * by the device that created the room. It no longer means "the authority
 * behind every host command" — a player's own session may submit one too, if
 * the reducer finds that session is the room's current controller (see
 * `handleHost`'s authorisation rule). `owner` is what may always reclaim
 * control, not what is always obeyed.
 */
export type Actor =
  | { role: 'owner' }
  | { role: 'player'; playerId: PlayerId }
  /** The scheduler firing a timer the reducer previously asked for. */
  | { role: 'system' };

export type Intent =
  | { kind: 'join'; name: string; teamId?: TeamId }
  | { kind: 'rejoin' }
  | { kind: 'leave' }
  | { kind: 'setTeam'; teamId: TeamId }
  /** Typed text, a chosen index, or an ordering — the game module interprets it. */
  | { kind: 'answer'; round: number; value: AnswerValue }
  | { kind: 'buzz'; round: number; charsSeen: number; tClient: ClientTime }
  | { kind: 'withdraw'; round: number }
  | { kind: 'host'; command: HostCommand }
  /** A player asking to be handed control of the room. Refused if they already
   *  have a pending request, or are already the controller. */
  | { kind: 'requestControl' }
  /** Takes back a control request before it is decided. */
  | { kind: 'withdrawControlRequest' }
  /** Fired by the scheduler at a time the reducer chose. */
  | { kind: 'timer'; round: number; tag: string }
  /** A judge provider's suggestion coming back; never a verdict on its own. */
  | { kind: 'judgeSuggestion'; round: number; playerId: PlayerId; suggestion: JudgeSuggestion };

/** An intent as the reducer sees it, once the transport has authenticated it. */
export interface AddressedIntent {
  actor: Actor;
  intent: Intent;
  receivedAt: ServerTime;
}

export type AnswerValue =
  | { type: 'text'; text: string }
  | { type: 'choice'; index: number }
  | { type: 'order'; order: string[] }
  | { type: 'reference'; book: number; chapter: number; verse: number }
  /** Sword drill: the player says they have found the passage. */
  | { type: 'found' }
  /**
   * A turn-based card game: the card in play was got, passed, or given away by
   * a slip. `card` names the card the tap was about, so a network retry, or two
   * phones tapping at once, is recognisably about a card that has already moved
   * on and is refused rather than moving on a second card.
   */
  | { type: 'card'; action: 'got' | 'pass' | 'slip'; card: number };

// ---------------------------------------------------------------------------
// Effects: what the reducer asks the outside world to do
// ---------------------------------------------------------------------------

/**
 * The reducer is pure. It never sets a timer, writes a database, or calls a
 * model; it returns a request for one of those, and the runtime performs it.
 * That is what makes the room state machine exhaustively testable without a
 * clock or a socket.
 */
export type Effect =
  | { type: 'timer'; at: ServerTime; round: number; tag: string }
  | { type: 'cancelTimers'; round: number }
  | { type: 'persist' }
  | { type: 'requestJudge'; round: number; playerId: PlayerId }
  /**
   * The round has been scored and the room may be told. It is an effect rather
   * than something a snapshot carries because a reveal is addressed twice over:
   * one public payload for the whole room and one private result per phone, and
   * only the runtime knows who is listening.
   */
  | { type: 'reveal'; round: number }
  | { type: 'closeRoom' }
  /**
   * The reducer actually removed this player from the roster — a kick that
   * took, or an ordinary leave. The transport performs the removal exactly
   * like any other effect, rather than assuming a dispatched `kick` or
   * `leave` was necessarily an applied one: once a `HostCommand` can be
   * refused (failing the controller check, say), that assumption is false,
   * and a refused kick would otherwise still destroy the session.
   */
  | { type: 'removeSession'; playerId: PlayerId };

// ---------------------------------------------------------------------------
// Buzz-in
// ---------------------------------------------------------------------------

/**
 * One entry in the buzz queue.
 *
 * Ordering is by `correctedAt` — the player's buzz timestamp translated into
 * server time using their measured clock offset, clamped to the interval
 * between the reveal and the moment the server actually heard the buzz. That
 * ranks by reaction time rather than by network luck, and unlike a raw
 * client-reported figure it cannot be improved by lying.
 *
 * `charsSeen` is what the player had actually read. It drives the "buzzed at
 * 38%" reveal, gives the judge the prefix the player saw, and flags a phone
 * whose renderer has drifted — but it does not decide the queue.
 */
export interface BuzzEntry {
  playerId: PlayerId;
  correctedAt: ServerTime;
  arrivedAt: ServerTime;
  charsSeen: number;
  /** True when the server had to clamp an implausible client timestamp. */
  clamped: boolean;
}

/**
 * The room's own truth about a buzz round — kept here, never sent whole.
 * `spent` names who has already answered wrong, and naming a wrong answer to
 * a screen the whole room is watching is exactly the leak ADR 0004 forbids;
 * sword drill in particular intends "no public mark" for anyone not reached.
 * What a screen or a foreign player's snapshot actually carries is
 * `PublicBuzzState`, below, which has everything but that.
 */
export interface BuzzState {
  /** Head of the queue is whoever is answering now. */
  queue: BuzzEntry[];
  /** Set once anyone buzzes: the stream is frozen for the whole room. */
  frozenAtChars: number | null;
  /** Deadline for the player currently answering. */
  answerDeadline: ServerTime | null;
  /** Players who already answered wrong on this round and cannot re-buzz. */
  spent: PlayerId[];
  /** Set when the host has granted a second, shorter window to be specific. */
  secondChanceFor: PlayerId | null;
  /**
   * Players the host has confirmed this round, in the order they were heard,
   * for a game where one confirmation does not end the round. Praise is public,
   * so this is safe on every screen; a confirmed player cannot buzz again.
   */
  confirmed?: PlayerId[];
}

/**
 * What the whole room may see of a buzz: who is up, who is waiting, who was
 * confirmed — everything `BuzzState` carries except `spent`. A player learns
 * their own spent status from `PlayerSnapshot.youAreSpent`; the controller
 * learns everyone's from `ControlPanel.spent`, to know who not to call on.
 */
export interface PublicBuzzState {
  queue: BuzzEntry[];
  frozenAtChars: number | null;
  answerDeadline: ServerTime | null;
  secondChanceFor: PlayerId | null;
  confirmed?: PlayerId[];
}

// ---------------------------------------------------------------------------
// Judging
// ---------------------------------------------------------------------------

/**
 * A suggestion, never a verdict. The host confirms with one tap, and the game
 * is fully playable with no provider configured at all.
 */
export interface JudgeSuggestion {
  verdict: 'correct' | 'incorrect' | 'ambiguous';
  reason: string;
}

export interface JudgeRequest {
  question: string;
  canonicalAnswer: string;
  accept: string[];
  /** One line from the question's author, for cases the accept list misses. */
  contextNote: string | null;
  /** The prefix the player had actually read when they buzzed. */
  seenPrefix: string;
  playerAnswer: string;
}

/**
 * Implemented by a null provider (returns nothing, which is the default) and by
 * an HTTP provider speaking the OpenAI-shaped chat-completions dialect that
 * Together and most hosts accept.
 */
export interface JudgeProvider {
  readonly id: string;
  suggest(request: JudgeRequest): Promise<JudgeSuggestion | null>;
}

// ---------------------------------------------------------------------------
// Control: who is running the room
// ---------------------------------------------------------------------------

/**
 * Who is running the room right now. Public: the screen says so by name, and
 * a phone may too. Not a credential — see `RoomState.controller` in
 * `server/room/state.ts` for why holding this is safe to broadcast.
 */
export type Controller = { kind: 'owner' } | { kind: 'player'; playerId: PlayerId };

/** A phone asking to be handed control. Nobody's snapshot but the controller's carries these. */
export interface ControlRequest {
  playerId: PlayerId;
  askedAt: ServerTime;
  /** When this request stops waiting: granted if nobody is controlling, dropped if someone is. */
  decidesAt: ServerTime;
}

/**
 * Everything running the room needs that is either private or absent from the
 * device's own snapshot, addressed to exactly one socket: the controller's.
 */
export interface ControlPanel {
  /**
   * The private half of adjudication: what one player actually said or typed,
   * before anyone has ruled on it. This is the field the whole design exists
   * to keep off a screen the room is looking at.
   */
  pendingJudge: (JudgeRequest & { playerId: PlayerId; suggestion: JudgeSuggestion | null }) | null;
  /** Phones asking to run the room. Nobody else's snapshot carries these. */
  requests: ControlRequest[];
  /**
   * Room facts a phone controller has no screen snapshot to read. Public
   * data, repeated here rather than conditionally omitted; nothing private is
   * duplicated.
   */
  answeredCount: number;
  standings: Standing[];
  teamStandings: TeamStanding[];
  overallStandings: Standing[];
  /** Who is out of this round's buzz, for a controller deciding who to call on. */
  spent: PlayerId[];
}

// ---------------------------------------------------------------------------
// Snapshots: what a client receives
// ---------------------------------------------------------------------------

/** Shared chrome: the parts of the shell every game screen renders. */
export interface SnapshotCommon {
  code: RoomCode;
  phase: PhaseName;
  paused: boolean;
  round: number;
  totalRounds: number;
  settings: RoomSettings;
  players: PublicPlayer[];
  /** Who is running the room. Public: the screen says so, and phones may too. */
  controller: Controller;
  /**
   * True when at least one screen is connected. A phone may then leave the
   * question to the screen and keep its own space for answering. A game that
   * ignores it renders exactly as it does today.
   */
  questionOnScreen: boolean;
  /** When the current phase ends, or null if it waits on the host. */
  phaseEndsAt: ServerTime | null;
  /**
   * The full length of the phase that ends at `phaseEndsAt`, or null when
   * nothing is counting down. The room's answer window is only the default: a
   * round may set its own, a reading phase has its own, and each buzz reader
   * gets a fresh window, so a timer bar sized from the settings would start
   * part-empty or overflow.
   */
  phaseDurationMs: number | null;
  /** When a scheduled reveal begins. Clients convert to their own clock. */
  revealAt: ServerTime | null;
  serverTime: ServerTime;
  /**
   * Present only during a round of a game that words its chrome differently.
   * Sent with the snapshot rather than the catalog because a label can depend
   * on the round — "Start Blue's turn" names whoever goes next. Common to
   * both viewers: none of `HostChrome`'s fields are more than a UI word
   * ("Turn" rather than "Q", a button's label), so a phone that has been
   * saying "Q 3 / 8" through a game whose rounds are turns gets the game's
   * own word too, not only the projector.
   */
  chrome?: HostChrome;
}

export interface PlayerSnapshot extends SnapshotCommon {
  viewer: 'player';
  you: PublicPlayer;
  /** Private to this socket. */
  yourScore: number;
  /** Whether this player has already answered the current round. */
  youAnswered: boolean;
  /**
   * This player's own standing answer, for a round where an answer can be
   * changed, so a phone that reloads mid-vote can highlight what it chose.
   * Null otherwise. Only ever this player's: nobody's snapshot carries anyone
   * else's answer.
   */
  yourAnswer: AnswerValue | null;
  /**
   * True when this round takes more than one answer from a player — a vote
   * that may change until time runs out, or a sequence of taps. A phone locks
   * after its first answer only when this is false.
   */
  canChangeAnswer: boolean;
  /** Rank is shown to a player only when it is worth showing: top three. */
  yourRank: number | null;
  /** Game-specific payload, already stripped of anything answer-revealing. */
  view: unknown;
  buzz: PublicBuzzState | null;
  /** Whether this player already answered wrong this round and cannot re-buzz. Never anyone else's. */
  youAreSpent: boolean;
  /** Present only on the phone that currently holds control. */
  control?: ControlPanel;
  /** This player's own standing request, and nobody else's. */
  yourControlRequest: 'pending' | 'denied' | null;
}

/**
 * The host chrome's wording, for a game whose rounds are not questions.
 *
 * Every field is optional, and one left out keeps the shell's own word, so a
 * game changes only what reads wrong for it. Words only: the controls stay
 * where they are and do what they did, because the host finds them by feel.
 */
export interface HostChrome {
  /** What a round is called in the counter; "Turn" reads "Turn 3 / 8". The shell says "Q". */
  roundWord?: string;
  /** The button that ends a round early. The shell says "Reveal now". */
  revealLabel?: string;
  /** The button that moves on from a reveal. The shell says "Next question". */
  nextLabel?: string;
  /**
   * Hides the "Answered x / y" count, for a round in which most of the room is
   * never meant to send anything and a low count would read as people failing.
   */
  hideAnswered?: boolean;
}

export interface ScreenSnapshot extends SnapshotCommon {
  viewer: 'screen';
  /**
   * Top three, unless the host turned individual scores on. The server decides
   * this, so the big screen physically cannot render a last place.
   */
  standings: Standing[];
  teamStandings: TeamStanding[];
  /**
   * Top three across the whole room's session — every game played in it, not
   * only the one live now. `newGame` resets `score` to zero for a fresh game
   * (see `HostCommand`), but folds what each player was carrying into a
   * separate running total first, so a room that plays several games in one
   * sitting can still be asked who came out ahead overall. Always a top
   * three: this is an occasional summary screen, shown on request, not the
   * per-round standings `showIndividualScores` governs.
   */
  overallStandings: Standing[];
  answeredCount: number;
  view: unknown;
  buzz: PublicBuzzState | null;
  /**
   * Present only on the screen whose credential is the room's owner token,
   * and only while that credential holds control. A display-token screen
   * never carries it, whatever else is happening in the room.
   */
  control?: ControlPanel;
}

export type ClientSnapshot = PlayerSnapshot | ScreenSnapshot;

// ---------------------------------------------------------------------------
// Reveal
// ---------------------------------------------------------------------------

/**
 * Aggregates are unattributed by construction: a count per option, never a list
 * of who chose what. Individual outcomes travel in `yourResult`, on the
 * player's own socket.
 */
export interface RevealAggregate {
  label: string;
  count: number;
}

/**
 * How one group voted, when a round was decided by group vote. A group is a
 * team, or the whole room with teams off.
 *
 * Counts only, like every other aggregate: no shape here can say who voted for
 * what, so a dissenter is never named. A team of one is the exception the
 * arithmetic cannot help, and it is the host's choice to play that way.
 */
export interface GroupResult {
  /** Null for the whole room, or for players who are on no team. */
  teamId: TeamId | null;
  /** Votes per option within this group, largest first. */
  split: RevealAggregate[];
  /** The option the group settled on, or null for a tie or no votes at all. */
  decided: string | null;
  /** Whether that option was right; null when the group decided nothing. */
  correct: boolean | null;
}

export interface RevealPayload {
  round: number;
  correctLabel: string;
  aggregates: RevealAggregate[];
  /** Free-form per-game detail for the reveal screen, e.g. partial-credit bars. */
  detail: unknown;
  /** Present only when the round was decided by group vote. */
  groups?: GroupResult[];
}

export interface PersonalResult {
  correct: boolean;
  /** Partial credit is normal: book right but chapter wrong still scores. */
  pointsAwarded: number;
  /** What the player submitted, echoed back so the phone can show it. */
  submitted: AnswerValue | null;
  /** One short line, e.g. "Close enough!" for a fuzzy match. */
  note: string | null;
}

// ---------------------------------------------------------------------------
// Server-sent events
// ---------------------------------------------------------------------------

/**
 * Nearly everything is a snapshot, because a snapshot is idempotent and a
 * reconnect is then indistinguishable from a phase change. The exceptions are
 * one-shot messages that are not part of steady state.
 */
export type ServerEvent =
  | { type: 'snapshot'; snapshot: ClientSnapshot }
  | { type: 'reveal'; reveal: RevealPayload; yourResult: PersonalResult | null }
  /** Full leaderboard, sent only to a host who explicitly asked for it. */
  | { type: 'standingsFull'; standings: Standing[] }
  | { type: 'kicked'; reason: string }
  | { type: 'roomClosed'; reason: string }
  /** Keeps intermediaries from timing out an idle stream. */
  | { type: 'heartbeat'; serverTime: ServerTime };

// ---------------------------------------------------------------------------
// HTTP surface
// ---------------------------------------------------------------------------

/**
 * Transport is server-sent events for the downstream half and plain POSTs for
 * the upstream half. It reconnects on its own, survives proxies that mangle
 * WebSocket upgrades, and replays nothing — a fresh stream opens with a
 * snapshot.
 */
/** Where the server module mounts the games router (the module manifest's `serverRoutes` names the same path). */
export const API_BASE = '/api/games';

export const API = {
  /** POST — create a room. Returns the code, the owner token and the display token. */
  createRoom: `${API_BASE}/rooms`,
  /** GET (SSE) — `/api/games/rooms/:code/stream?token=…` */
  stream: (code: RoomCode) => `${API_BASE}/rooms/${code}/stream`,
  /** POST — submit an intent to `/api/games/rooms/:code/intent`. */
  intent: (code: RoomCode) => `${API_BASE}/rooms/${code}/intent`,
  /** POST — clock-sync round trip. Deliberately outside any room. */
  time: `${API_BASE}/time`,
  /** GET — games and content sets available to a host. */
  catalog: `${API_BASE}/catalog`,
} as const;

export interface CreateRoomRequest {
  settings: Partial<RoomSettings>;
}

export interface CreateRoomResponse {
  code: RoomCode;
  ownerToken: HostToken;
  /** Opens a screen stream and nothing else — see `HostToken`'s own doc comment. */
  displayToken: string;
}

export interface JoinResponse {
  playerId: PlayerId;
  sessionToken: SessionToken;
}

/** Uniform failure shape, so the client has one path for every rejection. */
export interface ApiError {
  error: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/**
 * What a host may choose from before starting a room.
 *
 * A server with no game modules and no Bible module installed answers with
 * empty lists rather than an error: a host should be told there is nothing to
 * play, on the screen where they would have picked something.
 */
export interface CatalogGame {
  id: GameId;
  name: string;
  /** Describes the content's reach — "Gospels", "Whole Bible" — never a player. */
  scopeLabel?: string;
  supportsSolo: boolean;
  /**
   * Whether the game can be played as a group vote: `optional` puts a switch
   * in the lobby, `always` means the game is only ever played that way.
   */
  groupVote: GroupVoteMode;
  /**
   * Whether this game's rounds are shaped by the room's familiarity,
   * translation and set settings, respectively — a lobby hides whichever of
   * these is false for the game currently chosen, rather than showing a
   * control that would change nothing.
   */
  usesFamiliarity: boolean;
  usesTranslation: boolean;
  usesSet: boolean;
}

export type GroupVoteMode = 'none' | 'optional' | 'always';

export interface CatalogSet {
  id: string;
  name: string;
  /** Null when the set is not tied to one game. */
  gameId: GameId | null;
}

export interface Catalog {
  games: CatalogGame[];
  sets: CatalogSet[];
  /** Module abbreviations, e.g. `KJV`. */
  translations: string[];
}
