import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContentDatabase } from '../ContentDatabase.js';
import { importContent } from '../importer.js';
import { GAME_TAGS, generate, itemsPerList } from './generate.js';
import type { GeneratedFile } from './generate.js';
import { readSources } from './sources.js';
import type { RawSources } from './sources.js';
import { toVerseId } from '../../../../../src/modules/games/shared/verseId.js';

/** Distinct per person, because two who-am-I rounds opening on the same clue would be one question asked twice. */
const clues = (person: number): { text: string; ref: string }[] =>
  ['first', 'second', 'third', 'fourth', 'fifth'].map((ordinal, position) => ({
    text: `The ${ordinal} thing about person ${person}`,
    ref: `Gen ${position + 1}:${person + 1}`,
  }));

const men = ['Abraham', 'Isaac', 'Jacob', 'Joseph', 'Esau', 'Laban', 'Lot', 'Judah', 'Reuben', 'Benjamin'];

function raw(extra: Partial<RawSources> = {}): RawSources {
  return {
    people: [
      ...men.map((name, index) => ({
        name,
        sex: 'male',
        era: 'patriarchs',
        roles: ['patriarch'],
        difficulty: (index % 5) + 1,
        clues: index < 3 ? clues(index) : [],
      })),
      { name: 'Sarah', sex: 'female', era: 'patriarchs', difficulty: 1 },
      { name: 'Rebekah', sex: 'female', era: 'patriarchs', difficulty: 2 },
      { name: 'Paul', accept: ['Saul'], sex: 'male', era: 'church', difficulty: 1 },
    ],
    places: [
      { name: 'Bethel', kind: 'city', testament: 'old', difficulty: 2 },
      { name: 'Hebron', kind: 'city', testament: 'old', difficulty: 2 },
      { name: 'Haran', kind: 'city', testament: 'old', difficulty: 3 },
      { name: 'Sinai', kind: 'mountain', testament: 'old', difficulty: 1 },
    ],
    sayings: [
      { ref: 'Gen 22:7', speaker: 'Isaac', quote: 'where is the lamb for a burnt offering?', difficulty: 2 },
      { ref: 'Gen 37:26', speaker: 'Judah', quote: 'What profit is it if we slay our brother', difficulty: 3 },
    ],
    timelines: [
      {
        id: 'abraham',
        title: 'The life of Abraham',
        difficulty: 2,
        tags: ['genesis'],
        events: ['Called from Ur', 'Arrives in Canaan', 'Covenant', 'Ishmael born', 'Isaac born', 'Moriah'],
      },
    ],
    board: [
      {
        title: 'Patriarchs',
        questions: [
          { prompt: 'Who wrestled with an angel?', answer: 'Jacob', kind: 'person', difficulty: 3 },
          { prompt: 'Who was called from Ur?', answer: 'Abraham', kind: 'person', difficulty: 1 },
          {
            prompt: 'Where did Jacob dream of a ladder?',
            answer: 'Bethel',
            kind: 'place',
            distractors: ['Peniel'],
            difficulty: 2,
          },
          { prompt: 'Which book tells of Joseph?', answer: 'Genesis', kind: 'book', difficulty: 1 },
          {
            prompt: 'How many sons had Jacob?',
            answer: 'Twelve',
            distractors: ['Ten', 'Seven', 'Eleven'],
            difficulty: 2,
          },
        ],
      },
    ],
    ...extra,
  };
}

function build(extra: Partial<RawSources> = {}, seed = 1): GeneratedFile[] {
  const { sources, problems } = readSources(raw(extra));
  expect(problems).toEqual([]);
  return generate(sources, { seed });
}

function named(files: GeneratedFile[], name: string): GeneratedFile {
  const found = files.find((file) => file.name === name);
  if (!found) throw new Error(`no ${name}`);
  return found;
}

let db: ContentDatabase;
beforeEach(() => {
  db = ContentDatabase.openInMemory();
});
afterEach(() => {
  db.close();
});

describe('who said it', () => {
  it('asks who said the quotation, cites the verse, and offers plausible wrong answers', () => {
    const [question] = named(build(), 'who-said-it.json').questions;
    expect(question?.prompt).toBe('Who said, “where is the lamb for a burnt offering?”');
    expect(question?.answer).toBe('Isaac');
    expect(question?.promptVerseId).toBe(toVerseId(1, 22, 7));
    expect(question?.contextNote).toBe('Genesis 22:7');
    expect(question?.tags).toEqual([GAME_TAGS.whoSaidIt, 'patriarchs']);
    expect(question?.distractors).toHaveLength(8);
    expect(question?.distractors.slice(0, 3)).not.toContain('Sarah');
  });
});

