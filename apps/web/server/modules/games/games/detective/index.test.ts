/**
 * The case and what each screen is shown of it.
 *
 * The promises that matter here are about secrecy rather than arithmetic: a
 * phone is shown its own clue and nobody else's, the big screen never shows a
 * dealt clue, nothing any screen receives during play says which name is
 * right, and the deal holds still for as long as the seats do.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { AnswerValue, RoomSettings } from '../../../../../src/modules/games/shared/protocol.js';
import { DEFAULT_THEME } from '../../../../../src/modules/games/shared/theme.js';
import type { Round, RoundBuildContext, ScoredAnswer, Seat, Table } from '../../../../../src/modules/games/shared/games.js';
import { toVerseId } from '../../../../../src/modules/games/shared/verseId.js';
import { ContentLibrary, importContent } from '../../content/index.js';
import { makeTempDir, removeTempDir } from '../../content/fixtures.js';
import { dealtAnywhere, dealtIndexFor, holdersOf } from './deal.js';
import {
  GAME_ID,
  MIN_DISCUSSION_MS,
  POINTS,
  QUESTION,
  QUESTION_TAG,
  UNREADABLE_NOTE,
  createDetective,
  openingOf,
  scoreDetective,
} from './index.js';
import type {
  DetectiveHostView,
  DetectivePhoneView,
  DetectiveReveal,
  DetectiveSecret,
} from './index.js';

// ---------------------------------------------------------------------------
// An isolated library of cases
// ---------------------------------------------------------------------------

interface CaseSpec {
  person: string;
  difficulty: number;
  wrong?: string[];
}

const CLUES_PER_CASE = 4;

function slug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

/** Clue text that never names the person, so a leak of the answer can be searched for. */
function clueText(person: string, position: number): string {
  return `Evidence ${position} in the case of ${slug(person).length}${person.length % 7} ${position * 13}`;
}

function caseRow(spec: CaseSpec, caseNumber: number) {
  return {
    id: `detective-${slug(spec.person)}`,
    type: 'multiple-choice',
    prompt: `${QUESTION} Opening evidence number ${caseNumber}`,
    promptVerseId: toVerseId(2, 3, caseNumber + 1),
    answer: spec.person,
    difficulty: spec.difficulty,
    tags: [QUESTION_TAG],
    distractors: spec.wrong ?? ['Aaron', 'Balaam', 'Joshua', 'Caleb', 'Korah'],
    clues: Array.from({ length: CLUES_PER_CASE }, (_, position) => ({
      text: `${clueText(spec.person, position + 1)} #${caseNumber}`,
      ref: `Exodus ${caseNumber + 1}:${position + 1}`,
    })),
  };
}

const CASES: CaseSpec[] = [
  { person: 'Moses', difficulty: 1, wrong: ['Aaron', 'Balaam', 'Joshua', 'Caleb', 'Korah'] },
  { person: 'Ruth', difficulty: 1, wrong: ['Naomi', 'Orpah', 'Esther', 'Hannah'] },
  { person: 'Gideon', difficulty: 2, wrong: ['Samson', 'Barak', 'Jephthah', 'Ehud'] },
  { person: 'Jabez', difficulty: 4, wrong: ['Enoch', 'Nimrod', 'Obed', 'Hur'] },
];

let directory: string;
let library: ContentLibrary;

beforeEach(() => {
  directory = makeTempDir('detective-');
  library = ContentLibrary.open({
    moduleDir: join(directory, 'modules'),
    contentPath: ':memory:',
    defaultTranslation: 'FIX',
  });
  const report = importContent(library.db, { questions: CASES.map(caseRow) });
  expect(report.rejected).toEqual([]);
});

afterEach(() => {
  library.close();
  removeTempDir(directory);
});

function game() {
  return createDetective({ questions: (filter) => library.questions(filter) });
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

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
    familiarity: 'any',
    gameOptions: {},
    theme: DEFAULT_THEME,
    ...overrides,
  };
}

function context(
  settings: RoomSettings = settingsWith(),
  seed = 3,
  previous: readonly Round<DetectiveSecret | null>[] = []
): RoundBuildContext<DetectiveSecret | null> {
  return { settings, random: seeded(seed), previous, choice: null };
}

function build(settings?: RoomSettings, seed?: number): Round<DetectiveSecret | null> {
  return game().buildRound(context(settings, seed), 0);
}

function secretOf(round: Round<DetectiveSecret | null>): DetectiveSecret {
  if (round.secret === null) throw new Error('expected a case');
  return round.secret;
}

function seats(...ids: [string, Seat['teamId']][]): Seat[] {
  return ids.map(([playerId, teamId]) => ({ playerId, teamId }));
}

