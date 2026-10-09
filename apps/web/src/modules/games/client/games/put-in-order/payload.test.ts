/**
 * Reading a payload that might be from a different day.
 *
 * The cases here are the ones that reach a screen in front of people: an older
 * bundle, a round the server built nothing for, a reveal that has not arrived.
 * None may throw, and a list with a broken item must not let one tap place
 * two things.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_INSTRUCTIONS, labelsFor, letterFor, readDetail, readQuestion } from './payload.js';

const QUESTION = {
  title: 'The days of creation, set 1',
  instructions: 'Put these in the order God made them.',
  items: [
    { key: 'A', label: 'Fish and birds' },
    { key: 'B', label: 'Light' },
    { key: 'C', label: 'God rested' },
    { key: 'D', label: 'Dry land and plants' },
  ],
};

const DETAIL = {
  title: 'The days of creation, set 1',
  instructions: 'Put these in the order God made them.',
  items: [
    { key: 'B', label: 'Light', reference: 'Genesis 1:3', note: 'The first day.' },
    { key: 'D', label: 'Dry land and plants', reference: 'Genesis 1:12', note: null },
    { key: 'A', label: 'Fish and birds', reference: 'Genesis 1:21', note: null },
    { key: 'C', label: 'God rested', reference: 'Genesis 2:2', note: null },
  ],
  pairs: 6,
};

describe('reading a question', () => {
  it('reads one the server sent', () => {
    const question = readQuestion(QUESTION);

    expect(question?.title).toBe(QUESTION.title);
    expect(question?.items.map((item) => item.key)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('refuses anything it cannot draw', () => {
    expect(readQuestion(null)).toBeNull();
    expect(readQuestion('a list')).toBeNull();
    expect(readQuestion({ title: 'no items at all' })).toBeNull();
  });

  it('reads a round with nothing in it as an empty list, not as a broken one', () => {
    expect(readQuestion({ title: '', instructions: '', items: [] })?.items).toEqual([]);
  });

  it('drops an item it cannot answer with, and a key it has already seen', () => {
    const question = readQuestion({
      ...QUESTION,
      items: [{ key: 'A', label: 'Light' }, { key: 'A', label: 'Again' }, { label: 'No key' }, 7],
    });

    expect(question?.items).toEqual([{ key: 'A', label: 'Light' }]);
  });

  it('puts a plain instruction up when the list has none', () => {
    expect(readQuestion({ ...QUESTION, instructions: '' })?.instructions).toBe(DEFAULT_INSTRUCTIONS);
    expect(readQuestion({ items: [] })?.instructions).toBe(DEFAULT_INSTRUCTIONS);
  });
});

describe('reading a reveal', () => {
  it('reads one the server sent', () => {
    const detail = readDetail(DETAIL);

    expect(detail?.items).toHaveLength(4);
    expect(detail?.items[0]).toEqual(DETAIL.items[0]);
    expect(detail?.pairs).toBe(6);
  });

  it('refuses one with no order in it', () => {
    expect(readDetail(null)).toBeNull();
    expect(readDetail({ ...DETAIL, items: [] })).toBeNull();
    expect(readDetail({ title: 'no items' })).toBeNull();
  });

  it('treats a missing reference or note as none rather than as empty text', () => {
    const detail = readDetail({ items: [{ label: 'Matthew', reference: '', note: '' }] });

    expect(detail?.items[0]).toEqual({ key: '', label: 'Matthew', reference: null, note: null });
    expect(detail?.pairs).toBe(0);
  });
});

describe('small helpers', () => {
  it('letters the items so a host can say them aloud', () => {
    expect(letterFor(0)).toBe('A');
    expect(letterFor(4)).toBe('E');
    expect(letterFor(9)).toBe('10');
  });

  it('turns a sent order back into words, keeping a key it does not know', () => {
    const detail = readDetail(DETAIL);

    expect(labelsFor(['B', 'A', 'Z'], detail?.items ?? [])).toEqual(['Light', 'Fish and birds', 'Z']);
  });
});
