/**
 * Which saying comes next.
 *
 * The rules here decide what a whole evening feels like: a ceiling that holds
 * keeps a mixed group in lines they know, and a game that never repeats a
 * saying keeps each round a question. When the two collide, the ceiling bends,
 * and only as far as it has to.
 */

import { describe, expect, it } from 'vitest';
import type { QuestionRecord } from '../../content/index.js';
import { WHO_SAID_IT_TAG, chooseQuestion } from './draw.js';

function saying(id: string, difficulty: number): QuestionRecord {
  return {
    id,
    type: 'multiple-choice',
    prompt: `Who said, “${id}”`,
    promptVerseId: null,
    answer: 'Somebody',
    accept: [],
    contextNote: null,
    source: null,
    reviewedBy: null,
    distractors: ['A', 'B', 'C'],
    clues: [],
    book: null,
    section: null,
    difficulty,
    audience: 'all',
    tags: [WHO_SAID_IT_TAG],
  };
}

const POOL = [saying('a', 1), saying('b', 1), saying('c', 2), saying('d', 3), saying('e', 5)];
const NONE_ASKED: ReadonlySet<string> = new Set();

function drawnAcross(asked: ReadonlySet<string>, ceiling: number | null): Set<string | undefined> {
  const drawn = new Set<string | undefined>();
  for (let step = 0; step < 50; step += 1) {
    drawn.add(chooseQuestion(POOL, asked, ceiling, () => step / 50)?.id);
  }
  return drawn;
}

describe('a room with a ceiling', () => {
  it('asks only sayings at or under it', () => {
    expect(drawnAcross(NONE_ASKED, 1)).toEqual(new Set(['a', 'b']));
    expect(drawnAcross(NONE_ASKED, 3)).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('asks anything at all when there is no ceiling', () => {
    expect(drawnAcross(NONE_ASKED, null)).toEqual(new Set(['a', 'b', 'c', 'd', 'e']));
  });
});

describe('a game that has asked some already', () => {
  it('never asks the same saying twice', () => {
    expect(drawnAcross(new Set(['a']), 1)).toEqual(new Set(['b']));
  });

  it('steps past the ceiling by as little as it can once the ceiling runs out', () => {
    expect(drawnAcross(new Set(['a', 'b']), 1)).toEqual(new Set(['c']));
    expect(drawnAcross(new Set(['a', 'b', 'c']), 1)).toEqual(new Set(['d']));
  });

  it('has nothing to ask once every saying has been asked', () => {
    expect(chooseQuestion(POOL, new Set(POOL.map((question) => question.id)), null, () => 0.5)).toBeNull();
  });
});

describe('an empty library', () => {
  it('asks nothing rather than failing', () => {
    expect(chooseQuestion([], NONE_ASKED, 1, () => 0.5)).toBeNull();
  });
});

describe('the generator it is handed', () => {
  it('draws the same saying from the same value', () => {
    expect(chooseQuestion(POOL, NONE_ASKED, null, () => 0.42)).toBe(
      chooseQuestion(POOL, NONE_ASKED, null, () => 0.42)
    );
  });

  it('stays inside the list even for a generator that returns one', () => {
    expect(chooseQuestion(POOL, NONE_ASKED, null, () => 1)?.id).toBe('e');
  });
});
