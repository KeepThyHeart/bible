/**
 * Phase progression: lobby → intro → question → answering → reveal → summary.
 *
 * Two things make this worth its own module. The first is that `paused` is an
 * overlay rather than a phase, so pausing has to shift every deadline by the
 * same amount instead of replacing the phase — the round must come back exactly
 * where it left off. The second is that a buzz freezes the reading stream and a
 * failed answer thaws it, which is the same shift arithmetic applied for a
 * different reason.
 *
 * Nothing here schedules anything. A transition that wants to happen later
 * returns a `timer` effect and the scheduler fires an intent back, so a timing
 * bug reproduces as a sequence of intents in a test rather than as a flake.
 */

import type { BuzzState, Effect, ServerTime } from '../../../../src/modules/games/shared/protocol.js';
import type { GameModule, Round } from '../../../../src/modules/games/shared/games.js';
import { applyOutcome } from './scoring.js';
import { currentRound, seatsOf, seededRandom, tableOf, type RoomState } from './state.js';

export interface Transition {
  state: RoomState;
  effects: Effect[];
}

/** Tags are read back off a `timer` intent, so they are part of the seam. */
export const TIMER_QUESTION_END = 'questionEnd';
export const TIMER_ANSWER_END = 'answerEnd';
export const TIMER_BUZZ_ANSWER = 'buzzAnswer';
export const TIMER_AUTO_ADVANCE = 'autoAdvance';
export const TIMER_INTRO_END = 'introEnd';

/**
 * How long the how-to-play screen holds before the first round starts by
 * itself. The organizer can start sooner; this is the longest anyone waits.
 */
export const INTRO_MS = 8_000;

export function answerWindowFor(state: RoomState, round: Round | null): number {
  return round?.answerWindowMs ?? state.settings.answerWindowMs;
}

/**
 * A second chance is for a player who said something true but not specific
 * enough. It is deliberately short: they already know the answer or they don't.
 */
export function secondChanceWindowFor(state: RoomState, round: Round | null): number {
  return Math.round(answerWindowFor(state, round) / 2);
}

/**
 * How long a round reads before answers open, or undefined when it opens at
 * once. A buzz round always reads: its question streams, and buzzing is how it
 * stops.
 */
export function readingMsFor(game: GameModule, state: RoomState, round: Round): number | undefined {
  return game.usesBuzz ? (round.questionPhaseMs ?? answerWindowFor(state, round)) : round.questionPhaseMs;
}

/**
 * The full length of whatever is counting down now, derived from the phase
 * rather than stored beside it, so that no transition can set a deadline and
 * forget to say how long it is. After a pause or a thaw the deadline has moved
 * but the phase is the same length, which is what lets a timer bar show a
 * phase that is part-way through.
 */
export function phaseDurationOf(state: RoomState, game: GameModule): number | null {
  if (state.phaseEndsAt === null) return null;
  if (state.phase === 'intro') return INTRO_MS;
  if (state.phase === 'reveal') return state.settings.autoAdvanceMs;
  const round = currentRound(state);
  if (state.phase === 'question') {
    return round === null ? null : (readingMsFor(game, state, round) ?? null);
  }
  if (state.phase === 'answering') {
    return state.buzz?.secondChanceFor != null
      ? secondChanceWindowFor(state, round)
      : answerWindowFor(state, round);
  }
  return null;
}

function freshBuzz(game: GameModule): BuzzState {
  return {
    queue: [],
    frozenAtChars: null,
    answerDeadline: null,
    spent: [],
    secondChanceFor: null,
    ...(game.confirmsEveryBuzz ? { confirmed: [] } : {}),
  };
}

// ---------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------

/**
 * Builds the rounds from `from` to the end, keeping the ones before it, and
 * hands the first of them the host's choice if there was one.
 *
 * Everything after the chosen round is rebuilt as well, because each round is
 * built knowing the ones before it: a round built before the host chose would
 * still expect the walk the choice has just changed, and could ask the chosen
 * question a second time. Rounds not yet played have been seen by nobody, so
 * redrawing them costs nothing.
 *
 * The draws come from the room's seed and the advanced seed goes back into
 * state, so replaying the same intents — the choice among them — rebuilds the
 * same rounds.
 */
