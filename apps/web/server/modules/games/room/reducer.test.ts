import { describe, expect, it } from 'vitest';
import type {
  Actor,
  AddressedIntent,
  Effect,
  Intent,
  PersonalResult,
  PlayerId,
} from '../../../../src/modules/games/shared/protocol.js';
import type { GameModule, Round, RoundOutcome, ScoredAnswer } from '../../../../src/modules/games/shared/games.js';
import { reduce } from './reducer.js';
import { createRoom, withClockOffset, withConnected, type RoomState } from './state.js';

// ---------------------------------------------------------------------------
// A stand-in game
// ---------------------------------------------------------------------------

interface FakeSecret {
  answer: string;
  draw: number;
  /** What the host picked for this round, echoed so a test can see it arrive. */
  choice: string | null;
  judge: { question: string; canonicalAnswer: string; accept: string[]; contextNote: null };
}

interface FakeOptions {
  usesBuzz?: boolean;
  questionPhaseMs?: number;
  answerWindowMs?: number;
  confirmsEveryBuzz?: boolean;
  /** Choices the host may make, each usable once per game. */
  choices?: readonly string[];
}

/**
 * The room must work against any game, so the tests use one that does nothing
 * but echo a known answer. Anything the state machine gets right here it gets
 * right for a real game, because a real game reaches it through the same two
 * methods.
 */
