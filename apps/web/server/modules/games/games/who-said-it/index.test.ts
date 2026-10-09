/**
 * The round and what it is worth.
 *
 * Three things matter more than the arithmetic. The payload a phone receives
 * must not betray the answer or the reference, because reading a payload is the
 * cheapest cheat there is. The room's familiarity must hold, so a `core` room
 * hears Cain and not Hagar. And two players who are both right earn the same,
 * however far apart their taps arrived.
 *
 * Content comes from a library built here: a handful of sayings and a module
 * holding their verses. The imported library describes the real Bible, and a
 * test that depended on it would pass or fail with whatever was last imported.
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
import type { Round, RoundBuildContext, ScoredAnswer } from '../../../../../src/modules/games/shared/games.js';
import { toVerseId } from '../../../../../src/modules/games/shared/verseId.js';
import type { VerseId } from '../../../../../src/modules/games/shared/verseId.js';
import { ContentLibrary, importContent, useContent } from '../../content/index.js';
import { makeTempDir, removeTempDir, writeFixtureModule } from '../../content/fixtures.js';
import { TIMER_QUESTION_END } from '../../room/phases.js';
import { projectForPlayer, projectPersonalResult, projectReveal } from '../../room/projection.js';
import { reduce } from '../../room/reducer.js';
import { createRoom } from '../../room/state.js';
import type { RoomState } from '../../room/state.js';
import {
  GAME_ID,
  MAX_READING_MS,
  MIN_READING_MS,
  ROUND_POINTS,
  UNREADABLE_LABEL,
  listenerOf,
  quotationOf,
  scoreWhoSaidIt,
  whoSaidIt,
} from './index.js';
import type { WhoSaidItDetail, WhoSaidItSecret, WhoSaidItView } from './index.js';

/**
 * A mixing generator rather than a bare linear one: neighbouring seeds of a
 * linear generator give nearly the same first value, so a loop over seeds would
 * draw the same saying every time and prove nothing about the others.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
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
    familiarity: 'any',
    gameOptions: {},
    theme: DEFAULT_THEME,
    ...overrides,
  };
}

type Built = Round<WhoSaidItSecret | null>;

function contextOf(
  random: () => number,
  overrides: Partial<RoomSettings> = {},
  previous: readonly Built[] = []
): RoundBuildContext<WhoSaidItSecret | null> {
  return { settings: settingsWith(overrides), random, previous, choice: null };
}

function viewOf(round: Built): WhoSaidItView {
  return round.playerView as WhoSaidItView;
}

function answerOf(playerId: string, value: AnswerValue, at: ServerTime): ScoredAnswer {
  return { playerId, value, at, openedAt: 0 };
}

// ---------------------------------------------------------------------------
// The library the rounds are drawn from
// ---------------------------------------------------------------------------

const CAIN_VERSE = toVerseId(1, 4, 9);
const EVE_VERSE = toVerseId(1, 3, 13);
const ISAAC_VERSE = toVerseId(1, 22, 7);
const RUTH_VERSE = toVerseId(8, 1, 16);
/** Left out of the module on purpose: a saying whose verse the module lacks. */
const HAGAR_VERSE = toVerseId(1, 21, 16);

const VERSES = [
  {
    id: CAIN_VERSE,
    text: 'And the LORD said unto Cain, Where is Abel thy brother? And he said, I know not: Am I my brother’s keeper?',
  },
  { id: EVE_VERSE, text: 'And the woman said, The serpent beguiled me, and I did eat.' },
  {
    id: ISAAC_VERSE,
    text: 'And Isaac spake unto Abraham his father, and said, My father: and he said, Here am I, my son. And he said, Behold the fire and the wood: but where is the lamb for a burnt offering?',
  },
  {
    id: RUTH_VERSE,
    text: 'And Ruth said, Intreat me not to leave thee, or to return from following after thee: for whither thou goest, I will go.',
  },
];

const NAMES = ['Abel', 'Seth', 'Noah', 'Sarah', 'Rebekah', 'Rachel', 'Leah', 'Miriam', 'Naomi', 'Orpah'];

interface Saying {
  id: string;
  answer: string;
  verseId: VerseId;
  difficulty: number;
  quote: string;
  listener?: string;
  reference: string;
}