export function buildRounds(
  state: RoomState,
  game: GameModule,
  from: number,
  choice: string | null
): RoomState {
  // An open-ended game may already have built past its batch size; a host's
  // choice rebuilds what was there, not only the first batch.
  return buildRoundsTo(state, game, from, Math.max(state.settings.rounds, state.rounds.length), choice);
}

function buildRoundsTo(
  state: RoomState,
  game: GameModule,
  from: number,
  to: number,
  choice: string | null = null
): RoomState {
  const rng = seededRandom(state.rngSeed);
  const rounds: Round[] = state.rounds.slice(0, from);
  for (let index = from; index < to; index += 1) {
    rounds.push(
      game.buildRound(
        {
          settings: state.settings,
          random: rng.random,
          previous: rounds,
          choice: index === from ? choice : null,
        },
        index
      )
    );
  }
  return { ...state, rounds, rngSeed: rng.seedAfter() };
}

/**
 * Builds every round up front from the room's seed. Doing it in one go means a
 * room replayed from the same seed produces the same questions, and means a
 * game module is never called from inside a timer path — a host's choice
 * rebuilds from a host command, never from a timer.
 *
 * A group first sees how the game is played, for a fixed few seconds. A solo
 * player started the game themselves a moment ago and is waiting to play, so
 * they go straight to the first question.
 */
export function startGame(state: RoomState, game: GameModule, now: ServerTime): Transition {
  const built = buildRounds(state, game, 0, null);
  if (state.settings.solo) return enterRound(built, game, 0, now);
  return enterIntro(built, now);
}

/**
 * The how-to-play screen. It sits before round 0, so `roundIndex` is still -1
 * and its timer is keyed to that round: entering round 0 leaves it stale, and a
 * stale timer is ignored.
 */
