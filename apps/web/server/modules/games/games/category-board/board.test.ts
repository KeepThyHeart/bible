/**
 * The board, without a room around it.
 *
 * What matters here is that the board a room gets depends only on its
 * generator and its length, that it climbs, and that the walk never plays a
 * tile twice or skips one it could have played.
 */

import { describe, expect, it } from 'vitest';
import type { QuestionRecord, QuestionSetRecord } from '../../content/index.js';
import {
  MAX_COLUMNS,
  MIN_COLUMNS,
  ROWS,
  TILE_STEP,
  chooseBoard,
  columnFor,
  columnsFor,
  leadingDistractors,
  nextTile,
  questionAt,
  tileValue,
  walkOrder,
} from './board.js';
import type { BoardLayout, TilePosition } from './board.js';

function seeded(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function question(id: string, overrides: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id,
    type: 'multiple-choice',
    prompt: `Question ${id}?`,
    promptVerseId: null,
    answer: `Answer ${id}`,
    accept: [],
    contextNote: null,
    source: null,
    reviewedBy: null,
    distractors: [1, 2, 3, 4, 5].map((n) => `Wrong ${id}.${n}`),
    clues: [],
    book: null,
    section: null,
    difficulty: 3,
    audience: 'all',
    tags: ['category-board'],
    ...overrides,
  };
}

function set(id: string, questionIds: string[]): QuestionSetRecord {
  return {
    id,
    name: `Category ${id}`,
    description: null,
    questionIds,
    book: null,
    section: null,
    difficulty: 3,
    audience: 'all',
    tags: ['category-board'],
  };
}

/** A library of `count` five-question categories, keyed by question id. */
function libraryOf(count: number): { sets: QuestionSetRecord[]; lookup: (id: string) => QuestionRecord | null } {
  const records = new Map<string, QuestionRecord>();
  const sets: QuestionSetRecord[] = [];
  for (let category = 0; category < count; category += 1) {
    const ids: string[] = [];
    for (let row = 1; row <= ROWS; row += 1) {
      const id = `c${category}-q${row}`;
      records.set(id, question(id, { difficulty: row }));
      ids.push(id);
    }
    sets.push(set(`c${category}`, ids));
  }
  return { sets, lookup: (id) => records.get(id) ?? null };
}

/** A layout with columns of the given depths, for walking. */
function layoutOf(depths: number[]): BoardLayout {
  return {
    columns: depths.map((depth, index) => ({
      setId: `c${index}`,
      name: `Category ${index}`,
      questions: Array.from({ length: depth }, (_unused, row) => ({
        id: `c${index}-q${row}`,
        prompt: `Prompt ${index}.${row}`,
        answer: `Answer ${index}.${row}`,
        reference: null,
        distractors: ['a', 'b', 'c'],
      })),
    })),
  };
}

describe('how wide a board is', () => {
  it('gives a short game few enough columns to reach the hard rows', () => {
    expect(columnsFor(10, 12)).toBe(2);
    expect(columnsFor(15, 12)).toBe(3);
    expect(columnsFor(20, 12)).toBe(4);
  });

  it('keeps to a board a room can read', () => {
    expect(columnsFor(1, 12)).toBe(MIN_COLUMNS);
    expect(columnsFor(200, 12)).toBe(MAX_COLUMNS);
  });

  it('never asks for more categories than the library holds', () => {
    expect(columnsFor(30, 1)).toBe(1);
    expect(columnsFor(30, 0)).toBe(0);
  });
});

describe('what a tile is worth', () => {
  it('climbs a step per row, starting at one step', () => {
    expect([0, 1, 2, 3, 4].map(tileValue)).toEqual([1, 2, 3, 4, 5].map((n) => n * TILE_STEP));
  });
});

describe('the wrong answers a tile offers', () => {
  it('takes the leading ones, in the order the author ranked them', () => {
    expect(leadingDistractors(question('q'), 3)).toEqual(['Wrong q.1', 'Wrong q.2', 'Wrong q.3']);
  });

  it('passes over one that would read as the answer, or as another option', () => {
    const record = question('q', {
      answer: 'Saul',
      accept: ['King Saul'],
      distractors: ['saul!', 'David', 'King  Saul', 'david', 'Solomon', 'Jonathan'],
    });

    expect(leadingDistractors(record, 3)).toEqual(['David', 'Solomon', 'Jonathan']);
  });
});

