/**
 * The round and what it is worth.
 *
 * Two things are worth more than the arithmetic here. The first is that the
 * question the phone receives cannot betray its own answer, because the
 * cheapest possible cheat in this game is reading a payload. The second is that
 * two players who are both right earn the same however far apart their answers
 * arrived.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import type { GameModule, Round, ScoredAnswer } from '../../../../../src/modules/games/shared/games.js';
import { groupVoteApplies } from '../../../../../src/modules/games/shared/games.js';
import { TIMER_QUESTION_END } from '../../room/phases.js';
import { projectForPlayer, projectPersonalResult, projectReveal } from '../../room/projection.js';
import { reduce } from '../../room/reducer.js';
import { createRoom } from '../../room/state.js';
import type { RoomState } from '../../room/state.js';
import { formatRef, fromVerseId, toVerseId } from '../../../../../src/modules/games/shared/verseId.js';
import type { BibleModule } from '../../content/index.js';
import {
  BOOK_AND_CHAPTER_POINTS,
  BOOK_POINTS,
  CLOSENESS_LEVELS,
  CREDIT_LABELS,
  GAME_ID,
  MAX_READING_MS,
  MIN_READING_MS,
  ROUND_POINTS,
  createNameThatReference,
  mixFor,
  readGameOptions,
  scoreNameThatReference,
} from './index.js';
import type { NameThatReferenceSecret, NameThatReferenceView } from './index.js';
import { openFixtureCanon } from './fixtureCanon.js';
import type { OpenFixture } from './fixtureCanon.js';

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
    translation: 'FIX',
    teamsEnabled: false,
    rounds: 5,
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

let fixture: OpenFixture;
let canon: BibleModule;

beforeAll(() => {
  fixture = openFixtureCanon();
  canon = fixture.module;
});

afterAll(() => {
  fixture.close();
});

/**
 * The fixture stands in for the whole canon, so the verse being asked about is
 * drawn from it too. The curated pool describes the real Bible; a room playing
 * against six invented verses has no business consulting it.
 */
function gameUsing(
  overrides: Parameters<typeof createNameThatReference>[0] = {},
  source: BibleModule | null = null
) {
  const module = source ?? canon;
  return createNameThatReference({
    pick: (draw, random) =>
      module.randomVerse(draw.minWords === undefined ? {} : { minWords: draw.minWords }, random),
    ...overrides,
    source: () => source ?? canon,
  });
}

function buildOne(
  overrides: Parameters<typeof createNameThatReference>[0] = {},
  settings: RoomSettings = settingsWith(),
  seed = 4
): Round<NameThatReferenceSecret> {
  return gameUsing(overrides).buildRound(
    { settings, random: seeded(seed), previous: [], choice: null },
    0
  );
}

function viewOf(round: Round<NameThatReferenceSecret>): NameThatReferenceView {
  return round.playerView as NameThatReferenceView;
}

function answerOf(playerId: string, value: AnswerValue, at: ServerTime): ScoredAnswer {
  return { playerId, value, at, openedAt: 0 };
}

function roundOf(secret: NameThatReferenceSecret): Round<NameThatReferenceSecret> {
  return { index: 0, secret, hostView: null, playerView: null };
}

describe('the question a round puts up', () => {
  it('offers four references, one of them true', () => {
    const round = buildOne();
    const view = viewOf(round);

    expect(view.options).toHaveLength(4);
    expect(view.answerShape).toBe('choice');
    expect(round.secret.options.filter((option) => option.distance === null)).toHaveLength(1);
    expect(round.secret.options[round.secret.correctIndex]?.id).toBe(round.secret.verseId);
  });

  it('labels the options as a reader would write them', () => {
    const view = viewOf(buildOne());

    for (const option of view.options) {
      expect(option.label).toMatch(/^[1-3]? ?[A-Za-z ]+ \d+(:\d+)?$/);
    }
  });

  it('tells neither screen which option is right', () => {
    const round = buildOne();
    const payload = JSON.stringify(round.playerView);

    expect(Object.keys(viewOf(round)).sort()).toEqual([
      'answerShape',
      'closeness',
      'options',
      'text',
      'translation',
    ]);
    expect(payload).toBe(JSON.stringify(round.hostView));
    expect(payload).not.toContain('correct');
  });

  it('shows the verse before the options, for as long as it takes to read', () => {
    const round = buildOne();

    expect(round.questionPhaseMs).toBeGreaterThanOrEqual(MIN_READING_MS);
    expect(round.questionPhaseMs).toBeLessThanOrEqual(MAX_READING_MS);
    expect(viewOf(round).text.length).toBeGreaterThan(0);
  });

  it('replays exactly, given the same generator', () => {
    expect(buildOne({}, settingsWith(), 21)).toEqual(buildOne({}, settingsWith(), 21));
  });
});

