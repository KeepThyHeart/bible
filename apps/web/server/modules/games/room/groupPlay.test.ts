/**
 * Per-player views, answer policies and group voting, through the real reducer
 * and projection.
 *
 * The fake games here are shaped like the games this seam exists for: one
 * where each phone holds its own clue and a team votes on a suspect, and one
 * where a turn is a run of card taps that only some phones may make. Neither
 * is a real game; each does just enough to prove the room gives a game what it
 * needs and keeps what it must not share.
 */

import { describe, expect, it } from 'vitest';
import type {
  Actor,
  AddressedIntent,
  AnswerValue,
  Effect,
  Intent,
  PersonalResult,
  PlayerId,
  RoomSettings,
  TeamId,
} from '../../../../src/modules/games/shared/protocol.js';
import { TEAM_IDS } from '../../../../src/modules/games/shared/protocol.js';
import type {
  AnswerPolicy,
  GameModule,
  Round,
  RoundOutcome,
  ScoredAnswer,
  Seat,
} from '../../../../src/modules/games/shared/games.js';
import { MAX_LOG_ENTRIES } from '../../../../src/modules/games/shared/games.js';
import { reduce } from './reducer.js';
import {
  projectForScreen,
  projectForPlayer,
  projectPersonalResult,
  projectReveal,
} from './projection.js';
import { createRoom, tableOf, type RoomState } from './state.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const HOST: Actor = { role: 'owner' };
const SYSTEM: Actor = { role: 'system' };
const asPlayer = (playerId: PlayerId): Actor => ({ role: 'player', playerId });

interface Step {
  actor: Actor;
  intent: Intent;
  at: number;
}

function step(state: RoomState, game: GameModule, s: Step): { state: RoomState; effects: Effect[] } {
  const addressed: AddressedIntent = { actor: s.actor, intent: s.intent, receivedAt: s.at };
  return reduce(state, addressed, game);
}

function run(state: RoomState, game: GameModule, steps: Step[]): RoomState {
  return steps.reduce((current, s) => step(current, game, s).state, state);
}

function newRoom(settings: Partial<RoomSettings> = {}, seed = 7): RoomState {
  return createRoom({ code: 'ABCD', now: 1_000, seed, settings });
}

function join(playerId: PlayerId, at: number, teamId?: TeamId): Step {
  const intent: Intent =
    teamId === undefined ? { kind: 'join', name: playerId } : { kind: 'join', name: playerId, teamId };
  return { actor: asPlayer(playerId), intent, at };
}

function host(command: Extract<Intent, { kind: 'host' }>['command'], at: number): Step {
  return { actor: HOST, intent: { kind: 'host', command }, at };
}

function send(playerId: PlayerId, value: AnswerValue, at: number, round = 0): Step {
  return { actor: asPlayer(playerId), intent: { kind: 'answer', round, value }, at };
}

const text = (playerId: PlayerId, words: string, at: number): Step =>
  send(playerId, { type: 'text', text: words }, at);

const vote = (playerId: PlayerId, index: number, at: number): Step =>
  send(playerId, { type: 'choice', index }, at);

const card = (
  playerId: PlayerId,
  action: 'got' | 'pass' | 'slip',
  index: number,
  at: number,
  round = 0
): Step => send(playerId, { type: 'card', action, card: index }, at, round);

function timer(round: number, tag: string, at: number): Step {
  return { actor: SYSTEM, intent: { kind: 'timer', round, tag }, at };
}

function scoreOf(state: RoomState, playerId: PlayerId): number {
  return state.players.find((player) => player.id === playerId)?.score ?? 0;
}

/** Everything but the moment it was last touched, which every intent moves. */
function settled(state: RoomState): RoomState {
  return { ...state, lastActivity: 0 };
}

// ---------------------------------------------------------------------------
// A plain game with every new option left out unless a test asks for it
// ---------------------------------------------------------------------------

interface PlainSecret {
  answer: string;
}

interface PlainOptions {
  policy?: AnswerPolicy;
  usesBuzz?: boolean;
  answerWindowMs?: number;
  questionPhaseMs?: number;
  /** Who the game is willing to hear from. */
  hears?: (playerId: PlayerId) => boolean;
}

function plainGame(options: PlainOptions = {}): GameModule<PlainSecret> {
  const hears = options.hears;
  return {
    id: 'plain',
    name: 'Plain',
    supportsSolo: true,
    ...(options.policy === undefined ? {} : { answerPolicy: options.policy }),
    ...(options.usesBuzz === undefined ? {} : { usesBuzz: options.usesBuzz }),
    ...(hears === undefined ? {} : { accepts: (_round, _table, playerId) => hears(playerId) }),
    buildRound(_context, index): Round<PlainSecret> {
      const round: Round<PlainSecret> = {
        index,
        secret: { answer: `answer-${index}` },
        hostView: null,
        playerView: null,
      };
      if (options.answerWindowMs !== undefined) round.answerWindowMs = options.answerWindowMs;
      if (options.questionPhaseMs !== undefined) round.questionPhaseMs = options.questionPhaseMs;
      return round;
    },
    scoreRound(round, answers): RoundOutcome {
      const perPlayer = new Map<PlayerId, PersonalResult>();
      for (const answer of answers) {
        const correct = answer.value.type === 'text' && answer.value.text === round.secret.answer;
        perPlayer.set(answer.playerId, {
          correct,
          pointsAwarded: correct ? 10 : 0,
          submitted: answer.value,
          note: null,
        });
      }
      return { perPlayer, aggregates: [], correctLabel: round.secret.answer, detail: null };
    },
  };
}

