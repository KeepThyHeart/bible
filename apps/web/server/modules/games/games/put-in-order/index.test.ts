/**
 * The round and what it is worth.
 *
 * Three promises matter more than the arithmetic. The phone payload cannot
 * betray the order, because reading a payload is the cheapest cheat there is.
 * Nearly right is paid, and told to the room as a count rather than as a name.
 * And a game does not show the same list twice, or two lists from the same
 * story back to back, while it has anything else to show.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { AnswerValue, PlayerId, RoomSettings } from '../../../../../src/modules/games/shared/protocol.js';
import { DEFAULT_THEME } from '../../../../../src/modules/games/shared/theme.js';
import type { Round, RoundBuildContext, ScoredAnswer } from '../../../../../src/modules/games/shared/games.js';
import { toVerseId } from '../../../../../src/modules/games/shared/verseId.js';
import { ContentLibrary, importContent, useContent } from '../../content/index.js';
import { makeTempDir, removeTempDir } from '../../content/fixtures.js';
import {
  DEFAULT_INSTRUCTIONS,
  GAME_ID,
  GRADE_LABELS,
  MS_PER_ITEM,
  POINTS,
  createPutInOrder,
  putInOrder,
  scorePutInOrder,
} from './index.js';
import type { PutInOrderDetail, PutInOrderSecret, PutInOrderView } from './index.js';
import { timelineOf } from './pick.js';

function seeded(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function settings(overrides: Partial<RoomSettings> = {}): RoomSettings {
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

type PutInOrderRound = Round<PutInOrderSecret | null>;

function context(
  random: () => number,
  overrides: Partial<RoomSettings> = {},
  previous: readonly PutInOrderRound[] = []
): RoundBuildContext<PutInOrderSecret | null> {
  return { settings: settings(overrides), random, previous, choice: null };
}

function viewOf(round: PutInOrderRound): PutInOrderView {
  return round.playerView as PutInOrderView;
}

function answer(playerId: PlayerId, value: AnswerValue, at = 1_000): ScoredAnswer {
  return { playerId, value, at, openedAt: 0 };
}

function order(playerId: PlayerId, keys: string[], at = 1_000): ScoredAnswer {
  return answer(playerId, { type: 'order', order: keys }, at);
}

// ---------------------------------------------------------------------------
// A library of a few lists, imported the way the real content is
// ---------------------------------------------------------------------------

const CREATION = [
  { label: 'Light', verseId: toVerseId(1, 1, 3), note: 'The first day.' },
  { label: 'Dry land and plants', verseId: toVerseId(1, 1, 12), note: null },
  { label: 'Fish and birds', verseId: toVerseId(1, 1, 21), note: null },
  { label: 'God rested', verseId: toVerseId(1, 2, 2), note: null },
];

const LISTS = [
  {
    id: 'put-in-order-creation-1',
    title: 'The days of creation, set 1',
    instructions: 'Put these in the order God made them.',
    difficulty: 1,
    items: CREATION,
  },
  {
    id: 'put-in-order-creation-2',
    title: 'The days of creation, set 2',
    instructions: 'Put these in the order God made them.',
    difficulty: 1,
    items: [
      { label: 'The firmament of heaven', verseId: toVerseId(1, 1, 7), note: null },
      { label: 'Sun, moon and stars', verseId: toVerseId(1, 1, 16), note: null },
      { label: 'Land animals and man', verseId: toVerseId(1, 1, 27), note: null },
      { label: 'God rested', verseId: toVerseId(1, 2, 2), note: null },
    ],
  },
  {
    id: 'put-in-order-joseph-1',
    title: 'The story of Joseph, set 1',
    difficulty: 3,
    items: [
      { label: 'Given a coat of many colours', verseId: toVerseId(1, 37, 3), note: null },
      { label: 'Sold to the Ishmeelites', verseId: toVerseId(1, 37, 28), note: null },
      { label: 'Thrown into prison', verseId: toVerseId(1, 39, 20), note: null },
      { label: 'Made ruler over Egypt', verseId: toVerseId(1, 41, 41), note: null },
    ],
  },
  {
    id: 'put-in-order-judges-1',
    title: 'The judges, set 1',
    instructions: 'Put these judges in the order they judged Israel.',
    difficulty: 5,
    items: [
      { label: 'Othniel', verseId: toVerseId(7, 3, 9), note: null },
      { label: 'Ehud', verseId: toVerseId(7, 3, 15), note: null },
      { label: 'Deborah', verseId: toVerseId(7, 4, 4), note: null },
      { label: 'Gideon', verseId: toVerseId(7, 6, 11), note: null },
      { label: 'Samson', verseId: toVerseId(7, 13, 24), note: null },
    ],
  },
  {
    id: 'put-in-order-books-new-1',
    title: 'Books of the New Testament, set 1',
    instructions: 'Put these books in the order they appear in the Bible.',
    difficulty: 2,
    items: [
      { label: 'Matthew', verseId: null, note: null },
      { label: 'Acts', verseId: null, note: null },
      { label: 'Romans', verseId: null, note: null },
      { label: 'Jude', verseId: null, note: null },
    ],
  },
];

let directory: string;
let library: ContentLibrary;
let previous: ContentLibrary | null;

function stock(lists: readonly object[]): void {
  const report = importContent(library.db, { orderedLists: lists });
  expect(report.rejected).toEqual([]);
}

beforeEach(() => {
  directory = makeTempDir('put-in-order-');
  library = ContentLibrary.open({
    moduleDir: join(directory, 'no-modules'),
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

/** Builds a whole game's worth of rounds, each seeing the ones before it. */
function playGame(rounds: number, seed: number, overrides: Partial<RoomSettings> = {}): PutInOrderRound[] {
  const random = seeded(seed);
  const built: PutInOrderRound[] = [];
  for (let index = 0; index < rounds; index += 1) {
    built.push(putInOrder.buildRound(context(random, overrides, built), index));
  }
  return built;
}