describe('closeness as a dial', () => {
  it('keeps every wrong option at exactly the chosen rung', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const round = buildOne({ closeness: 'chapter' }, settingsWith(), seed);
      const truth = fromVerseId(round.secret.verseId);
      const wrong = round.secret.options.filter((option) => option.distance !== null);
      const label = formatRef(round.secret.verseId);

      // Every wrong option is at the requested rung, and a rung inside the
      // book never leaves it.
      expect(wrong.every((option) => option.distance === 'chapter'), label).toBe(true);
      for (const option of wrong) {
        expect(fromVerseId(option.id).book, label).toBe(truth.book);
      }
    }
  });

  it('sends every wrong option away from the book entirely at a farther rung', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const round = buildOne({ closeness: 'section' }, settingsWith(), seed);
      const truth = fromVerseId(round.secret.verseId);

      for (const option of round.secret.options) {
        if (option.distance === null) continue;
        // Usually 'section', but a book that is a whole section on its own
        // (Acts, Revelation, in this fixture) has no section rung to offer,
        // so the draw walks out to 'testament' instead — still away from the
        // book entirely, which is what this test is really checking.
        expect(['section', 'testament'], formatRef(round.secret.verseId)).toContain(option.distance);
        expect(fromVerseId(option.id).book, formatRef(round.secret.verseId)).not.toBe(truth.book);
      }
    }
  });

  it('asks the distractor draw for the same rung three times over, whichever rung is chosen', () => {
    // The uniform request is what rules out the reported default experience
    // of three closely-grouped references and one obvious outlier: a mixed
    // request is what used to make the truth's book membership (or, for a
    // farther rung, its testament) a three-against-one tell with no verse
    // knowledge required. Actually drawing at that rung can still fall
    // outward when a rung is thin (a single-chapter book's `book` shell, for
    // instance) — `distractors.test.ts` covers that — so this checks the
    // request itself rather than the fixture's necessarily sparse canon.
    for (const closeness of CLOSENESS_LEVELS) {
      expect(mixFor(closeness)).toEqual([closeness, closeness, closeness]);
    }
  });
});

