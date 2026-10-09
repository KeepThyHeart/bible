/**
 * The board as a room plays it.
 *
 * Rounds are built here the way the room builds them — all at once, each one
 * handed the rounds before it — against a content library of a few invented
 * categories. Three things are worth more than the arithmetic: the phone can
 * never read its own answer out of a payload, the board does not drift from one
 * round to the next, and two players who are both right on a tile earn the
 * same however far apart their answers arrived.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type {
  Actor,
  AnswerValue,
  Intent,
  PlayerId,
  RoomSettings,
  ServerTime,
  TeamId,
} from '../../../../../src/modules/games/shared/protocol.js';
import { DEFAULT_THEME } from '../../../../../src/modules/games/shared/theme.js';
import type { Round, ScoredAnswer } from '../../../../../src/modules/games/shared/games.js';
import { ContentLibrary, importJson, useContent } from '../../content/index.js';
import { makeTempDir, removeTempDir } from '../../content/fixtures.js';
import { TIMER_QUESTION_END } from '../../room/phases.js';
import { projectForPlayer, projectPersonalResult, projectReveal } from '../../room/projection.js';
import { reduce } from '../../room/reducer.js';
import { createRoom } from '../../room/state.js';
import type { RoomState } from '../../room/state.js';
import { TILE_STEP, walkOrder } from './board.js';
import {
  GAME_ID,
  MAX_READING_MS,
  MIN_READING_MS,
  UNREADABLE_LABEL,
  categoryBoard,
  scoreCategoryBoard,
} from './index.js';
import type {
  CategoryBoardDetail,
  CategoryBoardHostView,
  CategoryBoardSecret,
  TileQuestion,
} from './index.js';

function seeded(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function settingsWith(overrides: Partial<RoomSettings> = {}): RoomSettings {
  return {
    gameId: GAME_ID,
    setId: null,
    translation: 'KJV',
    teamsEnabled: false,
    rounds: 10,
    answerWindowMs: 20_000,
    showIndividualScores: false,
    solo: false,
    groupVote: false,
    familiarity: 'broad',
    gameOptions: {},
    theme: DEFAULT_THEME,
    ...overrides,
  };
}

/** Builds a whole room's rounds in one go, as the room does when it starts. */
function buildRoom(rounds: number, seed = 7): Round<CategoryBoardSecret>[] {
  const random = seeded(seed);
  const built: Round<CategoryBoardSecret>[] = [];
  for (let index = 0; index < rounds; index += 1) {
    built.push(
      categoryBoard.buildRound(
        { settings: settingsWith({ rounds }), random, previous: built, choice: null },
        index
      )
    );
  }
  return built;
}

/**
 * Builds rounds as the room does once the host picks: each round is handed the
 * choice made for it, or null for a round the host let the board decide.
 */
function buildChosen(choices: readonly (string | null)[], rounds = 10, seed = 7): Round<CategoryBoardSecret>[] {
  const random = seeded(seed);
  const built: Round<CategoryBoardSecret>[] = [];
  choices.forEach((choice, index) => {
    built.push(
      categoryBoard.buildRound({ settings: settingsWith({ rounds }), random, previous: built, choice }, index)
    );
  });
  return built;
}

function hostViewOf(round: Round<CategoryBoardSecret> | undefined): CategoryBoardHostView {
  return round?.hostView as CategoryBoardHostView;
}

function questionOf(round: Round<CategoryBoardSecret> | undefined): TileQuestion {
  return round?.playerView as TileQuestion;
}

function answerOf(playerId: string, value: AnswerValue, at: ServerTime): ScoredAnswer {
  return { playerId, value, at, openedAt: 0 };
}

// ---------------------------------------------------------------------------
// An invented library: three board categories and one set that is not a board
// ---------------------------------------------------------------------------

interface FixtureCategory {
  slug: string;
  name: string;
  /** Difficulties in the order the set lists its questions. */
  listed: number[];
  tag: string;
}

