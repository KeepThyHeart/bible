/**
 * The round and what it is worth.
 *
 * What matters most here is not the arithmetic but three promises the room
 * makes: the payload the phone receives does not mark its own answer, a person
 * is never asked twice in one game, and the big screen is told how many got it
 * at each clue without being told who did not.
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
import { groupVoteApplies } from '../../../../../src/modules/games/shared/games.js';
import { toVerseId } from '../../../../../src/modules/games/shared/verseId.js';
import { ContentLibrary, importContent, useContent } from '../../content/index.js';
import type { QuestionFilter, QuestionRecord } from '../../content/index.js';
import { makeTempDir, removeTempDir } from '../../content/fixtures.js';
import { projectForPlayer, projectPersonalResult, projectReveal } from '../../room/projection.js';
import { reduce } from '../../room/reducer.js';
import { createRoom } from '../../room/state.js';
import type { RoomState } from '../../room/state.js';
import {
  ARRIVAL_ALLOWANCE_MS,
  CLUE_INTERVAL_MS,
  GAME_ID,
  QUESTION_TAG,
  TEAM_VOTE,
  UNREADABLE_NOTE,
  answerWindowMsFor,
  createWhoAmI,
  encodeChoice,
  openedAtOf,
  pointsForClue,
  scoreWhoAmI,
  whoAmI,
} from './index.js';
import type { WhoAmIReveal, WhoAmISecret, WhoAmIView } from './index.js';

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

function person(name: string, difficulty: number, distractors: string[] = ['Cain', 'Abel', 'Noah', 'Seth']): QuestionRecord {
  return {
    id: `who-am-i-${name.toLowerCase().replace(/\s+/g, '-')}`,
    type: 'multiple-choice',
    prompt: `Who am I? A first clue about ${name}`,
    promptVerseId: null,
    answer: name,
    accept: [],
    contextNote: null,
    source: null,
    reviewedBy: null,
    distractors,
    clues: [1, 2, 3, 4, 5].map((step) => ({
      text: `Clue ${step} about ${name}`,
      verseId: toVerseId(1, step, 1),
    })),
    book: null,
    section: null,
    difficulty,
    audience: 'all',
    tags: [QUESTION_TAG],
  };
}

const PEOPLE: QuestionRecord[] = [
  person('Adam', 1),
  person('Eve', 1, ['Sarah', 'Rachel', 'Leah', 'Miriam']),
  person('Enoch', 2),
  person('Methuselah', 3),
  person('Jabez', 4),
];

/** A stand-in for the library: the same filtering, over a list in id order. */
function libraryOf(records: readonly QuestionRecord[]) {
  const asked: QuestionFilter[] = [];
  const source = (filter: QuestionFilter): QuestionRecord[] => {
    asked.push(filter);
    return records
      .filter((record) => filter.tag === undefined || record.tags.includes(filter.tag))
      .filter((record) => filter.maxDifficulty === undefined || record.difficulty <= filter.maxDifficulty)
      .filter((record) => filter.minDifficulty === undefined || record.difficulty >= filter.minDifficulty)
      .sort((a, b) => a.id.localeCompare(b.id));
  };
  return { source, asked };
}

function context(
  settings: RoomSettings = settingsWith(),
  seed = 3,
  previous: readonly Round<WhoAmISecret | null>[] = []
): RoundBuildContext<WhoAmISecret | null> {
  return { settings, random: seeded(seed), previous, choice: null };
}

function viewOf(round: Round<WhoAmISecret | null>): WhoAmIView {
  return round.playerView as WhoAmIView;
}

function answerOf(playerId: string, value: AnswerValue, at: ServerTime, openedAt?: ServerTime): ScoredAnswer {
  // The room always sends an opening. Leaving it off stands for one that is
  // not a usable number, which scoring has to survive by trusting the phone.
  return openedAt === undefined ? ({ playerId, value, at } as ScoredAnswer) : { playerId, value, at, openedAt };
}