describe('the two answer shapes', () => {
  it('offers no options at all when the round is typed', () => {
    const round = buildOne({ answerShape: 'reference' });

    expect(viewOf(round).answerShape).toBe('reference');
    expect(viewOf(round).options).toEqual([]);
    expect(round.secret.correctIndex).toBe(-1);
  });

  it('takes the shape and the closeness from the options the host set', () => {
    expect(readGameOptions({ closeness: 'chapter', answerShape: 'reference' })).toEqual({
      closeness: 'chapter',
      answerShape: 'reference',
    });
    expect(readGameOptions({ closeness: 'TESTAMENT' })).toEqual({
      closeness: 'testament',
      answerShape: null,
    });
    expect(readGameOptions({})).toEqual({ closeness: null, answerShape: null });

    const round = buildOne(
      {},
      settingsWith({ gameOptions: { closeness: 'chapter', answerShape: 'reference' } })
    );

    expect(round.secret.answerShape).toBe('reference');
    expect(round.secret.closeness).toBe('chapter');
  });

  it('reads the three-tier difficulty a room saved before closeness existed', () => {
    expect(readGameOptions({ difficulty: 'hard' })).toEqual({
      closeness: 'chapter',
      answerShape: null,
    });
    expect(readGameOptions({ difficulty: 'STANDARD' })).toEqual({
      closeness: 'section',
      answerShape: null,
    });
    expect(readGameOptions({ difficulty: 'easy' })).toEqual({
      closeness: 'testament',
      answerShape: null,
    });
    // closeness, once present, wins over a leftover difficulty from the same room.
    expect(readGameOptions({ difficulty: 'hard', closeness: 'anywhere' })).toEqual({
      closeness: 'anywhere',
      answerShape: null,
    });
  });

  it('plays on rather than refusing a value it does not recognise', () => {
    expect(readGameOptions({ closeness: 'brutal', answerShape: 'semaphore' })).toEqual({
      closeness: null,
      answerShape: null,
    });
    expect(readGameOptions({ difficulty: 'brutal' })).toEqual({ closeness: null, answerShape: null });
  });

  it('leaves the name of a content set alone', () => {
    // These two words used to be a covert difficulty dial, so a set named in
    // the ordinary way silently changed how the game played.
    const round = buildOne({}, settingsWith({ setId: 'gospels-easy' }));

    expect(round.secret.closeness).toBe('section');
    expect(round.secret.answerShape).toBe('choice');
  });

  it('leaves the module defaults alone for a set name it does not recognise', () => {
    const round = buildOne({ closeness: 'testament' }, settingsWith({ setId: 'psalms-and-proverbs' }));

    expect(round.secret.closeness).toBe('testament');
    expect(round.secret.answerShape).toBe('choice');
  });
});