const CATEGORIES: FixtureCategory[] = [
  { slug: 'kings', name: 'Kings and Queens', listed: [1, 2, 3, 4, 5], tag: 'category-board' },
  // Listed hardest first, so the board has to put them in order itself.
  { slug: 'prophets', name: 'Prophets', listed: [5, 4, 3, 2, 1], tag: 'category-board' },
  { slug: 'women', name: 'Women of the Bible', listed: [1, 2, 3, 4, 5], tag: 'category-board' },
  { slug: 'parables', name: 'Parables', listed: [1, 2, 3, 4, 5], tag: 'something-else' },
];

function questionId(slug: string, difficulty: number): string {
  return `${slug}-${difficulty}`;
}

function answerFor(slug: string, difficulty: number): string {
  return `${slug} answer ${difficulty}`;
}

function payload(): string {
  const questions = CATEGORIES.flatMap(({ slug, name, listed, tag }) =>
    listed.map((difficulty) => ({
      id: questionId(slug, difficulty),
      type: 'multiple-choice',
      prompt: `${name}, question ${difficulty}: which one is it?`,
      // One real reference, so the reveal has something to cite.
      promptVerseId: slug === 'kings' && difficulty === 1 ? 9_010_024 : null,
      answer: answerFor(slug, difficulty),
      difficulty,
      tags: [tag],
      distractors: [1, 2, 3, 4, 5, 6, 7, 8].map((rank) => `${slug} wrong ${difficulty}.${rank}`),
    }))
  );
  const sets = CATEGORIES.map(({ slug, name, listed, tag }) => ({
    id: `set-${slug}`,
    name,
    difficulty: 3,
    tags: [tag],
    questionIds: listed.map((difficulty) => questionId(slug, difficulty)),
  }));
  return JSON.stringify({ questions, sets });
}

let directory: string;
let library: ContentLibrary;
let previous: ContentLibrary | null;

beforeEach(() => {
  directory = makeTempDir('category-board-');
  library = ContentLibrary.open({
    moduleDir: join(directory, 'no-modules'),
    contentPath: ':memory:',
    defaultTranslation: 'KJV',
  });
  const report = importJson(library.db, payload());
  expect(report.rejected).toEqual([]);
  previous = useContent(library);
});

afterEach(() => {
  useContent(previous);
  library.close();
  removeTempDir(directory);
});

// ---------------------------------------------------------------------------
// Building rounds
// ---------------------------------------------------------------------------

describe('the question a tile puts up', () => {
  it('offers the answer and the three leading wrong answers', () => {
    const round = buildRoom(1)[0];
    const labels = questionOf(round).options.map((option) => option.label);
    const secret = round?.secret;
    const id = secret?.question?.id ?? '';
    const [slug, difficulty] = id.split('-');

    expect(labels).toHaveLength(4);
    expect([...labels].sort()).toEqual(
      [
        answerFor(slug ?? '', Number(difficulty)),
        ...[1, 2, 3].map((rank) => `${slug} wrong ${difficulty}.${rank}`),
      ].sort()
    );
  });

  it('tells neither screen which option is right', () => {
    const round = buildRoom(1)[0];
    const phone = JSON.stringify(round?.playerView);
    const big = JSON.stringify(round?.hostView);

    expect(Object.keys(questionOf(round)).sort()).toEqual(['category', 'options', 'prompt', 'value']);
    // The answer is one of the option labels, as it must be; what may not be
    // there is any field saying which one.
    expect(phone).not.toContain('correct');
    expect(big).not.toContain('correct');
    expect(big).not.toContain('"answer"');
  });

  it('gives the big screen the same question the phone has', () => {
    const round = buildRoom(1)[0];

    expect(hostViewOf(round).tile).toEqual(round?.playerView);
  });

  it('shows the question before the options, for as long as it takes to read', () => {
    const round = buildRoom(1)[0];

    expect(round?.questionPhaseMs).toBeGreaterThanOrEqual(MIN_READING_MS);
    expect(round?.questionPhaseMs).toBeLessThanOrEqual(MAX_READING_MS);
  });

  it('never offers a category that is not tagged for the board', () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      for (const round of buildRoom(15, seed)) {
        expect(round.secret.question?.category).not.toBe('Parables');
      }
    }
  });

  it('replays exactly, given the same generator', () => {
    expect(buildRoom(10, 21)).toEqual(buildRoom(10, 21));
  });
});