/** Wraps a game so a test can see every set of answers the room hands it to score. */
function recording<Secret>(game: GameModule<Secret>): {
  game: GameModule<Secret>;
  scored: ScoredAnswer[][];
} {
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

/** Three players with a round open for answers from 2 000 to 22 000. */
function openRound(game: GameModule, settings: Partial<RoomSettings> = {}): RoomState {
  return run(newRoom({ rounds: 2, answerWindowMs: 20_000, ...settings }), game, [
    join('alice', 1_100),
    join('bob', 1_101),
    join('cleo', 1_102),
    host({ cmd: 'start' }, 2_000),
  ]);
}

// ---------------------------------------------------------------------------
// A game shaped like the detective game: a clue per phone, a vote on a suspect
// ---------------------------------------------------------------------------

const SUSPECTS: readonly string[] = ['Moses', 'Aaron', 'Miriam', 'Joshua'];

interface CaseSecret {
  answer: number;
  clues: string[];
  dealOffset: number;
}

interface CaseOptions {
  mode?: 'optional' | 'always';
  supports?: (settings: RoomSettings) => boolean;
}

function suspectOf(value: AnswerValue): string {
  return value.type === 'choice' ? (SUSPECTS[value.index] ?? 'nobody') : 'nobody';
}

function caseGame(options: CaseOptions = {}): GameModule<CaseSecret> {
  const supports = options.supports;
  return {
    id: 'case',
    name: 'Case',
    supportsSolo: false,
    groupVote: {
      mode: options.mode ?? 'always',
      ...(supports === undefined ? {} : { supports }),
      key: (value) => (value.type === 'choice' ? String(value.index) : null),
      label: suspectOf,
    },
    buildRound(context, index): Round<CaseSecret> {
      return {
        index,
        secret: {
          answer: 0,
          clues: ['clue-vague', 'clue-a', 'clue-b', 'clue-c', 'clue-d'],
          dealOffset: Math.floor(context.random() * 4),
        },
        // Left on the round to prove a game that computes views never has
        // these sent in their place.
        hostView: { leak: 'HOST-ONLY-FIELD' },
        playerView: { leak: 'PLAYER-ONLY-FIELD' },
      };
    },
    viewFor(round, table, viewer) {
      const options = [...SUSPECTS];
      if (viewer === null) {
        const voters = new Set(table.log.map((answer) => answer.playerId)).size;
        return { prompt: round.secret.clues[0], options, voters };
      }
      const seat = table.seats.find((candidate) => candidate.playerId === viewer);
      if (seat === undefined) return { waiting: true };
      // Dealt within the team, so each team holds the whole case between them.
      const team = table.seats.filter((candidate) => candidate.teamId === seat.teamId);
      const dealt = round.secret.clues.slice(1);
      const clue = dealt[(team.indexOf(seat) + round.secret.dealOffset) % dealt.length];
      return { options, clue };
    },
    scoreRound(round, answers): RoundOutcome {
      const perPlayer = new Map<PlayerId, PersonalResult>();
      const counts = new Map<string, number>();
      for (const answer of answers) {
        if (answer.value.type !== 'choice') continue;
        const correct = answer.value.index === round.secret.answer;
        const label = suspectOf(answer.value);
        counts.set(label, (counts.get(label) ?? 0) + 1);
        perPlayer.set(answer.playerId, {
          correct,
          pointsAwarded: correct ? 100 : 0,
          submitted: answer.value,
          note: null,
        });
      }
      return {
        perPlayer,
        aggregates: [...counts].map(([label, count]) => ({ label, count })),
        correctLabel: SUSPECTS[round.secret.answer] ?? '',
        detail: { clues: round.secret.clues },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// A game shaped like the clue-giving game: a turn is a run of card taps
// ---------------------------------------------------------------------------

const CARDS = ['Jericho', 'manna', 'Goliath', 'ark', 'Babel', 'Jonah'];

interface TurnSecret {
  cards: string[];
}

/** The teams that have anyone in them, in the teams' own order. */
function teamsAtTable(seats: readonly Seat[]): (TeamId | null)[] {
  return [...TEAM_IDS, null].filter((teamId) => seats.some((seat) => seat.teamId === teamId));
}

function describerFor(turn: number, seats: readonly Seat[]): Seat | null {
  const teams = teamsAtTable(seats);
  if (teams.length === 0) return null;
  const team = teams[turn % teams.length];
  const members = seats.filter((seat) => seat.teamId === team);
  return members[Math.floor(turn / teams.length) % members.length] ?? null;
}

/** Every accepted tap moves the deck on by one card. */
function cardInPlay(log: readonly ScoredAnswer[]): number {
  return log.filter((entry) => entry.value.type === 'card').length;
}

function cardsGot(log: readonly ScoredAnswer[]): number {
  return log.filter((entry) => entry.value.type === 'card' && entry.value.action === 'got').length;
}

function turnGame(): GameModule<TurnSecret> {
  return {
    id: 'turns',
    name: 'Turns',
    supportsSolo: false,
    answerPolicy: 'log',
    standingsAtSummaryOnly: true,
    buildRound(_context, index): Round<TurnSecret> {
      return {
        index,
        secret: { cards: CARDS },
        hostView: null,
        playerView: null,
        questionPhaseMs: 5_000,
        answerWindowMs: 60_000,
      };
    },
    accepts(round, table, playerId, value) {
      if (value.type !== 'card') return false;
      const describer = describerFor(round.index, table.seats);
      const seat = table.seats.find((candidate) => candidate.playerId === playerId);
      if (describer === null || seat === undefined) return false;
      // Naming the card makes a retried or doubled tap a tap on a card that
      // has already moved on.
      if (value.card !== cardInPlay(table.log) || value.card >= round.secret.cards.length) return false;
      if (value.action === 'slip') return seat.teamId !== describer.teamId;
      return playerId === describer.playerId;
    },
    viewFor(round, table, viewer) {
      const describer = describerFor(round.index, table.seats);
      const current = round.secret.cards[cardInPlay(table.log)] ?? null;
      if (viewer === null) {
        return {
          team: describer?.teamId ?? null,
          describer: describer?.playerId ?? null,
          got: cardsGot(table.log),
        };
      }
      const seat = table.seats.find((candidate) => candidate.playerId === viewer);
      if (seat === undefined || describer === null) return { role: 'waiting' };
      if (viewer === describer.playerId) return { role: 'describer', card: current };
      if (seat.teamId === describer.teamId) return { role: 'guesser' };
      return { role: 'watcher', card: current };
    },
    scoreRound(round, answers, table): RoundOutcome {
      const describer = describerFor(round.index, table.seats);
      const got = cardsGot(answers);
      const perPlayer = new Map<PlayerId, PersonalResult>();
      for (const seat of table.seats) {
        if (describer === null || seat.teamId !== describer.teamId) continue;
        perPlayer.set(seat.playerId, {
          correct: got > 0,
          pointsAwarded: got * 10,
          submitted: null,
          note: null,
        });
      }
      return {
        perPlayer,
        aggregates: [],
        correctLabel: `${describer?.teamId ?? 'nobody'} got ${got}`,
        detail: null,
      };
    },
  };
}

/** Two teams of two, turn 0 described by ann, the timer running from 7 000. */
function turnRoom(game: GameModule): RoomState {
  return run(newRoom({ teamsEnabled: true, rounds: 3 }), game, [
    join('ann', 1_100, 'red'),
    join('bo', 1_101, 'blue'),
    join('cy', 1_102, 'red'),
    join('di', 1_103, 'blue'),
    host({ cmd: 'start' }, 2_000),
    timer(0, 'questionEnd', 7_000),
  ]);
}

// ---------------------------------------------------------------------------
// Answer policies
// ---------------------------------------------------------------------------

describe('a game that takes the latest answer', () => {
  const game = plainGame({ policy: 'latest' });

  it('replaces the earlier answer rather than adding to it', () => {
    const state = run(openRound(game), game, [
      text('alice', 'first thought', 2_100),
      text('alice', 'second thought', 2_200),
    ]);
    expect(state.answers).toHaveLength(1);
    expect(state.answers[0]?.value).toEqual({ type: 'text', text: 'second thought' });
  });

  it('does not reveal early when everyone is in, because a vote can still change', () => {
    const state = run(openRound(game), game, [
      text('alice', 'answer-0', 2_100),
      text('bob', 'answer-0', 2_150),
      text('cleo', 'answer-0', 2_200),
    ]);
    expect(state.phase).toBe('answering');
  });

  it('refuses a change once the window has closed', () => {
    const started = run(openRound(game), game, [text('alice', 'answer-0', 2_100)]);
    const late = (started.phaseEndsAt ?? 0) + 1;
    const state = run(started, game, [text('alice', 'too late', late)]);
    expect(state.answers[0]?.value).toEqual({ type: 'text', text: 'answer-0' });
  });

  it('hands the game one answer per player, the one that stood', () => {
    const { game: recorded, scored } = recording(game);
    run(openRound(recorded), recorded, [
      text('alice', 'wrong', 2_100),
      text('bob', 'answer-0', 2_200),
      text('alice', 'answer-0', 2_300),
      host({ cmd: 'revealNow' }, 3_000),
    ]);
    expect(scored[0]?.map((answer) => [answer.playerId, answer.value])).toEqual([
      ['bob', { type: 'text', text: 'answer-0' }],
      ['alice', { type: 'text', text: 'answer-0' }],
    ]);
  });
});

describe('a game that keeps a log', () => {
  const game = plainGame({ policy: 'log' });

  it('keeps every answer in the order it arrived, even two in the same moment', () => {
    const state = run(openRound(game), game, [
      text('alice', 'one', 2_100),
      text('bob', 'two', 2_200),
      text('alice', 'three', 2_200),
    ]);
    expect(tableOf(state).log.map((entry) => entry.value)).toEqual([
      { type: 'text', text: 'one' },
      { type: 'text', text: 'two' },
      { type: 'text', text: 'three' },
    ]);
    expect(state.phase).toBe('answering');
  });

  it('stops taking entries at the cap', () => {
    const taps = Array.from({ length: MAX_LOG_ENTRIES + 5 }, (_, index) =>
      text('alice', `tap-${index}`, 2_001 + index)
    );
    const state = run(openRound(game, { answerWindowMs: 60_000 }), game, taps);
    expect(state.answers).toHaveLength(MAX_LOG_ENTRIES);
    expect(state.answers.at(-1)?.value).toEqual({ type: 'text', text: `tap-${MAX_LOG_ENTRIES - 1}` });
  });

  it('keeps what a player sent after they leave', () => {
    const state = run(openRound(game), game, [
      text('alice', 'one', 2_100),
      { actor: asPlayer('alice'), intent: { kind: 'leave' }, at: 2_200 },
    ]);
    expect(state.answers.map((entry) => entry.playerId)).toEqual(['alice']);
  });
});

describe("a game's own rules about who may answer", () => {
  it('leaves the room exactly as it was, with nothing to do, when it refuses', () => {
    const game = plainGame({ hears: (playerId) => playerId !== 'bob' });
    const before = run(openRound(game), game, [text('alice', 'answer-0', 2_100)]);
    const refused = step(before, game, text('bob', 'answer-0', 2_200));
    expect(refused.effects).toEqual([]);
    expect(settled(refused.state)).toEqual(settled(before));
  });

  it('takes the answer as usual when it accepts', () => {
    const game = plainGame({ hears: (playerId) => playerId !== 'bob' });
    const state = run(openRound(game), game, [text('alice', 'answer-0', 2_100)]);
    expect(state.answers.map((entry) => entry.playerId)).toEqual(['alice']);
  });
});

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

describe('the seats at the table', () => {
  it('are taken when the round begins, in the order people joined', () => {
    const game = plainGame();
    const state = run(newRoom({ rounds: 2 }), game, [
      join('zed', 1_100),
      join('amy', 1_101),
      host({ cmd: 'start' }, 2_000),
    ]);
    expect(state.roundSeats).toEqual([
      { playerId: 'zed', teamId: null },
      { playerId: 'amy', teamId: null },
    ]);
  });

  it('carry no team with teams off, whatever a player picked', () => {
    const game = plainGame();
    const state = run(newRoom({ rounds: 2 }), game, [
      join('zed', 1_100, 'red'),
      host({ cmd: 'start' }, 2_000),
    ]);
    expect(state.players[0]?.teamId).toBe('red');
    expect(state.roundSeats).toEqual([{ playerId: 'zed', teamId: null }]);
  });

  it('carry each team with teams on', () => {
    const game = plainGame();
    const state = run(newRoom({ rounds: 2, teamsEnabled: true }), game, [
      join('zed', 1_100, 'gold'),
      join('amy', 1_101, 'red'),
      host({ cmd: 'start' }, 2_000),
    ]);
    expect(state.roundSeats.map((seat) => seat.teamId)).toEqual(['gold', 'red']);
  });

  it('hold nobody who arrived mid-round, and seat them from the next one', () => {
    const game = plainGame({ policy: 'latest' });
    const late = run(openRound(game), game, [join('dan', 2_500)]);
    expect(late.roundSeats.map((seat) => seat.playerId)).toEqual(['alice', 'bob', 'cleo']);

    const next = run(late, game, [host({ cmd: 'revealNow' }, 3_000), host({ cmd: 'nextRound' }, 4_000)]);
    expect(next.roundSeats.map((seat) => seat.playerId)).toEqual(['alice', 'bob', 'cleo', 'dan']);
  });

  it('hold still when someone leaves, so a deal from them does not reshuffle', () => {
    const game = plainGame();
    const state = run(openRound(game), game, [
      { actor: asPlayer('alice'), intent: { kind: 'leave' }, at: 2_500 },
    ]);
    expect(state.roundSeats.map((seat) => seat.playerId)).toEqual(['alice', 'bob', 'cleo']);
  });
});

// ---------------------------------------------------------------------------
// What each viewer is sent
// ---------------------------------------------------------------------------

/** A game whose view names the phone it was computed for. */
function mirrorGame(): GameModule {
  return {
    id: 'mirror',
    name: 'Mirror',
    supportsSolo: false,
    buildRound: (_context, index) => ({
      index,
      secret: null,
      hostView: { leak: 'HOST-ONLY-FIELD' },
      playerView: { leak: 'PLAYER-ONLY-FIELD' },
    }),
    viewFor: (_round, _table, viewer) => ({ mine: `view-for-${viewer ?? 'host'}` }),
    scoreRound: () => ({ perPlayer: new Map(), aggregates: [], correctLabel: '', detail: null }),
  };
}

describe('a view computed per viewer', () => {
  const players = ['alice', 'bob', 'cleo'];

  it('reaches only the phone it was computed for', () => {
    const game = mirrorGame();
    const state = openRound(game);
    for (const playerId of players) {
      const wire = JSON.stringify(projectForPlayer(state, playerId, game));
      expect(wire).toContain(`view-for-${playerId}`);
      for (const other of players.filter((candidate) => candidate !== playerId)) {
        expect(wire).not.toContain(`view-for-${other}`);
      }
      expect(wire).not.toContain('view-for-host');
    }
  });

  it('gives the big screen its own view and no phone’s', () => {
    const game = mirrorGame();
    const wire = JSON.stringify(projectForScreen(openRound(game), game, true));
    expect(wire).toContain('view-for-host');
    for (const playerId of players) expect(wire).not.toContain(`view-for-${playerId}`);
  });

  it('never sends the round’s own views in place of the computed ones', () => {
    const game = mirrorGame();
    const state = openRound(game);
    expect(JSON.stringify(projectForScreen(state, game, true))).not.toContain('HOST-ONLY-FIELD');
    expect(JSON.stringify(projectForPlayer(state, 'alice', game))).not.toContain('PLAYER-ONLY-FIELD');
  });

  it('can deal from the seats within each team, repeating once a team outnumbers the clues', () => {
    const game = caseGame();
    const state = run(newRoom({ teamsEnabled: true, rounds: 2 }), game, [
      join('r1', 1_100, 'red'),
      join('r2', 1_101, 'red'),
      join('b1', 1_102, 'blue'),
      join('r3', 1_103, 'red'),
      join('r4', 1_104, 'red'),
      join('r5', 1_105, 'red'),
      host({ cmd: 'start' }, 2_000),
    ]);
    const clueOf = (playerId: PlayerId): unknown =>
      (projectForPlayer(state, playerId, game).view as { clue: string }).clue;
    const red = ['r1', 'r2', 'r3', 'r4'].map(clueOf);
    expect(new Set(red).size).toBe(4);
    expect(clueOf('r5')).toBe(clueOf('r1'));
    // Blue's first seat is dealt as red's is: seat order counts within a team.
    expect(clueOf('b1')).toBe(clueOf('r1'));
    expect(JSON.stringify(projectForScreen(state, game, true))).not.toMatch(/clue-[abcd]/);
  });

  it('tells someone without a seat to wait for the next round', () => {
    const game = caseGame();
    const state = run(openRound(game), game, [join('dan', 2_500)]);
    expect(projectForPlayer(state, 'dan', game).view).toEqual({ waiting: true });
  });
});

describe('a player’s own answer', () => {
  it('is echoed to that phone alone when it can still change', () => {
    const game = plainGame({ policy: 'latest' });
    const state = run(openRound(game), game, [
      text('alice', 'alice-vote', 2_100),
      text('bob', 'bob-vote', 2_200),
    ]);
    const alice = projectForPlayer(state, 'alice', game);
    expect(alice.yourAnswer).toEqual({ type: 'text', text: 'alice-vote' });
    expect(alice.canChangeAnswer).toBe(true);
    expect(JSON.stringify(alice)).not.toContain('bob-vote');
    expect(projectForPlayer(state, 'cleo', game).yourAnswer).toBeNull();

    const big = JSON.stringify(projectForScreen(state, game, true));
    expect(big).not.toContain('alice-vote');
    expect(big).not.toContain('bob-vote');
  });

  it('is not echoed where the first answer stands, and the phone may lock', () => {
    const game = plainGame();
    const state = run(openRound(game), game, [text('alice', 'answer-0', 2_100)]);
    const alice = projectForPlayer(state, 'alice', game);
    expect(alice.yourAnswer).toBeNull();
    expect(alice.canChangeAnswer).toBe(false);
    expect(alice.youAnswered).toBe(true);
  });

  it('is not echoed from a log, which is a run of taps rather than a choice', () => {
    const game = plainGame({ policy: 'log' });
    const state = run(openRound(game), game, [text('alice', 'tap', 2_100)]);
    const alice = projectForPlayer(state, 'alice', game);
    expect(alice.yourAnswer).toBeNull();
    expect(alice.canChangeAnswer).toBe(true);
  });
});

describe('the big screen during a log round', () => {
  it('counts people in, not taps', () => {
    const game = plainGame({ policy: 'log' });
    const state = run(openRound(game), game, [
      text('alice', 'one', 2_100),
      text('alice', 'two', 2_200),
      text('bob', 'three', 2_300),
    ]);
    expect(projectForScreen(state, game, true).answeredCount).toBe(2);
  });
});

describe('a round the game says is complete', () => {
  /** A log game with nothing left to take once two taps are in. */
  function twoTapGame(): GameModule<PlainSecret> {
    return { ...plainGame({ policy: 'log' }), roundComplete: (_round, table) => table.log.length >= 2 };
  }

  it('reveals on the answer that completes it, and the same way on a replay', () => {
    const game = twoTapGame();
    const steps = [text('alice', 'one', 2_100), text('bob', 'two', 2_200)];
    const state = run(openRound(game), game, steps);
    expect(state.phase).toBe('reveal');
    expect(state.phaseStartedAt).toBe(2_200);
    expect(settled(run(openRound(game), game, steps))).toEqual(settled(state));
  });

  it('is not asked about an answer the game refused', () => {
    const game = { ...twoTapGame(), accepts: () => false };
    const state = run(openRound(game), game, [text('alice', 'one', 2_100), text('bob', 'two', 2_200)]);
    expect(state.phase).toBe('answering');
  });

  it('leaves a round that is not complete running', () => {
    const game = twoTapGame();
    const state = run(openRound(game), game, [text('alice', 'one', 2_100)]);
    expect(state.phase).toBe('answering');
  });
});

describe('what a view is told about the phase', () => {
  it('is where the round stands, so a view can withhold something until answers open', () => {
    const game: GameModule<PlainSecret> = {
      ...plainGame({ questionPhaseMs: 1_000 }),
      viewFor: (_round, _table, _viewer, phase) => ({ phase }),
    };
    const reading = openRound(game);
    expect(projectForPlayer(reading, 'alice', game).view).toEqual({ phase: 'question' });
    const open = run(reading, game, [timer(0, 'questionEnd', 3_000)]);
    expect(projectForPlayer(open, 'alice', game).view).toEqual({ phase: 'answering' });
    expect(projectForScreen(open, game, true).view).toEqual({ phase: 'answering' });
  });
});

describe('the chrome a game words for itself', () => {
  it('carries the game’s own words during a round', () => {
    const game: GameModule<PlainSecret> = {
      ...plainGame(),
      hostChrome: (round, _table, phase) => ({ roundWord: `Turn-${round.index}-${phase}` }),
    };
    expect(projectForScreen(openRound(game), game, true).chrome).toEqual({ roundWord: 'Turn-0-answering' });
  });

  it('is left out for a game with nothing to say, and outside a round', () => {
    const plain = plainGame();
    expect(projectForScreen(openRound(plain), plain, true)).not.toHaveProperty('chrome');
    const worded: GameModule<PlainSecret> = { ...plain, hostChrome: () => ({ roundWord: 'Turn' }) };
    expect(projectForScreen(newRoom(), worded, true)).not.toHaveProperty('chrome');
  });

  it('reaches a player’s own snapshot too — none of it is host-only', () => {
    const game: GameModule<PlainSecret> = {
      ...plainGame(),
      hostChrome: (round, _table, phase) => ({ roundWord: `Turn-${round.index}-${phase}` }),
    };
    const state = openRound(game);
    expect(projectForPlayer(state, 'alice', game).chrome).toEqual(
      projectForScreen(state, game, true).chrome
    );
  });

  it('is left out of a player’s snapshot the same way it is the host’s', () => {
    const plain = plainGame();
    expect(projectForPlayer(openRound(plain), 'alice', plain)).not.toHaveProperty('chrome');
  });
});

// ---------------------------------------------------------------------------
// Group voting
// ---------------------------------------------------------------------------

/** Four players, teams off, a case open for votes from 2 000. */
function caseRoom(game: GameModule, settings: Partial<RoomSettings> = {}): RoomState {
  return run(newRoom({ rounds: 2, answerWindowMs: 20_000, ...settings }), game, [
    join('ann', 1_100),
    join('bo', 1_101),
    join('cy', 1_102),
    join('di', 1_103),
    host({ cmd: 'start' }, 2_000),
  ]);
}

function resultOf(state: RoomState, playerId: PlayerId): PersonalResult | null {
  return projectPersonalResult(state, playerId);
}

describe('a group vote', () => {
  it('keeps the team’s line and adds the game’s own note about the answer the team gave', () => {
    const plain = caseGame();
    const game: GameModule<CaseSecret> = {
      ...plain,
      scoreRound(round, answers, table) {
        const outcome = plain.scoreRound(round, answers, table);
        for (const [playerId, result] of outcome.perPlayer) {
          outcome.perPlayer.set(playerId, { ...result, note: result.correct ? 'Well reasoned' : null });
        }
        return outcome;
      },
    };
    const right = run(caseRoom(game), game, [vote('ann', 0, 2_100), host({ cmd: 'revealNow' }, 3_000)]);
    expect(resultOf(right, 'bo')?.note).toBe('The room chose Moses. Well reasoned');
    const wrong = run(caseRoom(game), game, [vote('ann', 1, 2_100), host({ cmd: 'revealNow' }, 3_000)]);
    expect(resultOf(wrong, 'bo')?.note).toBe('The room chose Aaron');
  });

  it('scores everyone on the side of a right majority, dissenters and non-voters too', () => {
    const game = caseGame();
    const state = run(caseRoom(game), game, [
      vote('ann', 0, 2_100),
      vote('bo', 0, 2_200),
      vote('cy', 1, 2_300),
      host({ cmd: 'revealNow' }, 3_000),
    ]);
    for (const playerId of ['ann', 'bo', 'cy', 'di']) expect(scoreOf(state, playerId)).toBe(100);
    expect(resultOf(state, 'cy')).toEqual({
      correct: true,
      pointsAwarded: 100,
      submitted: { type: 'choice', index: 1 },
      note: 'The room chose Moses',
    });
    expect(resultOf(state, 'di')?.submitted).toBeNull();
    expect(projectReveal(state)?.groups).toEqual([
      {
        teamId: null,
        split: [
          { label: 'Moses', count: 2 },
          { label: 'Aaron', count: 1 },
        ],
        decided: 'Moses',
        correct: true,
      },
    ]);
  });

  it('scores nobody when the group is split, and still shows the answer', () => {
    const game = caseGame();
    const state = run(caseRoom(game), game, [
      vote('ann', 0, 2_100),
      vote('bo', 1, 2_200),
      host({ cmd: 'revealNow' }, 3_000),
    ]);
    for (const playerId of ['ann', 'bo', 'cy', 'di']) expect(scoreOf(state, playerId)).toBe(0);
    expect(resultOf(state, 'ann')).toEqual({
      correct: false,
      pointsAwarded: 0,
      submitted: { type: 'choice', index: 0 },
      note: 'The room was split',
    });
    const reveal = projectReveal(state);
    expect(reveal?.correctLabel).toBe('Moses');
    expect(reveal?.groups?.[0]).toMatchObject({ decided: null, correct: null });
  });

  it('decides each team on its own', () => {
    const game = caseGame();
    const state = run(newRoom({ rounds: 2, teamsEnabled: true }), game, [
      join('ann', 1_100, 'red'),
      join('bo', 1_101, 'red'),
      join('cy', 1_102, 'red'),
      join('di', 1_103, 'blue'),
      join('ed', 1_104, 'blue'),
      host({ cmd: 'start' }, 2_000),
      vote('ann', 0, 2_100),
      vote('bo', 0, 2_200),
      vote('cy', 1, 2_300),
      vote('di', 1, 2_400),
      vote('ed', 1, 2_500),
      host({ cmd: 'revealNow' }, 3_000),
    ]);
    expect(['ann', 'bo', 'cy'].map((id) => scoreOf(state, id))).toEqual([100, 100, 100]);
    expect(['di', 'ed'].map((id) => scoreOf(state, id))).toEqual([0, 0]);
    expect(resultOf(state, 'di')?.note).toBe('Your team chose Aaron');
    expect(projectReveal(state)?.groups).toEqual([
      {
        teamId: 'red',
        split: [
          { label: 'Moses', count: 2 },
          { label: 'Aaron', count: 1 },
        ],
        decided: 'Moses',
        correct: true,
      },
      { teamId: 'blue', split: [{ label: 'Aaron', count: 2 }], decided: 'Aaron', correct: false },
    ]);
    // The room-wide split is still the whole room's real votes.
    expect(projectReveal(state)?.aggregates).toEqual([
      { label: 'Moses', count: 2 },
      { label: 'Aaron', count: 3 },
    ]);
  });

  it('counts only the latest vote, which may change until time runs out', () => {
    const game = caseGame();
    const state = run(caseRoom(game), game, [
      vote('ann', 1, 2_100),
      vote('bo', 1, 2_200),
      vote('ann', 0, 2_300),
      vote('bo', 0, 2_400),
      vote('cy', 0, 2_500),
      vote('di', 0, 2_600),
    ]);
    expect(state.phase).toBe('answering');
    const ended = run(state, game, [timer(0, 'answerEnd', state.phaseEndsAt ?? 0)]);
    expect(projectReveal(ended)?.groups?.[0]?.split).toEqual([{ label: 'Moses', count: 4 }]);
    expect(projectForPlayer(state, 'ann', game).yourAnswer).toEqual({ type: 'choice', index: 0 });
  });

  it('names nobody in what it tells the room', () => {
    const game = caseGame();
    const state = run(caseRoom(game, { teamsEnabled: true }), game, [
      vote('ann', 0, 2_100),
      vote('bo', 1, 2_200),
      host({ cmd: 'revealNow' }, 3_000),
    ]);
    const wire = JSON.stringify(projectReveal(state));
    for (const playerId of ['ann', 'bo', 'cy', 'di']) expect(wire).not.toContain(playerId);
  });

  it('refuses a vote from someone without a seat, and anything that is not a vote', () => {
    const game = caseGame();
    const state = run(caseRoom(game), game, [
      join('late', 2_050),
      vote('late', 0, 2_100),
      text('ann', 'Moses', 2_200),
    ]);
    expect(state.answers).toEqual([]);
  });

  it('plays an optional vote normally until the host turns it on', () => {
    const game = caseGame({ mode: 'optional' });
    const normal = run(caseRoom(game), game, [vote('ann', 1, 2_100), vote('ann', 0, 2_200)]);
    expect(normal.answers.map((entry) => entry.value)).toEqual([{ type: 'choice', index: 1 }]);
    expect(projectForPlayer(normal, 'ann', game).canChangeAnswer).toBe(false);

    const voting = run(caseRoom(game, { groupVote: true }), game, [
      vote('ann', 1, 2_100),
      vote('ann', 0, 2_200),
    ]);
    expect(voting.answers.map((entry) => entry.value)).toEqual([{ type: 'choice', index: 0 }]);
    expect(projectForPlayer(voting, 'ann', game).canChangeAnswer).toBe(true);
  });

  it('plays normally under settings the game says it cannot vote on', () => {
    const game = caseGame({ mode: 'optional', supports: () => false });
    const state = run(caseRoom(game, { groupVote: true }), game, [
      vote('ann', 1, 2_100),
      vote('ann', 0, 2_200),
    ]);
    expect(state.answers.map((entry) => entry.value)).toEqual([{ type: 'choice', index: 1 }]);
  });

  it('cannot be switched on or off once the rounds are built', () => {
    const game = caseGame({ mode: 'optional' });
    const state = run(caseRoom(game), game, [
      host({ cmd: 'setSettings', settings: { groupVote: true } }, 2_100),
    ]);
    expect(state.settings.groupVote).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A turn of card taps
// ---------------------------------------------------------------------------

describe('a turn game', () => {
  const viewOf = (state: RoomState, game: GameModule, playerId: PlayerId): unknown =>
    projectForPlayer(state, playerId, game).view;

  it('shows the card to the describer and the other team, never to teammates or the big screen', () => {
    const game = turnGame();
    const state = turnRoom(game);
    expect(viewOf(state, game, 'ann')).toEqual({ role: 'describer', card: 'Jericho' });
    expect(viewOf(state, game, 'cy')).toEqual({ role: 'guesser' });
    expect(viewOf(state, game, 'bo')).toEqual({ role: 'watcher', card: 'Jericho' });
    expect(JSON.stringify(projectForScreen(state, game, true))).not.toContain('Jericho');

    const passed = run(state, game, [card('ann', 'pass', 0, 8_000)]);
    expect(viewOf(passed, game, 'ann')).toEqual({ role: 'describer', card: 'manna' });
    const big = JSON.stringify(projectForScreen(passed, game, true));
    expect(big).not.toContain('Jericho');
    expect(big).not.toContain('manna');
  });

  it('moves on one card for a retried tap and for two phones slipping at once', () => {
    const game = turnGame();
    const state = run(turnRoom(game), game, [
      card('ann', 'got', 0, 8_000),
      card('ann', 'got', 0, 8_001),
      card('bo', 'slip', 1, 8_100),
      card('di', 'slip', 1, 8_101),
    ]);
    expect(state.answers.map((entry) => [entry.playerId, entry.value])).toEqual([
      ['ann', { type: 'card', action: 'got', card: 0 }],
      ['bo', { type: 'card', action: 'slip', card: 1 }],
    ]);
  });

  it('takes a card only from the describer, and a slip only from the other team', () => {
    const game = turnGame();
    const state = run(turnRoom(game), game, [
      card('cy', 'got', 0, 8_000),
      card('cy', 'slip', 0, 8_100),
      card('ann', 'slip', 0, 8_200),
    ]);
    expect(state.answers).toEqual([]);
  });

  it('pays only the describing team, and says nothing to the others', () => {
    const game = turnGame();
    const playing = run(turnRoom(game), game, [
      card('ann', 'got', 0, 8_000),
      card('ann', 'got', 1, 9_000),
      card('ann', 'pass', 2, 10_000),
    ]);
    const state = run(playing, game, [timer(0, 'answerEnd', playing.phaseEndsAt ?? 0)]);
    expect(state.phase).toBe('reveal');
    expect(['ann', 'cy', 'bo', 'di'].map((id) => scoreOf(state, id))).toEqual([20, 20, 0, 0]);
    expect(resultOf(state, 'bo')).toBeNull();
    expect(projectReveal(state)?.correctLabel).toBe('red got 2');
  });

  it('keeps the cards got when the describer leaves', () => {
    const game = turnGame();
    const state = run(turnRoom(game), game, [
      card('ann', 'got', 0, 8_000),
      { actor: asPlayer('ann'), intent: { kind: 'leave' }, at: 8_500 },
    ]);
    expect(projectForScreen(state, game, true).view).toEqual({ team: 'red', describer: 'ann', got: 1 });
  });

  it('passes the turn from team to team and through each team in turn', () => {
    const game = turnGame();
    const describerIn = (state: RoomState): PlayerId | undefined =>
      ['ann', 'bo', 'cy', 'di'].find(
        (id) => (viewOf(state, game, id) as { role: string }).role === 'describer'
      );
    const first = turnRoom(game);
    const second = run(first, game, [host({ cmd: 'revealNow' }, 8_000), host({ cmd: 'nextRound' }, 9_000)]);
    const third = run(second, game, [host({ cmd: 'revealNow' }, 10_000), host({ cmd: 'nextRound' }, 11_000)]);
    expect([first, second, third].map(describerIn)).toEqual(['ann', 'bo', 'cy']);
  });

  it('keeps the standings off the big screen until the game is over', () => {
    const game = turnGame();
    const playing = run(turnRoom(game), game, [card('ann', 'got', 0, 8_000)]);
    const revealed = run(playing, game, [host({ cmd: 'revealNow' }, 9_000)]);
    for (const state of [playing, revealed]) {
      expect(projectForScreen(state, game, true).standings).toEqual([]);
      expect(projectForScreen(state, game, true).teamStandings).toEqual([]);
    }
    const over = run(revealed, game, [host({ cmd: 'end' }, 10_000)]);
    expect(projectForScreen(over, game, true).standings.length).toBeGreaterThan(0);
    expect(projectForScreen(over, game, true).teamStandings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

describe('replaying the same room', () => {
  function everything(state: RoomState, game: GameModule, players: PlayerId[]): unknown {
    return {
      state,
      host: projectForScreen(state, game, true),
      players: players.map((playerId) => projectForPlayer(state, playerId, game)),
      reveal: projectReveal(state),
      results: players.map((playerId) => projectPersonalResult(state, playerId)),
    };
  }

  it('rebuilds a group vote exactly, from the same seed and the same intents', () => {
    const replay = (): unknown => {
      const game = caseGame();
      const state = run(newRoom({ rounds: 2, teamsEnabled: true }, 11), game, [
        join('ann', 1_100),
        join('bo', 1_101),
        join('cy', 1_102),
        host({ cmd: 'start' }, 2_000),
        vote('ann', 0, 2_100),
        vote('bo', 2, 2_200),
        vote('ann', 3, 2_300),
        host({ cmd: 'revealNow' }, 3_000),
      ]);
      return everything(state, game, ['ann', 'bo', 'cy']);
    };
    expect(replay()).toEqual(replay());
  });

  it('rebuilds a turn exactly, from the same seed and the same intents', () => {
    const replay = (): unknown => {
      const game = turnGame();
      const state = run(turnRoom(game), game, [
        card('ann', 'got', 0, 8_000),
        card('bo', 'slip', 1, 8_100),
        card('ann', 'pass', 2, 8_200),
      ]);
      return everything(state, game, ['ann', 'bo', 'cy', 'di']);
    };
    expect(replay()).toEqual(replay());
  });
});

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

describe('how long the phase on screen is', () => {
  it('is the round’s own answer window, before and after a pause', () => {
    const game = plainGame({ answerWindowMs: 38_000 });
    const open = openRound(game);
    expect(projectForScreen(open, game, true).phaseDurationMs).toBe(38_000);
    const resumed = run(open, game, [host({ cmd: 'pause' }, 5_000), host({ cmd: 'resume' }, 9_000)]);
    expect(resumed.phaseEndsAt).toBe(2_000 + 38_000 + 4_000);
    expect(projectForPlayer(resumed, 'alice', game).phaseDurationMs).toBe(38_000);
  });

  it('is the reading time while a round reads, and nothing once it is revealed', () => {
    const game = plainGame({ questionPhaseMs: 3_000 });
    const reading = openRound(game);
    expect(reading.phase).toBe('question');
    expect(projectForScreen(reading, game, true).phaseDurationMs).toBe(3_000);
    const revealed = run(reading, game, [host({ cmd: 'revealNow' }, 2_500)]);
    expect(projectForScreen(revealed, game, true).phaseDurationMs).toBeNull();
  });

  it('follows a buzz round through the reader’s window and a second chance', () => {
    const game = plainGame({ usesBuzz: true, questionPhaseMs: 30_000 });
    const reading = openRound(game, { answerWindowMs: 10_000 });
    expect(projectForScreen(reading, game, true).phaseDurationMs).toBe(30_000);

    const buzzed = run(reading, game, [
      { actor: asPlayer('alice'), intent: { kind: 'buzz', round: 0, charsSeen: 5, tClient: 2_400 }, at: 2_500 },
    ]);
    expect(projectForScreen(buzzed, game, true).phaseDurationMs).toBe(10_000);

    const heard = run(buzzed, game, [text('alice', 'a woman', 3_000)]);
    expect(projectForScreen(heard, game, true).phaseDurationMs).toBeNull();

    const again = run(heard, game, [host({ cmd: 'judge', verdict: 'askToBeSpecific' }, 3_500)]);
    expect(projectForScreen(again, game, true).phaseDurationMs).toBe(5_000);
  });
});

describe('the tiebreak', () => {
  it('times each correct answer from its own opening, so a pause costs nobody', () => {
    const game = plainGame();
    const state = run(openRound(game), game, [
      text('alice', 'answer-0', 3_000),
      host({ cmd: 'pause' }, 3_500),
      host({ cmd: 'resume' }, 8_500),
      text('bob', 'answer-0', 9_500),
      host({ cmd: 'revealNow' }, 10_000),
    ]);
    const taken = (playerId: PlayerId): number | undefined =>
      state.players.find((player) => player.id === playerId)?.totalResponseMs;
    expect(taken('alice')).toBe(1_000);
    // Opened at 2 000, moved to 7 000 by the five-second pause.
    expect(taken('bob')).toBe(2_500);
  });
});