describe('the list a round puts up', () => {
  beforeEach(() => stock(LISTS));

  it('shows every item of one list, under a letter each', () => {
    const round = putInOrder.buildRound(context(seeded(4)), 0);
    const view = viewOf(round);
    const list = LISTS.find((candidate) => candidate.id === round.secret?.listId);

    expect(view.title).toBe(list?.title);
    expect(view.items.map((item) => item.key)).toEqual(
      ['A', 'B', 'C', 'D', 'E'].slice(0, view.items.length)
    );
    expect(view.items.map((item) => item.label).sort()).toEqual(
      list?.items.map((item) => item.label).sort()
    );
  });

  it('never shows a list already in its right order', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const round = putInOrder.buildRound(context(seeded(seed)), 0);
      const shown = viewOf(round).items.map((item) => item.label);

      expect(shown, `seed ${seed}`).not.toEqual(round.secret?.items.map((item) => item.label));
    }
  });

  it('tells neither screen where anything belongs', () => {
    const round = putInOrder.buildRound(context(seeded(9)), 0);
    const payload = JSON.stringify(round.playerView);

    expect(Object.keys(viewOf(round)).sort()).toEqual(['instructions', 'items', 'title']);
    for (const item of viewOf(round).items) expect(Object.keys(item).sort()).toEqual(['key', 'label']);
    expect(payload).toBe(JSON.stringify(round.hostView));
    expect(payload).not.toContain('verseId');
    expect(payload).not.toContain(round.secret?.listId ?? 'unreachable');
  });

  it('keys each item by the slot it is shown in, not by where it belongs', () => {
    const round = putInOrder.buildRound(context(seeded(12)), 0);
    const shownKeyOf = new Map(viewOf(round).items.map((item) => [item.label, item.key]));

    for (const item of round.secret?.items ?? []) {
      expect(item.key).toBe(shownKeyOf.get(item.label));
    }
  });

  it('takes the list’s own instruction, or a plain one when it has none', () => {
    const rounds = playGame(LISTS.length, 3);
    const joseph = rounds.find((round) => round.secret?.listId === 'put-in-order-joseph-1');
    const judges = rounds.find((round) => round.secret?.listId === 'put-in-order-judges-1');

    expect(joseph && viewOf(joseph).instructions).toBe(DEFAULT_INSTRUCTIONS);
    expect(judges && viewOf(judges).instructions).toBe(
      'Put these judges in the order they judged Israel.'
    );
  });

  it('gives the room longer to order a longer list, but never less than it chose', () => {
    const rounds = playGame(LISTS.length, 5);
    const judges = rounds.find((round) => round.secret?.listId === 'put-in-order-judges-1');

    expect(judges?.answerWindowMs).toBe(5 * MS_PER_ITEM);

    const unhurried = putInOrder.buildRound(context(seeded(5), { answerWindowMs: 90_000 }), 0);
    expect(unhurried.answerWindowMs).toBe(90_000);
  });

  it('builds exactly the same round from the same generator', () => {
    expect(putInOrder.buildRound(context(seeded(21)), 0)).toEqual(
      putInOrder.buildRound(context(seeded(21)), 0)
    );
  });
});

