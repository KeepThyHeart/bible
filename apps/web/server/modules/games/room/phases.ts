/**
 * Phase progression: lobby → question → answering → reveal → summary.
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
  const rng = seededRandom(state.rngSeed);
  const rounds: Round[] = state.rounds.slice(0, from);
  for (let index = from; index < state.settings.rounds; index += 1) {
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
 */
export function startGame(state: RoomState, game: GameModule, now: ServerTime): Transition {
  return enterRound(buildRounds(state, game, 0, null), game, 0, now);
}

// ---------------------------------------------------------------------------
// Round entry
// ---------------------------------------------------------------------------

export function enterRound(
  state: RoomState,
  game: GameModule,
  index: number,
  now: ServerTime
): Transition {
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
 * Scores the round and stops the clock. The reveal waits on the host rather
 * than on a timer: a leader wants to talk over it, and a room that advances
 * itself mid-sentence is worse than one that needs a tap.
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
    phaseEndsAt: null,
  };
  return {
    state: next,
    effects: [
      { type: 'cancelTimers', round: state.roundIndex },
      // Scoring is done and nothing else will change it, so this is the one
      // moment at which the public payload and every private result agree.
      { type: 'reveal', round: state.roundIndex },
      { type: 'persist' },
    ],
  };
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