function choose(option: number, cluesSeen: number): AnswerValue {
  return { type: 'choice', index: encodeChoice(option, cluesSeen) };
}

const SECRET: WhoAmISecret = {
  questionId: 'who-am-i-adam',
  person: 'Adam',
  clues: [
    { text: 'I lived nine hundred and thirty years', verseId: toVerseId(1, 5, 5) },
    { text: 'I gave names to the cattle', verseId: toVerseId(1, 2, 20) },
    { text: 'I was formed from the dust of the ground', verseId: toVerseId(1, 2, 7) },
    { text: 'My wife was made from one of my ribs', verseId: toVerseId(1, 2, 22) },
    { text: 'I was the first man', verseId: null },
  ],
  options: ['Cain', 'Adam', 'Noah', 'Seth'],
  correctIndex: 1,
  pacing: 'server',
  clueIntervalMs: CLUE_INTERVAL_MS,
};

const OPENED = 1_700_000_000_000;

describe('the question a round puts up', () => {
  it('offers four people, one of them the answer, from the first clue', () => {
    const { source } = libraryOf(PEOPLE);
    const round = createWhoAmI({ questions: source }).buildRound(context(), 0);
    const secret = round.secret as WhoAmISecret;
    const view = viewOf(round);

    expect(view.options).toHaveLength(4);
    expect(view.options.map((option) => option.label)).toContain(secret.person);
    expect(secret.options[secret.correctIndex]).toBe(secret.person);
    expect(view.clues).toHaveLength(5);
  });

  it('offers the three most plausible wrong answers, not the rest', () => {
    const { source } = libraryOf([person('Adam', 1, ['Cain', 'Abel', 'Noah', 'Seth', 'Enos'])]);
    const round = createWhoAmI({ questions: source }).buildRound(context(), 0);

    expect([...(round.secret?.options ?? [])].sort()).toEqual(['Abel', 'Adam', 'Cain', 'Noah']);
  });

  it('tells neither screen which option is right, nor where the clues are from', () => {
    const { source } = libraryOf(PEOPLE);
    const round = createWhoAmI({ questions: source }).buildRound(context(), 0);
    const payload = JSON.stringify(round.playerView);

    expect(Object.keys(viewOf(round)).sort()).toEqual([
      'answerWindowMs',
      'clueIntervalMs',
      'clues',
      'options',
      'pacing',
    ]);
    expect(payload).toBe(JSON.stringify(round.hostView));
    expect(payload).not.toContain('correct');
    expect(payload).not.toContain('Genesis');
  });

  it('opens answers at once and holds them open for every clue', () => {
    const { source } = libraryOf(PEOPLE);
    const round = createWhoAmI({ questions: source }).buildRound(context(), 0);

    // No reading phase: the room refuses answers during one, and a player who
    // is sure at clue one must be able to say so at clue one.
    expect(round.questionPhaseMs).toBeUndefined();
    expect(round.answerWindowMs).toBe(answerWindowMsFor(5));
    expect(viewOf(round).answerWindowMs).toBe(round.answerWindowMs);
    expect(viewOf(round).clueIntervalMs).toBe(CLUE_INTERVAL_MS);
  });

  it('is paced by the server in a group and by the player alone', () => {
    const { source } = libraryOf(PEOPLE);
    const game = createWhoAmI({ questions: source });

    expect(viewOf(game.buildRound(context(settingsWith({ solo: false })), 0)).pacing).toBe('server');
    expect(viewOf(game.buildRound(context(settingsWith({ solo: true })), 0)).pacing).toBe('player');
  });

  it('replays exactly, given the same generator', () => {
    const { source } = libraryOf(PEOPLE);
    const game = createWhoAmI({ questions: source });

    expect(game.buildRound(context(settingsWith(), 21), 0)).toEqual(
      game.buildRound(context(settingsWith(), 21), 0)
    );
  });

  it('asks the library for who-am-I questions only', () => {
    const { source, asked } = libraryOf(PEOPLE);
    createWhoAmI({ questions: source }).buildRound(context(), 0);

    expect(asked.every((filter) => filter.tag === QUESTION_TAG)).toBe(true);
  });
});