describe('one category on the board', () => {
  it('puts its questions easiest first, however they were listed', () => {
    const records = new Map(
      [4, 1, 5, 2, 3].map((difficulty) => {
        const id = `d${difficulty}`;
        return [id, question(id, { difficulty })];
      })
    );
    const column = columnFor(set('s', [...records.keys()]), (id) => records.get(id) ?? null);

    expect(column?.questions.map((entry) => entry.id)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5']);
  });

  it('keeps the authored order between questions of the same difficulty', () => {
    const records = new Map(['x', 'y', 'z'].map((id) => [id, question(id, { difficulty: 2 })]));
    const column = columnFor(set('s', ['z', 'x', 'y']), (id) => records.get(id) ?? null);

    expect(column?.questions.map((entry) => entry.id)).toEqual(['z', 'x', 'y']);
  });

  it('leaves off a question that is gone or cannot offer four options', () => {
    const records = new Map([
      ['ok', question('ok', { difficulty: 1 })],
      ['thin', question('thin', { difficulty: 2, distractors: ['only', 'two'] })],
    ]);
    const column = columnFor(set('s', ['ok', 'missing', 'thin']), (id) => records.get(id) ?? null);

    expect(column?.questions.map((entry) => entry.id)).toEqual(['ok']);
  });

  it('is left off the board entirely when none of its questions can be played', () => {
    expect(columnFor(set('s', ['missing']), () => null)).toBeNull();
  });

  it('holds no more than a column of rows', () => {
    const records = new Map(
      Array.from({ length: 8 }, (_unused, n) => [`q${n}`, question(`q${n}`, { difficulty: 1 })])
    );
    const column = columnFor(set('s', [...records.keys()]), (id) => records.get(id) ?? null);

    expect(column?.questions).toHaveLength(ROWS);
  });

  it('carries the reference as a reader would write it', () => {
    const record = question('q', { promptVerseId: 9_010_024 });
    const column = columnFor(set('s', ['q']), () => record);

    expect(column?.questions[0]?.reference).toBe('1 Samuel 10:24');
  });
});

describe('choosing a board', () => {
  it('chooses the same board from the same generator', () => {
    const { sets, lookup } = libraryOf(12);

    expect(chooseBoard(sets, lookup, 20, seeded(5))).toEqual(chooseBoard(sets, lookup, 20, seeded(5)));
  });

  it('does not care what order the library listed its categories in', () => {
    const { sets, lookup } = libraryOf(12);

    expect(chooseBoard([...sets].reverse(), lookup, 20, seeded(5))).toEqual(
      chooseBoard(sets, lookup, 20, seeded(5))
    );
  });

  it('draws different boards as the generator changes', () => {
    const { sets, lookup } = libraryOf(12);
    const boards = new Set<string>();
    for (let seed = 1; seed <= 10; seed += 1) {
      const board = chooseBoard(sets, lookup, 10, seeded(seed));
      boards.add(board?.columns.map((column) => column.setId).join(',') ?? '');
    }

    expect(boards.size).toBeGreaterThan(1);
  });

  it('is as wide as the room is long, and never repeats a category', () => {
    const { sets, lookup } = libraryOf(12);
    const board = chooseBoard(sets, lookup, 20, seeded(3));
    const ids = board?.columns.map((column) => column.setId) ?? [];

    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it('is nothing at all when the library has no categories', () => {
    expect(chooseBoard([], () => null, 10, seeded(1))).toBeNull();
  });
});

describe('walking the board', () => {
  it('plays across the easiest row before going down a row', () => {
    const order = walkOrder(layoutOf([2, 2, 2]));

    expect(order.slice(0, 4)).toEqual([
      { column: 0, row: 0 },
      { column: 1, row: 0 },
      { column: 2, row: 0 },
      { column: 0, row: 1 },
    ]);
    expect(order).toHaveLength(6);
  });

  it('steps over a hole in a short column rather than stopping there', () => {
    const order = walkOrder(layoutOf([3, 1, 2]));

    expect(order).toEqual([
      { column: 0, row: 0 },
      { column: 1, row: 0 },
      { column: 2, row: 0 },
      { column: 0, row: 1 },
      { column: 2, row: 1 },
      { column: 0, row: 2 },
    ]);
  });

  it('comes to the first tile nobody has played', () => {
    const board = layoutOf([2, 2]);
    const played: TilePosition[] = [
      { column: 1, row: 0 },
      { column: 0, row: 0 },
    ];

    expect(nextTile(board, played)).toEqual({ column: 0, row: 1 });
    expect(nextTile(board, [])).toEqual({ column: 0, row: 0 });
  });

  it('says so once every tile has been played', () => {
    const board = layoutOf([1, 1]);

    expect(nextTile(board, walkOrder(board))).toBeNull();
  });

  it('finds the question on a tile, and nothing off the board', () => {
    const board = layoutOf([2]);

    expect(questionAt(board, { column: 0, row: 1 })?.id).toBe('c0-q1');
    expect(questionAt(board, { column: 3, row: 0 })).toBeNull();
  });
});