function tableOf(seated: readonly Seat[], log: readonly ScoredAnswer[] = []): Table {
  return { seats: seated, log };
}

function vote(playerId: string, index: number, at = 1_000): ScoredAnswer {
  return { playerId, value: { type: 'choice', index }, at, openedAt: 0 };
}

function phoneView(round: Round<DetectiveSecret | null>, table: Table, playerId: string): DetectivePhoneView {
  return game().viewFor?.(round, table, playerId, 'answering') as DetectivePhoneView;
}

function hostView(round: Round<DetectiveSecret | null>, table: Table): DetectiveHostView {
  return game().viewFor?.(round, table, null, 'answering') as DetectiveHostView;
}

/** The view with its list of names taken out, which is the only place a name belongs. */
function withoutOptions(view: unknown): string {
  const rest: Record<string, unknown> = { ...(view as Record<string, unknown>) };
  delete rest['options'];
  return JSON.stringify(rest);
}

// ---------------------------------------------------------------------------
// Building a case
// ---------------------------------------------------------------------------

describe('a case', () => {
  it('shows the vaguest clue, taken from the prompt, and deals the other four', () => {
    const secret = secretOf(build());
    const row = caseRow(CASES.find((spec) => spec.person === secret.person) as CaseSpec, CASES.findIndex((spec) => spec.person === secret.person));
    expect(secret.opening.text).toBe(openingOf(row.prompt));
    expect(secret.opening.text.startsWith(QUESTION)).toBe(false);
    expect(secret.dealt.map((clue) => clue.text)).toEqual(row.clues.map((clue) => clue.text));
  });

  it('offers the person and the three leading wrong answers, with the right one marked only in the secret', () => {
    const secret = secretOf(build(settingsWith({ familiarity: 'core' }), 9));
    const spec = CASES.find((candidate) => candidate.person === secret.person) as CaseSpec;
    expect([...secret.options].sort()).toEqual([spec.person, ...(spec.wrong ?? []).slice(0, 3)].sort());
    expect(secret.options[secret.correctIndex]).toBe(secret.person);
  });

  it('keeps a hand-written prompt whole when it does not follow the pattern', () => {
    expect(openingOf('I kept the flock of my father-in-law')).toBe('I kept the flock of my father-in-law');
    expect(openingOf(`${QUESTION}   I kept the flock`)).toBe('I kept the flock');
  });

  it('gives the room long enough to read four clues aloud, unless the host already gave more', () => {
    expect(build().answerWindowMs).toBe(MIN_DISCUSSION_MS);
    expect(build(settingsWith({ answerWindowMs: MIN_DISCUSSION_MS + 30_000 })).answerWindowMs).toBe(
      MIN_DISCUSSION_MS + 30_000
    );
  });

  it('never asks about the same person twice in one game', () => {
    const detective = game();
    const played: Round<DetectiveSecret | null>[] = [];
    for (let index = 0; index < CASES.length; index += 1) {
      played.push(detective.buildRound(context(settingsWith(), 5, played), index));
    }
    expect(new Set(played.map((round) => secretOf(round).person)).size).toBe(CASES.length);
  });

  it('draws at or under the room’s familiarity while it can', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const secret = secretOf(build(settingsWith({ familiarity: 'core' }), seed));
      expect(['Moses', 'Ruth']).toContain(secret.person);
    }
  });

  it('reaches only the nearest tier above once the familiar people are used up', () => {
    const detective = game();
    const core = settingsWith({ familiarity: 'core' });
    const played: Round<DetectiveSecret | null>[] = [];
    for (let index = 0; index < 3; index += 1) {
      played.push(detective.buildRound(context(core, 2, played), index));
    }
    expect(played.map((round) => secretOf(round).person).slice(2)).toEqual(['Gideon']);
  });

  it('draws from every case when the room set no ceiling', () => {
    const people = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) people.add(secretOf(build(settingsWith(), seed)).person);
    expect(people).toContain('Jabez');
  });

  it('is nothing at all when there is no case to draw, and says so on both screens', () => {
    const empty = createDetective({ questions: () => [] });
    const round = empty.buildRound(context(), 0);
    expect(round.secret).toBeNull();
    const table = tableOf(seats(['ann', null]));
    expect(empty.viewFor?.(round, table, null, 'answering')).toBeNull();
    expect(empty.viewFor?.(round, table, 'ann', 'answering')).toBeNull();
    expect(empty.accepts?.(round, table, 'ann', { type: 'choice', index: 0 })).toBe(false);
    expect(empty.scoreRound(round, [vote('ann', 0)], table)).toEqual({
      perPlayer: new Map(),
      aggregates: [],
      correctLabel: '',
      detail: null,
    });
  });

  it('is played only as a vote, and not alone', () => {
    const detective = game();
    expect(detective.groupVote?.mode).toBe('always');
    expect(detective.supportsSolo).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The deal
// ---------------------------------------------------------------------------

describe('the deal', () => {
  const room = seats(['ann', null], ['bo', null], ['cy', null], ['di', null], ['ed', null], ['flo', null]);

  it('gives each of the first four phones a different clue, then comes round again', () => {
    const dealt = room.map((seat) => dealtIndexFor(room, seat.playerId, 4, 1));
    expect(dealt).toEqual([1, 2, 3, 0, 1, 2]);
    expect(holdersOf(room, 'ann', 4, 1)).toBe(2);
    expect(holdersOf(room, 'di', 4, 1)).toBe(1);
  });

  it('deals within each team, so every team holds the whole case', () => {
    const teams = seats(['r1', 'red'], ['b1', 'blue'], ['r2', 'red'], ['b2', 'blue']);
    expect(teams.map((seat) => dealtIndexFor(teams, seat.playerId, 4, 0))).toEqual([0, 0, 1, 1]);
  });

  it('holds nothing for someone without a seat', () => {
    expect(dealtIndexFor(room, 'late', 4, 0)).toBeNull();
    expect(holdersOf(room, 'late', 4, 0)).toBe(0);
  });

  it('knows which clues a small room never saw', () => {
    expect([...dealtAnywhere(seats(['ann', null], ['bo', null]), 4, 3)].sort()).toEqual([0, 3]);
  });
});

// ---------------------------------------------------------------------------
// What each screen is shown
// ---------------------------------------------------------------------------

describe('what each screen is shown', () => {
  const four = seats(['ann', null], ['bo', null], ['cy', null], ['di', null]);

  it('puts one clue on each phone, and no phone carries another phone’s clue', () => {
    const round = build();
    const secret = secretOf(round);
    const table = tableOf(four);
    const clues = four.map((seat) => phoneView(round, table, seat.playerId).clue);
    expect([...clues].sort()).toEqual(secret.dealt.map((clue) => clue.text).sort());

    for (const [position, seat] of four.entries()) {
      const wire = JSON.stringify(phoneView(round, table, seat.playerId));
      for (const other of clues.filter((_, index) => index !== position)) {
        expect(wire).not.toContain(other);
      }
      // The public clue is the big screen's; a phone need not repeat it.
      expect(wire).not.toContain(secret.opening.text);
    }
  });

  it('says nothing on a phone about which name is right, or where a clue comes from', () => {
    const round = build();
    const secret = secretOf(round);
    for (const seat of four) {
      const view = phoneView(round, tableOf(four), seat.playerId);
      expect(Object.keys(view).sort()).toEqual(['clue', 'options', 'shared']);
      expect(view.options.map((option) => option.label)).toEqual(secret.options);
      expect(withoutOptions(view)).not.toContain(secret.person);
      expect(JSON.stringify(view)).not.toMatch(/Exodus|correct/i);
    }
  });

  it('shows the big screen the public clue and the names, and never a dealt clue', () => {
    const round = build();
    const secret = secretOf(round);
    const view = hostView(round, tableOf(four));
    expect(view).toEqual({
      question: QUESTION,
      opening: secret.opening.text,
      options: secret.options.map((label, index) => ({ index, label })),
    });
    const wire = JSON.stringify(view);
    for (const clue of secret.dealt) expect(wire).not.toContain(clue.text);
    expect(withoutOptions(view)).not.toContain(secret.person);
    expect(wire).not.toMatch(/Exodus|correct/i);
  });

  it('tells a phone when another phone in its group holds the same clue', () => {
    const round = build();
    const five = [...four, { playerId: 'ed', teamId: null }];
    const table = tableOf(five);
    const shared = five.map((seat) => phoneView(round, table, seat.playerId).shared);
    expect(shared.filter(Boolean)).toHaveLength(2);
    expect(phoneView(round, table, 'ed').clue).toBe(phoneView(round, table, 'ann').clue);
  });

  it('tells someone who joined after the deal to wait for the next case', () => {
    const round = build();
    expect(game().viewFor?.(round, tableOf(four), 'late', 'answering')).toEqual({ waiting: true });
  });

  it('is the same every time it is asked, and changes nothing', () => {
    const round = build();
    const before = JSON.stringify(round);
    const table = tableOf(four, [vote('ann', 1)]);
    expect(phoneView(round, table, 'bo')).toEqual(phoneView(round, table, 'bo'));
    expect(hostView(round, table)).toEqual(hostView(round, table));
    expect(JSON.stringify(round)).toBe(before);
  });

  it('does not change while votes arrive, so nobody learns anything from a vote', () => {
    const round = build();
    const quiet = tableOf(four);
    const busy = tableOf(four, [vote('ann', 0), vote('bo', 2, 1_100)]);
    expect(hostView(round, busy)).toEqual(hostView(round, quiet));
    expect(phoneView(round, busy, 'cy')).toEqual(phoneView(round, quiet, 'cy'));
  });
});

// ---------------------------------------------------------------------------
// Taking a vote
// ---------------------------------------------------------------------------

describe('taking a vote', () => {
  const two = seats(['ann', null], ['bo', null]);

  it('takes a choice of one of the names from anyone seated', () => {
    const round = build();
    expect(game().accepts?.(round, tableOf(two), 'ann', { type: 'choice', index: 3 })).toBe(true);
  });

  it('refuses anyone without a seat, and anything that is not one of the names', () => {
    const round = build();
    const accepts = (playerId: string, value: AnswerValue): boolean | undefined =>
      game().accepts?.(round, tableOf(two), playerId, value);
    expect(accepts('late', { type: 'choice', index: 0 })).toBe(false);
    expect(accepts('ann', { type: 'choice', index: 4 })).toBe(false);
    expect(accepts('ann', { type: 'choice', index: -1 })).toBe(false);
    expect(accepts('ann', { type: 'choice', index: 1.5 })).toBe(false);
    expect(accepts('ann', { type: 'text', text: 'Moses' })).toBe(false);
  });

  it('counts two votes for one name as the same vote, and names it for the big screen', () => {
    const round = build();
    const secret = secretOf(round);
    const spec = game().groupVote;
    expect(spec?.key({ type: 'choice', index: 2 }, round)).toBe('2');
    expect(spec?.key({ type: 'choice', index: 9 }, round)).toBeNull();
    expect(spec?.key({ type: 'found' }, round)).toBeNull();
    expect(spec?.label({ type: 'choice', index: 2 }, round)).toBe(secret.options[2]);
  });
});

// ---------------------------------------------------------------------------
// Scoring, one answer at a time
// ---------------------------------------------------------------------------

describe('scoring', () => {
  it('pays each right answer the same, and counts every name even at zero', () => {
    const secret = secretOf(build());
    const wrong = (secret.correctIndex + 1) % secret.options.length;
    const outcome = scoreDetective(
      secret,
      [vote('ann', secret.correctIndex), vote('bo', wrong, 1_100)],
      tableOf(seats(['ann', null], ['bo', null]))
    );
    expect(outcome.perPlayer.get('ann')).toEqual({
      correct: true,
      pointsAwarded: POINTS,
      submitted: { type: 'choice', index: secret.correctIndex },
      note: null,
    });
    expect(outcome.perPlayer.get('bo')?.pointsAwarded).toBe(0);
    expect(outcome.correctLabel).toBe(secret.person);
    expect(outcome.aggregates.map((row) => row.label)).toEqual(secret.options);
    expect(outcome.aggregates.reduce((total, row) => total + row.count, 0)).toBe(2);
  });

  it('marks an answer it cannot read, and counts it nowhere', () => {
    const secret = secretOf(build());
    const outcome = scoreDetective(
      secret,
      [{ playerId: 'ann', value: { type: 'choice', index: 8 }, at: 1, openedAt: 0 }],
      tableOf(seats(['ann', null]))
    );
    expect(outcome.perPlayer.get('ann')?.note).toBe(UNREADABLE_NOTE);
    expect(outcome.aggregates.every((row) => row.count === 0)).toBe(true);
  });

  it('shows every clue with its reference, and where it was', () => {
    const secret = secretOf(build());
    const outcome = scoreDetective(secret, [], tableOf(seats(['ann', null], ['bo', null])));
    const detail = outcome.detail as DetectiveReveal;
    expect(detail.person).toBe(secret.person);
    expect(detail.options[detail.correctIndex]).toBe(secret.person);
    expect(detail.clues).toHaveLength(1 + CLUES_PER_CASE);
    expect(detail.clues[0]).toMatchObject({ text: secret.opening.text, where: 'screen' });
    expect(detail.clues.every((clue) => clue.reference?.startsWith('Exodus'))).toBe(true);
    // Two phones hold two of the four; the reveal does not pretend otherwise.
    expect(detail.clues.slice(1).map((clue) => clue.where).sort()).toEqual([
      'phones',
      'phones',
      'undealt',
      'undealt',
    ]);
  });
});
