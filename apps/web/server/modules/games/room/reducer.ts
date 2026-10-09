/**
 * The room state machine.
 *
 * `reduce` is a pure function: it reads no clock, opens no socket, draws no
 * randomness outside the seed carried in state, and never mutates what it was
 * given. Every time value comes from the intent's `receivedAt` or from state
 * itself, and anything that has to happen later leaves as an effect for the
 * runtime to perform.
 *
 * That constraint is not tidiness for its own sake. The failures this room has
 * to survive are timing failures — a phone waking from lock mid-round, two
 * buzzes a hundred milliseconds apart over cellular, a host pausing while a
 * timer is in flight — and a pure reducer turns every one of them into a list
 * of intents that a test can replay exactly.
 *
 * The game module arrives as a parameter rather than an import, so that the
 * state machine can be tested against a fake and so that no game is ever wired
 * into the room by name.
 */

import type {
  Actor,
  AddressedIntent,
  AnswerValue,
  BuzzEntry,
  BuzzState,
  ClientTime,
  HostCommand,
  JudgeSuggestion,
  PlayerId,
  RoomSettings,
  ServerTime,
  TeamId,
} from '../../../../src/modules/games/shared/protocol.js';
import { TEAM_IDS } from '../../../../src/modules/games/shared/protocol.js';
import type { GameModule } from '../../../../src/modules/games/shared/games.js';
import { MAX_LOG_ENTRIES } from '../../../../src/modules/games/shared/games.js';
import { correctBuzzTime } from '../clock/offsetTracking.js';
import { effectiveGame } from './groupVote.js';
import {
  answerWindowFor,
  buildRounds,
  enterReveal,
  enterRound,
  enterSummary,
  freezeStream,
  openAnswering,
  resumeStream,
  secondChanceWindowFor,
  shiftTimes,
  startGame,
  timerForPhase,
  TIMER_ANSWER_END,
  TIMER_BUZZ_ANSWER,
  TIMER_QUESTION_END,
  type Transition,
} from './phases.js';
import {
  answerPolicyOf,
  currentRound,
  findPlayer,
  replacePlayer,
  seededRandom,
  tableOf,
  type PlayerState,
  type ReceivedAnswer,
  type RoomState,
} from './state.js';

export type ReduceResult = Transition;

/** Long enough for a real name, short enough to fit a phone's roster row. */
const MAX_NAME_LENGTH = 24;

/**
 * Two "Dave"s in the same room are not a typo, and are indistinguishable
 * everywhere a name is the only identifier — sword drill's "reading aloud",
 * describe-it's "up next". Rather than reject the second Dave, or silently
 * let the roster carry a duplicate, this disambiguates: "Dave" and "Dave (2)".
 * Case-insensitive, since "Dave" and "dave" read as the same name once shown
 * side by side.
 */