describe('who gets asked about', () => {
  function build(settings: RoomSettings, rounds: number, records = PEOPLE): Round<WhoAmISecret | null>[] {
    const { source } = libraryOf(records);
    const game = createWhoAmI({ questions: source });
    const random = seeded(11);
    const built: Round<WhoAmISecret | null>[] = [];
    for (let index = 0; index < rounds; index += 1) {
      built.push(game.buildRound({ settings, random, previous: built, choice: null }, index));
    }
    return built;
  }

  it('stays at or under the familiarity the room chose', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const { source } = libraryOf(PEOPLE);
      const round = createWhoAmI({ questions: source }).buildRound(
        context(settingsWith({ familiarity: 'core' }), seed),
        0
      );

      expect(['Adam', 'Eve']).toContain(round.secret?.person);
    }
  });

  it('draws from everyone when the room asked for anywhere in the Bible', () => {
    const asked = new Set(build(settingsWith({ familiarity: 'any' }), 5).map((round) => round.secret?.person));

    expect(asked.size).toBe(5);
  });

  it('never asks about the same person twice in one game', () => {
    const asked = build(settingsWith({ familiarity: 'deep' }), 5).map((round) => round.secret?.person);

    expect(new Set(asked).size).toBe(5);
  });

  it('counts two questions about one person as one person', () => {
    const second = { ...person('Adam', 1), id: 'who-am-i-adam-again', prompt: 'Who am I? Again' };
    const asked = build(settingsWith({ familiarity: 'core' }), 3, [person('Adam', 1), second, person('Eve', 1)]).map(
      (round) => round.secret?.person
    );

    expect(asked.filter((name) => name === 'Adam')).toHaveLength(1);
  });

  it('reaches one tier further rather than repeating someone', () => {
    const asked = build(settingsWith({ familiarity: 'core' }), 3).map((round) => round.secret?.person);

    // Adam and Eve are the whole of the first tier; the third round goes to
    // the nearest tier beyond it, not to the most obscure person on file.
    expect(asked.slice(0, 2).sort()).toEqual(['Adam', 'Eve']);
    expect(asked[2]).toBe('Enoch');
  });

  it('builds an empty round once everyone has been asked', () => {
    const rounds = build(settingsWith({ familiarity: 'any' }), 6);

    expect(rounds[5]?.secret).toBeNull();
    expect(rounds[5]?.playerView).toBeNull();
  });

  it('passes over a question it cannot play', () => {
    const cluesless = { ...person('Abel', 1), clues: [] };
    const asked = build(settingsWith({ familiarity: 'core' }), 1, [cluesless, person('Adam', 1)]);

    expect(asked[0]?.secret?.person).toBe('Adam');
  });

  it('shows no more than five clues, whatever was written', () => {
    const wordy = person('Adam', 1);
    wordy.clues = [...wordy.clues, { text: 'A sixth clue', verseId: null }];
    const round = build(settingsWith(), 1, [wordy])[0];

    expect(round?.secret?.clues).toHaveLength(5);
  });
});