export function enterIntro(state: RoomState, now: ServerTime): Transition {
  const endsAt = now + INTRO_MS;
  return {
    state: { ...state, phase: 'intro', phaseStartedAt: now, phaseEndsAt: endsAt },
    effects: [
      { type: 'cancelTimers', round: state.roundIndex },
      { type: 'timer', at: endsAt, round: state.roundIndex, tag: TIMER_INTRO_END },
      { type: 'persist' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Round entry
// ---------------------------------------------------------------------------

export function enterRound(
  before: RoomState,
  game: GameModule,
  index: number,
  now: ServerTime
): Transition {
  const state = extendOpenEnded(before, game, index);
  const round = state.rounds[index];
  if (!round) return enterSummary(state, now);

  const cleared: RoomState = {
    ...state,
    roundIndex: index,
    answers: [],
    // Taken as the round begins and held until the next one: a game dealing
    // from the seats needs the deal to stay put while phones come and go.
    roundSeats: seatsOf(state),
    lastOutcome: null,
    judging: null,
    streamFrozenAt: null,
    paused: false,
    pausedAt: null,
    phaseStartedAt: now,
    // The instant the content became visible. Buzz corrections clamp to it, and
    // clients convert it to their own clock to start a stream in step.
    revealAt: now,
  };

  const readingMs = readingMsFor(game, state, round);

  if (readingMs !== undefined) {
    const endsAt = now + readingMs;
    const next: RoomState = {
      ...cleared,
      phase: 'question',
      questionEndsAt: endsAt,
      phaseEndsAt: endsAt,
      buzz: game.usesBuzz ? freshBuzz(game) : null,
      // A buzz round is open from the moment the question appears; any other
      // round opens when the reading is over.
      answeringOpenedAt: game.usesBuzz ? now : null,
    };
    return {
      state: next,
      effects: [
        { type: 'cancelTimers', round: index },
        { type: 'timer', at: endsAt, round: index, tag: TIMER_QUESTION_END },
        { type: 'persist' },
      ],
    };
  }

  return openAnswering({ ...cleared, questionEndsAt: null, buzz: null }, now);
}

/** Opens the answer window for a round that needs no reading phase first. */
export function openAnswering(state: RoomState, now: ServerTime): Transition {
  const endsAt = now + answerWindowFor(state, currentRound(state));
  const next: RoomState = {
    ...state,
    phase: 'answering',
    phaseStartedAt: now,
    phaseEndsAt: endsAt,
    answeringOpenedAt: now,
  };
  return {
    state: next,
    effects: [
      { type: 'cancelTimers', round: state.roundIndex },
      { type: 'timer', at: endsAt, round: state.roundIndex, tag: TIMER_ANSWER_END },
    ],
  };
}

// ---------------------------------------------------------------------------
// Reveal and summary
// ---------------------------------------------------------------------------

/**
 * Scores the round and stops the clock. By default the reveal waits on the
 * host rather than on a timer: a leader wants to talk over it, and a room that
 * advances itself mid-sentence is worse than one that needs a tap. A room that
 * has asked for auto-advance gets a timer instead, but never after the last
 * round, where the next step is the summary and the organizer should choose
 * when the room sees it.
 */
export function enterReveal(state: RoomState, game: GameModule, now: ServerTime): Transition {
  const round = currentRound(state);
  if (!round) return enterSummary(state, now);

  // Arrival order, so a game that needs to break a tie can, and so that nothing
  // else about the ordering can leak into what a round is worth.
  const table = tableOf(state);
  const outcome = game.scoreRound(round, [...table.log], table);
  const scored = applyOutcome(state, outcome);

  const next: RoomState = {
    ...scored,
    phase: 'reveal',
    paused: false,
    pausedAt: null,
    lastOutcome: outcome,
    judging: null,
    streamFrozenAt: null,
    phaseStartedAt: now,
    phaseEndsAt: autoAdvanceDeadline(state, now),
  };
  return {
    state: next,
    effects: [
      { type: 'cancelTimers', round: state.roundIndex },
      ...timerForPhase(next),
      // Scoring is done and nothing else will change it, so this is the one
      // moment at which the public payload and every private result agree.
      { type: 'reveal', round: state.roundIndex },
      { type: 'persist' },
    ],
  };
}

/**
 * Rounds an open-ended game will ever build, so a room left running all
 * evening still ends rather than drawing on content without limit.
 */
export const OPEN_ENDED_MAX_ROUNDS = 100;

/**
 * An open-ended game builds its rounds a batch at a time, the next batch when
 * the room reaches the end of the last. Built from the room's seed exactly as
 * the first batch was, so a replay of the same intents still draws the same
 * questions, wherever in the evening it was asked for.
 */
export function extendOpenEnded(state: RoomState, game: GameModule, index: number): RoomState {
  if (!state.settings.openEnded || index < state.rounds.length) return state;
  if (state.rounds.length === 0 || state.rounds.length >= OPEN_ENDED_MAX_ROUNDS) return state;
  const batch = Math.max(1, state.settings.rounds);
  const target = Math.min(state.rounds.length + batch, OPEN_ENDED_MAX_ROUNDS);
  return buildRoundsTo(state, game, state.rounds.length, target);
}

/**
 * Back into play from the results with everything kept: the next round if one
 * is built, another batch of the room's length if not.
 */
export function continueFromSummary(state: RoomState, game: GameModule, now: ServerTime): Transition | null {
  if (state.phase !== 'summary' || state.rounds.length === 0) return null;
  const next = state.roundIndex + 1;
  const built =
    next < state.rounds.length
      ? state
      : buildRoundsTo(state, game, state.rounds.length, Math.min(state.rounds.length + Math.max(1, state.settings.rounds), OPEN_ENDED_MAX_ROUNDS));
  if (next >= built.rounds.length) return null;
  return enterRound(built, game, next, now);
}

/** True when moving on from the current round would end the game. */
export function onLastRound(state: RoomState): boolean {
  if (state.roundIndex + 1 < state.rounds.length) return false;
  return !state.settings.openEnded || state.rounds.length >= OPEN_ENDED_MAX_ROUNDS;
}

/**
 * When the reveal moves on by itself, or null when it waits for the organizer:
 * auto-advance is off, or no round is left to move on to.
 */
export function autoAdvanceDeadline(state: RoomState, now: ServerTime): ServerTime | null {
  const wait = state.settings.autoAdvanceMs;
  if (wait === null || onLastRound(state)) return null;
  return now + wait;
}

export function enterSummary(state: RoomState, now: ServerTime): Transition {
  const next: RoomState = {
    ...state,
    phase: 'summary',
    paused: false,
    pausedAt: null,
    buzz: null,
    judging: null,
    streamFrozenAt: null,
    questionEndsAt: null,
    phaseStartedAt: now,
    phaseEndsAt: null,
    revealAt: null,
    answeringOpenedAt: null,
  };
  return {
    state: next,
    effects: [{ type: 'cancelTimers', round: state.roundIndex }, { type: 'persist' }],
  };
}

// ---------------------------------------------------------------------------
// Shifting time
// ---------------------------------------------------------------------------

/**
 * Moves every deadline by the same delta. Used by resume and by thawing a
 * frozen stream: in both cases the room lost wall-clock time that the round
 * should not be charged for.
 *
 * The opening moves with them. Content paced from the opening — a clue every
 * seven seconds — is paced against the same clock as the deadline, and an
 * opening left behind would tell a game that clues appeared during a pause
 * when every screen was holding still.
 */
export function shiftTimes(state: RoomState, deltaMs: number): RoomState {
  const shift = (time: ServerTime | null): ServerTime | null =>
    time === null ? null : time + deltaMs;
  return {
    ...state,
    phaseEndsAt: shift(state.phaseEndsAt),
    questionEndsAt: shift(state.questionEndsAt),
    revealAt: shift(state.revealAt),
    answeringOpenedAt: shift(state.answeringOpenedAt),
    buzz: state.buzz ? { ...state.buzz, answerDeadline: shift(state.buzz.answerDeadline) } : null,
  };
}

/** Re-arms whatever timer the current phase is waiting on. */
export function timerForPhase(state: RoomState): Effect[] {
  if (state.phase === 'question' && state.phaseEndsAt !== null) {
    return [{ type: 'timer', at: state.phaseEndsAt, round: state.roundIndex, tag: TIMER_QUESTION_END }];
  }
  if (state.phase === 'answering' && state.phaseEndsAt !== null) {
    const tag = state.buzz ? TIMER_BUZZ_ANSWER : TIMER_ANSWER_END;
    return [{ type: 'timer', at: state.phaseEndsAt, round: state.roundIndex, tag }];
  }
  if (state.phase === 'reveal' && state.phaseEndsAt !== null) {
    return [{ type: 'timer', at: state.phaseEndsAt, round: state.roundIndex, tag: TIMER_AUTO_ADVANCE }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Freezing and thawing the reading stream
// ---------------------------------------------------------------------------

/**
 * The first buzz stops the text for the whole room, which is the point: nobody
 * reads further while someone is answering. The deadline is anchored to the
 * freeze instant rather than to whoever currently heads the queue, so a buzz
 * that arrives late but corrects to an earlier moment can take the head without
 * quietly winning extra thinking time.
 */
export function freezeStream(state: RoomState, atChars: number, now: ServerTime): Transition {
  if (!state.buzz) return { state, effects: [] };
  const deadline = now + answerWindowFor(state, currentRound(state));
  const next: RoomState = {
    ...state,
    phase: 'answering',
    streamFrozenAt: now,
    phaseStartedAt: now,
    phaseEndsAt: deadline,
    buzz: { ...state.buzz, frozenAtChars: atChars, answerDeadline: deadline },
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
 * An empty queue puts the room back where it was reading, with every deadline
 * pushed by the time the freeze consumed so that the stream resumes at the same
 * character rather than jumping ahead.
 */
export function resumeStream(state: RoomState, now: ServerTime): Transition {
  const buzz = state.buzz;
  const frozenAt = state.streamFrozenAt;
  if (!buzz || frozenAt === null || state.questionEndsAt === null) {
    return { state, effects: [] };
  }
  const shifted = shiftTimes({ ...state, phaseEndsAt: state.questionEndsAt }, now - frozenAt);
  const next: RoomState = {
    ...shifted,
    phase: 'question',
    streamFrozenAt: null,
    phaseStartedAt: now,
    judging: null,
    buzz: { ...buzz, frozenAtChars: null, answerDeadline: null, secondChanceFor: null },
  };
  return {
    state: next,
    effects: [{ type: 'cancelTimers', round: state.roundIndex }, ...timerForPhase(next)],
  };
}