describe('the room’s familiarity', () => {
  beforeEach(() => stock(LISTS));

  it('keeps a room set to the best-known material to the easiest lists', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const round = putInOrder.buildRound(context(seeded(seed), { familiarity: 'core' }), 0);

      expect(timelineOf(round.secret?.listId ?? ''), `seed ${seed}`).toBe('creation');
    }
  });

  it('reaches the hardest lists when the room set no cap', () => {
    const seen = new Set(playGame(LISTS.length, 8).map((round) => round.secret?.listId));

    expect(seen.has('put-in-order-judges-1')).toBe(true);
  });

  it('offers the easiest lists there are when nothing sits under the cap', () => {
    library.close();
    library = ContentLibrary.open({
      moduleDir: join(directory, 'no-modules'),
      contentPath: ':memory:',
      defaultTranslation: 'KJV',
    });
    useContent(library);
    stock(LISTS.filter((list) => list.difficulty >= 3));

    const round = putInOrder.buildRound(context(seeded(2), { familiarity: 'core' }), 0);

    expect(round.secret?.listId).toBe('put-in-order-joseph-1');
  });
});

describe('across a game', () => {
  beforeEach(() => stock(LISTS));

  it('does not show the same list twice', () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const ids = playGame(LISTS.length, seed).map((round) => round.secret?.listId);

      expect(new Set(ids).size, `seed ${seed}`).toBe(LISTS.length);
    }
  });

  it('does not follow a list with another from the same story while there is a choice', () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      // Four rounds from four stories, two of the lists sharing one: the
      // second creation list must never land straight after the first.
      const stories = playGame(4, seed).map((round) => timelineOf(round.secret?.listId ?? ''));

      for (let index = 1; index < stories.length; index += 1) {
        expect(stories[index], `seed ${seed}`).not.toBe(stories[index - 1]);
      }
    }
  });
});