describe('a server with nothing imported', () => {
  it('builds an empty round rather than failing in front of a group', () => {
    const round = createWhoAmI({ questions: () => [] }).buildRound(context(), 4);

    expect(round.index).toBe(4);
    expect(round.secret).toBeNull();
    expect(round.hostView).toBeNull();
    expect(round.playerView).toBeNull();
  });

  it('scores it as nothing at all', () => {
    const outcome = scoreWhoAmI(null, [answerOf('p-1', choose(0, 1), OPENED)]);

    expect(outcome.perPlayer.size).toBe(0);
    expect(outcome.aggregates).toEqual([]);
    expect(outcome.correctLabel).toBe('');
    expect(outcome.detail).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe('scoring a guess', () => {
  it('pays more the fewer clues it took', () => {
    const outcome = scoreWhoAmI(SECRET, [
      answerOf('first', choose(1, 1), OPENED + 1),
      answerOf('third', choose(1, 3), OPENED + 2),
      answerOf('fifth', choose(1, 5), OPENED + 3),
    ]);

    expect(outcome.perPlayer.get('first')?.pointsAwarded).toBe(100);
    expect(outcome.perPlayer.get('third')?.pointsAwarded).toBe(60);
    expect(outcome.perPlayer.get('fifth')?.pointsAwarded).toBe(20);
  });

  it('pays nothing for the wrong person and says nothing about it on the answer line', () => {
    const outcome = scoreWhoAmI(SECRET, [answerOf('p-1', choose(0, 1), OPENED)]);

    expect(outcome.perPlayer.get('p-1')).toEqual({
      correct: false,
      pointsAwarded: 0,
      submitted: choose(0, 1),
      note: null,
    });
  });

  it('tells a right answer, privately, which clue it was credited at', () => {
    const outcome = scoreWhoAmI(SECRET, [answerOf('p-1', choose(1, 2), OPENED)]);

    expect(outcome.perPlayer.get('p-1')?.note).toBe('Got it at clue 2');
  });

  it('counts only the first guess a player sent', () => {
    const outcome = scoreWhoAmI(SECRET, [
      answerOf('p-1', choose(1, 4), OPENED + 900),
      answerOf('p-1', choose(0, 1), OPENED + 100),
    ]);

    expect(outcome.perPlayer.size).toBe(1);
    expect(outcome.perPlayer.get('p-1')?.correct).toBe(false);
  });

  it('scores an answer it cannot read as nothing and says so', () => {
    const outcome = scoreWhoAmI(SECRET, [
      answerOf('typed', { type: 'text', text: 'Adam' }, OPENED),
      answerOf('offEnd', { type: 'choice', index: 6 }, OPENED),
    ]);

    expect(outcome.perPlayer.get('typed')?.pointsAwarded).toBe(0);
    expect(outcome.perPlayer.get('typed')?.note).toBe(UNREADABLE_NOTE);
    expect(outcome.perPlayer.get('offEnd')?.note).toBe(UNREADABLE_NOTE);
  });

  it('says nothing about a player who never answered', () => {
    const outcome = scoreWhoAmI(SECRET, [answerOf('p-1', choose(1, 1), OPENED)]);

    expect(outcome.perPlayer.has('p-2')).toBe(false);
  });
});

describe('scoring against the server clock', () => {
  it('reads the opening off an answer when the room supplies one', () => {
    expect(openedAtOf(answerOf('p-1', choose(1, 1), OPENED + 5, OPENED))).toBe(OPENED);
    expect(openedAtOf(answerOf('p-1', choose(1, 1), OPENED + 5))).toBeNull();
  });

  it('pays by the clock, not by what a phone claims, when it knows the opening', () => {
    const at = OPENED + 2 * CLUE_INTERVAL_MS + ARRIVAL_ALLOWANCE_MS + 10;
    const outcome = scoreWhoAmI(SECRET, [answerOf('p-1', choose(1, 1), at, OPENED)]);

    expect(outcome.perPlayer.get('p-1')?.pointsAwarded).toBe(60);
  });

  it('pays two players who answered at the same clue the same, whatever the gap', () => {
    const outcome = scoreWhoAmI(SECRET, [
      answerOf('early', choose(1, 2), OPENED + CLUE_INTERVAL_MS + 100, OPENED),
      answerOf('late', choose(1, 2), OPENED + 2 * CLUE_INTERVAL_MS - 100, OPENED),
    ]);

    expect(outcome.perPlayer.get('early')?.pointsAwarded).toBe(80);
    expect(outcome.perPlayer.get('late')?.pointsAwarded).toBe(80);
  });

  it('pays a solo player at the clue they turned to, however long they lingered', () => {
    const lingered = OPENED + 4 * CLUE_INTERVAL_MS + ARRIVAL_ALLOWANCE_MS + 10;
    const solo = scoreWhoAmI({ ...SECRET, pacing: 'player' }, [
      answerOf('p-1', choose(1, 1), lingered, OPENED),
    ]);
    const group = scoreWhoAmI(SECRET, [answerOf('p-1', choose(1, 1), lingered, OPENED)]);

    // Alone, the player turns the clues; the clock says nothing about which
    // one was showing. In a group the clock is what makes clues comparable.
    expect(solo.perPlayer.get('p-1')?.pointsAwarded).toBe(100);
    expect(group.perPlayer.get('p-1')?.pointsAwarded).toBe(20);
  });
});

describe('what the big screen is told', () => {
  it('counts who got it at each clue and names nobody', () => {
    const outcome = scoreWhoAmI(SECRET, [
      answerOf('a', choose(1, 1), OPENED + 1),
      answerOf('b', choose(1, 1), OPENED + 2),
      answerOf('c', choose(1, 4), OPENED + 3),
      answerOf('d', choose(2, 2), OPENED + 4),
    ]);

    expect(outcome.aggregates).toEqual([
      { label: 'Clue 1', count: 2 },
      { label: 'Clue 2', count: 0 },
      { label: 'Clue 3', count: 0 },
      { label: 'Clue 4', count: 1 },
      { label: 'Clue 5', count: 0 },
    ]);
    for (const row of outcome.aggregates) {
      expect(Object.keys(row).sort()).toEqual(['count', 'label']);
    }
    expect(JSON.stringify(outcome.aggregates)).not.toContain('"d"');
  });

  it('never counts a wrong guess anywhere the room can see', () => {
    const outcome = scoreWhoAmI(SECRET, [
      answerOf('a', choose(0, 1), OPENED + 1),
      answerOf('b', choose(2, 3), OPENED + 2),
    ]);
    const detail = outcome.detail as WhoAmIReveal;

    expect(outcome.aggregates.every((row) => row.count === 0)).toBe(true);
    expect(detail.gotIt).toBe(0);
    expect(JSON.stringify(detail)).not.toMatch(/wrong|missed/i);
  });

  it('names the person it was looking for', () => {
    expect(scoreWhoAmI(SECRET, []).correctLabel).toBe('Adam');
  });

  it('hands the reveal every clue with where it comes from and what it was worth', () => {
    const outcome = scoreWhoAmI(SECRET, [answerOf('a', choose(1, 2), OPENED)]);
    const detail = outcome.detail as WhoAmIReveal;

    expect(detail.person).toBe('Adam');
    expect(detail.clues.map((clue) => clue.reference)).toEqual([
      'Genesis 5:5',
      'Genesis 2:20',
      'Genesis 2:7',
      'Genesis 2:22',
      null,
    ]);
    expect(detail.clues.map((clue) => clue.points)).toEqual([100, 80, 60, 40, 20]);
    expect(detail.clues.map((clue) => clue.gotIt)).toEqual([0, 1, 0, 0, 0]);
    expect(detail.options).toEqual(SECRET.options);
    expect(detail.correctIndex).toBe(1);
    expect(detail.gotIt).toBe(1);
  });
});

describe('the round as the room sees it', () => {
  it('reports itself as a game one person can play alone', () => {
    expect(whoAmI.id).toBe('who-am-i');
    expect(whoAmI.supportsSolo).toBe(true);
    expect(whoAmI.usesBuzz).toBe(false);
  });

  it('scores through the module the same way as through the function', () => {
    const round: Round<WhoAmISecret | null> = { index: 0, secret: SECRET, hostView: null, playerView: null };
    const answers = [answerOf('p-1', choose(1, 2), OPENED)];

    expect(whoAmI.scoreRound(round, answers, { seats: [], log: [] })).toEqual(scoreWhoAmI(SECRET, answers));
  });
});

describe('drawing from the content library', () => {
  let directory: string;
  let library: ContentLibrary;
  let previous: ContentLibrary | null;

  beforeEach(() => {
    directory = makeTempDir('who-am-i-');
    library = ContentLibrary.open({
      moduleDir: join(directory, 'modules'),
      contentPath: ':memory:',
      defaultTranslation: 'KJV',
    });
    previous = useContent(library);
  });

  afterEach(() => {
    useContent(previous);
    library.close();
    removeTempDir(directory);
  });

  function importPeople(): void {
    const row = (name: string, difficulty: number, tags: string[]) => ({
      id: `test-${name.toLowerCase()}`,
      prompt: `Who am I? Something only ${name} did`,
      answer: name,
      difficulty,
      tags,
      distractors: ['Jonah', 'Hosea', 'Amos', 'Micah', 'Nahum', 'Obadiah', 'Haggai', 'Malachi'].filter(
        (other) => other !== name
      ),
      clues: [1, 2, 3, 4, 5].map((step) => ({ text: `${name}, clue ${step}`, ref: `Genesis ${step}:1` })),
    });
    const report = importContent(library.db, {
      questions: [
        row('Moses', 1, [QUESTION_TAG]),
        row('Gideon', 3, [QUESTION_TAG]),
        row('Deborah', 1, ['who-said-it']),
      ],
    });
    expect(report.rejected).toEqual([]);
  }

  it('asks about a tagged person at the room familiarity', () => {
    importPeople();

    for (let seed = 1; seed <= 10; seed += 1) {
      const round = whoAmI.buildRound(context(settingsWith({ familiarity: 'core' }), seed), 0);
      expect(round.secret?.person).toBe('Moses');
    }
  });

  it('carries the clue references through to the reveal', () => {
    importPeople();
    const round = whoAmI.buildRound(context(settingsWith({ familiarity: 'core' })), 0);
    const detail = whoAmI.scoreRound(round, [], { seats: [], log: [] }).detail as WhoAmIReveal;

    expect(detail.clues[2]?.reference).toBe('Genesis 3:1');
  });

  it('builds an empty round when nothing is imported', () => {
    expect(whoAmI.buildRound(context(), 0).secret).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Teams voting together, through the room
// ---------------------------------------------------------------------------

describe('teams voting together, through the room', () => {
  const HOST: Actor = { role: 'owner' };
  /** Answers open with the first clue, the moment the host starts. */
  const STARTED = 2_000;
  const TEAMS: readonly [PlayerId, TeamId][] = [
    ['ann', 'red'],
    ['bo', 'red'],
    ['cy', 'red'],
    ['dan', 'red'],
    ['di', 'blue'],
    ['ed', 'blue'],
    ['fay', 'blue'],
  ];
  const game = createWhoAmI({ questions: libraryOf(PEOPLE).source });

  function apply(state: RoomState, actor: Actor, intent: Intent, at: ServerTime): RoomState {
    return reduce(state, { actor, intent, receivedAt: at }, game).state;
  }

  /** Four in red and three in blue, the first clue up and the options open. */
  function roomOf(overrides: Partial<RoomSettings>): RoomState {
    const settings = settingsWith({ rounds: 1, teamsEnabled: true, ...overrides });
    let state = createRoom({ code: 'VOTE', now: 1_000, seed: 5, settings });
    TEAMS.forEach(([playerId, teamId], position) => {
      state = apply(state, { role: 'player', playerId }, { kind: 'join', name: playerId, teamId }, 1_100 + position);
    });
    return apply(state, HOST, { kind: 'host', command: { cmd: 'start' } }, STARTED);
  }

  /**
   * A moment the server's own clock credits at this clue, the arrival
   * allowance included, with `into` telling apart two taps at the same clue.
   */
  function atClue(clue: number, into: number): ServerTime {
    return STARTED + (clue - 1) * CLUE_INTERVAL_MS + ARRIVAL_ALLOWANCE_MS + into;
  }

  /** A guess at a person, sent at a clue the phone was showing. */
  function guess(state: RoomState, playerId: PlayerId, option: number, clue: number, into: number): RoomState {
    return apply(state, { role: 'player', playerId }, { kind: 'answer', round: 0, value: choose(option, clue) }, atClue(clue, into));
  }

  function revealed(state: RoomState): RoomState {
    return apply(state, HOST, { kind: 'host', command: { cmd: 'revealNow' } }, atClue(5, 5_000));
  }

  function scoresOf(state: RoomState, players: readonly PlayerId[]): number[] {
    return players.map((playerId) => state.players.find((player) => player.id === playerId)?.score ?? 0);
  }

  function peopleIn(state: RoomState): { right: number; wrong: number; person: string; wrongName: string } {
    const secret = state.rounds[0]?.secret as WhoAmISecret;
    const wrong = (secret.correctIndex + 1) % secret.options.length;
    return { right: secret.correctIndex, wrong, person: secret.person, wrongName: secret.options[wrong] ?? '' };
  }

  it('pays a whole team what its majority chose, after letting a guess change', () => {
    let state = roomOf({ groupVote: true });
    const { right, wrong, person, wrongName } = peopleIn(state);
    state = guess(state, 'ann', wrong, 1, 100);
    // The lockout is off: a wrong first guess can still be changed.
    state = guess(state, 'ann', right, 1, 200);
    state = guess(state, 'bo', right, 1, 300);
    state = guess(state, 'cy', wrong, 1, 400);
    state = guess(state, 'di', wrong, 1, 500);
    state = guess(state, 'ed', wrong, 1, 600);
    state = guess(state, 'fay', right, 1, 700);
    state = revealed(state);

    expect(scoresOf(state, ['ann', 'bo', 'cy', 'dan'])).toEqual([100, 100, 100, 100]);
    expect(scoresOf(state, ['di', 'ed', 'fay'])).toEqual([0, 0, 0]);
    expect(projectPersonalResult(state, 'cy')).toEqual({
      correct: true,
      pointsAwarded: 100,
      submitted: choose(wrong, 1),
      note: `Your team chose ${person}. Got it at clue 1`,
    });
    expect(projectReveal(state)?.groups?.map((group) => [group.teamId, group.decided, group.correct])).toEqual([
      ['red', person, true],
      ['blue', wrongName, false],
    ]);
  });

  it('pays a team at the clue its majority first formed, so a straggler costs it nothing', () => {
    let state = roomOf({ groupVote: true });
    const { right } = peopleIn(state);
    state = guess(state, 'ann', right, 1, 100);
    state = guess(state, 'bo', right, 1, 200);
    state = guess(state, 'cy', right, 2, 100);
    // Three of red's four were already agreed; the fourth comes round at the last clue.
    state = guess(state, 'dan', right, 5, 100);
    state = revealed(state);

    const atClueTwo = pointsForClue(2);
    expect(scoresOf(state, ['ann', 'bo', 'cy', 'dan'])).toEqual([atClueTwo, atClueTwo, atClueTwo, atClueTwo]);
  });

  it('pays a team that hedged across the names only from the clue where most of it agreed', () => {
    let state = roomOf({ groupVote: true });
    const { right } = peopleIn(state);
    const secret = state.rounds[0]?.secret as WhoAmISecret;
    const others = secret.options.map((_, index) => index).filter((index) => index !== right);
    state = guess(state, 'ann', right, 1, 100);
    state = guess(state, 'bo', others[0] ?? right, 1, 200);
    state = guess(state, 'cy', others[1 % others.length] ?? right, 1, 300);
    state = guess(state, 'dan', others[2 % others.length] ?? right, 1, 400);
    state = guess(state, 'bo', right, 4, 100);
    state = guess(state, 'cy', right, 4, 200);
    state = revealed(state);

    const atClueFour = pointsForClue(4);
    expect(atClueFour).toBeLessThan(pointsForClue(1));
    expect(scoresOf(state, ['ann', 'bo', 'cy', 'dan'])).toEqual([atClueFour, atClueFour, atClueFour, atClueFour]);
  });

  it('scores nobody on a tied team', () => {
    let state = roomOf({ groupVote: true });
    const { right, wrong } = peopleIn(state);
    state = guess(state, 'ann', right, 1, 100);
    state = guess(state, 'bo', right, 1, 200);
    state = guess(state, 'cy', wrong, 1, 300);
    state = guess(state, 'dan', wrong, 1, 400);
    state = revealed(state);

    expect(scoresOf(state, ['ann', 'bo', 'cy', 'dan'])).toEqual([0, 0, 0, 0]);
    expect(projectReveal(state)?.groups?.[0]).toMatchObject({ teamId: 'red', decided: null, correct: null });
  });

  it('pays an answer that never held most of the team at its latest vote', () => {
    let state = roomOf({ groupVote: true });
    const { right } = peopleIn(state);
    state = guess(state, 'ann', right, 1, 100);
    state = guess(state, 'bo', right, 3, 100);
    state = revealed(state);

    const atClueThree = pointsForClue(3);
    expect(atClueThree).toBe(60);
    expect(scoresOf(state, ['ann', 'bo', 'cy', 'dan'])).toEqual([atClueThree, atClueThree, atClueThree, atClueThree]);
    // The ladder on the big screen is still everyone's own vote, each at its own clue.
    expect(projectReveal(state)?.aggregates.map((row) => row.count)).toEqual([1, 0, 1, 0, 0]);
  });

  it('does not move a team down the ladder for a second tap on the name a player already backs', () => {
    let state = roomOf({ groupVote: true });
    const { right } = peopleIn(state);
    state = guess(state, 'ann', right, 1, 100);
    state = guess(state, 'bo', right, 1, 200);
    state = guess(state, 'ann', right, 4, 100);

    expect(state.answers.find((answer) => answer.playerId === 'ann')?.value).toEqual(choose(right, 1));
    expect(scoresOf(revealed(state), ['ann', 'bo', 'cy', 'dan'])).toEqual([100, 100, 100, 100]);
  });

  it('keeps the one-guess lockout without the switch, and always when playing alone', () => {
    let state = roomOf({ groupVote: false });
    const { right, wrong } = peopleIn(state);
    state = guess(state, 'ann', wrong, 1, 100);
    state = guess(state, 'ann', right, 1, 200);

    expect(state.answers.map((answer) => answer.value)).toEqual([choose(wrong, 1)]);
    expect(projectForPlayer(state, 'ann', game).canChangeAnswer).toBe(false);
    expect(groupVoteApplies(TEAM_VOTE, settingsWith({ groupVote: true }))).toBe(true);
    expect(groupVoteApplies(TEAM_VOTE, settingsWith({ groupVote: true, solo: true }))).toBe(false);
  });

  it('tells both screens a team is voting only when one is, and still not the answer', () => {
    const voting = game.buildRound(context(settingsWith({ groupVote: true })), 0);
    const normal = game.buildRound(context(settingsWith()), 0);

    expect(viewOf(voting).groupVote).toBe(true);
    expect(JSON.stringify(voting.playerView)).not.toContain('correct');
    expect(voting.hostView).toBe(voting.playerView);
    expect(Object.keys(viewOf(normal))).not.toContain('groupVote');
  });
});