describe('the board across a room', () => {
  it('keeps the same categories on every round', () => {
    const rounds = buildRoom(10);
    const names = hostViewOf(rounds[0]).columns.map((column) => column.name);

    expect(names).toHaveLength(2);
    for (const round of rounds) {
      expect(hostViewOf(round).columns.map((column) => column.name)).toEqual(names);
    }
  });

  it('plays the easiest row across the board, then the next row down', () => {
    const rounds = buildRoom(10);
    const values = rounds.map((round) => questionOf(round).value);

    expect(values).toEqual([100, 100, 200, 200, 300, 300, 400, 400, 500, 500]);
  });

  it('climbs even in a category that was listed hardest first', () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const rounds = buildRoom(15, seed);
      const prophets = rounds.filter((round) => round.secret.question?.category === 'Prophets');

      expect(prophets.map((round) => round.secret.question?.id)).toEqual([
        'prophets-1',
        'prophets-2',
        'prophets-3',
        'prophets-4',
        'prophets-5',
      ]);
    }
  });

  it('never plays a tile twice', () => {
    const rounds = buildRoom(15);
    const asked = rounds.map((round) => round.secret.question?.id);

    expect(new Set(asked).size).toBe(15);
  });

  it('marks the tiles already played, and the one in play now', () => {
    const rounds = buildRoom(10);
    const third = hostViewOf(rounds[2]);
    const states = third.columns.map((column) => column.tiles.map((tile) => tile.state));

    // The first two rounds took the top row; the third is the start of row two.
    expect(states[0]).toEqual(['played', 'current', 'open', 'open', 'open']);
    expect(states[1]).toEqual(['played', 'open', 'open', 'open', 'open']);
  });

  it('labels every tile with what it is worth', () => {
    const view = hostViewOf(buildRoom(1)[0]);

    for (const column of view.columns) {
      expect(column.tiles.map((tile) => tile.value)).toEqual([1, 2, 3, 4, 5].map((n) => n * TILE_STEP));
    }
  });

  it('carries the board on the first round only, and plays it all the same', () => {
    const rounds = buildRoom(4);

    expect(rounds[0]?.secret.chosenBoard).not.toBeNull();
    expect(rounds.slice(1).every((round) => round.secret.chosenBoard === null)).toBe(true);
  });

  it('shows the finished board once every tile has been played', () => {
    // Three categories is the whole library, so fifteen tiles is the whole board.
    const rounds = buildRoom(17);
    const board = rounds[0]?.secret.chosenBoard;
    const last = rounds[16];

    expect(board ? walkOrder(board) : []).toHaveLength(15);
    expect(hostViewOf(last).tile).toBeNull();
    expect(last?.playerView).toBeNull();
    expect(last?.questionPhaseMs).toBeUndefined();
    expect(
      hostViewOf(last).columns.every((column) => column.tiles.every((tile) => tile.state === 'played'))
    ).toBe(true);
  });
});

describe('the host choosing a tile', () => {
  it('offers nothing to pick before the board has been drawn', () => {
    expect(categoryBoard.openChoices?.([])).toEqual([]);
  });

  it('offers every tile not yet played, named the way the big screen names them', () => {
    const [first] = buildChosen([null]);
    const open = categoryBoard.openChoices?.(first ? [first] : []) ?? [];

    // Two categories of five, less the tile the first round played.
    expect(open).toHaveLength(9);
    expect(open).not.toContain('0:0');
    expect(hostViewOf(first).columns[1]?.tiles[4]?.choice).toBe('1:4');
    expect(open).toContain('1:4');
  });

  it('plays the tile the host chose', () => {
    const rounds = buildChosen([null, '1:4']);

    expect(rounds[1]?.secret.tile).toEqual({ column: 1, row: 4 });
    expect(questionOf(rounds[1]).value).toBe(500);
  });

  it('carries on along the board after a choice, without coming back to the chosen tile', () => {
    const rounds = buildChosen([null, '1:4', null, null]);

    expect(rounds.map((round) => round.secret.tile)).toEqual([
      { column: 0, row: 0 },
      { column: 1, row: 4 },
      { column: 1, row: 0 },
      { column: 0, row: 1 },
    ]);
  });

  it('plays the next tile along for a choice it cannot use', () => {
    for (const choice of ['0:0', '7:2', '0:9', 'the hard one', '']) {
      const rounds = buildChosen([null, choice]);

      expect(rounds[1]?.secret.tile, choice).toEqual({ column: 1, row: 0 });
    }
  });
});