const SAYINGS: readonly Saying[] = [
  { id: 'cain', answer: 'Cain', verseId: CAIN_VERSE, difficulty: 1, quote: 'Am I my brother’s keeper?', listener: 'God', reference: 'Genesis 4:9' },
  { id: 'eve', answer: 'Eve', verseId: EVE_VERSE, difficulty: 1, quote: 'The serpent beguiled me, and I did eat', listener: 'God', reference: 'Genesis 3:13' },
  { id: 'isaac', answer: 'Isaac', verseId: ISAAC_VERSE, difficulty: 2, quote: 'where is the lamb for a burnt offering?', listener: 'his father', reference: 'Genesis 22:7' },
  { id: 'ruth', answer: 'Ruth', verseId: RUTH_VERSE, difficulty: 2, quote: 'whither thou goest, I will go', listener: 'Naomi', reference: 'Ruth 1:16' },
  { id: 'hagar', answer: 'Hagar', verseId: HAGAR_VERSE, difficulty: 4, quote: 'Let me not see the death of the child', reference: 'Genesis 21:16' },
];

const DIFFICULTY = new Map(SAYINGS.map((entry) => [entry.id, entry.difficulty]));

function questionFor(entry: Saying): Record<string, unknown> {
  return {
    id: entry.id,
    type: 'multiple-choice',
    prompt: `Who said, “${entry.quote}”`,
    promptVerseId: entry.verseId,
    answer: entry.answer,
    contextNote:
      entry.listener === undefined ? entry.reference : `${entry.reference}, spoken to ${entry.listener}`,
    difficulty: entry.difficulty,
    tags: ['who-said-it'],
    distractors: NAMES.filter((name) => name !== entry.answer).slice(0, 8),
  };
}

/** Another game's question, which this one must never ask. */
const NOT_OURS = {
  id: 'someone-else',
  type: 'multiple-choice',
  prompt: 'Who am I? I led the people out of Egypt.',
  answer: 'Moses',
  difficulty: 1,
  tags: ['who-am-i'],
  distractors: NAMES.slice(0, 8),
};

let directory: string;
let library: ContentLibrary;
let previous: ContentLibrary | null;

beforeEach(() => {
  directory = makeTempDir('who-said-it-');
  writeFixtureModule(join(directory, 'modules', 'fixture.db'), { abbreviation: 'FIX', verses: VERSES });
  library = ContentLibrary.open({
    moduleDir: join(directory, 'modules'),
    contentPath: ':memory:',
    defaultTranslation: 'FIX',
  });
  const report = importContent(library.db, { questions: [...SAYINGS.map(questionFor), NOT_OURS] });
  expect(report.rejected).toEqual([]);
  previous = useContent(library);
});

afterEach(() => {
  useContent(previous);
  library.close();
  removeTempDir(directory);
});

function buildOne(overrides: Partial<RoomSettings> = {}, seed = 4): Built {
  return whoSaidIt.buildRound(contextOf(seeded(seed), overrides), 0);
}

function buildGame(rounds: number, overrides: Partial<RoomSettings> = {}, seed = 7): Built[] {
  const random = seeded(seed);
  const built: Built[] = [];
  for (let index = 0; index < rounds; index += 1) {
    built.push(whoSaidIt.buildRound(contextOf(random, overrides, built), index));
  }
  return built;
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

describe('the question a round puts up', () => {
  it('offers four names, one of them the speaker', () => {
    const round = buildOne();
    const secret = round.secret;

    expect(viewOf(round).options).toHaveLength(4);
    expect(secret?.options.filter((option) => option.correct)).toEqual([
      { label: secret?.speaker, correct: true },
    ]);
    expect(viewOf(round).options.map((option) => option.index)).toEqual([0, 1, 2, 3]);
  });

  it('draws the wrong names from the question’s own list', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const secret = buildOne({}, seed).secret;
      for (const option of secret?.options ?? []) {
        if (!option.correct) expect(NAMES, option.label).toContain(option.label);
      }
    }
  });

  it('shows the words alone, without the framing of the prompt', () => {
    const round = buildOne();
    const saying = SAYINGS.find((entry) => entry.id === round.secret?.questionId);

    expect(viewOf(round).quote).toBe(saying?.quote);
  });

  it('tells neither screen who said it or where', () => {
    const round = buildOne();
    const payload = JSON.stringify(round.playerView);

    expect(Object.keys(viewOf(round)).sort()).toEqual(['options', 'quote']);
    expect(payload).toBe(JSON.stringify(round.hostView));
    expect(payload).not.toContain('correct');
    expect(payload).not.toContain(round.secret?.reference ?? 'unreachable');
    expect(payload).not.toContain(round.secret?.questionId ?? 'unreachable');
  });

  it('shows the quotation before the names, for as long as it takes to read', () => {
    const round = buildOne();

    expect(round.questionPhaseMs).toBeGreaterThanOrEqual(MIN_READING_MS);
    expect(round.questionPhaseMs).toBeLessThanOrEqual(MAX_READING_MS);
  });

  it('replays exactly, given the same generator', () => {
    expect(buildOne({}, 21)).toEqual(buildOne({}, 21));
  });

  it('asks only the questions written for this game', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      expect(buildOne({}, seed).secret?.questionId).not.toBe(NOT_OURS.id);
    }
  });
});

