/**
 * Reading a payload that might be from a different day.
 *
 * The cases here are the ones that reach a screen in front of people: an older
 * bundle that does not know a field, a round the server built nothing for, a
 * board with every tile played, a reveal that has not arrived yet. None of them
 * may throw, and none of them may draw a question with nothing to tap as though
 * it were a real one.
 */

import { describe, expect, it } from 'vitest';
import { letterFor, readDetail, readHostView, readQuestion, tileCaption } from './payload.js';

const QUESTION = {
  category: 'Prophets',
  value: 300,
  prompt: 'Which prophet told King David, Thou art the man?',
  options: [
    { index: 0, label: 'Nathan' },
    { index: 1, label: 'Gad' },
    { index: 2, label: 'Samuel' },
    { index: 3, label: 'Elijah' },
  ],
};

const HOST_VIEW = {
  columns: [
    {
      name: 'Prophets',
      tiles: [
        { value: 100, state: 'played' },
        { value: 200, state: 'current' },
        { value: 300, state: 'open' },
      ],
    },
    { name: 'Kings and Queens', tiles: [{ value: 100, state: 'played' }] },
  ],
  tile: QUESTION,
};

const DETAIL = {
  category: 'Prophets',
  value: 300,
  prompt: QUESTION.prompt,
  answer: 'Nathan',
  reference: '2 Samuel 12:7',
  options: [
    { label: 'Nathan', correct: true },
    { label: 'Gad', correct: false },
  ],
};

describe('reading a question', () => {
  it('reads one the server sent', () => {
    const question = readQuestion(QUESTION);

    expect(question?.category).toBe('Prophets');
    expect(question?.value).toBe(300);
    expect(question?.options).toHaveLength(4);
  });

  it('refuses anything it cannot draw', () => {
    expect(readQuestion(null)).toBeNull();
    expect(readQuestion('a question')).toBeNull();
    expect(readQuestion({ ...QUESTION, prompt: undefined })).toBeNull();
    expect(readQuestion({ ...QUESTION, value: 'three hundred' })).toBeNull();
  });

  it('refuses a question with nothing to tap', () => {
    expect(readQuestion({ ...QUESTION, options: [] })).toBeNull();
    expect(readQuestion({ ...QUESTION, options: [{ index: 0 }, 'Nathan', 7] })).toBeNull();
  });

  it('drops an option it cannot label rather than the whole question', () => {
    const question = readQuestion({ ...QUESTION, options: [{ index: 0, label: 'Nathan' }, { label: 'Gad' }] });

    expect(question?.options).toEqual([{ index: 0, label: 'Nathan' }]);
  });
});

describe('reading the board', () => {
  it('reads the columns, the tiles and the tile in play', () => {
    const view = readHostView(HOST_VIEW);

    expect(view?.columns.map((column) => column.name)).toEqual(['Prophets', 'Kings and Queens']);
    expect(view?.columns[0]?.tiles.map((tile) => tile.state)).toEqual(['played', 'current', 'open']);
    expect(view?.tile?.prompt).toBe(QUESTION.prompt);
  });

  it('reads a cleared board as a board with no tile in play', () => {
    const view = readHostView({ ...HOST_VIEW, tile: null });

    expect(view?.columns).toHaveLength(2);
    expect(view?.tile).toBeNull();
  });

  it('draws a tile it does not recognise the state of as open', () => {
    const view = readHostView({ columns: [{ name: 'A', tiles: [{ value: 100, state: 'glowing' }] }] });

    expect(view?.columns[0]?.tiles[0]?.state).toBe('open');
  });

  it('refuses a payload with no board in it', () => {
    expect(readHostView(null)).toBeNull();
    expect(readHostView(QUESTION)).toBeNull();
    expect(readHostView({ columns: [] })).toBeNull();
    expect(readHostView({ columns: [{ tiles: [] }] })).toBeNull();
  });
});

describe('reading a reveal', () => {
  it('reads one the server sent', () => {
    const detail = readDetail(DETAIL);

    expect(detail?.answer).toBe('Nathan');
    expect(detail?.reference).toBe('2 Samuel 12:7');
    expect(detail?.options[0]?.correct).toBe(true);
  });

  it('refuses one with no answer, which is what an empty round sends', () => {
    expect(readDetail(null)).toBeNull();
    expect(readDetail({ ...DETAIL, answer: '' })).toBeNull();
  });

  it('reads a question with no one verse to cite as having no reference', () => {
    expect(readDetail({ ...DETAIL, reference: null })?.reference).toBeNull();
    expect(readDetail({ ...DETAIL, reference: '' })?.reference).toBeNull();
  });
});

describe('what the screens say aloud', () => {
  it('letters the options so a host can call them', () => {
    expect([0, 1, 2, 3].map(letterFor)).toEqual(['A', 'B', 'C', 'D']);
    expect(letterFor(9)).toBe('10');
  });

  it('names a tile the way a host would', () => {
    expect(tileCaption('Prophets', 300)).toBe('Prophets for 300');
  });
});
