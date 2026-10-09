import { describe, expect, it } from 'vitest';
import { readSources } from './sources.js';
import type { RawSources } from './sources.js';
import { toVerseId } from '../../../../../src/modules/games/shared/verseId.js';

const moses = {
  name: 'Moses',
  sex: 'male',
  era: 'exodus',
  roles: ['prophet', 'Leader'],
  difficulty: 1,
  clues: [{ text: 'I was drawn out of the water', ref: 'Exodus 2:10' }],
};

function read(raw: RawSources) {
  return readSources(raw);
}

describe('reading sources', () => {
  it('reads a person, lowercasing roles and turning references into verse ids', () => {
    const { sources, problems } = read({ people: [moses] });
    expect(problems).toEqual([]);
    expect(sources.people[0]).toEqual({
      name: 'Moses',
      accept: [],
      sex: 'male',
      era: 'exodus',
      roles: ['prophet', 'leader'],
      difficulty: 1,
      clues: [{ text: 'I was drawn out of the water', verseId: toVerseId(2, 2, 10) }],
    });
  });

  it('files a saying under the speaker’s name as the people file spells it', () => {
    const { sources, problems } = read({
      people: [moses],
      sayings: [{ ref: 'Exod 32:26', speaker: 'moses', quote: 'Who is on the Lord’s side?', difficulty: 3 }],
    });
    expect(problems).toEqual([]);
    expect(sources.sayings[0]?.speaker).toBe('Moses');
    expect(sources.sayings[0]?.verseId).toBe(toVerseId(2, 32, 26));
  });

  it('reads timeline events given as bare labels or with references', () => {
    const { sources } = read({
      timelines: [
        {
          id: 'exodus',
          title: 'The Exodus',
          difficulty: 2,
          events: ['The burning bush', { label: 'The Red Sea', ref: 'Exod 14:21', note: 'dry ground' }],
        },
      ],
    });
    expect(sources.timelines[0]?.events).toEqual([
      { label: 'The burning bush', verseId: null, note: null },
      { label: 'The Red Sea', verseId: toVerseId(2, 14, 21), note: 'dry ground' },
    ]);
  });
});

describe('refusing what the generator cannot use', () => {
  it('drops a saying whose speaker is not on file, and says why', () => {
    const { sources, problems } = read({
      people: [moses],
      sayings: [{ ref: 'Gen 3:9', speaker: 'Adam', quote: 'Where art thou?', difficulty: 1 }],
    });
    expect(sources.sayings).toEqual([]);
    expect(problems[0]?.detail).toContain('not in the people file');
  });

  it('drops a person with an era it does not know', () => {
    const { sources, problems } = read({ people: [{ ...moses, era: 'medieval' }] });
    expect(sources.people).toEqual([]);
    expect(problems[0]?.detail).toContain('era must be one of');
  });

  it('drops a person whose clue rests on a reference it cannot read', () => {
    const { problems } = read({
      people: [{ ...moses, clues: [{ text: 'x', ref: 'Exodus two' }] }],
    });
    expect(problems[0]?.detail).toContain('is not a book, chapter and verse');
  });

  it('refuses the same person twice', () => {
    const { sources, problems } = read({ people: [moses, { ...moses, name: 'MOSES' }] });
    expect(sources.people).toHaveLength(1);
    expect(problems[0]?.detail).toContain('listed twice');
  });

  it('refuses a timeline with two events of the same label', () => {
    const { sources, problems } = read({
      timelines: [{ id: 't', title: 'T', difficulty: 1, events: ['A', 'B', 'a'] }],
    });
    expect(sources.timelines).toEqual([]);
    expect(problems[0]?.detail).toContain('share a label');
  });

  it('refuses a board question about a person not on file', () => {
    const { sources, problems } = read({
      people: [moses],
      board: [{ title: 'Leaders', questions: [{ prompt: 'Who led?', answer: 'Joshua', kind: 'person', difficulty: 1 }] }],
    });
    expect(sources.board[0]?.questions).toEqual([]);
    expect(problems[0]?.item).toBe('Leaders: Who led?');
  });

  it('refuses a board question of kind other with too few wrong answers', () => {
    const { problems } = read({
      board: [
        {
          title: 'Numbers',
          questions: [{ prompt: 'How many plagues?', answer: 'Ten', distractors: ['Seven'], difficulty: 1 }],
        },
      ],
    });
    expect(problems[0]?.detail).toContain('at least 3 authored wrong answers');
  });

  it('refuses a board answer of kind book that names no book', () => {
    const { problems } = read({
      board: [
        { title: 'Books', questions: [{ prompt: 'Which book?', answer: 'Hezekiah', kind: 'book', difficulty: 3 }] },
      ],
    });
    expect(problems[0]?.detail).toContain('not the name of a book');
  });
});