describe('who am I and the detective game', () => {
  it('only describes people with enough clues, and leaves the rest as wrong answers', () => {
    const files = build();
    const answers = named(files, 'who-am-i.json').questions.map((question) => question.answer);
    expect(answers).toEqual(['Abraham', 'Isaac', 'Jacob']);
    expect(named(files, 'who-am-i.json').questions[0]?.distractors).toContain('Joseph');
  });

  it('opens a who-am-I with the vaguest clue and keeps every clue to reveal', () => {
    const [question] = named(build(), 'who-am-i.json').questions;
    expect(question?.prompt).toBe('Who am I? The first thing about person 0');
    expect(question?.clues).toHaveLength(5);
  });

  it('shows a detective case its vaguest clue and deals out the rest', () => {
    const [question] = named(build(), 'detective.json').questions;
    expect(question?.prompt).toBe('Who is the mystery person? The first thing about person 0');
    expect(question?.clues.map((clue) => clue.text)).toEqual([
      'The second thing about person 0',
      'The third thing about person 0',
      'The fourth thing about person 0',
      'The fifth thing about person 0',
    ]);
  });
});

describe('put in order', () => {
  it('draws several distinct handfuls from a timeline, each in story order', () => {
    const lists = named(build(), 'put-in-order.json').orderedLists;
    expect(lists).toHaveLength(5);
    const events = ['Called from Ur', 'Arrives in Canaan', 'Covenant', 'Ishmael born', 'Isaac born', 'Moriah'];
    for (const list of lists) {
      expect(list.items).toHaveLength(itemsPerList(2));
      const positions = list.items.map((item) => events.indexOf(item.label));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
    expect(new Set(lists.map((list) => list.items.map((item) => item.label).join('|'))).size).toBe(5);
  });

  it('makes a list harder when two of its events sit side by side in the story', () => {
    for (const list of named(build(), 'put-in-order.json').orderedLists) {
      expect([2, 3]).toContain(list.difficulty);
    }
  });
});

describe('the category board', () => {
  it('builds one column per category, easiest first', () => {
    const board = named(build(), 'category-board.json');
    expect(board.sets).toHaveLength(1);
    const difficulties = board.sets[0]?.questionIds.map(
      (id) => board.questions.find((question) => question.id === id)?.difficulty
    );
    expect(difficulties).toEqual([1, 1, 2, 2, 3]);
  });

  it('puts an author’s wrong answers first and fills the rest from the right pool', () => {
    const board = named(build(), 'category-board.json');
    const place = board.questions.find((question) => question.answer === 'Bethel');
    expect(place?.distractors[0]).toBe('Peniel');
    expect(place?.distractors).toContain('Hebron');
    const book = board.questions.find((question) => question.answer === 'Genesis');
    expect(book?.distractors.slice(0, 3).sort()).toEqual(['Exodus', 'Leviticus', 'Numbers']);
    const count = board.questions.find((question) => question.answer === 'Twelve');
    expect(count?.distractors).toEqual(['Ten', 'Seven', 'Eleven']);
  });
});

describe('the batch as a whole', () => {
  it('regenerates identically', () => {
    expect(build()).toEqual(build());
  });

  it('changes nothing else when one saying is added', () => {
    const before = named(build(), 'who-said-it.json').questions[0];
    const withMore = build({
      sayings: [
        ...(raw().sayings as unknown[]),
        { ref: 'Gen 27:22', speaker: 'Isaac', quote: 'The voice is Jacob’s voice', difficulty: 3 },
      ],
    });
    expect(named(withMore, 'who-said-it.json').questions[0]).toEqual(before);
  });

  it('reshuffles when the seed changes', () => {
    const one = named(build({}, 1), 'who-am-i.json').questions[0]?.distractors;
    const two = named(build({}, 2), 'who-am-i.json').questions[0]?.distractors;
    expect(one).not.toEqual(two);
  });

  it('writes nothing the importer refuses', () => {
    for (const file of build()) {
      const report = importContent(db, file);
      expect(report.rejected).toEqual([]);
    }
    expect(db.findQuestions({ tag: GAME_TAGS.whoAmI })).toHaveLength(3);
    expect(db.getQuestion('detective-abraham')?.clues).toHaveLength(4);
  });
});