describe('what the reveal is handed', () => {
  function builtFor(id: string, overrides: Partial<RoomSettings> = {}): WhoSaidItSecret {
    for (let seed = 1; seed <= 200; seed += 1) {
      const secret = buildOne(overrides, seed).secret;
      if (secret?.questionId === id) return secret;
    }
    throw new Error(`no seed under 200 drew ${id}`);
  }

  it('carries the verse from the module, its reference and who was listening', () => {
    const secret = builtFor('isaac');

    expect(secret.text).toBe(VERSES[2]?.text);
    expect(secret.translation).toBe('FIX');
    expect(secret.reference).toBe('Genesis 22:7');
    expect(secret.listener).toBe('his father');
  });

  it('still has the verse when the room names a translation nobody installed', () => {
    const secret = builtFor('cain', { translation: 'KJV' });

    expect(secret.text).toContain('brother’s keeper');
    // The label says which translation actually answered, not which was asked for.
    expect(secret.translation).toBe('FIX');
  });

  it('plays a saying whose verse the module lacks, and says nothing of the verse', () => {
    const secret = builtFor('hagar');

    expect(secret.text).toBe('');
    expect(secret.reference).toBe('Genesis 21:16');
    expect(secret.listener).toBeNull();
  });
});

describe('the room’s familiarity', () => {
  it('keeps a core room to the sayings everyone knows', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const id = buildOne({ familiarity: 'core' }, seed).secret?.questionId ?? '';
      expect(DIFFICULTY.get(id), id).toBe(1);
    }
  });

  it('lets a room that asked for anything have anything', () => {
    const seen = new Set<string | undefined>();
    for (let seed = 1; seed <= 60; seed += 1) seen.add(buildOne({ familiarity: 'any' }, seed).secret?.questionId);

    expect(seen).toEqual(new Set(SAYINGS.map((entry) => entry.id)));
  });
});

describe('a whole game', () => {
  it('never asks the same saying twice', () => {
    const asked = buildGame(5).map((round) => round.secret?.questionId);

    expect(new Set(asked).size).toBe(5);
  });

  it('steps up only as far as it must once a core room has heard every core saying', () => {
    const asked = buildGame(4, { familiarity: 'core' }).map(
      (round) => DIFFICULTY.get(round.secret?.questionId ?? '') ?? 0
    );

    expect(asked.slice(0, 2)).toEqual([1, 1]);
    expect(asked.slice(2)).toEqual([2, 2]);
  });

  it('puts up an honest empty round once every saying has been asked', () => {
    const rounds = buildGame(6);
    const last = rounds[5];

    expect(last?.secret).toBeNull();
    expect(last?.hostView).toBeNull();
    expect(last?.playerView).toBeNull();
  });
});