function uniqueName(state: RoomState, base: string): string {
  const taken = new Set(state.players.map((player) => player.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`;
    const trimmedBase = base.slice(0, Math.max(1, MAX_NAME_LENGTH - suffix.length));
    const candidate = `${trimmedBase}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function reduce(
  state: RoomState,
  addressed: AddressedIntent,
  installed: GameModule
): ReduceResult {
  // A closed room is a dead room: nothing reopens it, and answering intents
  // against it would resurrect state the runtime has already torn down.
  if (state.closed) return { state, effects: [] };

  // The game as this room plays it. Group voting is a room mode wrapped around
  // the game, so everything below sees one module whichever way it is played.
  const game = effectiveGame(installed, state.settings);
  const now = addressed.receivedAt;
  const base: RoomState = { ...state, lastActivity: now };
  const { actor, intent } = addressed;

  switch (intent.kind) {
    case 'join':
      return handleJoin(base, actor, intent.name, intent.teamId, now);
    case 'rejoin':
      return handleRejoin(base, actor);
    case 'leave':
      return handleLeave(base, actor, game, now);
    case 'setTeam':
      return handleSetTeam(base, actor, intent.teamId);
    case 'answer':
      return handleAnswer(base, actor, intent.round, intent.value, game, now);
    case 'buzz':
      return handleBuzz(base, actor, intent.round, intent.charsSeen, intent.tClient, now);
    case 'withdraw':
      return handleWithdraw(base, actor, intent.round, now);
    case 'host':
      return handleHost(base, actor, intent.command, game, now);
    case 'requestControl':
      return handleRequestControl(base, actor, now);
    case 'withdrawControlRequest':
      return handleWithdrawControlRequest(base, actor);
    case 'timer':
      return handleTimer(base, actor, intent.round, intent.tag, game, now);
    case 'judgeSuggestion':
      return handleJudgeSuggestion(base, intent.round, intent.playerId, intent.suggestion);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unchanged(state: RoomState): ReduceResult {
  return { state, effects: [] };
}

function actingPlayer(state: RoomState, actor: Actor): PlayerState | null {
  if (actor.role !== 'player') return null;
  return findPlayer(state, actor.playerId);
}

function mintPlayerId(state: RoomState): { id: PlayerId; seed: number } {
  const rng = seededRandom(state.rngSeed);
  let id: PlayerId;
  do {
    id = `p-${Math.floor(rng.random() * 0x1_0000_0000).toString(36)}`;
  } while (state.players.some((player) => player.id === id));
  return { id, seed: rng.seedAfter() };
}

/** Fills the emptiest team, so that a room that fills up stays balanced. */
function autoTeam(state: RoomState): TeamId | null {
  if (!state.settings.teamsEnabled) return null;
  const counts = new Map<TeamId, number>();
  for (const player of state.players) {
    if (player.teamId) counts.set(player.teamId, (counts.get(player.teamId) ?? 0) + 1);
  }
  let chosen: TeamId | null = null;
  let smallest = Number.POSITIVE_INFINITY;
  for (const teamId of TEAM_IDS) {
    const count = counts.get(teamId) ?? 0;
    if (count < smallest) {
      chosen = teamId;
      smallest = count;
    }
  }
  return chosen;
}

function roundIsLive(state: RoomState): boolean {
  return state.phase === 'question' || state.phase === 'answering';
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

function handleJoin(
  state: RoomState,
  actor: Actor,
  rawName: string,
  teamId: TeamId | undefined,
  now: ServerTime
): ReduceResult {
  const name = rawName.trim().slice(0, MAX_NAME_LENGTH);
  if (!name) return unchanged(state);

  // A join addressed as an existing player is a returning phone, not a second
  // person. Restoring rather than duplicating is what keeps a reload invisible
  // to the rest of the room — and it must never cost the player their score.
  const existing = actingPlayer(state, actor);
  if (existing) {
    const restored: PlayerState = {
      ...existing,
      name,
      connected: true,
      teamId: teamId ?? existing.teamId,
    };
    return { state: replacePlayer(state, restored), effects: [{ type: 'persist' }] };
  }

  const minted = actor.role === 'player' ? null : mintPlayerId(state);
  const id = actor.role === 'player' ? actor.playerId : (minted?.id ?? '');
  if (!id) return unchanged(state);

  const player: PlayerState = {
    id,
    name: uniqueName(state, name),
    teamId: teamId ?? autoTeam(state),
    connected: true,
    score: 0,
    joinedAt: now,
    clockOffsetMs: 0,
    totalResponseMs: 0,
    // A player who joins mid-session has no earlier game to carry a total in
    // from — this only ever grows from here, at the next `newGame`.
    allTimeScore: 0,
  };

  // Latecomers are allowed in mid-game on purpose: a youth group does not
  // arrive all at once, and shutting the door is worse than a zero score.
  return {
    state: {
      ...state,
      players: [...state.players, player],
      rngSeed: minted?.seed ?? state.rngSeed,
    },
    effects: [{ type: 'persist' }],
  };
}

/**
 * The phone-woke-from-lock path, and the one behaviour in this file that must
 * never regress: the same player comes back with the same id, the same team and
 * the same score. Nothing about a rejoin is allowed to look like a new player.
 */
function handleRejoin(state: RoomState, actor: Actor): ReduceResult {
  const player = actingPlayer(state, actor);
  if (!player) return unchanged(state);
  if (player.connected) return unchanged(state);
  return {
    state: replacePlayer(state, { ...player, connected: true }),
    effects: [{ type: 'persist' }],
  };
}

/**
 * An explicit departure removes the player. A dropped stream does not come
 * through here — the transport marks that as a disconnection, so that a tunnel
 * or a lock screen never costs anyone their place.
 */
function handleLeave(
  state: RoomState,
  actor: Actor,
  game: GameModule,
  now: ServerTime
): ReduceResult {
  const player = actingPlayer(state, actor);
  if (!player) return unchanged(state);
  return removePlayer(state, player.id, game, now);
}

function removePlayer(
  state: RoomState,
  playerId: PlayerId,
  game: GameModule,
  now: ServerTime
): ReduceResult {
  const players = state.players.filter((player) => player.id !== playerId);
  const withoutPlayer: RoomState = {
    ...state,
    players,
    // A log is a record of what happened in the turn, not one person's answer:
    // the cards a describer got stay got when the describer leaves, and the
    // position in the deck that the log implies must not jump backwards.
    answers:
      answerPolicyOf(game) === 'log'
        ? state.answers
        : state.answers.filter((answer) => answer.playerId !== playerId),
    // The controlling player leaving is never left dangling on an id the
    // roster no longer has — control reverts to the owner.
    controller:
      state.controller.kind === 'player' && state.controller.playerId === playerId
        ? { kind: 'owner' }
        : state.controller,
    controlRequests: state.controlRequests.filter((request) => request.playerId !== playerId),
    deniedControlPlayers: state.deniedControlPlayers.filter((id) => id !== playerId),
  };

  // Both callers (`handleLeave`, the `kick` command) have already checked the
  // player exists, so this is always a genuine removal — the transport is
  // told to invalidate the session exactly when, and only when, the roster
  // actually changed, rather than inferring it from the intent it forwarded.
  if (!withoutPlayer.buzz) {
    return {
      state: withoutPlayer,
      effects: [{ type: 'removeSession', playerId }, { type: 'persist' }],
    };
  }

  const wasHead = withoutPlayer.buzz.queue[0]?.playerId === playerId;
  const buzz = {
    ...withoutPlayer.buzz,
    queue: withoutPlayer.buzz.queue.filter((entry) => entry.playerId !== playerId),
    spent: withoutPlayer.buzz.spent.filter((id) => id !== playerId),
    ...(withoutPlayer.buzz.confirmed === undefined
      ? {}
      : { confirmed: withoutPlayer.buzz.confirmed.filter((id) => id !== playerId) }),
    secondChanceFor:
      withoutPlayer.buzz.secondChanceFor === playerId ? null : withoutPlayer.buzz.secondChanceFor,
  };
  const trimmed: RoomState = {
    ...withoutPlayer,
    buzz,
    judging: withoutPlayer.judging?.playerId === playerId ? null : withoutPlayer.judging,
  };
  if (!wasHead) {
    return {
      state: trimmed,
      effects: [{ type: 'removeSession', playerId }, { type: 'persist' }],
    };
  }

  const advanced = advanceQueue(trimmed, game, now);
  return {
    state: advanced.state,
    effects: [{ type: 'removeSession', playerId }, ...advanced.effects, { type: 'persist' }],
  };
}

function handleSetTeam(state: RoomState, actor: Actor, teamId: TeamId): ReduceResult {
  const player = actingPlayer(state, actor);
  if (!player || !state.settings.teamsEnabled) return unchanged(state);
  // Switching sides mid-round would let a player move their points; between
  // rounds it is just someone sitting with their friends.
  if (roundIsLive(state)) return unchanged(state);
  return {
    state: replacePlayer(state, { ...player, teamId }),
    effects: [{ type: 'persist' }],
  };
}

// ---------------------------------------------------------------------------
// Control
// ---------------------------------------------------------------------------

/**
 * How long a request waits before the reducer decides it one way or the
 * other (§5.2 of the design): granted if nobody is attending the controller,
 * dropped otherwise.
 */
const CONTROL_REQUEST_WINDOW_MS = 45_000;

/**
 * A round value no real round ever reaches (`roundIndex` starts at `-1` and
 * only ever counts up from there), reserved for a control request's timer so
 * that it is never swept up by a round-scoped `cancelTimers` — a request is
 * about who runs the *room*, and must survive the round changing under it.
 * The tag is the requesting player's own id, which is all a control-request
 * timer ever needs to name: one request per player, so one timer per id.
 */
const CONTROL_TIMER_ROUND = -2;

/** Whether this actor *is* the room's current controller — the one thing every `HostCommand` but `reclaimControl` requires. */
function isController(state: RoomState, actor: Actor): boolean {
  if (actor.role === 'owner') return state.controller.kind === 'owner';
  if (actor.role === 'player') {
    return state.controller.kind === 'player' && state.controller.playerId === actor.playerId;
  }
  return false;
}

/**
 * A phone asking to run the room. Refused when that player already has a
 * pending request, and refused when they are already the controller —
 * asking to hold what you already hold is not a request.
 */
function handleRequestControl(state: RoomState, actor: Actor, now: ServerTime): ReduceResult {
  const player = actingPlayer(state, actor);
  if (!player) return unchanged(state);
  if (isController(state, actor)) return unchanged(state);
  if (state.controlRequests.some((request) => request.playerId === player.id)) {
    return unchanged(state);
  }
  const decidesAt = now + CONTROL_REQUEST_WINDOW_MS;
  const request = { playerId: player.id, askedAt: now, decidesAt };
  return {
    state: {
      ...state,
      controlRequests: [...state.controlRequests, request],
      // Asking again is the thing that ends a previous denial's cooldown.
      deniedControlPlayers: state.deniedControlPlayers.filter((id) => id !== player.id),
    },
    effects: [
      { type: 'timer', at: decidesAt, round: CONTROL_TIMER_ROUND, tag: player.id },
      { type: 'persist' },
    ],
  };
}

/**
 * The two-branch fire (§5.2). A request that is no longer pending — granted,
 * denied or withdrawn by the time this arrives — is a stale timer and does
 * nothing, the same way any other late timer in this room is handled: by
 * finding nothing left to act on rather than by being cancelled up front.
 *
 * `attended` is read fresh from state as it stands *now*, not as it stood
 * when the request was made, so a controller who stepped away and came back
 * before the deadline is attended again and the request simply expires.
 */
function handleControlRequestExpiry(state: RoomState, playerId: PlayerId): ReduceResult {
  if (!state.controlRequests.some((request) => request.playerId === playerId)) {
    return unchanged(state);
  }
  const attended =
    state.controller.kind === 'player'
      ? findPlayer(state, state.controller.playerId)?.connected === true
      : state.ownerPresent;

  if (attended) {
    // Nobody at the controller answered. Told the same way a denial is: the
    // player may ask again once they see it.
    return {
      state: {
        ...state,
        controlRequests: state.controlRequests.filter((request) => request.playerId !== playerId),
        deniedControlPlayers: state.deniedControlPlayers.includes(playerId)
          ? state.deniedControlPlayers
          : [...state.deniedControlPlayers, playerId],
      },
      effects: [{ type: 'persist' }],
    };
  }

  // Nobody is attending the controller at all — the one situation this timer
  // exists for. A room whose screen went to sleep otherwise has no way to
  // advance a round, ever.
  return handleGrantControl(state, playerId);
}

/** Takes back a request before it was decided. Not an error if there was none. */
function handleWithdrawControlRequest(state: RoomState, actor: Actor): ReduceResult {
  const player = actingPlayer(state, actor);
  if (!player) return unchanged(state);
  if (!state.controlRequests.some((request) => request.playerId === player.id)) {
    return unchanged(state);
  }
  return {
    state: {
      ...state,
      controlRequests: state.controlRequests.filter((request) => request.playerId !== player.id),
    },
    effects: [{ type: 'persist' }],
  };
}

/** Hands control to a player: approves a request, or moves it with no request at all. */
function handleGrantControl(state: RoomState, playerId: PlayerId): ReduceResult {
  if (!findPlayer(state, playerId)) return unchanged(state);
  return {
    state: {
      ...state,
      controller: { kind: 'player', playerId },
      // The next broadcast moves the panel to exactly one phone; every other
      // request would otherwise sit waiting on a controller who has moved on.
      controlRequests: [],
    },
    effects: [{ type: 'persist' }],
  };
}

/**
 * Turns a request down. The player's `yourControlRequest` reads `denied`
 * until they ask again — see `deniedControlPlayers`.
 */
function handleDenyControl(state: RoomState, playerId: PlayerId): ReduceResult {
  if (!state.controlRequests.some((request) => request.playerId === playerId)) {
    return unchanged(state);
  }
  return {
    state: {
      ...state,
      controlRequests: state.controlRequests.filter((request) => request.playerId !== playerId),
      deniedControlPlayers: state.deniedControlPlayers.includes(playerId)
        ? state.deniedControlPlayers
        : [...state.deniedControlPlayers, playerId],
    },
    effects: [{ type: 'persist' }],
  };
}

/** The owner credential takes control back. The one command it may always send. */
function handleReclaimControl(state: RoomState): ReduceResult {
  if (state.controller.kind === 'owner') return unchanged(state);
  return {
    state: { ...state, controller: { kind: 'owner' } },
    effects: [{ type: 'persist' }],
  };
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

function answerText(value: AnswerValue): string {
  return value.type === 'text' ? value.text : '';
}

/**
 * The opening an answer arriving now is measured from. Answers are refused
 * outside a live round, and every way into one sets the opening, so the phase
 * start is only there to keep the type honest.
 */
function openingOf(state: RoomState): ServerTime {
  return state.answeringOpenedAt ?? state.phaseStartedAt;
}

function handleAnswer(
  state: RoomState,
  actor: Actor,
  round: number,
  value: AnswerValue,
  game: GameModule,
  now: ServerTime
): ReduceResult {
  const player = actingPlayer(state, actor);
  if (!player) return unchanged(state);
  if (state.phase !== 'answering' || state.paused) return unchanged(state);
  // An answer carries the round it was written for, so a submission that was
  // in flight across a round change lands nowhere rather than on the new round.
  if (round !== state.roundIndex) return unchanged(state);
  if (state.phaseEndsAt !== null && now > state.phaseEndsAt) return unchanged(state);

  const buzz = state.buzz;
  if (buzz) {
    // Only whoever holds the buzzer may answer, and only while they hold it.
    if (buzz.queue[0]?.playerId !== player.id) return unchanged(state);
    // An attempt already in front of the host is not amendable. Replacement
    // exists for a second chance the host granted, not for a change of mind
    // typed while the room watches them deliberate.
    if (state.judging) return unchanged(state);
    return recordBuzzAnswer(state, player.id, value, now);
  }

  const current = currentRound(state);
  if (!current) return unchanged(state);
  // The game's own rules about who may send what, asked before anything is
  // kept. A refusal is silence rather than an error: a stale tap on a card that
  // has already moved on is ordinary traffic.
  if (game.accepts && !game.accepts(current, tableOf(state), player.id, value)) {
    return unchanged(state);
  }

  const entry: ReceivedAnswer = { playerId: player.id, value, at: now, openedAt: openingOf(state) };
  switch (answerPolicyOf(game)) {
    case 'latest':
      // A vote stands until it is changed, so the earlier one goes. There is no
      // early reveal: everyone being in says nothing about whether they are
      // done, and the host still has Reveal now.
      return settle(
        {
          ...state,
          answers: [...state.answers.filter((answer) => answer.playerId !== player.id), entry],
        },
        game,
        now
      );
    case 'log':
      if (state.answers.length >= MAX_LOG_ENTRIES) return unchanged(state);
      return settle({ ...state, answers: [...state.answers, entry] }, game, now);
    case 'first':
      return collectFirst(state, player.id, entry, game, now);
  }
}

function collectFirst(
  state: RoomState,
  playerId: PlayerId,
  entry: ReceivedAnswer,
  game: GameModule,
  now: ServerTime
): ReduceResult {
  // First answer stands. Last-write-wins would let a player watch the room and
  // amend, and would make "how fast were you" a question with no fixed answer;
  // a change of mind is a different game from the one being played here.
  if (state.answers.some((answer) => answer.playerId === playerId)) return unchanged(state);

  const withAnswer: RoomState = { ...state, answers: [...state.answers, entry] };

  // Nobody enjoys watching a bar run down after the last phone has buzzed in.
  const waiting = withAnswer.players.filter((candidate) => candidate.connected);
  const allIn =
    waiting.length > 0 &&
    waiting.every((candidate) =>
      withAnswer.answers.some((answer) => answer.playerId === candidate.id)
    );
  if (allIn) return enterReveal(withAnswer, game, now);

  return settle(withAnswer, game, now);
}

/**
 * Keeps an answer, and ends the round there when the game says nothing is left
 * to take — a deck played to its last card. The game answers from the round
 * and the table alone, so this stays a function of state and a replay ends the
 * round at the same answer.
 */
function settle(next: RoomState, game: GameModule, now: ServerTime): ReduceResult {
  const round = currentRound(next);
  if (round !== null && game.roundComplete?.(round, tableOf(next)) === true) {
    return enterReveal(next, game, now);
  }
  return { state: next, effects: [] };
}

/**
 * A buzz answer is not scored on arrival: it goes to the host, who has the last
 * word whether or not a provider offered an opinion. The clock stops while they
 * decide, so deliberation never eats the answerer's window.
 */
function recordBuzzAnswer(
  state: RoomState,
  playerId: PlayerId,
  value: AnswerValue,
  now: ServerTime
): ReduceResult {
  const buzz = state.buzz;
  if (!buzz) return unchanged(state);
  const charsSeen = buzz.queue[0]?.charsSeen ?? 0;

  const next: RoomState = {
    ...state,
    // A second chance replaces the earlier attempt rather than adding to it.
    answers: [
      ...state.answers.filter((answer) => answer.playerId !== playerId),
      { playerId, value, at: now, openedAt: openingOf(state) },
    ],
    buzz: { ...buzz, answerDeadline: null, secondChanceFor: null },
    phaseEndsAt: null,
    judging: {
      round: state.roundIndex,
      playerId,
      answerText: answerText(value),
      charsSeen,
      requestedAt: now,
      suggestion: null,
    },
  };

  return {
    state: next,
    effects: [
      { type: 'cancelTimers', round: state.roundIndex },
      { type: 'requestJudge', round: state.roundIndex, playerId },
    ],
  };
}

// ---------------------------------------------------------------------------
// Buzzing
// ---------------------------------------------------------------------------

function handleBuzz(
  state: RoomState,
  actor: Actor,
  round: number,
  charsSeen: number,
  tClient: ClientTime,
  now: ServerTime
): ReduceResult {
  const player = actingPlayer(state, actor);
  const buzz = state.buzz;
  if (!player || !buzz) return unchanged(state);
  if (round !== state.roundIndex || state.paused) return unchanged(state);
  if (!admitsBuzzFrom(state, buzz, player.id)) return unchanged(state);

  const entry = correctBuzz(state, player, charsSeen, tClient, now);
  return admitBuzz(state, buzz, entry, now);
}

/**
 * The rules an ordinary buzz and a host's `callOn` both have to pass: the
 * round has to still be live, and the player must not already be spent,
 * confirmed, or already in the queue. Shared so `callOn` cannot become a way
 * around a rule a player's own tap is held to.
 */
function admitsBuzzFrom(state: RoomState, buzz: BuzzState, playerId: PlayerId): boolean {
  // Once the answer is out there is nothing left to be first to.
  if (!roundIsLive(state)) return false;
  if (buzz.spent.includes(playerId)) return false;
  // A confirmed player has had the only turn worth having. Letting them back
  // in the queue would put them in front of someone still trying.
  if (buzz.confirmed?.includes(playerId)) return false;
  if (buzz.queue.some((entry) => entry.playerId === playerId)) return false;
  return true;
}

/**
 * Puts an already-timed buzz entry in the queue and freezes the stream if
 * this is the first buzz of the round — the part a player's own tap and the
 * host calling on someone share once each has produced its own `BuzzEntry`.
 */
function admitBuzz(state: RoomState, buzz: BuzzState, entry: BuzzEntry, now: ServerTime): ReduceResult {
  // The head is pinned once they have spoken: a verdict, or a second chance the
  // host granted, belongs to whoever actually answered. Without this a buzz
  // that arrived late but corrects to an earlier moment could slide in front of
  // them and collect a ruling on words it never said.
  const attemptInFlight = state.judging !== null || buzz.secondChanceFor !== null;
  const head = attemptInFlight ? buzz.queue.slice(0, 1) : [];
  // Everyone behind the head is sorted rather than appended: ordering is by when
  // the player actually pressed, so a buzz that took longer to reach the server
  // can still be ahead of one that arrived first.
  const waiting = [...buzz.queue.slice(head.length), entry].sort(
    (a, b) => a.correctedAt - b.correctedAt || a.arrivedAt - b.arrivedAt
  );
  const withEntry: RoomState = { ...state, buzz: { ...buzz, queue: [...head, ...waiting] } };

  if (state.streamFrozenAt === null) return freezeStream(withEntry, entry.charsSeen, now);
  return { state: withEntry, effects: [] };
}

/**
 * The host puts a connected player at the buzzer, standing in for that
 * player's own tap — sword drill's "the host calls on whoever found it"
 * mode. `correctedAt`/`arrivedAt` are simply `now`: there is no client clock
 * to correct for a tap that was never made, and the host calling on someone
 * is itself the moment being timed.
 */
function handleCallOn(state: RoomState, playerId: PlayerId, now: ServerTime): ReduceResult {
  const player = findPlayer(state, playerId);
  const buzz = state.buzz;
  if (!player || !player.connected || !buzz || state.paused) return unchanged(state);
  if (!admitsBuzzFrom(state, buzz, playerId)) return unchanged(state);

  const entry: BuzzEntry = { playerId, correctedAt: now, arrivedAt: now, charsSeen: 0, clamped: false };
  return admitBuzz(state, buzz, entry, now);
}

/**
 * Corrected client time, clamped to the interval between the reveal and the
 * moment the buzz arrived. Both bounds are provable: a buzz cannot honestly
 * have happened before the question appeared, and cannot have happened after
 * the server heard it. Anything outside gets pulled to the edge and flagged, so
 * a broken clock is visible rather than silently deciding a round.
 *
 * `charsSeen` is recorded but does not order the queue. It is a figure the
 * client derives and cannot be checked, and it structurally favours a phone
 * that renders late.
 */
function correctBuzz(
  state: RoomState,
  player: PlayerState,
  charsSeen: number,
  tClient: ClientTime,
  now: ServerTime
): BuzzEntry {
  // The clamping rule is borrowed rather than restated. It decides who wins a
  // buzz, so a second copy of it here would be a rule free to drift out of
  // agreement with the one the clock layer tests. Purity is the only thing
  // this reducer asks of it.
  const { correctedAt, clamped } = correctBuzzTime(
    tClient,
    player.clockOffsetMs,
    state.revealAt ?? now,
    now
  );
  return {
    playerId: player.id,
    correctedAt,
    arrivedAt: now,
    charsSeen: Math.max(0, Math.trunc(charsSeen)),
    clamped,
  };
}

/**
 * A withdrawal is not a wrong answer, so it does not spend the player's turn.
 * Re-buzzing gains nothing: the new press gets a new, later corrected time.
 */
function handleWithdraw(
  state: RoomState,
  actor: Actor,
  round: number,
  now: ServerTime
): ReduceResult {
  const player = actingPlayer(state, actor);
  const buzz = state.buzz;
  if (!player || !buzz || round !== state.roundIndex) return unchanged(state);
  // Standing down from a round that has already been answered changes nothing,
  // and acting on it would put the room back into a phase it has left.
  if (!roundIsLive(state)) return unchanged(state);
  if (!buzz.queue.some((entry) => entry.playerId === player.id)) return unchanged(state);

  const wasHead = buzz.queue[0]?.playerId === player.id;
  const queue = buzz.queue.filter((entry) => entry.playerId !== player.id);
  const withdrawn: RoomState = {
    ...state,
    buzz: {
      ...buzz,
      queue,
      secondChanceFor: buzz.secondChanceFor === player.id ? null : buzz.secondChanceFor,
    },
    judging: state.judging?.playerId === player.id ? null : state.judging,
  };
  if (!wasHead) return { state: withdrawn, effects: [] };

  return handOver(withdrawn, now);
}

/**
 * Passes the buzzer to whoever is next, with a fresh window — the previous
 * holder consumed the one anchored to the freeze. An empty queue thaws the
 * stream so the room reads on from where it stopped.
 */
function handOver(state: RoomState, now: ServerTime): ReduceResult {
  const buzz = state.buzz;
  if (!buzz) return unchanged(state);
  if (buzz.queue.length === 0) return resumeStream(state, now);

  const deadline = now + answerWindowFor(state, currentRound(state));
  const next: RoomState = {
    ...state,
    phase: 'answering',
    phaseStartedAt: now,
    phaseEndsAt: deadline,
    judging: null,
    buzz: { ...buzz, answerDeadline: deadline, secondChanceFor: null },
  };
  return {
    state: next,
    effects: [
      { type: 'cancelTimers', round: state.roundIndex },
      { type: 'timer', at: deadline, round: state.roundIndex, tag: TIMER_BUZZ_ANSWER },
    ],
  };
}

/**
 * Moves on once the previous holder is out of the queue, whether they left,
 * were retired as wrong or were confirmed.
 */
function advanceQueue(state: RoomState, game: GameModule, now: ServerTime): ReduceResult {
  const buzz = state.buzz;
  if (!buzz) return unchanged(state);
  // Someone leaving a queue that belongs to a finished round is bookkeeping,
  // not a hand-over. Passing the buzzer here would reopen the round and score
  // it a second time.
  if (!roundIsLive(state)) return unchanged(state);
  // Nothing left to read means nothing left to buzz on.
  if (buzz.queue.length === 0 && state.questionEndsAt === null) {
    return enterReveal(state, game, now);
  }
  return handOver(state, now);
}

function retireHead(state: RoomState, game: GameModule, now: ServerTime): ReduceResult {
  const buzz = state.buzz;
  const head = buzz?.queue[0];
  if (!buzz || !head) return unchanged(state);
  const spentState: RoomState = {
    ...state,
    buzz: {
      ...buzz,
      queue: buzz.queue.slice(1),
      // A wrong answer is final for this round: one bite each keeps a fast
      // guesser from monopolising the buzzer.
      spent: [...buzz.spent, head.playerId],
      secondChanceFor: null,
    },
    judging: null,
  };
  return advanceQueue(spentState, game, now);
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

const STRUCTURAL_SETTINGS: readonly (keyof RoomSettings)[] = [
  'gameId',
  'setId',
  'rounds',
  'translation',
  'solo',
  // Group voting changes how answers are collected. Switching it mid-round
  // would score answers kept under one rule by the other.
  'groupVote',
];

function mergeSettings(
  current: RoomSettings,
  patch: Partial<RoomSettings>,
  roundsBuilt: boolean
): RoomSettings {
  const merged: RoomSettings = { ...current };
  for (const [key, value] of Object.entries(patch) as [keyof RoomSettings, unknown][]) {
    if (value === undefined) continue;
    // Which game and how many rounds are decided before the rounds are built;
    // changing them afterwards would leave the room holding content for a game
    // it is no longer playing.
    if (roundsBuilt && STRUCTURAL_SETTINGS.includes(key)) continue;
    Object.assign(merged, { [key]: value });
  }
  return merged;
}

function handleHost(
  state: RoomState,
  actor: Actor,
  command: HostCommand,
  game: GameModule,
  now: ServerTime
): ReduceResult {
  // The one command the owner may always send, whoever currently controls
  // the room — it is the recovery path and nothing else (§5.1).
  if (command.cmd === 'reclaimControl') {
    if (actor.role !== 'owner') return unchanged(state);
    return handleReclaimControl(state);
  }
  // Every other command requires the actor to *be* the controller. A room
  // nobody has handed control to has `controller = { kind: 'owner' }`, which
  // makes today's owner-only behaviour a special case of this rule rather
  // than a second one.
  if (!isController(state, actor)) return unchanged(state);

  switch (command.cmd) {
    case 'start':
      if (state.phase !== 'lobby') return unchanged(state);
      return startGame(state, game, now);

    case 'pause':
      return handlePause(state, now);

    case 'resume':
      return handleResume(state, now);

    case 'skip':
      // Abandoning a round scores nobody: a question the room could not use
      // should not cost anyone points.
      if (state.roundIndex < 0) return unchanged(state);
      return enterRound(state, game, state.roundIndex + 1, now);

    case 'revealNow':
      if (!roundIsLive(state)) return unchanged(state);
      return enterReveal(state, game, now);

    case 'nextRound':
      if (state.phase === 'lobby') return unchanged(state);
      return enterRound(state, game, state.roundIndex + 1, now);

    case 'kick':
      if (!findPlayer(state, command.playerId)) return unchanged(state);
      return removePlayer(state, command.playerId, game, now);

    case 'adjust':
      return handleAdjust(state, command.playerId, command.delta);

    case 'end': {
      const ended = enterSummary(state, now);
      return {
        state: { ...ended.state, closed: true },
        effects: [...ended.effects, { type: 'closeRoom' }],
      };
    }

    case 'newGame':
      return startNewGame(state, now);

    case 'setSettings':
      return {
        state: {
          ...state,
          settings: mergeSettings(state.settings, command.settings, state.rounds.length > 0),
        },
        effects: [{ type: 'persist' }],
      };

    case 'requestFullStandings':
      // A one-off private reply, assembled by the runtime from the projection
      // built for exactly this purpose. Nothing about the room changes.
      return unchanged(state);

    case 'judge':
      return handleJudge(state, command.verdict, game, now);

    case 'choose':
      return handleChoose(state, command.choice, game, now);

    case 'callOn':
      return handleCallOn(state, command.playerId, now);

    case 'grantControl':
      return handleGrantControl(state, command.playerId);

    case 'denyControl':
      return handleDenyControl(state, command.playerId);

    // 'reclaimControl' is handled above, before the controller check, and
    // is excluded from `command`'s type here by that early return.
  }
}

/**
 * The host picks the next round and the room goes straight to it.
 *
 * Only between rounds: a choice during play would swap the question out from
 * under the people answering it. The game says which choices are open, and
 * anything else — a tile already played, one that never existed, a game that
 * takes no choices — is ignored rather than turned into a default, because a
 * host whose tap did nothing taps again, while a host whose tap started the
 * wrong question has lost it.
 */
function handleChoose(
  state: RoomState,
  choice: string,
  game: GameModule,
  now: ServerTime
): ReduceResult {
  if (state.phase !== 'reveal') return unchanged(state);
  const next = state.roundIndex + 1;
  if (next >= state.rounds.length) return unchanged(state);
  const open = game.openChoices?.(state.rounds.slice(0, next)) ?? [];
  if (!open.includes(choice)) return unchanged(state);
  return enterRound(buildRounds(state, game, next, choice), game, next, now);
}

/**
 * Ends the current game while leaving the room, and everyone in it, exactly
 * where they are. This is deliberately not `enterSummary` plus a flag: the
 * round-scoped fields it clears are the same ones a fresh room starts with,
 * and clearing `rounds` is what lets `setSettings` change `gameId` and the
 * other structural settings again (see `STRUCTURAL_SETTINGS` above) — they are
 * locked only while `rounds.length > 0`.
 *
 * Scores reset to zero. A new game is a clean slate, not a continuation of the
 * last one's standings; a host wanting to keep a running score across games
 * this round should use `end` and a fresh room instead. This is a product
 * choice made for this round, not something the prior code decided either way.
 */
function startNewGame(state: RoomState, now: ServerTime): ReduceResult {
  const next: RoomState = {
    ...state,
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
    phaseStartedAt: now,
    phaseEndsAt: null,
    revealAt: null,
    answeringOpenedAt: null,
    // Folded into `allTimeScore` before the reset, so "who came out ahead
    // overall" survives a fresh game even though the round-by-round
    // standings do not — see `overallScore` in scoring.ts.
    players: state.players.map((player) => ({
      ...player,
      score: 0,
      totalResponseMs: 0,
      allTimeScore: player.allTimeScore + player.score,
    })),
  };
  return {
    state: next,
    effects: [{ type: 'cancelTimers', round: state.roundIndex }, { type: 'persist' }],
  };
}

function handlePause(state: RoomState, now: ServerTime): ReduceResult {
  if (state.paused || !roundIsLive(state)) return unchanged(state);
  // The phase is left exactly as it was. Pausing is an overlay, so that
  // resuming puts the room back mid-sentence rather than at the start.
  return {
    state: { ...state, paused: true, pausedAt: now },
    effects: [{ type: 'cancelTimers', round: state.roundIndex }],
  };
}

function handleResume(state: RoomState, now: ServerTime): ReduceResult {
  if (!state.paused || state.pausedAt === null) return unchanged(state);
  // Every deadline moves by the length of the pause, so the round gets back
  // exactly the time it was holding when it stopped.
  const shifted = shiftTimes(state, now - state.pausedAt);
  const resumed: RoomState = {
    ...shifted,
    paused: false,
    pausedAt: null,
    streamFrozenAt:
      state.streamFrozenAt === null ? null : state.streamFrozenAt + (now - state.pausedAt),
  };
  return { state: resumed, effects: timerForPhase(resumed) };
}

function handleAdjust(state: RoomState, playerId: PlayerId, delta: number): ReduceResult {
  const player = findPlayer(state, playerId);
  if (!player || !Number.isFinite(delta)) return unchanged(state);
  return {
    state: replacePlayer(state, { ...player, score: player.score + delta }),
    effects: [{ type: 'persist' }],
  };
}

/**
 * The host adjudicates. A provider only ever offers a suggestion, so a room
 * with no provider configured plays exactly the same way.
 */
function handleJudge(
  state: RoomState,
  verdict: 'correct' | 'incorrect' | 'askToBeSpecific',
  game: GameModule,
  now: ServerTime
): ReduceResult {
  const buzz = state.buzz;
  const head = buzz?.queue[0];
  if (!buzz || !head) return unchanged(state);
  // A verdict on a round the room has already revealed is a double tap on the
  // host's screen, not an instruction to score the round again.
  if (!roundIsLive(state)) return unchanged(state);

  if (verdict === 'correct') {
    if (game.confirmsEveryBuzz) return confirmHead(state, game, now);
    return enterReveal(withVerdict(state, head.playerId, 'correct'), game, now);
  }
  if (verdict === 'incorrect') {
    return retireHead(withVerdict(state, head.playerId, 'incorrect'), game, now);
  }

  const deadline = now + secondChanceWindowFor(state, currentRound(state));
  const next: RoomState = {
    ...state,
    phase: 'answering',
    phaseStartedAt: now,
    phaseEndsAt: deadline,
    // Clearing the attempt is what lets the replacement through; the answer
    // handler otherwise stands by the first one.
    answers: state.answers.filter((answer) => answer.playerId !== head.playerId),
    judging: null,
    buzz: { ...buzz, answerDeadline: deadline, secondChanceFor: head.playerId },
  };
  return {
    state: next,
    effects: [
      { type: 'cancelTimers', round: state.roundIndex },
      { type: 'timer', at: deadline, round: state.roundIndex, tag: TIMER_BUZZ_ANSWER },
    ],
  };
}

/**
 * Puts the host's ruling on the answer it was about, so the game scoring the
 * round can tell a ruling from an answer nobody got round to.
 */
function withVerdict(
  state: RoomState,
  playerId: PlayerId,
  verdict: 'correct' | 'incorrect'
): RoomState {
  return {
    ...state,
    answers: state.answers.map((answer) =>
      answer.playerId === playerId ? { ...answer, verdict } : answer
    ),
  };
}

/**
 * One confirmation among several: the reader leaves the queue with their
 * ruling on file and the next reader is heard. When nobody is left waiting,
 * the room goes back to looking — the clock picks up where it stopped — so
 * anyone still turning pages can find it and buzz until the time runs out or
 * the host reveals.
 *
 * A confirmation needs the reader's answer to land on. Without one there is
 * nothing for the game to pay, and a double tap on the host's screen would
 * confirm the next reader before they had said a word.
 */
function confirmHead(state: RoomState, game: GameModule, now: ServerTime): ReduceResult {
  const buzz = state.buzz;
  const head = buzz?.queue[0];
  if (!buzz || !head) return unchanged(state);
  if (state.judging?.playerId !== head.playerId) return unchanged(state);

  const confirmed: RoomState = {
    ...withVerdict(state, head.playerId, 'correct'),
    buzz: {
      ...buzz,
      queue: buzz.queue.slice(1),
      confirmed: [...(buzz.confirmed ?? []), head.playerId],
      secondChanceFor: null,
    },
    judging: null,
  };
  return advanceQueue(confirmed, game, now);
}

// ---------------------------------------------------------------------------
// Timers and judging suggestions
// ---------------------------------------------------------------------------

function handleTimer(
  state: RoomState,
  actor: Actor,
  round: number,
  tag: string,
  game: GameModule,
  now: ServerTime
): ReduceResult {
  if (actor.role !== 'system') return unchanged(state);

  // A control request is about the room, not the round: it is due whether or
  // not a round is even live, and whether or not the room is paused, so it is
  // read before either of those guards rather than being subject to them.
  if (round === CONTROL_TIMER_ROUND) return handleControlRequestExpiry(state, tag);

  // A timer that outlived its round, or that fired while the room was paused,
  // is stale by definition: the phase it was scheduled for has moved on.
  if (round !== state.roundIndex || state.paused) return unchanged(state);

  if (tag === TIMER_QUESTION_END) {
    if (state.phase !== 'question') return unchanged(state);
    // A streamed question that nobody buzzed on has simply run out.
    if (state.buzz) return enterReveal({ ...state, questionEndsAt: null }, game, now);
    return openAnswering(state, now);
  }

  if (tag === TIMER_ANSWER_END) {
    if (state.phase !== 'answering' || state.buzz) return unchanged(state);
    return enterReveal(state, game, now);
  }

  if (tag === TIMER_BUZZ_ANSWER) {
    if (state.phase !== 'answering' || !state.buzz) return unchanged(state);
    // Silence is an incorrect answer. Holding the buzzer and saying nothing
    // must not be a way to run the clock out on everyone else.
    return retireHead(state, game, now);
  }

  return unchanged(state);
}

function handleJudgeSuggestion(
  state: RoomState,
  round: number,
  playerId: PlayerId,
  suggestion: JudgeSuggestion
): ReduceResult {
  const judging = state.judging;
  // A suggestion for an attempt that has already been settled is discarded
  // rather than shown against whoever holds the buzzer now.
  if (!judging || judging.round !== round || judging.playerId !== playerId) {
    return unchanged(state);
  }
  return { state: { ...state, judging: { ...judging, suggestion } }, effects: [] };
}