function fakeGame(options: FakeOptions = {}): GameModule {
  const choices = options.choices;
  return {
    id: 'echo',
    name: 'Echo',
    supportsSolo: true,
    usesBuzz: options.usesBuzz ?? false,
    ...(options.confirmsEveryBuzz === undefined ? {} : { confirmsEveryBuzz: options.confirmsEveryBuzz }),
    ...(choices === undefined
      ? {}
      : {
          openChoices: (previous: readonly Round[]): string[] => {
            const used = new Set(previous.map((round) => (round.secret as FakeSecret).choice));
            return choices.filter((choice) => !used.has(choice));
          },
        }),
    buildRound(context, index): Round<FakeSecret> {
      const draw = context.random();
      const answer = `answer-${index}`;
      const round: Round<FakeSecret> = {
        index,
        secret: {
          answer,
          draw,
          choice: context.choice,
          judge: {
            question: 'Who was the mother-in-law of Ruth?',
            canonicalAnswer: answer,
            accept: [answer],
            contextNote: null,
          },
        },
        hostView: { prompt: `prompt-${index}`, answer },
        playerView: { prompt: `prompt-${index}` },
      };
      if (options.questionPhaseMs !== undefined) round.questionPhaseMs = options.questionPhaseMs;
      if (options.answerWindowMs !== undefined) round.answerWindowMs = options.answerWindowMs;
      return round;
    },
    scoreRound(round: Round<FakeSecret>, answers: ScoredAnswer[]): RoundOutcome {
      const perPlayer = new Map<PlayerId, PersonalResult>();
      let correctCount = 0;
      for (const answer of answers) {
        const correct = answer.value.type === 'text' && answer.value.text === round.secret.answer;
        if (correct) correctCount += 1;
        perPlayer.set(answer.playerId, {
          correct,
          pointsAwarded: correct ? 10 : 0,
          submitted: answer.value,
          note: null,
        });
      }
      return {
        perPlayer,
        aggregates: [{ label: round.secret.answer, count: correctCount }],
        correctLabel: round.secret.answer,
        detail: null,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const HOST: Actor = { role: 'owner' };
const SYSTEM: Actor = { role: 'system' };
const asPlayer = (playerId: PlayerId): Actor => ({ role: 'player', playerId });

function newRoom(overrides: Partial<Parameters<typeof createRoom>[0]> = {}): RoomState {
  return createRoom({
    code: 'ABCD',
    now: 1_000,
    seed: 7,
    ...overrides,
  });
}

interface Step {
  actor: Actor;
  intent: Intent;
  at: number;
}

function step(state: RoomState, game: GameModule, s: Step): { state: RoomState; effects: Effect[] } {
  const addressed: AddressedIntent = { actor: s.actor, intent: s.intent, receivedAt: s.at };
  return reduce(state, addressed, game);
}

/** Runs a sequence and keeps only the final state, for setting a scene up. */
function run(state: RoomState, game: GameModule, steps: Step[]): RoomState {
  return steps.reduce((current, s) => step(current, game, s).state, state);
}

function join(playerId: PlayerId, at: number, name = playerId): Step {
  return { actor: asPlayer(playerId), intent: { kind: 'join', name }, at };
}

function host(command: Extract<Intent, { kind: 'host' }>['command'], at: number): Step {
  return { actor: HOST, intent: { kind: 'host', command }, at };
}

function answer(playerId: PlayerId, round: number, text: string, at: number): Step {
  return {
    actor: asPlayer(playerId),
    intent: { kind: 'answer', round, value: { type: 'text', text } },
    at,
  };
}

function buzz(playerId: PlayerId, round: number, charsSeen: number, tClient: number, at: number): Step {
  return { actor: asPlayer(playerId), intent: { kind: 'buzz', round, charsSeen, tClient }, at };
}

function timer(round: number, tag: string, at: number): Step {
  return { actor: SYSTEM, intent: { kind: 'timer', round, tag }, at };
}

function scoreOf(state: RoomState, playerId: PlayerId): number {
  return state.players.find((player) => player.id === playerId)?.score ?? 0;
}

// ---------------------------------------------------------------------------

describe('roster', () => {
  it('adds a joining player with no score and no team', () => {
    const game = fakeGame();
    const state = run(newRoom(), game, [join('alice', 1_100)]);
    expect(state.players).toHaveLength(1);
    expect(state.players[0]).toMatchObject({
      id: 'alice',
      name: 'alice',
      score: 0,
      connected: true,
      teamId: null,
    });
  });

  it('disambiguates a second player who joins with the same name', () => {
    const game = fakeGame();
    const state = run(newRoom(), game, [
      join('p1', 1_100, 'Dave'),
      join('p2', 1_101, 'Dave'),
      join('p3', 1_102, 'dave'),
    ]);
    // Disambiguation preserves what each player actually typed; only the
    // comparison that decides a collision is case-insensitive.
    expect(state.players.map((player) => player.name)).toEqual(['Dave', 'Dave (2)', 'dave (3)']);
  });

  it('does not disambiguate a rejoin restoring its own existing name', () => {
    const game = fakeGame();
    const joined = run(newRoom(), game, [join('p1', 1_100, 'Dave')]);
    const rejoined = run(
      withConnected(joined, 'p1', false),
      game,
      [join('p1', 1_200, 'Dave')]
    );
    expect(rejoined.players.map((player) => player.name)).toEqual(['Dave']);
  });

  it('mints an identifier from the seed when the caller supplies none', () => {
    const game = fakeGame();
    const first = run(newRoom(), game, [
      { actor: SYSTEM, intent: { kind: 'join', name: 'Ruth' }, at: 1_100 },
    ]);
    const second = run(newRoom(), game, [
      { actor: SYSTEM, intent: { kind: 'join', name: 'Ruth' }, at: 1_100 },
    ]);
    expect(first.players[0]?.id).toBeTruthy();
    expect(first.players[0]?.id).toBe(second.players[0]?.id);
    expect(first.rngSeed).not.toBe(newRoom().rngSeed);
  });

  it('places joiners on the emptiest team when teams are on', () => {
    const game = fakeGame();
    const state = run(newRoom({ settings: { teamsEnabled: true } }), game, [
      join('a', 1_100),
      join('b', 1_101),
      join('c', 1_102),
      join('d', 1_103),
      join('e', 1_104),
    ]);
    expect(state.players.map((player) => player.teamId)).toEqual([
      'red',
      'blue',
      'green',
      'gold',
      'red',
    ]);
  });

  it('refuses a team change while the round is live', () => {
    const game = fakeGame();
    const started = run(newRoom({ settings: { teamsEnabled: true, rounds: 2 } }), game, [
      join('alice', 1_100),
      host({ cmd: 'start' }, 2_000),
    ]);
    const attempted = step(started, game, {
      actor: asPlayer('alice'),
      intent: { kind: 'setTeam', teamId: 'gold' },
      at: 2_100,
    }).state;
    expect(attempted.players[0]?.teamId).toBe(started.players[0]?.teamId);
  });

  it('removes a player who deliberately leaves', () => {
    const game = fakeGame();
    const state = run(newRoom(), game, [
      join('alice', 1_100),
      join('bob', 1_101),
      { actor: asPlayer('bob'), intent: { kind: 'leave' }, at: 1_200 },
    ]);
    expect(state.players.map((player) => player.id)).toEqual(['alice']);
  });

  it('leaves the room untouched when it did not act', () => {
    const game = fakeGame();
    const before = run(newRoom(), game, [join('alice', 1_100)]);
    const snapshot = JSON.stringify(before);
    step(before, game, { actor: asPlayer('nobody'), intent: { kind: 'rejoin' }, at: 1_500 });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('rejoin', () => {
  it('restores the same player with the same score after a dropped stream', () => {
    const game = fakeGame();
    const played = run(newRoom({ settings: { rounds: 2, teamsEnabled: true } }), game, [
      join('alice', 1_100),
      join('bob', 1_101),
      host({ cmd: 'start' }, 2_000),
      answer('alice', 0, 'answer-0', 2_100),
      answer('bob', 0, 'nope', 2_200),
    ]);
    expect(played.phase).toBe('reveal');
    const scoreBefore = scoreOf(played, 'alice');
    const teamBefore = played.players.find((player) => player.id === 'alice')?.teamId;
    expect(scoreBefore).toBe(10);

    const dropped = withConnected(played, 'alice', false);
    const back = step(dropped, game, {
      actor: asPlayer('alice'),
      intent: { kind: 'rejoin' },
      at: 5_000,
    }).state;

    const alice = back.players.find((player) => player.id === 'alice');
    expect(back.players).toHaveLength(2);
    expect(alice?.id).toBe('alice');
    expect(alice?.connected).toBe(true);
    expect(alice?.score).toBe(scoreBefore);
    expect(alice?.teamId).toBe(teamBefore);
    expect(back.phase).toBe('reveal');
  });

  it('restores rather than duplicating when the returning phone sends a join', () => {
    const game = fakeGame();
    const played = run(newRoom(), game, [
      join('alice', 1_100),
      host({ cmd: 'adjust', playerId: 'alice', delta: 25 }, 1_200),
    ]);
    const dropped = withConnected(played, 'alice', false);
    const back = run(dropped, game, [join('alice', 5_000, 'Alice')]);
    expect(back.players).toHaveLength(1);
    expect(back.players[0]?.score).toBe(25);
    expect(back.players[0]?.name).toBe('Alice');
    expect(back.players[0]?.connected).toBe(true);
  });

  it('ignores a rejoin from someone the room has never seen', () => {
    const game = fakeGame();
    const state = run(newRoom(), game, [
      join('alice', 1_100),
      { actor: asPlayer('ghost'), intent: { kind: 'rejoin' }, at: 1_200 },
    ]);
    expect(state.players).toHaveLength(1);
  });
});

describe('answering', () => {
  const twoPlayers = (game: GameModule): RoomState =>
    run(newRoom({ settings: { rounds: 3 } }), game, [
      join('alice', 1_100),
      join('bob', 1_101),
      join('cleo', 1_102),
      host({ cmd: 'start' }, 2_000),
    ]);

  it('stands by the first answer and rejects a second', () => {
    const game = fakeGame();
    const state = run(twoPlayers(game), game, [
      answer('alice', 0, 'answer-0', 2_100),
      answer('alice', 0, 'a different mind', 2_200),
    ]);
    expect(state.answers).toHaveLength(1);
    expect(state.answers[0]?.value).toEqual({ type: 'text', text: 'answer-0' });
    expect(state.answers[0]?.at).toBe(2_100);
  });

  it('rejects an answer addressed to another round', () => {
    const game = fakeGame();
    const state = run(twoPlayers(game), game, [answer('alice', 1, 'answer-0', 2_100)]);
    expect(state.answers).toHaveLength(0);
  });

  it('rejects an answer that arrives after the window closed', () => {
    const game = fakeGame();
    const started = twoPlayers(game);
    const late = (started.phaseEndsAt ?? 0) + 1;
    const state = run(started, game, [answer('alice', 0, 'answer-0', late)]);
    expect(state.answers).toHaveLength(0);
  });

  it('reveals as soon as every connected player is in', () => {
    const game = fakeGame();
    const state = run(twoPlayers(game), game, [
      answer('alice', 0, 'answer-0', 2_100),
      answer('bob', 0, 'answer-0', 2_150),
      answer('cleo', 0, 'wrong', 2_200),
    ]);
    expect(state.phase).toBe('reveal');
    expect(scoreOf(state, 'alice')).toBe(10);
    expect(scoreOf(state, 'cleo')).toBe(0);
  });

  it('scores everyone in the window the same, whatever their speed', () => {
    const game = fakeGame();
    const state = run(twoPlayers(game), game, [
      answer('alice', 0, 'answer-0', 2_010),
      answer('bob', 0, 'answer-0', 2_900),
      answer('cleo', 0, 'answer-0', 3_900),
    ]);
    expect(scoreOf(state, 'alice')).toBe(scoreOf(state, 'bob'));
    expect(scoreOf(state, 'bob')).toBe(scoreOf(state, 'cleo'));
  });

  it('closes the round when the answer timer fires', () => {
    const game = fakeGame();
    const started = twoPlayers(game);
    const result = step(started, game, {
      actor: SYSTEM,
      intent: { kind: 'timer', round: 0, tag: 'answerEnd' },
      at: started.phaseEndsAt ?? 0,
    });
    expect(result.state.phase).toBe('reveal');
  });

  it('ignores a timer belonging to a round that has moved on', () => {
    const game = fakeGame();
    const started = twoPlayers(game);
    const result = step(started, game, timer(2, 'answerEnd', 3_000));
    expect(result.state.phase).toBe('answering');
  });
});

describe('pausing', () => {
  const started = (game: GameModule): RoomState =>
    run(newRoom({ settings: { rounds: 2, answerWindowMs: 20_000 } }), game, [
      join('alice', 1_100),
      join('bob', 1_101),
      host({ cmd: 'start' }, 2_000),
    ]);

  it('keeps the phase and gives the time back on resume', () => {
    const game = fakeGame();
    const live = started(game);
    expect(live.phase).toBe('answering');
    const endsAt = live.phaseEndsAt ?? 0;

    const paused = step(live, game, host({ cmd: 'pause' }, 5_000));
    expect(paused.state.phase).toBe('answering');
    expect(paused.state.paused).toBe(true);
    expect(paused.state.phaseEndsAt).toBe(endsAt);
    expect(paused.effects).toContainEqual({ type: 'cancelTimers', round: 0 });

    const resumed = step(paused.state, game, host({ cmd: 'resume' }, 9_000));
    expect(resumed.state.phase).toBe('answering');
    expect(resumed.state.paused).toBe(false);
    expect(resumed.state.phaseEndsAt).toBe(endsAt + 4_000);
    expect(resumed.effects).toContainEqual({
      type: 'timer',
      at: endsAt + 4_000,
      round: 0,
      tag: 'answerEnd',
    });
  });

  it('refuses answers while paused and accepts them again afterwards', () => {
    const game = fakeGame();
    const paused = run(started(game), game, [host({ cmd: 'pause' }, 5_000)]);
    expect(run(paused, game, [answer('alice', 0, 'answer-0', 6_000)]).answers).toHaveLength(0);

    const resumed = run(paused, game, [
      host({ cmd: 'resume' }, 9_000),
      answer('alice', 0, 'answer-0', 9_100),
    ]);
    expect(resumed.answers).toHaveLength(1);
  });

  it('ignores a timer that fires while the room is paused', () => {
    const game = fakeGame();
    const paused = run(started(game), game, [host({ cmd: 'pause' }, 5_000)]);
    const result = step(paused, game, timer(0, 'answerEnd', paused.phaseEndsAt ?? 0));
    expect(result.state.phase).toBe('answering');
    expect(result.state.paused).toBe(true);
  });
});

describe('buzzing', () => {
  const buzzGame = (): GameModule => fakeGame({ usesBuzz: true, questionPhaseMs: 30_000 });

  function reading(game: GameModule): RoomState {
    return run(newRoom({ settings: { rounds: 2, answerWindowMs: 10_000 } }), game, [
      join('alice', 1_100),
      join('bob', 1_101),
      join('cleo', 1_102),
      host({ cmd: 'start' }, 2_000),
    ]);
  }

  it('opens a round as a reading phase with a reveal instant to sync to', () => {
    const game = buzzGame();
    const state = reading(game);
    expect(state.phase).toBe('question');
    expect(state.revealAt).toBe(2_000);
    expect(state.buzz?.queue).toEqual([]);
  });

  it('orders the queue by corrected time rather than by arrival', () => {
    const game = buzzGame();
    // Bob's phone is a second behind the server; his buzz is also slower to
    // arrive, and neither fact is allowed to cost him the buzzer.
    const synced = withClockOffset(reading(game), 'bob', 1_000);
    const state = run(synced, game, [
      buzz('alice', 0, 40, 2_500, 2_520),
      buzz('bob', 0, 30, 1_400, 2_800),
    ]);
    expect(state.buzz?.queue.map((entry) => entry.playerId)).toEqual(['bob', 'alice']);
    expect(state.buzz?.queue[0]?.correctedAt).toBe(2_400);
    expect(state.buzz?.queue[0]?.arrivedAt).toBe(2_800);
    // Neither buzz had to be pulled to an edge. The flag is only worth
    // anything if it tells this case apart from one that was clamped.
    expect(state.buzz?.queue.every((entry) => !entry.clamped)).toBe(true);
  });

  it('records how much was read without letting it decide the queue', () => {
    const game = buzzGame();
    const state = run(reading(game), game, [
      buzz('alice', 0, 10, 2_600, 2_620),
      buzz('bob', 0, 99, 2_400, 2_640),
    ]);
    expect(state.buzz?.queue.map((entry) => entry.playerId)).toEqual(['bob', 'alice']);
    expect(state.buzz?.queue.map((entry) => entry.charsSeen)).toEqual([99, 10]);
  });

  it('clamps a timestamp from before the question and flags it', () => {
    const game = buzzGame();
    const state = run(reading(game), game, [buzz('alice', 0, 20, 1, 2_500)]);
    expect(state.buzz?.queue[0]?.correctedAt).toBe(2_000);
    expect(state.buzz?.queue[0]?.clamped).toBe(true);
  });

  it('clamps a timestamp from after the buzz arrived and flags it', () => {
    const game = buzzGame();
    const state = run(reading(game), game, [buzz('alice', 0, 20, 9_999_999, 2_500)]);
    expect(state.buzz?.queue[0]?.correctedAt).toBe(2_500);
    expect(state.buzz?.queue[0]?.clamped).toBe(true);
  });

  it('freezes the stream for the whole room on the first buzz', () => {
    const game = buzzGame();
    const result = step(reading(game), game, buzz('alice', 0, 42, 2_400, 2_420));
    expect(result.state.phase).toBe('answering');
    expect(result.state.buzz?.frozenAtChars).toBe(42);
    expect(result.state.buzz?.answerDeadline).toBe(12_420);
    expect(result.effects).toContainEqual({
      type: 'timer',
      at: 12_420,
      round: 0,
      tag: 'buzzAnswer',
    });
  });

  it('still queues a later buzz while the stream is frozen', () => {
    const game = buzzGame();
    const state = run(reading(game), game, [
      buzz('alice', 0, 42, 2_400, 2_420),
      buzz('bob', 0, 44, 2_450, 2_480),
    ]);
    expect(state.buzz?.queue).toHaveLength(2);
    expect(state.buzz?.frozenAtChars).toBe(42);
  });

  describe('the host calling a player onto the buzzer', () => {
    it('puts them at the head and freezes the stream, the same as their own buzz would', () => {
      const game = buzzGame();
      const result = step(reading(game), game, host({ cmd: 'callOn', playerId: 'alice' }, 2_500));
      expect(result.state.buzz?.queue.map((entry) => entry.playerId)).toEqual(['alice']);
      expect(result.state.buzz?.queue[0]?.correctedAt).toBe(2_500);
      expect(result.state.buzz?.queue[0]?.clamped).toBe(false);
      expect(result.state.phase).toBe('answering');
      expect(result.state.buzz?.frozenAtChars).toBe(0);
    });

    it('queues behind whoever the room is already listening to', () => {
      const game = buzzGame();
      const buzzed = run(reading(game), game, [buzz('alice', 0, 10, 2_400, 2_420)]);
      const state = run(buzzed, game, [host({ cmd: 'callOn', playerId: 'bob' }, 2_500)]);
      expect(state.buzz?.queue.map((entry) => entry.playerId)).toEqual(['alice', 'bob']);
    });

    it('refuses a player who is not connected', () => {
      const game = buzzGame();
      const state = step(reading(game), game, host({ cmd: 'callOn', playerId: 'nobody' }, 2_500)).state;
      expect(state.buzz?.queue).toEqual([]);
    });

    it('refuses a player already in the queue, spent, or confirmed — the same rules a buzz follows', () => {
      const game = buzzGame();
      const alreadyQueued = run(reading(game), game, [buzz('alice', 0, 10, 2_400, 2_420)]);
      const state = step(
        alreadyQueued,
        game,
        host({ cmd: 'callOn', playerId: 'alice' }, 2_500)
      ).state;
      expect(state.buzz?.queue).toHaveLength(1);
    });

    it('does nothing while the room is paused', () => {
      const game = buzzGame();
      const paused = run(reading(game), game, [host({ cmd: 'pause' }, 2_200)]);
      const state = step(paused, game, host({ cmd: 'callOn', playerId: 'alice' }, 2_500)).state;
      expect(state.buzz?.queue).toEqual([]);
    });
  });

  it('sends a typed buzz answer to the host rather than scoring it', () => {
    const game = buzzGame();
    const buzzed = run(reading(game), game, [buzz('alice', 0, 42, 2_400, 2_420)]);
    const result = step(buzzed, game, answer('alice', 0, 'answer-0', 3_000));
    expect(result.effects).toContainEqual({ type: 'requestJudge', round: 0, playerId: 'alice' });
    expect(result.state.phase).toBe('answering');
    expect(result.state.judging?.playerId).toBe('alice');
    expect(scoreOf(result.state, 'alice')).toBe(0);
  });

  it('refuses an answer from anyone but the player holding the buzzer', () => {
    const game = buzzGame();
    const buzzed = run(reading(game), game, [
      buzz('alice', 0, 42, 2_400, 2_420),
      buzz('bob', 0, 44, 2_450, 2_480),
    ]);
    const state = run(buzzed, game, [answer('bob', 0, 'answer-0', 3_000)]);
    expect(state.answers).toHaveLength(0);
  });

  it('passes down the queue over several wrong answers and then resumes the stream', () => {
    const game = buzzGame();
    const queued = run(reading(game), game, [
      buzz('alice', 0, 40, 2_400, 2_420),
      buzz('bob', 0, 41, 2_430, 2_450),
      buzz('cleo', 0, 42, 2_460, 2_470),
    ]);
    expect(queued.buzz?.queue.map((entry) => entry.playerId)).toEqual(['alice', 'bob', 'cleo']);

    const afterFirst = run(queued, game, [host({ cmd: 'judge', verdict: 'incorrect' }, 4_000)]);
    expect(afterFirst.buzz?.queue.map((entry) => entry.playerId)).toEqual(['bob', 'cleo']);
    expect(afterFirst.buzz?.spent).toEqual(['alice']);
    expect(afterFirst.buzz?.answerDeadline).toBe(14_000);

    const afterSecond = run(afterFirst, game, [host({ cmd: 'judge', verdict: 'incorrect' }, 5_000)]);
    expect(afterSecond.buzz?.queue.map((entry) => entry.playerId)).toEqual(['cleo']);
    expect(afterSecond.buzz?.spent).toEqual(['alice', 'bob']);
    expect(afterSecond.phase).toBe('answering');

    const afterThird = step(afterSecond, game, host({ cmd: 'judge', verdict: 'incorrect' }, 6_000));
    expect(afterThird.state.phase).toBe('question');
    expect(afterThird.state.buzz?.queue).toEqual([]);
    expect(afterThird.state.buzz?.frozenAtChars).toBeNull();
    expect(afterThird.state.buzz?.answerDeadline).toBeNull();
    // The stream picks up where it stopped: the reading phase is pushed on by
    // exactly the time the freeze consumed.
    expect(afterThird.state.revealAt).toBe(2_000 + (6_000 - 2_420));
    expect(afterThird.state.questionEndsAt).toBe(32_000 + (6_000 - 2_420));
    expect(afterThird.effects).toContainEqual({
      type: 'timer',
      at: 32_000 + (6_000 - 2_420),
      round: 0,
      tag: 'questionEnd',
    });
  });

  it('refuses a second buzz from a player who already answered wrong', () => {
    const game = buzzGame();
    const spent = run(reading(game), game, [
      buzz('alice', 0, 40, 2_400, 2_420),
      host({ cmd: 'judge', verdict: 'incorrect' }, 4_000),
    ]);
    const retried = run(spent, game, [buzz('alice', 0, 60, 5_000, 5_020)]);
    expect(retried.buzz?.queue).toEqual([]);
  });

  it('ends the round when the holder of the buzzer says nothing at all', () => {
    const game = buzzGame();
    const buzzed = run(reading(game), game, [buzz('alice', 0, 40, 2_400, 2_420)]);
    const expired = step(buzzed, game, timer(0, 'buzzAnswer', buzzed.buzz?.answerDeadline ?? 0));
    expect(expired.state.buzz?.spent).toEqual(['alice']);
    expect(expired.state.phase).toBe('question');
  });

  it('gives a second chance without spending the turn', () => {
    const game = buzzGame();
    const answered = run(reading(game), game, [
      buzz('alice', 0, 40, 2_400, 2_420),
      answer('alice', 0, 'a woman', 3_000),
    ]);
    const specific = run(answered, game, [
      host({ cmd: 'judge', verdict: 'askToBeSpecific' }, 3_500),
    ]);
    expect(specific.buzz?.secondChanceFor).toBe('alice');
    expect(specific.buzz?.spent).toEqual([]);
    expect(specific.answers).toHaveLength(0);
    expect(specific.buzz?.answerDeadline).toBe(3_500 + 5_000);

    const replaced = run(specific, game, [answer('alice', 0, 'answer-0', 4_000)]);
    expect(replaced.answers).toHaveLength(1);
    expect(replaced.answers[0]?.value).toEqual({ type: 'text', text: 'answer-0' });
  });

  it('scores the round when the host rules the answer correct', () => {
    const game = buzzGame();
    const answered = run(reading(game), game, [
      buzz('alice', 0, 40, 2_400, 2_420),
      answer('alice', 0, 'answer-0', 3_000),
    ]);
    const ruled = run(answered, game, [host({ cmd: 'judge', verdict: 'correct' }, 3_500)]);
    expect(ruled.phase).toBe('reveal');
    expect(scoreOf(ruled, 'alice')).toBe(10);
  });

  it('withdraws without spending the turn and resumes the stream', () => {
    const game = buzzGame();
    const buzzed = run(reading(game), game, [buzz('alice', 0, 40, 2_400, 2_420)]);
    const withdrawn = run(buzzed, game, [
      { actor: asPlayer('alice'), intent: { kind: 'withdraw', round: 0 }, at: 3_000 },
    ]);
    expect(withdrawn.buzz?.queue).toEqual([]);
    expect(withdrawn.buzz?.spent).toEqual([]);
    expect(withdrawn.phase).toBe('question');

    const again = run(withdrawn, game, [buzz('alice', 0, 55, 4_000, 4_020)]);
    expect(again.buzz?.queue.map((entry) => entry.playerId)).toEqual(['alice']);
  });

  it('hands the buzzer on when the player at the head withdraws', () => {
    const game = buzzGame();
    const queued = run(reading(game), game, [
      buzz('alice', 0, 40, 2_400, 2_420),
      buzz('bob', 0, 41, 2_430, 2_450),
    ]);
    const withdrawn = run(queued, game, [
      { actor: asPlayer('alice'), intent: { kind: 'withdraw', round: 0 }, at: 3_000 },
    ]);
    expect(withdrawn.buzz?.queue.map((entry) => entry.playerId)).toEqual(['bob']);
    expect(withdrawn.phase).toBe('answering');
    expect(withdrawn.buzz?.answerDeadline).toBe(13_000);
  });

  it('ignores a buzz once the answer has been revealed', () => {
    const game = buzzGame();
    const revealed = run(reading(game), game, [host({ cmd: 'revealNow' }, 3_000)]);
    expect(revealed.phase).toBe('reveal');
    const late = run(revealed, game, [buzz('alice', 0, 40, 3_100, 3_120)]);
    expect(late.buzz?.queue ?? []).toEqual([]);
  });

  it('reveals when the reading runs out with nobody buzzing', () => {
    const game = buzzGame();
    const state = reading(game);
    const expired = step(state, game, timer(0, 'questionEnd', 32_000));
    expect(expired.state.phase).toBe('reveal');
  });

  it('keeps a suggestion only for the attempt it was asked about', () => {
    const game = buzzGame();
    const answered = run(reading(game), game, [
      buzz('alice', 0, 40, 2_400, 2_420),
      answer('alice', 0, 'a woman', 3_000),
    ]);
    const matched = run(answered, game, [
      {
        actor: SYSTEM,
        intent: {
          kind: 'judgeSuggestion',
          round: 0,
          playerId: 'alice',
          suggestion: { verdict: 'ambiguous', reason: 'too general' },
        },
        at: 3_100,
      },
    ]);
    expect(matched.judging?.suggestion?.verdict).toBe('ambiguous');

    const stale = run(answered, game, [
      {
        actor: SYSTEM,
        intent: {
          kind: 'judgeSuggestion',
          round: 0,
          playerId: 'bob',
          suggestion: { verdict: 'correct', reason: 'stale' },
        },
        at: 3_100,
      },
    ]);
    expect(stale.judging?.suggestion).toBeNull();
  });

  it('leaves the buzzer with whoever answered when a later buzz corrects earlier', () => {
    const game = buzzGame();
    const answered = run(reading(game), game, [
      buzz('alice', 0, 40, 2_400, 2_420),
      answer('alice', 0, 'a woman', 3_000),
    ]);
    // Bob pressed before Alice by his own clock, but his buzz only reached the
    // server after she had spoken. The verdict has to land on her.
    const late = run(answered, game, [buzz('bob', 0, 30, 2_350, 3_100)]);
    expect(late.buzz?.queue.map((entry) => entry.playerId)).toEqual(['alice', 'bob']);
    expect(late.judging?.playerId).toBe('alice');

    const ruled = run(late, game, [host({ cmd: 'judge', verdict: 'incorrect' }, 3_500)]);
    expect(ruled.buzz?.spent).toEqual(['alice']);
    expect(ruled.buzz?.queue.map((entry) => entry.playerId)).toEqual(['bob']);
  });

  it('keeps the buzzer with the player granted a second chance', () => {
    const game = buzzGame();
    const specific = run(reading(game), game, [
      buzz('alice', 0, 40, 2_400, 2_420),
      answer('alice', 0, 'a woman', 3_000),
      host({ cmd: 'judge', verdict: 'askToBeSpecific' }, 3_500),
    ]);
    const late = run(specific, game, [buzz('bob', 0, 30, 2_350, 3_600)]);
    expect(late.buzz?.queue.map((entry) => entry.playerId)).toEqual(['alice', 'bob']);

    const replaced = run(late, game, [answer('alice', 0, 'answer-0', 3_700)]);
    expect(replaced.answers.map((entry) => entry.playerId)).toEqual(['alice']);
    expect(replaced.answers[0]?.value).toEqual({ type: 'text', text: 'answer-0' });
  });

  it('sorts a late buzz among the players still waiting', () => {
    const game = buzzGame();
    const answered = run(reading(game), game, [
      buzz('alice', 0, 40, 2_400, 2_420),
      buzz('cleo', 0, 44, 2_600, 2_620),
      answer('alice', 0, 'a woman', 3_000),
    ]);
    const late = run(answered, game, [buzz('bob', 0, 42, 2_500, 3_100)]);
    expect(late.buzz?.queue.map((entry) => entry.playerId)).toEqual(['alice', 'bob', 'cleo']);
  });

  it('refuses a change of mind while the host is reading the answer', () => {
    const game = buzzGame();
    const answered = run(reading(game), game, [
      buzz('alice', 0, 40, 2_400, 2_420),
      answer('alice', 0, 'a woman', 3_000),
    ]);
    const amended = run(answered, game, [answer('alice', 0, 'answer-0', 3_100)]);
    expect(amended.answers).toHaveLength(1);
    expect(amended.answers[0]?.value).toEqual({ type: 'text', text: 'a woman' });
    expect(amended.judging?.answerText).toBe('a woman');
  });
});

/**
 * A round that has reached the reveal is finished. Everything below is the same
 * shape of mistake: an intent about the buzz queue arriving late must not pull
 * a settled round back open, because the room has already scored it and moved
 * the screen on.
 */
describe('a settled round', () => {
  const buzzGame = (): GameModule => fakeGame({ usesBuzz: true, questionPhaseMs: 30_000 });

  function revealed(game: GameModule): RoomState {
    return run(newRoom({ settings: { rounds: 2, answerWindowMs: 10_000 } }), game, [
      join('alice', 1_100),
      join('bob', 1_101),
      host({ cmd: 'start' }, 2_000),
      buzz('alice', 0, 40, 2_400, 2_420),
      buzz('bob', 0, 41, 2_430, 2_450),
      answer('alice', 0, 'answer-0', 3_000),
      host({ cmd: 'judge', verdict: 'correct' }, 3_500),
    ]);
  }

  it('is not reopened by a withdrawal', () => {
    const game = buzzGame();
    const settled = revealed(game);
    expect(settled.phase).toBe('reveal');
    const after = run(settled, game, [
      { actor: asPlayer('alice'), intent: { kind: 'withdraw', round: 0 }, at: 4_000 },
    ]);
    expect(after.phase).toBe('reveal');
    expect(scoreOf(after, 'alice')).toBe(10);
  });

  it('is not reopened by a player leaving the queue', () => {
    const game = buzzGame();
    const after = run(revealed(game), game, [
      { actor: asPlayer('alice'), intent: { kind: 'leave' }, at: 4_000 },
    ]);
    expect(after.phase).toBe('reveal');
    expect(after.players.map((player) => player.id)).toEqual(['bob']);
  });

  it('is not reopened by a kick, and does not score twice', () => {
    const game = buzzGame();
    const settled = revealed(game);
    const after = run(settled, game, [host({ cmd: 'kick', playerId: 'bob' }, 4_000)]);
    expect(after.phase).toBe('reveal');
    expect(scoreOf(after, 'alice')).toBe(10);
  });

  it('is not reopened by a verdict arriving after the fact', () => {
    const game = buzzGame();
    const after = run(revealed(game), game, [
      host({ cmd: 'judge', verdict: 'incorrect' }, 4_000),
    ]);
    expect(after.phase).toBe('reveal');
    expect(after.buzz?.spent).toEqual([]);
    expect(scoreOf(after, 'alice')).toBe(10);
  });

  it('is not reopened by an answer', () => {
    const game = buzzGame();
    const after = run(revealed(game), game, [answer('bob', 0, 'answer-0', 4_000)]);
    expect(after.phase).toBe('reveal');
    expect(scoreOf(after, 'bob')).toBe(0);
  });
});

describe('host authority', () => {
  const lobby = (game: GameModule): RoomState =>
    run(newRoom({ settings: { rounds: 3 } }), game, [join('alice', 1_100), join('bob', 1_101)]);

  it('ignores a host command from a player', () => {
    const game = fakeGame();
    const state = run(lobby(game), game, [
      { actor: asPlayer('alice'), intent: { kind: 'host', command: { cmd: 'start' } }, at: 2_000 },
    ]);
    expect(state.phase).toBe('lobby');
  });

  it('removes a kicked player', () => {
    const game = fakeGame();
    const state = run(lobby(game), game, [host({ cmd: 'kick', playerId: 'bob' }, 1_500)]);
    expect(state.players.map((player) => player.id)).toEqual(['alice']);
  });

  it('drops a kicked player out of the buzz queue and hands the buzzer on', () => {
    const game = fakeGame({ usesBuzz: true, questionPhaseMs: 30_000 });
    const queued = run(newRoom({ settings: { rounds: 2, answerWindowMs: 10_000 } }), game, [
      join('alice', 1_100),
      join('bob', 1_101),
      host({ cmd: 'start' }, 2_000),
      buzz('alice', 0, 40, 2_400, 2_420),
      buzz('bob', 0, 41, 2_430, 2_450),
    ]);
    const kicked = run(queued, game, [host({ cmd: 'kick', playerId: 'alice' }, 3_000)]);
    expect(kicked.players.map((player) => player.id)).toEqual(['bob']);
    expect(kicked.buzz?.queue.map((entry) => entry.playerId)).toEqual(['bob']);
  });

  it('adjusts a score up and down', () => {
    const game = fakeGame();
    const state = run(lobby(game), game, [
      host({ cmd: 'adjust', playerId: 'alice', delta: 15 }, 1_500),
      host({ cmd: 'adjust', playerId: 'alice', delta: -5 }, 1_600),
    ]);
    expect(scoreOf(state, 'alice')).toBe(10);
    expect(scoreOf(state, 'bob')).toBe(0);
  });

  it('skips a round without scoring anybody', () => {
    const game = fakeGame();
    const state = run(lobby(game), game, [
      host({ cmd: 'start' }, 2_000),
      answer('alice', 0, 'answer-0', 2_100),
      host({ cmd: 'skip' }, 2_500),
    ]);
    expect(state.roundIndex).toBe(1);
    expect(state.phase).toBe('answering');
    expect(scoreOf(state, 'alice')).toBe(0);
    expect(state.answers).toEqual([]);
  });

  it('reveals early, scoring the answers already in', () => {
    const game = fakeGame();
    const state = run(lobby(game), game, [
      host({ cmd: 'start' }, 2_000),
      answer('alice', 0, 'answer-0', 2_100),
      host({ cmd: 'revealNow' }, 2_500),
    ]);
    expect(state.phase).toBe('reveal');
    expect(state.roundIndex).toBe(0);
    expect(scoreOf(state, 'alice')).toBe(10);
    expect(scoreOf(state, 'bob')).toBe(0);
    expect(state.lastOutcome?.correctLabel).toBe('answer-0');
  });

  it('ignores a reveal command once the round is already revealed', () => {
    const game = fakeGame();
    const revealed = run(lobby(game), game, [
      host({ cmd: 'start' }, 2_000),
      answer('alice', 0, 'answer-0', 2_100),
      host({ cmd: 'revealNow' }, 2_500),
    ]);
    const again = run(revealed, game, [host({ cmd: 'revealNow' }, 2_600)]);
    expect(scoreOf(again, 'alice')).toBe(10);
  });

  it('moves to the summary after the last round', () => {
    const game = fakeGame();
    const state = run(newRoom({ settings: { rounds: 1 } }), game, [
      join('alice', 1_100),
      host({ cmd: 'start' }, 2_000),
      host({ cmd: 'revealNow' }, 2_500),
      host({ cmd: 'nextRound' }, 3_000),
    ]);
    expect(state.phase).toBe('summary');
  });

  it('closes the room on end and then accepts nothing', () => {
    const game = fakeGame();
    const ended = step(
      run(lobby(game), game, [host({ cmd: 'start' }, 2_000)]),
      game,
      host({ cmd: 'end' }, 2_500)
    );
    expect(ended.state.closed).toBe(true);
    expect(ended.state.phase).toBe('summary');
    expect(ended.effects).toContainEqual({ type: 'closeRoom' });

    const after = step(ended.state, game, join('carl', 3_000));
    expect(after.state.players.map((player) => player.id)).toEqual(['alice', 'bob']);
    expect(after.effects).toEqual([]);
  });

  it('returns to the lobby on newGame without closing the room', () => {
    const game = fakeGame();
    const midGame = run(lobby(game), game, [
      host({ cmd: 'start' }, 2_000),
      answer('alice', 0, 'answer-0', 2_100),
      host({ cmd: 'revealNow' }, 2_500),
    ]);
    expect(scoreOf(midGame, 'alice')).toBe(10);

    const restarted = step(midGame, game, host({ cmd: 'newGame' }, 3_000));
    expect(restarted.state.closed).toBe(false);
    expect(restarted.state.phase).toBe('lobby');
    expect(restarted.state.rounds).toEqual([]);
    expect(restarted.state.roundIndex).toBe(-1);
    expect(restarted.state.players.map((player) => player.id)).toEqual(['alice', 'bob']);
    // Scores reset for a genuinely new game.
    expect(scoreOf(restarted.state, 'alice')).toBe(0);
    expect(restarted.effects).not.toContainEqual({ type: 'closeRoom' });

    // The room, still open, accepts players and can be started again on a
    // different game — `roundsBuilt` is false again once `rounds` is cleared.
    const after = step(restarted.state, game, join('carl', 3_100));
    expect(after.state.players.map((player) => player.id)).toEqual(['alice', 'bob', 'carl']);

    const reconfigured = step(
      restarted.state,
      game,
      host({ cmd: 'setSettings', settings: { gameId: 'sword-drill' } }, 3_200)
    );
    expect(reconfigured.state.settings.gameId).toBe('sword-drill');

    const startedAgain = run(restarted.state, game, [host({ cmd: 'start' }, 3_300)]);
    expect(startedAgain.phase).not.toBe('lobby');
    expect(startedAgain.roundIndex).toBe(0);
  });

  it('folds each player’s score into allTimeScore before resetting it for a fresh game', () => {
    const game = fakeGame();
    const firstGame = run(lobby(game), game, [
      host({ cmd: 'start' }, 2_000),
      answer('alice', 0, 'answer-0', 2_100),
      host({ cmd: 'revealNow' }, 2_500),
    ]);
    expect(scoreOf(firstGame, 'alice')).toBe(10);

    const afterFirstReset = step(firstGame, game, host({ cmd: 'newGame' }, 3_000)).state;
    const alice = afterFirstReset.players.find((player) => player.id === 'alice');
    expect(alice?.score).toBe(0);
    expect(alice?.allTimeScore).toBe(10);

    // A second game's points add to the running total rather than replacing it.
    const secondGame = run(afterFirstReset, game, [
      host({ cmd: 'start' }, 3_100),
      answer('alice', 0, 'answer-0', 3_200),
      host({ cmd: 'revealNow' }, 3_600),
    ]);
    expect(scoreOf(secondGame, 'alice')).toBe(10);

    const afterSecondReset = step(secondGame, game, host({ cmd: 'newGame' }, 4_000)).state;
    const aliceAgain = afterSecondReset.players.find((player) => player.id === 'alice');
    expect(aliceAgain?.score).toBe(0);
    expect(aliceAgain?.allTimeScore).toBe(20);
  });

  it('ignores a newGame timer left over from before the reset', () => {
    // A stale timer for a round that no longer exists must not resurrect it.
    const game = fakeGame();
    const midGame = run(lobby(game), game, [host({ cmd: 'start' }, 2_000)]);
    const restarted = run(midGame, game, [host({ cmd: 'newGame' }, 2_500)]);
    const state = step(restarted, game, {
      actor: SYSTEM,
      intent: { kind: 'timer', round: 0, tag: 'questionEnd' },
      at: 2_600,
    }).state;
    expect(state.phase).toBe('lobby');
  });

  it('refuses to change the game once the rounds are built', () => {
    const game = fakeGame();
    const started = run(lobby(game), game, [host({ cmd: 'start' }, 2_000)]);
    const state = run(started, game, [
      host({ cmd: 'setSettings', settings: { gameId: 'something-else', teamsEnabled: true } }, 2_500),
    ]);
    expect(state.settings.gameId).toBe(lobby(game).settings.gameId);
    expect(state.settings.teamsEnabled).toBe(true);
  });

  it('accepts a full change of settings while still in the lobby', () => {
    const game = fakeGame();
    const state = run(lobby(game), game, [
      host({ cmd: 'setSettings', settings: { gameId: 'sword-drill', rounds: 5 } }, 1_500),
    ]);
    expect(state.settings.gameId).toBe('sword-drill');
    expect(state.settings.rounds).toBe(5);
  });
});

describe('control', () => {
  const lobby = (game: GameModule): RoomState =>
    run(newRoom({ settings: { rounds: 3 } }), game, [join('alice', 1_100), join('bob', 1_101)]);

  const grantedToAlice = (game: GameModule): RoomState =>
    run(lobby(game), game, [host({ cmd: 'grantControl', playerId: 'alice' }, 1_200)]);

  it('starts a room with the owner in control', () => {
    expect(newRoom().controller).toEqual({ kind: 'owner' });
  });

  it("a non-controller's nextRound changes nothing", () => {
    const game = fakeGame();
    // Alice holds control and starts the game; Bob then asks for the next
    // round, but Bob — not Alice — is not the controller.
    const state = run(grantedToAlice(game), game, [
      { actor: asPlayer('alice'), intent: { kind: 'host', command: { cmd: 'start' } }, at: 1_300 },
      { actor: asPlayer('bob'), intent: { kind: 'host', command: { cmd: 'nextRound' } }, at: 1_400 },
    ]);
    expect(state.roundIndex).toBe(0);
  });

  it('lets the controlling player run the room once granted', () => {
    const game = fakeGame();
    const state = run(grantedToAlice(game), game, [
      { actor: asPlayer('alice'), intent: { kind: 'host', command: { cmd: 'start' } }, at: 1_300 },
    ]);
    expect(state.phase).not.toBe('lobby');
  });

  it("the owner's reclaimControl always works, even mid-game and from someone else's hold", () => {
    const game = fakeGame();
    const state = run(grantedToAlice(game), game, [
      host({ cmd: 'reclaimControl' }, 1_300),
    ]);
    expect(state.controller).toEqual({ kind: 'owner' });

    // And now the owner runs the room again — the recovery this exists for.
    const started = run(state, game, [host({ cmd: 'start' }, 1_400)]);
    expect(started.phase).not.toBe('lobby');
  });

  it('reclaimControl from a player is refused', () => {
    const game = fakeGame();
    const state = run(grantedToAlice(game), game, [
      { actor: asPlayer('bob'), intent: { kind: 'host', command: { cmd: 'reclaimControl' } }, at: 1_300 },
    ]);
    expect(state.controller).toEqual({ kind: 'player', playerId: 'alice' });
  });

  it('a grant clears every request', () => {
    const game = fakeGame();
    const asked = run(lobby(game), game, [
      { actor: asPlayer('alice'), intent: { kind: 'requestControl' }, at: 1_150 },
      { actor: asPlayer('bob'), intent: { kind: 'requestControl' }, at: 1_160 },
    ]);
    expect(asked.controlRequests.map((request) => request.playerId)).toEqual(['alice', 'bob']);

    const granted = run(asked, game, [host({ cmd: 'grantControl', playerId: 'alice' }, 1_200)]);
    expect(granted.controller).toEqual({ kind: 'player', playerId: 'alice' });
    expect(granted.controlRequests).toEqual([]);
  });

  it('grantControl to nobody in the room is refused', () => {
    const game = fakeGame();
    const state = run(lobby(game), game, [
      host({ cmd: 'grantControl', playerId: 'ghost' }, 1_200),
    ]);
    expect(state.controller).toEqual({ kind: 'owner' });
  });

  it('a kicked controller reverts to owner', () => {
    const game = fakeGame();
    // Kicking is itself a `HostCommand`, so only the controller (or the owner,
    // via reclaim) may issue it — here it's the controller kicking herself,
    // which is the direct way to exercise `removePlayer`'s own revert-on-kick
    // logic without an unrelated reclaim muddying what the assertion proves.
    const state = run(grantedToAlice(game), game, [
      { actor: asPlayer('alice'), intent: { kind: 'host', command: { cmd: 'kick', playerId: 'alice' } }, at: 1_300 },
    ]);
    expect(state.controller).toEqual({ kind: 'owner' });
    expect(state.players.map((player) => player.id)).toEqual(['bob']);
  });

  it('a leaving controller reverts control to owner', () => {
    const game = fakeGame();
    const state = run(grantedToAlice(game), game, [
      { actor: asPlayer('alice'), intent: { kind: 'leave' }, at: 1_300 },
    ]);
    expect(state.controller).toEqual({ kind: 'owner' });
  });

  it('a disconnect does not take control away', () => {
    const game = fakeGame();
    const state = grantedToAlice(game);
    const dropped = withConnected(state, 'alice', false);
    expect(dropped.controller).toEqual({ kind: 'player', playerId: 'alice' });
  });

  it('a second request from one player is refused', () => {
    const game = fakeGame();
    const state = run(lobby(game), game, [
      { actor: asPlayer('alice'), intent: { kind: 'requestControl' }, at: 1_150 },
      { actor: asPlayer('alice'), intent: { kind: 'requestControl' }, at: 1_160 },
    ]);
    expect(state.controlRequests).toHaveLength(1);
    expect(state.controlRequests[0]?.askedAt).toBe(1_150);
  });

  it('the controller asking for control changes nothing', () => {
    const game = fakeGame();
    const state = run(grantedToAlice(game), game, [
      { actor: asPlayer('alice'), intent: { kind: 'requestControl' }, at: 1_300 },
    ]);
    expect(state.controlRequests).toEqual([]);
  });

  it('withdrawing a request removes it', () => {
    const game = fakeGame();
    const asked = run(lobby(game), game, [
      { actor: asPlayer('alice'), intent: { kind: 'requestControl' }, at: 1_150 },
    ]);
    const withdrawn = run(asked, game, [
      { actor: asPlayer('alice'), intent: { kind: 'withdrawControlRequest' }, at: 1_200 },
    ]);
    expect(withdrawn.controlRequests).toEqual([]);
  });

  it('denying a request removes it and marks the player denied until they ask again', () => {
    const game = fakeGame();
    const asked = run(lobby(game), game, [
      { actor: asPlayer('alice'), intent: { kind: 'requestControl' }, at: 1_150 },
    ]);
    const denied = run(asked, game, [host({ cmd: 'denyControl', playerId: 'alice' }, 1_200)]);
    expect(denied.controlRequests).toEqual([]);
    expect(denied.deniedControlPlayers).toEqual(['alice']);

    const askedAgain = run(denied, game, [
      { actor: asPlayer('alice'), intent: { kind: 'requestControl' }, at: 1_300 },
    ]);
    expect(askedAgain.deniedControlPlayers).toEqual([]);
    expect(askedAgain.controlRequests.map((request) => request.playerId)).toEqual(['alice']);
  });

  it('newGame and end leave the controller alone', () => {
    const game = fakeGame();
    const playing = run(grantedToAlice(game), game, [
      { actor: asPlayer('alice'), intent: { kind: 'host', command: { cmd: 'start' } }, at: 1_300 },
    ]);
    const restarted = run(playing, game, [
      { actor: asPlayer('alice'), intent: { kind: 'host', command: { cmd: 'newGame' } }, at: 1_400 },
    ]);
    expect(restarted.controller).toEqual({ kind: 'player', playerId: 'alice' });

    const ended = run(restarted, game, [
      { actor: asPlayer('alice'), intent: { kind: 'host', command: { cmd: 'end' } }, at: 1_500 },
    ]);
    expect(ended.controller).toEqual({ kind: 'player', playerId: 'alice' });
  });
});

describe('control request expiry', () => {
  const lobby = (game: GameModule): RoomState =>
    run(newRoom({ settings: { rounds: 3 } }), game, [join('alice', 1_100), join('bob', 1_101)]);

  /** `-2` is `CONTROL_TIMER_ROUND` in reducer.ts: reserved so this timer is
   *  never swept up by a round-scoped `cancelTimers`. */
  function controlTimerDue(playerId: PlayerId, at: number): Step {
    return { actor: SYSTEM, intent: { kind: 'timer', round: -2, tag: playerId }, at };
  }

  function requested(playerId: PlayerId, at: number): Step {
    return { actor: asPlayer(playerId), intent: { kind: 'requestControl' }, at };
  }

  it("asking for control arms a timer at the request's own window", () => {
    const game = fakeGame();
    const result = step(lobby(game), game, requested('alice', 1_150));
    expect(result.effects).toContainEqual({ type: 'timer', at: 1_150 + 45_000, round: -2, tag: 'alice' });
  });

  it('attended + no answer → the request expires, denied until asked again', () => {
    const game = fakeGame();
    // The owner's screen is present and watching, so the request is attended
    // and nobody granted it — it simply times out.
    const asked = run(lobby(game), game, [requested('alice', 1_150)]);
    const attended = { ...asked, ownerPresent: true };
    const expired = step(attended, game, controlTimerDue('alice', 1_150 + 45_000)).state;

    expect(expired.controlRequests).toEqual([]);
    expect(expired.deniedControlPlayers).toEqual(['alice']);
    expect(expired.controller).toEqual({ kind: 'owner' });
  });

  it('unattended → the request is granted', () => {
    const game = fakeGame();
    const asked = run(lobby(game), game, [requested('alice', 1_150)]);
    // No screen at all: the owner side of the controller is unattended.
    const unattended = { ...asked, ownerPresent: false };
    const granted = step(unattended, game, controlTimerDue('alice', 1_150 + 45_000)).state;

    expect(granted.controller).toEqual({ kind: 'player', playerId: 'alice' });
    expect(granted.controlRequests).toEqual([]);
  });

  it('a disconnected player-controller leaves a request unattended', () => {
    const game = fakeGame();
    const grantedToBob = run(lobby(game), game, [
      host({ cmd: 'grantControl', playerId: 'bob' }, 1_150),
    ]);
    const bobDropped = withConnected(grantedToBob, 'bob', false);
    const asked = run(bobDropped, game, [requested('alice', 1_200)]);
    const granted = step(asked, game, controlTimerDue('alice', 1_200 + 45_000)).state;

    expect(granted.controller).toEqual({ kind: 'player', playerId: 'alice' });
  });

  it('a controller reconnecting before the timer keeps control', () => {
    const game = fakeGame();
    const grantedToBob = run(lobby(game), game, [
      host({ cmd: 'grantControl', playerId: 'bob' }, 1_150),
    ]);
    const bobDropped = withConnected(grantedToBob, 'bob', false);
    const asked = run(bobDropped, game, [requested('alice', 1_200)]);
    // Bob is back well before the deadline — attended is read fresh at fire
    // time, not as it stood when the request was made.
    const bobBack = withConnected(asked, 'bob', true);
    const expired = step(bobBack, game, controlTimerDue('alice', 1_200 + 45_000)).state;

    expect(expired.controller).toEqual({ kind: 'player', playerId: 'bob' });
    expect(expired.controlRequests).toEqual([]);
    expect(expired.deniedControlPlayers).toEqual(['alice']);
  });

  it('a stale timer for a request already granted, denied or withdrawn does nothing', () => {
    const game = fakeGame();
    const asked = run(lobby(game), game, [requested('alice', 1_150)]);
    const grantedEarly = run(asked, game, [host({ cmd: 'grantControl', playerId: 'alice' }, 1_160)]);

    const state = step(grantedEarly, game, controlTimerDue('alice', 1_150 + 45_000)).state;
    // Still Alice's, from the explicit grant — the late timer found no
    // request left to act on and changed nothing.
    expect(state.controller).toEqual({ kind: 'player', playerId: 'alice' });
    expect(state.deniedControlPlayers).toEqual([]);
  });

  it('a control request timer fires regardless of pause, unlike a round timer', () => {
    const game = fakeGame({ usesBuzz: true, questionPhaseMs: 30_000 });
    const started = run(newRoom({ settings: { rounds: 2, answerWindowMs: 10_000 } }), game, [
      join('alice', 1_100),
      join('bob', 1_101),
      host({ cmd: 'start' }, 2_000),
      host({ cmd: 'pause' }, 2_100),
      requested('bob', 2_150),
    ]);
    expect(started.paused).toBe(true);

    const attended = { ...started, ownerPresent: true };
    const expired = step(attended, game, controlTimerDue('bob', 2_150 + 45_000)).state;
    expect(expired.paused).toBe(true);
    expect(expired.deniedControlPlayers).toEqual(['bob']);
  });
});

describe('determinism', () => {
  it('builds the same rounds from the same seed and different ones otherwise', () => {
    const game = fakeGame();
    const draws = (seed: number): number[] =>
      run(newRoom({ seed, settings: { rounds: 3 } }), game, [
        join('alice', 1_100),
        host({ cmd: 'start' }, 2_000),
      ]).rounds.map((round) => (round.secret as FakeSecret).draw);

    expect(draws(7)).toEqual(draws(7));
    expect(draws(7)).not.toEqual(draws(8));
  });

  it('never mutates the state it was handed', () => {
    const game = fakeGame();
    const before = run(newRoom({ settings: { rounds: 2 } }), game, [
      join('alice', 1_100),
      join('bob', 1_101),
    ]);
    const snapshot = JSON.stringify(before);
    step(before, game, host({ cmd: 'start' }, 2_000));
    step(before, game, host({ cmd: 'adjust', playerId: 'alice', delta: 99 }, 2_000));
    step(before, game, answer('alice', 0, 'answer-0', 2_100));
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------

/** Wraps a game so a test can see every answer the room hands it to score. */
function recording(game: GameModule): { game: GameModule; scored: ScoredAnswer[][] } {
  const scored: ScoredAnswer[][] = [];
  return {
    scored,
    game: {
      ...game,
      scoreRound(round, answers, table) {
        scored.push(answers);
        return game.scoreRound(round, answers, table);
      },
    },
  };
}

/** Three players in a buzz room whose first question has just gone up at 2 000. */
function buzzRoom(game: GameModule): RoomState {
  return run(newRoom({ settings: { rounds: 2, answerWindowMs: 10_000 } }), game, [
    join('alice', 1_100),
    join('bob', 1_101),
    join('cleo', 1_102),
    host({ cmd: 'start' }, 2_000),
  ]);
}

describe('when answering opened', () => {
  function playing(game: GameModule): RoomState {
    return run(newRoom({ settings: { rounds: 2, answerWindowMs: 10_000 } }), game, [
      join('alice', 1_100),
      join('bob', 1_101),
      host({ cmd: 'start' }, 2_000),
    ]);
  }

  it('records the opening on each answer', () => {
    const game = fakeGame();
    const state = run(playing(game), game, [answer('alice', 0, 'answer-0', 3_000)]);
    expect(state.answers[0]?.openedAt).toBe(2_000);
  });

  it('moves the opening by a pause for answers after it, and only for those', () => {
    const { game, scored } = recording(fakeGame());
    const resumed = run(playing(game), game, [
      answer('alice', 0, 'answer-0', 3_000),
      host({ cmd: 'pause' }, 4_000),
      host({ cmd: 'resume' }, 9_000),
    ]);
    // The same instant the deadline implies: the window counted back from a
    // deadline the pause pushed on by its own length.
    expect((resumed.phaseEndsAt ?? 0) - 10_000).toBe(7_000);

    run(resumed, game, [answer('bob', 0, 'answer-0', 9_500)]);
    expect(scored[0]?.map((scoredAnswer) => [scoredAnswer.playerId, scoredAnswer.openedAt])).toEqual([
      ['alice', 2_000],
      ['bob', 7_000],
    ]);
  });

  it('opens when the reading ends, for a round that reads first', () => {
    const game = fakeGame({ questionPhaseMs: 3_000 });
    const state = run(playing(game), game, [
      timer(0, 'questionEnd', 5_000),
      answer('alice', 0, 'answer-0', 6_000),
    ]);
    expect(state.answers[0]?.openedAt).toBe(5_000);
  });

  it('opens with the question for a buzz round, which takes buzzes from the first word', () => {
    const game = fakeGame({ usesBuzz: true, questionPhaseMs: 30_000 });
    const state = run(buzzRoom(game), game, [
      buzz('alice', 0, 10, 2_400, 2_420),
      answer('alice', 0, 'answer-0', 3_000),
    ]);
    expect(state.answers[0]?.openedAt).toBe(2_000);
  });
});

describe("the host's ruling reaches the game", () => {
  const buzzGame = (): GameModule => fakeGame({ usesBuzz: true, questionPhaseMs: 30_000 });

  it('hands the game each ruling on the answer it was about', () => {
    const { game, scored } = recording(buzzGame());
    run(buzzRoom(game), game, [
      buzz('alice', 0, 40, 2_400, 2_420),
      buzz('bob', 0, 41, 2_430, 2_450),
      answer('alice', 0, 'a woman', 3_000),
      host({ cmd: 'judge', verdict: 'incorrect' }, 3_500),
      answer('bob', 0, 'answer-0', 4_000),
      host({ cmd: 'judge', verdict: 'correct' }, 4_500),
    ]);
    expect(scored[0]?.map((scoredAnswer) => [scoredAnswer.playerId, scoredAnswer.verdict])).toEqual([
      ['alice', 'incorrect'],
      ['bob', 'correct'],
    ]);
  });

  it('hands over an answer nobody ruled on with no verdict at all', () => {
    const { game, scored } = recording(buzzGame());
    run(buzzRoom(game), game, [
      buzz('alice', 0, 40, 2_400, 2_420),
      answer('alice', 0, 'a woman', 3_000),
      host({ cmd: 'revealNow' }, 3_500),
    ]);
    expect(scored[0]).toHaveLength(1);
    expect(scored[0]?.[0]).not.toHaveProperty('verdict');
  });
});

describe('a game that confirms every buzz', () => {
  const confirming = (): GameModule =>
    fakeGame({ usesBuzz: true, questionPhaseMs: 30_000, confirmsEveryBuzz: true });

  /** Alice and Bob in line, and Alice's answer in front of the host. */
  function heardAlice(game: GameModule): RoomState {
    return run(buzzRoom(game), game, [
      buzz('alice', 0, 40, 2_400, 2_420),
      buzz('bob', 0, 41, 2_430, 2_450),
      answer('alice', 0, 'answer-0', 3_000),
    ]);
  }

  it('starts every round with nobody confirmed', () => {
    expect(buzzRoom(confirming()).buzz?.confirmed).toEqual([]);
    // A game whose confirmation ends the round never carries the list.
    expect(buzzRoom(fakeGame({ usesBuzz: true, questionPhaseMs: 30_000 })).buzz).not.toHaveProperty(
      'confirmed'
    );
  });

  it('confirms the reader and hands the turn on without revealing', () => {
    const game = confirming();
    const result = step(heardAlice(game), game, host({ cmd: 'judge', verdict: 'correct' }, 3_500));
    expect(result.state.phase).toBe('answering');
    expect(result.state.buzz?.queue.map((entry) => entry.playerId)).toEqual(['bob']);
    expect(result.state.buzz?.confirmed).toEqual(['alice']);
    expect(result.state.buzz?.answerDeadline).toBe(13_500);
    expect(result.effects.some((effect) => effect.type === 'reveal')).toBe(false);
  });

  it('ignores a confirmation with no answer on file to land on', () => {
    const game = confirming();
    const state = run(heardAlice(game), game, [
      host({ cmd: 'judge', verdict: 'correct' }, 3_500),
      host({ cmd: 'judge', verdict: 'correct' }, 3_600),
    ]);
    expect(state.buzz?.queue.map((entry) => entry.playerId)).toEqual(['bob']);
    expect(state.buzz?.confirmed).toEqual(['alice']);
  });

  it('refuses a buzz from someone already confirmed', () => {
    const game = confirming();
    const state = run(heardAlice(game), game, [
      host({ cmd: 'judge', verdict: 'correct' }, 3_500),
      buzz('alice', 0, 50, 3_600, 3_620),
    ]);
    expect(state.buzz?.queue.map((entry) => entry.playerId)).toEqual(['bob']);
  });

  it('goes back to reading once the queue is empty, and keeps the round open for more', () => {
    const game = confirming();
    const state = run(heardAlice(game), game, [
      host({ cmd: 'judge', verdict: 'correct' }, 3_500),
      answer('bob', 0, 'answer-0', 4_000),
      host({ cmd: 'judge', verdict: 'correct' }, 4_500),
    ]);
    expect(state.phase).toBe('question');
    expect(state.buzz?.confirmed).toEqual(['alice', 'bob']);
    // The reading gets back the time the freeze took from it.
    expect(state.questionEndsAt).toBe(32_000 + (4_500 - 2_420));

    const later = run(state, game, [buzz('cleo', 0, 60, 5_000, 5_020)]);
    expect(later.phase).toBe('answering');
    expect(later.buzz?.queue.map((entry) => entry.playerId)).toEqual(['cleo']);
  });

  it('scores everyone confirmed when the round ends', () => {
    const game = confirming();
    const state = run(heardAlice(game), game, [
      host({ cmd: 'judge', verdict: 'correct' }, 3_500),
      answer('bob', 0, 'answer-0', 4_000),
      host({ cmd: 'judge', verdict: 'correct' }, 4_500),
      host({ cmd: 'revealNow' }, 5_000),
    ]);
    expect(state.phase).toBe('reveal');
    expect(scoreOf(state, 'alice')).toBe(10);
    expect(scoreOf(state, 'bob')).toBe(10);
  });

  it('forgets a confirmed player who leaves', () => {
    const game = confirming();
    const state = run(heardAlice(game), game, [
      host({ cmd: 'judge', verdict: 'correct' }, 3_500),
      host({ cmd: 'kick', playerId: 'alice' }, 3_600),
    ]);
    expect(state.buzz?.confirmed).toEqual([]);
  });
});

describe('the host choosing the next round', () => {
  const chooser = (): GameModule => fakeGame({ choices: ['left', 'middle', 'right'] });

  function revealed(game: GameModule, rounds = 3): RoomState {
    return run(newRoom({ settings: { rounds } }), game, [
      join('alice', 1_100),
      host({ cmd: 'start' }, 2_000),
      host({ cmd: 'revealNow' }, 2_500),
    ]);
  }

  function choiceOf(state: RoomState, index: number): string | null | undefined {
    return (state.rounds[index]?.secret as FakeSecret | undefined)?.choice;
  }

  it('builds the next round from the choice and goes straight to it', () => {
    const game = chooser();
    const state = run(revealed(game), game, [host({ cmd: 'choose', choice: 'right' }, 3_000)]);
    expect(state.roundIndex).toBe(1);
    expect(state.phase).toBe('answering');
    expect(choiceOf(state, 1)).toBe('right');
    // The rounds after it are the game's own choosing again.
    expect(choiceOf(state, 2)).toBeNull();
  });

  it('leaves the round already played exactly as it was', () => {
    const game = chooser();
    const before = revealed(game);
    const after = run(before, game, [host({ cmd: 'choose', choice: 'right' }, 3_000)]);
    expect(after.rounds[0]).toEqual(before.rounds[0]);
  });

  it('ignores a choice the game is not offering', () => {
    const game = chooser();
    const state = run(revealed(game), game, [
      host({ cmd: 'choose', choice: 'right' }, 3_000),
      host({ cmd: 'revealNow' }, 3_500),
      // Already played, then never offered.
      host({ cmd: 'choose', choice: 'right' }, 4_000),
      host({ cmd: 'choose', choice: 'upstairs' }, 4_100),
    ]);
    expect(state.roundIndex).toBe(1);
    expect(state.phase).toBe('reveal');
  });

  it('ignores a choice made while a question is up', () => {
    const game = chooser();
    const playing = run(newRoom({ settings: { rounds: 3 } }), game, [
      join('alice', 1_100),
      host({ cmd: 'start' }, 2_000),
    ]);
    const after = run(playing, game, [host({ cmd: 'choose', choice: 'left' }, 2_200)]);
    expect(after.roundIndex).toBe(0);
    expect(after.rounds).toEqual(playing.rounds);
  });

  it('ignores a choice after the last round', () => {
    const game = chooser();
    const state = run(revealed(game, 1), game, [host({ cmd: 'choose', choice: 'left' }, 3_000)]);
    expect(state.phase).toBe('reveal');
    expect(state.roundIndex).toBe(0);
  });

  it('ignores a choice for a game that takes none', () => {
    const game = fakeGame();
    const before = revealed(game);
    const after = run(before, game, [host({ cmd: 'choose', choice: 'left' }, 3_000)]);
    expect(after.phase).toBe('reveal');
    expect(after.rounds).toEqual(before.rounds);
  });

  it('rebuilds the same rounds when the same choices are replayed', () => {
    const game = chooser();
    const replay = (): RoomState =>
      run(revealed(game), game, [host({ cmd: 'choose', choice: 'middle' }, 3_000)]);
    expect(replay().rounds).toEqual(replay().rounds);
    expect(replay().rngSeed).toBe(replay().rngSeed);
  });
});