describe('a server with nothing imported', () => {
  let empty: ContentLibrary;

  beforeEach(() => {
    empty = ContentLibrary.open({
      moduleDir: join(directory, 'nothing-here'),
      contentPath: ':memory:',
      defaultTranslation: 'FIX',
    });
    useContent(empty);
  });

  afterEach(() => {
    empty.close();
  });

  it('builds an empty round rather than failing in front of a group', () => {
    const round = whoSaidIt.buildRound(contextOf(seeded(2)), 3);

    expect(round.index).toBe(3);
    expect(round.secret).toBeNull();
    expect(round.hostView).toBeNull();
    expect(round.playerView).toBeNull();
  });

  it('marks nobody wrong for having tapped at an empty screen', () => {
    const round = whoSaidIt.buildRound(contextOf(seeded(2)), 0);
    const outcome = whoSaidIt.scoreRound(round, [answerOf('p-1', { type: 'choice', index: 0 }, 10)], { seats: [], log: [] });

    expect(outcome.perPlayer.size).toBe(0);
    expect(outcome.aggregates).toEqual([]);
    expect(outcome.correctLabel).toBe('');
    expect(outcome.detail).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reading a question
// ---------------------------------------------------------------------------

describe('reading what the question was written as', () => {
  it('takes the quotation out of its prompt', () => {
    expect(quotationOf('Who said, “Am I my brother’s keeper?”')).toBe('Am I my brother’s keeper?');
    expect(quotationOf('Who said, "Here am I"')).toBe('Here am I');
  });

  it('shows a prompt with no quotation marks whole', () => {
    expect(quotationOf('  Who said that there is a time to every purpose?  ')).toBe(
      'Who said that there is a time to every purpose?'
    );
  });

  it('finds the listener in the context note, when there is one', () => {
    expect(listenerOf('Genesis 22:7, spoken to his father')).toBe('his father');
    expect(listenerOf('Genesis 21:6')).toBeNull();
    expect(listenerOf(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const SECRET: WhoSaidItSecret = {
  questionId: 'cain',
  speaker: 'Cain',
  quote: 'Am I my brother’s keeper?',
  verseId: CAIN_VERSE,
  reference: 'Genesis 4:9',
  listener: 'God',
  text: 'Am I my brother’s keeper?',
  translation: 'FIX',
  options: [
    { label: 'Abel', correct: false },
    { label: 'Cain', correct: true },
    { label: 'Seth', correct: false },
    { label: 'Noah', correct: false },
  ],
};

describe('scoring a round', () => {
  it('pays everyone who is right the same, however late they were', () => {
    const outcome = scoreWhoSaidIt(SECRET, [
      answerOf('quick', { type: 'choice', index: 1 }, 100),
      answerOf('slow', { type: 'choice', index: 1 }, 19_900),
      answerOf('wrong', { type: 'choice', index: 0 }, 200),
    ]);

    expect(outcome.perPlayer.get('quick')?.pointsAwarded).toBe(ROUND_POINTS);
    expect(outcome.perPlayer.get('slow')?.pointsAwarded).toBe(ROUND_POINTS);
    expect(outcome.perPlayer.get('wrong')).toEqual({
      correct: false,
      pointsAwarded: 0,
      submitted: { type: 'choice', index: 0 },
      note: null,
    });
  });

  it('names the speaker as the answer', () => {
    expect(scoreWhoSaidIt(SECRET, []).correctLabel).toBe('Cain');
  });

  it('counts the split by name and names no player', () => {
    const outcome = scoreWhoSaidIt(SECRET, [
      answerOf('a', { type: 'choice', index: 1 }, 1),
      answerOf('b', { type: 'choice', index: 1 }, 2),
      answerOf('c', { type: 'choice', index: 3 }, 3),
    ]);

    expect(outcome.aggregates).toEqual([
      { label: 'Abel', count: 0 },
      { label: 'Cain', count: 2 },
      { label: 'Seth', count: 0 },
      { label: 'Noah', count: 1 },
    ]);
    for (const row of outcome.aggregates) {
      expect(Object.keys(row).sort()).toEqual(['count', 'label']);
    }
  });

  it('scores an answer of the wrong shape as nothing and says so', () => {
    const outcome = scoreWhoSaidIt(SECRET, [
      answerOf('typed', { type: 'text', text: 'Cain' }, 1),
      answerOf('offEnd', { type: 'choice', index: 9 }, 2),
    ]);

    expect(outcome.perPlayer.get('typed')?.pointsAwarded).toBe(0);
    expect(outcome.perPlayer.get('offEnd')?.note).toBe(UNREADABLE_LABEL);
    expect(outcome.aggregates).toContainEqual({ label: UNREADABLE_LABEL, count: 2 });
  });

  it('leaves the unreadable row off when every answer was one of the names', () => {
    const outcome = scoreWhoSaidIt(SECRET, [answerOf('a', { type: 'choice', index: 1 }, 1)]);

    expect(outcome.aggregates.map((row) => row.label)).not.toContain(UNREADABLE_LABEL);
  });

  it('counts only the first answer a player sent', () => {
    const outcome = scoreWhoSaidIt(SECRET, [
      answerOf('p-1', { type: 'choice', index: 1 }, 900),
      answerOf('p-1', { type: 'choice', index: 0 }, 100),
    ]);

    expect(outcome.perPlayer.size).toBe(1);
    expect(outcome.perPlayer.get('p-1')?.correct).toBe(false);
  });

  it('hands the reveal the speaker, the verse, its reference and its listener', () => {
    const detail = scoreWhoSaidIt(SECRET, []).detail as WhoSaidItDetail;

    expect(detail).toEqual({
      speaker: 'Cain',
      quote: SECRET.quote,
      reference: 'Genesis 4:9',
      listener: 'God',
      text: SECRET.text,
      translation: 'FIX',
      options: SECRET.options,
    });
  });
});

describe('the module as the room sees it', () => {
  it('names itself descriptively and plays alone', () => {
    expect(whoSaidIt.id).toBe('who-said-it');
    expect(whoSaidIt.supportsSolo).toBe(true);
    expect(whoSaidIt.usesBuzz).toBe(false);
  });

  it('scores through the module the same way as through the function', () => {
    const round: Built = { index: 0, secret: SECRET, hostView: null, playerView: null };
    const answers = [answerOf('p-1', { type: 'choice', index: 1 }, 5)];

    expect(whoSaidIt.scoreRound(round, answers, { seats: [], log: [] })).toEqual(scoreWhoSaidIt(SECRET, answers));
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
    return reduce(state, { actor, intent, receivedAt: at }, whoSaidIt).state;
  }

  /** Four in red and three in blue, with the round's names up and open. */
  function roomOf(overrides: Partial<RoomSettings>): RoomState {
    const settings = settingsWith({ rounds: 1, teamsEnabled: true, answerWindowMs: WINDOW, ...overrides });
    let state = createRoom({ code: 'VOTE', now: 1_000, seed: 5, settings });
    TEAMS.forEach(([playerId, teamId], position) => {
      state = apply(state, { role: 'player', playerId }, { kind: 'join', name: playerId, teamId }, 1_100 + position);
    });
    state = apply(state, HOST, { kind: 'host', command: { cmd: 'start' } }, 2_000);
    // The quotation is read first; the names go up when that phase ends.
    return apply(state, { role: 'system' }, { kind: 'timer', round: 0, tag: TIMER_QUESTION_END }, state.phaseEndsAt ?? 0);
  }

  /** Each tap a tenth of a second after the last, from the moment the names went up. */
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

  function namesIn(state: RoomState): { right: number; wrong: number; rightName: string; wrongName: string } {
    const secret = state.rounds[0]?.secret as WhoSaidItSecret;
    const right = secret.options.findIndex((option) => option.correct);
    const wrong = (right + 1) % secret.options.length;
    return {
      right,
      wrong,
      rightName: secret.options[right]?.label ?? '',
      wrongName: secret.options[wrong]?.label ?? '',
    };
  }

  it('pays a whole team what its majority chose, dissenters and non-voters too', () => {
    const room = roomOf({ groupVote: true });
    const { right, wrong, rightName, wrongName } = namesIn(room);
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

    expect(scoresOf(state, ['ann', 'bo', 'cy', 'dan'])).toEqual([ROUND_POINTS, ROUND_POINTS, ROUND_POINTS, ROUND_POINTS]);
    expect(scoresOf(state, ['di', 'ed', 'fay'])).toEqual([0, 0, 0]);
    expect(projectPersonalResult(state, 'cy')).toEqual({
      correct: true,
      pointsAwarded: ROUND_POINTS,
      submitted: { type: 'choice', index: wrong },
      note: `Your team chose ${rightName}`,
    });
    expect(projectReveal(state)?.groups?.map((group) => [group.teamId, group.decided, group.correct])).toEqual([
      ['red', rightName, true],
      ['blue', wrongName, false],
    ]);
  });

  it('lets a vote change until time runs out, and echoes it to that phone alone', () => {
    const room = roomOf({ groupVote: true });
    const { right, wrong } = namesIn(room);
    const state = cast(room, [
      ['ann', wrong],
      ['ann', right],
    ]);

    expect(state.phase).toBe('answering');
    expect(state.answers.map((answer) => [answer.playerId, answer.value])).toEqual([
      ['ann', { type: 'choice', index: right }],
    ]);
    expect(projectForPlayer(state, 'ann', whoSaidIt).canChangeAnswer).toBe(true);
    expect(projectForPlayer(state, 'ann', whoSaidIt).yourAnswer).toEqual({ type: 'choice', index: right });
    expect(projectForPlayer(state, 'bo', whoSaidIt).yourAnswer).toBeNull();
  });

  it('refuses a tap that names no option, so it is never counted as a vote', () => {
    const state = cast(roomOf({ groupVote: true }), [['ann', 9]]);

    expect(state.answers).toEqual([]);
  });

  it('with the switch off, a tap still stands until time runs out rather than locking in first', () => {
    const room = roomOf({ groupVote: false });
    const { right, wrong } = namesIn(room);
    const state = revealed(
      cast(room, [
        ['ann', wrong],
        ['ann', right],
        ['bo', wrong],
      ])
    );

    // Ann's later, correct tap stands; nobody decides for a team since
    // voting is off.
    expect(scoresOf(state, ['ann', 'bo', 'cy'])).toEqual([ROUND_POINTS, 0, 0]);
    expect(projectReveal(state)?.groups).toBeUndefined();
  });
});