describe('a room with no verses to draw from', () => {
  it('builds an empty round rather than failing in front of a group', () => {
    const game = createNameThatReference({ source: () => null, pick: () => null });
    const round = game.buildRound(
      { settings: settingsWith(), random: seeded(2), previous: [], choice: null },
      3
    );

    expect(round.index).toBe(3);
    expect(round.hostView).toBeNull();
    expect(round.playerView).toBeNull();
  });

  it('scores it as nothing at all', () => {
    const game = createNameThatReference({ source: () => null, pick: () => null });
    const round = game.buildRound(
      { settings: settingsWith(), random: seeded(2), previous: [], choice: null },
      0
    );
    const outcome = game.scoreRound(round, [
      answerOf('p-1', { type: 'choice', index: 0 }, 10),
    ], { seats: [], log: [] });

    expect(outcome.perPlayer.size).toBe(0);
    expect(outcome.aggregates).toEqual([]);
    expect(outcome.correctLabel).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const CHOICE_SECRET: NameThatReferenceSecret = {
  verseId: toVerseId(43, 3, 16),
  text: 'For God so loved the world.',
  translation: 'FIX',
  answerShape: 'choice',
  closeness: 'section',
  options: [
    { id: toVerseId(43, 3, 15), distance: 'chapter' },
    { id: toVerseId(43, 3, 16), distance: null },
    { id: toVerseId(43, 8, 12), distance: 'book' },
    { id: toVerseId(45, 8, 28), distance: 'section' },
  ],
  correctIndex: 1,
};

const TYPED_SECRET: NameThatReferenceSecret = {
  ...CHOICE_SECRET,
  answerShape: 'reference',
  options: [],
  correctIndex: -1,
};

describe('scoring a multiple-choice round', () => {
  it('pays everyone who is right the same, however late they were', () => {
    const outcome = scoreNameThatReference(CHOICE_SECRET, [
      answerOf('quick', { type: 'choice', index: 1 }, 100),
      answerOf('slow', { type: 'choice', index: 1 }, 19_900),
      answerOf('wrong', { type: 'choice', index: 0 }, 200),
    ]);

    expect(outcome.perPlayer.get('quick')?.pointsAwarded).toBe(ROUND_POINTS);
    expect(outcome.perPlayer.get('slow')?.pointsAwarded).toBe(ROUND_POINTS);
    expect(outcome.perPlayer.get('quick')?.correct).toBe(true);
    expect(outcome.perPlayer.get('wrong')).toEqual({
      correct: false,
      pointsAwarded: 0,
      submitted: { type: 'choice', index: 0 },
      note: null,
    });
  });

  it('names the reference it was looking for', () => {
    const outcome = scoreNameThatReference(CHOICE_SECRET, []);

    expect(outcome.correctLabel).toBe('John 3:16');
  });

  it('counts the split by option and names nobody', () => {
    const outcome = scoreNameThatReference(CHOICE_SECRET, [
      answerOf('a', { type: 'choice', index: 1 }, 1),
      answerOf('b', { type: 'choice', index: 1 }, 2),
      answerOf('c', { type: 'choice', index: 0 }, 3),
    ]);

    expect(outcome.aggregates).toEqual([
      { label: 'John 3:15', count: 1 },
      { label: 'John 3:16', count: 2 },
      { label: 'John 8:12', count: 0 },
      { label: 'Romans 8:28', count: 0 },
    ]);
    // A count is all the big screen gets. Anything else on the row would be a
    // way to work out who chose what.
    for (const row of outcome.aggregates) {
      expect(Object.keys(row).sort()).toEqual(['count', 'label']);
    }
  });

  it('scores an answer of the wrong shape as nothing and says so', () => {
    const outcome = scoreNameThatReference(CHOICE_SECRET, [
      answerOf('stale', { type: 'text', text: 'John 3:16' }, 1),
      answerOf('offEnd', { type: 'choice', index: 9 }, 2),
    ]);

    expect(outcome.perPlayer.get('stale')?.pointsAwarded).toBe(0);
    expect(outcome.perPlayer.get('offEnd')?.note).toBe(CREDIT_LABELS.unreadable);
    expect(outcome.aggregates).toContainEqual({ label: CREDIT_LABELS.unreadable, count: 2 });
  });

  it('counts only the first answer a player sent', () => {
    const outcome = scoreNameThatReference(CHOICE_SECRET, [
      answerOf('p-1', { type: 'choice', index: 1 }, 900),
      answerOf('p-1', { type: 'choice', index: 0 }, 100),
    ]);

    expect(outcome.perPlayer.size).toBe(1);
    expect(outcome.perPlayer.get('p-1')?.correct).toBe(false);
  });
});

describe('scoring a typed reference', () => {
  const submissions: [string, AnswerValue, number][] = [
    ['exact', { type: 'reference', book: 43, chapter: 3, verse: 16 }, ROUND_POINTS],
    ['chapter', { type: 'reference', book: 43, chapter: 3, verse: 1 }, BOOK_AND_CHAPTER_POINTS],
    ['book', { type: 'reference', book: 43, chapter: 9, verse: 16 }, BOOK_POINTS],
    ['miss', { type: 'reference', book: 42, chapter: 3, verse: 16 }, 0],
    ['unreadable', { type: 'found' }, 0],
  ];

  it('pays for as much of the reference as the player had', () => {
    for (const [name, value, points] of submissions) {
      const outcome = scoreNameThatReference(TYPED_SECRET, [answerOf(name, value, 1)]);

      expect(outcome.perPlayer.get(name)?.pointsAwarded, name).toBe(points);
      expect(outcome.perPlayer.get(name)?.correct, name).toBe(points === ROUND_POINTS);
    }
  });

  it('does not credit a chapter number that matched by accident', () => {
    const outcome = scoreNameThatReference(TYPED_SECRET, [
      answerOf('p-1', { type: 'reference', book: 42, chapter: 3, verse: 16 }, 1),
    ]);

    expect(outcome.perPlayer.get('p-1')?.pointsAwarded).toBe(0);
    expect(outcome.perPlayer.get('p-1')?.note).toBe(CREDIT_LABELS.miss);
  });

  it('shows the room how far it got, in tiers, without naming anyone', () => {
    const outcome = scoreNameThatReference(
      TYPED_SECRET,
      submissions.map(([name, value], index) => answerOf(name, value, index + 1))
    );

    expect(outcome.aggregates).toEqual([
      { label: CREDIT_LABELS.exact, count: 1 },
      { label: CREDIT_LABELS.bookAndChapter, count: 1 },
      { label: CREDIT_LABELS.book, count: 1 },
      { label: CREDIT_LABELS.miss, count: 1 },
      { label: CREDIT_LABELS.unreadable, count: 1 },
    ]);
  });

  it('carries the verse and the reference into the reveal', () => {
    const outcome = scoreNameThatReference(TYPED_SECRET, []);
    const detail = outcome.detail as { reference: string; text: string; answerShape: string };

    expect(detail.reference).toBe('John 3:16');
    expect(detail.text).toBe(TYPED_SECRET.text);
    expect(detail.answerShape).toBe('reference');
  });
});

describe('the round as the room sees it', () => {
  it('reports itself as a game one person can play alone', () => {
    const game = gameUsing();

    expect(game.id).toBe(GAME_ID);
    expect(game.supportsSolo).toBe(true);
    expect(game.usesBuzz).toBe(false);
  });

  it('scores through the module the same way as through the function', () => {
    const round = roundOf(CHOICE_SECRET);
    const answers = [answerOf('p-1', { type: 'choice', index: 1 }, 5)];

    expect(gameUsing().scoreRound(round, answers, { seats: [], log: [] })).toEqual(
      scoreNameThatReference(CHOICE_SECRET, answers)
    );
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

  type Game = GameModule<NameThatReferenceSecret>;

  function apply(game: Game, state: RoomState, actor: Actor, intent: Intent, at: ServerTime): RoomState {
    return reduce(state, { actor, intent, receivedAt: at }, game).state;
  }

  /** Four in red and three in blue, with the round's answers open. */
  function roomOf(game: Game, overrides: Partial<RoomSettings>): RoomState {
    const settings = settingsWith({ rounds: 1, teamsEnabled: true, answerWindowMs: WINDOW, ...overrides });
    let state = createRoom({ code: 'VOTE', now: 1_000, seed: 5, settings });
    TEAMS.forEach(([playerId, teamId], position) => {
      state = apply(game, state, { role: 'player', playerId }, { kind: 'join', name: playerId, teamId }, 1_100 + position);
    });
    state = apply(game, state, HOST, { kind: 'host', command: { cmd: 'start' } }, 2_000);
    // The verse is read first; answers open when that phase ends.
    return apply(
      game,
      state,
      { role: 'system' },
      { kind: 'timer', round: 0, tag: TIMER_QUESTION_END },
      state.phaseEndsAt ?? 0
    );
  }

  /** Each answer a tenth of a second after the last, from the moment answers opened. */
  function cast(game: Game, room: RoomState, answers: readonly [PlayerId, AnswerValue][]): RoomState {
    const opened = (room.phaseEndsAt ?? 0) - WINDOW;
    return answers.reduce(
      (state, [playerId, value], position) =>
        apply(game, state, { role: 'player', playerId }, { kind: 'answer', round: 0, value }, opened + 100 * (position + 1)),
      room
    );
  }

  function revealed(game: Game, state: RoomState): RoomState {
    return apply(game, state, HOST, { kind: 'host', command: { cmd: 'revealNow' } }, (state.phaseEndsAt ?? 0) - 1_000);
  }

  function scoresOf(state: RoomState, players: readonly PlayerId[]): number[] {
    return players.map((playerId) => state.players.find((player) => player.id === playerId)?.score ?? 0);
  }

  const tap = (index: number): AnswerValue => ({ type: 'choice', index });

  function optionsIn(state: RoomState): { right: number; wrong: number; rightLabel: string; wrongLabel: string } {
    const secret = state.rounds[0]?.secret as NameThatReferenceSecret;
    const right = secret.correctIndex;
    const wrong = (right + 1) % secret.options.length;
    const labelAt = (position: number): string => {
      const option = secret.options[position];
      return option === undefined ? '' : formatRef(option.id);
    };
    return { right, wrong, rightLabel: labelAt(right), wrongLabel: labelAt(wrong) };
  }

  it('pays a whole team what its majority chose, dissenters and non-voters too', () => {
    const game = gameUsing();
    const room = roomOf(game, { groupVote: true });
    const { right, wrong, rightLabel, wrongLabel } = optionsIn(room);
    const state = revealed(
      game,
      cast(game, room, [
        ['ann', tap(right)],
        ['bo', tap(right)],
        ['cy', tap(wrong)],
        ['di', tap(wrong)],
        ['ed', tap(wrong)],
        ['fay', tap(right)],
      ])
    );

    expect(scoresOf(state, ['ann', 'bo', 'cy', 'dan'])).toEqual([ROUND_POINTS, ROUND_POINTS, ROUND_POINTS, ROUND_POINTS]);
    expect(scoresOf(state, ['di', 'ed', 'fay'])).toEqual([0, 0, 0]);
    expect(projectPersonalResult(state, 'dan')).toEqual({
      correct: true,
      pointsAwarded: ROUND_POINTS,
      submitted: null,
      note: `Your team chose ${rightLabel}`,
    });
    expect(projectReveal(state)?.groups?.map((group) => [group.teamId, group.decided, group.correct])).toEqual([
      ['red', rightLabel, true],
      ['blue', wrongLabel, false],
    ]);
  });

  it('lets a vote change until time runs out, and echoes it to that phone alone', () => {
    const game = gameUsing();
    const room = roomOf(game, { groupVote: true });
    const { right, wrong } = optionsIn(room);
    const state = cast(game, room, [
      ['ann', tap(wrong)],
      ['ann', tap(right)],
    ]);

    expect(state.phase).toBe('answering');
    expect(state.answers.map((answer) => [answer.playerId, answer.value])).toEqual([['ann', tap(right)]]);
    expect(projectForPlayer(state, 'ann', game).canChangeAnswer).toBe(true);
    expect(projectForPlayer(state, 'ann', game).yourAnswer).toEqual(tap(right));
    expect(projectForPlayer(state, 'bo', game).yourAnswer).toBeNull();
  });

  it('cannot be voted on in its typed shape, but still lets a second guess replace the first', () => {
    const game = gameUsing();
    const typed = { groupVote: true, gameOptions: { answerShape: 'reference' } };

    expect(groupVoteApplies(game.groupVote, settingsWith(typed))).toBe(false);
    expect(groupVoteApplies(game.groupVote, settingsWith({ groupVote: true }))).toBe(true);
    expect(groupVoteApplies(createNameThatReference({ answerShape: 'reference' }).groupVote, settingsWith({ groupVote: true }))).toBe(false);

    const second: AnswerValue = { type: 'reference', book: 1, chapter: 1, verse: 1 };
    const state = cast(game, roomOf(game, typed), [
      ['ann', { type: 'reference', book: 43, chapter: 3, verse: 16 }],
      ['ann', second],
    ]);

    // Group voting never applies to the typed shape — it is never counted as
    // a team's vote — but the game's own answerPolicy is `latest` regardless,
    // so a second guess still replaces the first rather than being refused.
    expect(state.answers.map((answer) => answer.value)).toEqual([second]);
    expect(projectForPlayer(state, 'ann', game).canChangeAnswer).toBe(true);
  });

  it('with the switch off, a tap still stands until time runs out rather than locking in first', () => {
    const game = gameUsing();
    const room = roomOf(game, { groupVote: false });
    const { right, wrong } = optionsIn(room);
    const state = revealed(
      game,
      cast(game, room, [
        ['ann', tap(wrong)],
        ['ann', tap(right)],
        ['bo', tap(wrong)],
      ])
    );

    // Ann's later, correct tap stands; nobody decides for a team since
    // voting is off.
    expect(scoresOf(state, ['ann', 'bo', 'cy'])).toEqual([ROUND_POINTS, 0, 0]);
    expect(projectReveal(state)?.groups).toBeUndefined();
  });
});