describe('a library with no board categories in it', () => {
  let empty: ContentLibrary;

  beforeEach(() => {
    empty = ContentLibrary.open({
      moduleDir: join(directory, 'no-modules'),
      contentPath: ':memory:',
      defaultTranslation: 'KJV',
    });
    useContent(empty);
  });

  afterEach(() => {
    empty.close();
  });

  it('builds rounds with nothing in them rather than failing in front of a group', () => {
    const rounds = buildRoom(3);

    for (const round of rounds) {
      expect(round.hostView).toBeNull();
      expect(round.playerView).toBeNull();
    }
    expect(rounds.map((round) => round.index)).toEqual([0, 1, 2]);
  });

  it('marks nobody wrong for tapping at an empty screen', () => {
    const round = buildRoom(1)[0] as Round<CategoryBoardSecret>;
    const outcome = categoryBoard.scoreRound(round, [answerOf('p-1', { type: 'choice', index: 0 }, 10)], { seats: [], log: [] });

    expect(outcome.perPlayer.size).toBe(0);
    expect(outcome.aggregates).toEqual([]);
    expect(outcome.correctLabel).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const SECRET: CategoryBoardSecret = {
  chosenBoard: null,
  tile: { column: 0, row: 2 },
  question: {
    id: 'kings-3',
    category: 'Kings and Queens',
    prompt: 'Which queen was married to King Ahab?',
    answer: 'Jezebel',
    reference: '1 Kings 16:31',
  },
  value: 300,
  options: [
    { label: 'Vashti', correct: false },
    { label: 'Jezebel', correct: true },
    { label: 'Esther', correct: false },
    { label: 'Bathsheba', correct: false },
  ],
};

describe('scoring a tile', () => {
  it('pays everyone who is right the tile value, however late they were', () => {
    const outcome = scoreCategoryBoard(SECRET, [
      answerOf('quick', { type: 'choice', index: 1 }, 100),
      answerOf('slow', { type: 'choice', index: 1 }, 19_900),
      answerOf('wrong', { type: 'choice', index: 0 }, 200),
    ]);

    expect(outcome.perPlayer.get('quick')?.pointsAwarded).toBe(300);
    expect(outcome.perPlayer.get('slow')?.pointsAwarded).toBe(300);
    expect(outcome.perPlayer.get('quick')?.correct).toBe(true);
    expect(outcome.perPlayer.get('wrong')).toEqual({
      correct: false,
      pointsAwarded: 0,
      submitted: { type: 'choice', index: 0 },
      note: null,
    });
  });

  it('names the answer it was looking for', () => {
    expect(scoreCategoryBoard(SECRET, []).correctLabel).toBe('Jezebel');
  });

  it('counts the split by option and names nobody', () => {
    const outcome = scoreCategoryBoard(SECRET, [
      answerOf('a', { type: 'choice', index: 1 }, 1),
      answerOf('b', { type: 'choice', index: 1 }, 2),
      answerOf('c', { type: 'choice', index: 3 }, 3),
    ]);

    expect(outcome.aggregates).toEqual([
      { label: 'Vashti', count: 0 },
      { label: 'Jezebel', count: 2 },
      { label: 'Esther', count: 0 },
      { label: 'Bathsheba', count: 1 },
    ]);
    // A count is all the big screen gets. Anything else on the row would be a
    // way to work out who chose what.
    for (const row of outcome.aggregates) {
      expect(Object.keys(row).sort()).toEqual(['count', 'label']);
    }
  });

  it('scores an answer of the wrong shape as nothing and says so', () => {
    const outcome = scoreCategoryBoard(SECRET, [
      answerOf('typed', { type: 'text', text: 'Jezebel' }, 1),
      answerOf('offEnd', { type: 'choice', index: 9 }, 2),
    ]);

    expect(outcome.perPlayer.get('typed')?.pointsAwarded).toBe(0);
    expect(outcome.perPlayer.get('offEnd')?.note).toBe(UNREADABLE_LABEL);
    expect(outcome.aggregates).toContainEqual({ label: UNREADABLE_LABEL, count: 2 });
  });

  it('counts only the first answer a player sent', () => {
    const outcome = scoreCategoryBoard(SECRET, [
      answerOf('p-1', { type: 'choice', index: 1 }, 900),
      answerOf('p-1', { type: 'choice', index: 0 }, 100),
    ]);

    expect(outcome.perPlayer.size).toBe(1);
    expect(outcome.perPlayer.get('p-1')?.correct).toBe(false);
  });

  it('carries the category, the value and the reference into the reveal', () => {
    const detail = scoreCategoryBoard(SECRET, []).detail as CategoryBoardDetail;

    expect(detail.category).toBe('Kings and Queens');
    expect(detail.value).toBe(300);
    expect(detail.reference).toBe('1 Kings 16:31');
    expect(detail.options.filter((option) => option.correct)).toEqual([
      { label: 'Jezebel', correct: true },
    ]);
  });

  it('pays a harder tile more, through the module as through the function', () => {
    const rounds = buildRoom(10);
    const hard = rounds[9] as Round<CategoryBoardSecret>;
    const right = hard.secret.options.findIndex((option) => option.correct);
    const outcome = categoryBoard.scoreRound(hard, [answerOf('p-1', { type: 'choice', index: right }, 5)], { seats: [], log: [] });

    expect(outcome.perPlayer.get('p-1')?.pointsAwarded).toBe(500);
    expect(outcome).toEqual(scoreCategoryBoard(hard.secret, [answerOf('p-1', { type: 'choice', index: right }, 5)]));
  });

  it('cites the verse a question came from, as a reader would write it', () => {
    // Fifteen rounds puts all three categories on the board, whatever the seed.
    const kings = buildRoom(15).find((round) => round.secret.question?.id === 'kings-1');

    expect(kings?.secret.question?.reference).toBe('1 Samuel 10:24');
  });
});

describe('the game as the room sees it', () => {
  it('reports itself as a tapped game one person can play alone', () => {
    expect(categoryBoard.id).toBe(GAME_ID);
    expect(categoryBoard.supportsSolo).toBe(true);
    expect(categoryBoard.usesBuzz).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Teams voting together, through the room
// ---------------------------------------------------------------------------

describe('teams voting together, through the room', () => {
  const WINDOW = 20_000;
  const HOST: Actor = { role: 'owner' };
  const TEAMS: readonly [PlayerId, TeamId][] = [
    ['ann', 'red'],
    ['bo', 'red'],
    ['cy', 'red'],
    ['dan', 'red'],
    ['di', 'blue'],
    ['ed', 'blue'],
    ['fay', 'blue'],
  ];

  function apply(state: RoomState, actor: Actor, intent: Intent, at: ServerTime): RoomState {
    return reduce(state, { actor, intent, receivedAt: at }, categoryBoard).state;
  }

  /** Four in red and three in blue, with the first tile's options up and open. */
  function roomOf(overrides: Partial<RoomSettings>): RoomState {
    const settings = settingsWith({ rounds: 2, teamsEnabled: true, answerWindowMs: WINDOW, ...overrides });
    let state = createRoom({ code: 'VOTE', now: 1_000, seed: 5, settings });
    TEAMS.forEach(([playerId, teamId], position) => {
      state = apply(state, { role: 'player', playerId }, { kind: 'join', name: playerId, teamId }, 1_100 + position);
    });
    state = apply(state, HOST, { kind: 'host', command: { cmd: 'start' } }, 2_000);
    // The question is read first; the options go up when that phase ends.
    return apply(state, { role: 'system' }, { kind: 'timer', round: 0, tag: TIMER_QUESTION_END }, state.phaseEndsAt ?? 0);
  }

  /** Each tap a tenth of a second after the last, from the moment the options went up. */
  function cast(room: RoomState, taps: readonly [PlayerId, number][]): RoomState {
    const opened = (room.phaseEndsAt ?? 0) - WINDOW;
    return taps.reduce(
      (state, [playerId, index], position) =>
        apply(
          state,
          { role: 'player', playerId },
          { kind: 'answer', round: 0, value: { type: 'choice', index } },
          opened + 100 * (position + 1)
        ),
      room
    );
  }

  function revealed(state: RoomState): RoomState {
    return apply(state, HOST, { kind: 'host', command: { cmd: 'revealNow' } }, (state.phaseEndsAt ?? 0) - 1_000);
  }

  function scoresOf(state: RoomState, players: readonly PlayerId[]): number[] {
    return players.map((playerId) => state.players.find((player) => player.id === playerId)?.score ?? 0);
  }

  function tileIn(state: RoomState): { right: number; wrong: number; rightLabel: string; wrongLabel: string; value: number } {
    const secret = state.rounds[0]?.secret as CategoryBoardSecret;
    const right = secret.options.findIndex((option) => option.correct);
    const wrong = (right + 1) % secret.options.length;
    return {
      right,
      wrong,
      rightLabel: secret.options[right]?.label ?? '',
      wrongLabel: secret.options[wrong]?.label ?? '',
      value: secret.value,
    };
  }

  it('pays a whole team the tile when its majority is right, dissenters and non-voters too', () => {
    const room = roomOf({ groupVote: true });
    const { right, wrong, rightLabel, wrongLabel, value } = tileIn(room);
    const state = revealed(
      cast(room, [
        ['ann', right],
        ['bo', right],
        ['cy', wrong],
        ['di', wrong],
        ['ed', wrong],
        ['fay', right],
      ])
    );

    expect(value).toBeGreaterThan(0);
    expect(scoresOf(state, ['ann', 'bo', 'cy', 'dan'])).toEqual([value, value, value, value]);
    expect(scoresOf(state, ['di', 'ed', 'fay'])).toEqual([0, 0, 0]);
    expect(projectPersonalResult(state, 'fay')).toEqual({
      correct: false,
      pointsAwarded: 0,
      submitted: { type: 'choice', index: right },
      note: `Your team chose ${wrongLabel}`,
    });
    expect(projectReveal(state)?.groups?.map((group) => [group.teamId, group.decided, group.correct])).toEqual([
      ['red', rightLabel, true],
      ['blue', wrongLabel, false],
    ]);
  });

  it('lets a vote change until time runs out, and echoes it to that phone alone', () => {
    const room = roomOf({ groupVote: true });
    const { right, wrong } = tileIn(room);
    const state = cast(room, [
      ['ann', wrong],
      ['ann', right],
    ]);

    expect(state.phase).toBe('answering');
    expect(state.answers.map((answer) => [answer.playerId, answer.value])).toEqual([
      ['ann', { type: 'choice', index: right }],
    ]);
    expect(projectForPlayer(state, 'ann', categoryBoard).canChangeAnswer).toBe(true);
    expect(projectForPlayer(state, 'ann', categoryBoard).yourAnswer).toEqual({ type: 'choice', index: right });
    expect(projectForPlayer(state, 'bo', categoryBoard).yourAnswer).toBeNull();
  });

  it('refuses a tap that names no option, so it is never counted as a vote', () => {
    const state = cast(roomOf({ groupVote: true }), [['ann', 9]]);

    expect(state.answers).toEqual([]);
  });

  it('with the switch off, a tap still stands until time runs out rather than locking in first', () => {
    const room = roomOf({ groupVote: false });
    const { right, wrong, value } = tileIn(room);
    const state = revealed(
      cast(room, [
        ['ann', wrong],
        ['ann', right],
        ['bo', wrong],
      ])
    );

    // Ann's later, correct tap stands; nobody decides for a team since
    // voting is off.
    expect(scoresOf(state, ['ann', 'bo', 'cy'])).toEqual([value, 0, 0]);
    expect(projectReveal(state)?.groups).toBeUndefined();
  });
});