describe('a server with no lists imported', () => {
  it('builds a round that says there is nothing, rather than failing in front of a group', () => {
    const round = putInOrder.buildRound(context(seeded(1)), 3);

    expect(round.index).toBe(3);
    expect(round.secret).toBeNull();
    expect(viewOf(round).items).toEqual([]);
    expect(round.hostView).toEqual(round.playerView);
  });

  it('scores it as nothing at all', () => {
    const round = putInOrder.buildRound(context(seeded(1)), 0);
    const outcome = putInOrder.scoreRound(round, [order('p-1', ['A', 'B', 'C', 'D'])], { seats: [], log: [] });

    expect(outcome.perPlayer.size).toBe(0);
    expect(outcome.aggregates).toEqual([]);
    expect(outcome.correctLabel).toBe('');
    expect(outcome.detail).toBeNull();
  });

  it('can be handed its lists directly', () => {
    const game = createPutInOrder({ lists: () => [] });

    expect(game.buildRound(context(seeded(1)), 0).secret).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Shown as A–D in a shuffled order; the right order is C, A, D, B. */
const SECRET: PutInOrderSecret = {
  listId: 'put-in-order-creation-1',
  title: 'The days of creation, set 1',
  instructions: 'Put these in the order God made them.',
  items: [
    { key: 'C', ...CREATION[0]! },
    { key: 'A', ...CREATION[1]! },
    { key: 'D', ...CREATION[2]! },
    { key: 'B', ...CREATION[3]! },
  ],
};

const RIGHT = ['C', 'A', 'D', 'B'];

describe('scoring an order', () => {
  it('pays a perfect order in full, however late it arrived', () => {
    const outcome = scorePutInOrder(SECRET, [
      order('quick', RIGHT, 100),
      order('slow', RIGHT, 19_900),
    ]);

    for (const who of ['quick', 'slow']) {
      expect(outcome.perPlayer.get(who)).toEqual({
        correct: true,
        pointsAwarded: POINTS,
        submitted: { type: 'order', order: RIGHT },
        note: null,
      });
    }
  });

  it('pays most of the round for one neighbouring swap, and says how close it was', () => {
    const outcome = scorePutInOrder(SECRET, [order('p-1', ['A', 'C', 'D', 'B'])]);

    expect(outcome.perPlayer.get('p-1')?.correct).toBe(false);
    expect(outcome.perPlayer.get('p-1')?.pointsAwarded).toBe(67);
    expect(outcome.perPlayer.get('p-1')?.note).toBe('One swap from perfect');
  });

  it('pays less as more pairs come out the wrong way round', () => {
    const outcome = scorePutInOrder(SECRET, [order('p-1', ['A', 'C', 'B', 'D'])]);

    expect(outcome.perPlayer.get('p-1')?.pointsAwarded).toBe(33);
    expect(outcome.perPlayer.get('p-1')?.note).toBe('4 of 6 pairs the right way round');
  });

  it('pays nothing for an order no better than a shuffle, and explains why privately', () => {
    const outcome = scorePutInOrder(SECRET, [order('p-1', ['B', 'D', 'A', 'C'])]);

    expect(outcome.perPlayer.get('p-1')?.pointsAwarded).toBe(0);
    expect(outcome.perPlayer.get('p-1')?.note).toContain('0 of 6 pairs');
    expect(outcome.perPlayer.get('p-1')?.note).toContain('Points start past half');
  });

  it('pays nothing for something that is not an ordering of these items', () => {
    const outcome = scorePutInOrder(SECRET, [
      answer('text', { type: 'text', text: 'C A D B' }),
      order('short', ['C', 'A']),
      order('twice', ['C', 'C', 'D', 'B']),
      order('stranger', ['C', 'A', 'D', 'E']),
    ]);

    for (const who of ['text', 'short', 'twice', 'stranger']) {
      expect(outcome.perPlayer.get(who)?.pointsAwarded, who).toBe(0);
      expect(outcome.perPlayer.get(who)?.note, who).toBe(GRADE_LABELS.unreadable);
    }
  });

  it('counts only the first order a player sent', () => {
    const outcome = scorePutInOrder(SECRET, [
      order('p-1', RIGHT, 900),
      order('p-1', ['B', 'D', 'A', 'C'], 100),
    ]);

    expect(outcome.perPlayer.size).toBe(1);
    expect(outcome.perPlayer.get('p-1')?.pointsAwarded).toBe(0);
  });

  it('says nothing about a player who never answered', () => {
    const outcome = scorePutInOrder(SECRET, [order('p-1', RIGHT)]);

    expect(outcome.perPlayer.has('p-2')).toBe(false);
  });
});

describe('what the big screen is told', () => {
  it('counts how many got it right and how many nearly did, and names nobody', () => {
    const outcome = scorePutInOrder(SECRET, [
      order('a', RIGHT),
      order('b', RIGHT),
      order('c', ['A', 'C', 'D', 'B']),
      order('d', ['A', 'C', 'B', 'D']),
      order('e', ['B', 'D', 'A', 'C']),
      answer('f', { type: 'found' }),
    ]);

    expect(outcome.aggregates).toEqual([
      { label: GRADE_LABELS.inOrder, count: 2 },
      { label: GRADE_LABELS.oneSwap, count: 1 },
      { label: GRADE_LABELS.partly, count: 1 },
      { label: GRADE_LABELS.furtherOff, count: 1 },
      { label: GRADE_LABELS.unreadable, count: 1 },
    ]);
    for (const row of outcome.aggregates) {
      expect(Object.keys(row).sort()).toEqual(['count', 'label']);
    }
    expect(JSON.stringify(outcome.aggregates)).not.toMatch(/"[a-f]"/);
  });

  it('always leads with the right and the nearly right, even when nobody was either', () => {
    const outcome = scorePutInOrder(SECRET, []);

    expect(outcome.aggregates).toEqual([
      { label: GRADE_LABELS.inOrder, count: 0 },
      { label: GRADE_LABELS.oneSwap, count: 0 },
    ]);
  });

  it('carries the right order, with each item’s reference and note, into the reveal', () => {
    const outcome = scorePutInOrder(SECRET, []);
    const detail = outcome.detail as PutInOrderDetail;

    expect(outcome.correctLabel).toBe('Light → Dry land and plants → Fish and birds → God rested');
    expect(detail.title).toBe(SECRET.title);
    expect(detail.pairs).toBe(6);
    expect(detail.items[0]).toEqual({
      key: 'C',
      label: 'Light',
      reference: 'Genesis 1:3',
      note: 'The first day.',
    });
    expect(detail.items[3]?.reference).toBe('Genesis 2:2');
  });

  it('leaves the reference off an item that has no single home', () => {
    const books: PutInOrderSecret = {
      ...SECRET,
      items: SECRET.items.map((item) => ({ ...item, verseId: null })),
    };
    const detail = scorePutInOrder(books, []).detail as PutInOrderDetail;

    expect(detail.items.every((item) => item.reference === null)).toBe(true);
  });
});

describe('what the module tells the catalog', () => {
  it('names itself descriptively and plays alone', () => {
    expect(putInOrder.id).toBe('put-in-order');
    expect(putInOrder.name).toBe('Put in order');
    expect(putInOrder.supportsSolo).toBe(true);
    expect(putInOrder.usesBuzz).toBe(false);
  });

  it('scores through the module the same way as through the function', () => {
    const round: PutInOrderRound = { index: 0, secret: SECRET, hostView: null, playerView: null };
    const answers = [order('p-1', ['A', 'C', 'D', 'B'])];

    expect(putInOrder.scoreRound(round, answers, { seats: [], log: [] })).toEqual(scorePutInOrder(SECRET, answers));
  });
});
