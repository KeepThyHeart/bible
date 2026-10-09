import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContentDatabase } from './ContentDatabase.js';
import type { QuestionRecord } from './ContentDatabase.js';
import { MIN_GAME_ITEMS, validateContent } from './validate.js';
import type { ContentFinding, VerseReader } from './validate.js';
import { GAME_TAGS } from './generator/generate.js';
import { fromVerseId, toVerseId } from '../../../../src/modules/games/shared/verseId.js';

const ISAAC = toVerseId(1, 22, 7);
const BASKET = toVerseId(2, 2, 3);
const NAMED = toVerseId(2, 2, 10);
const FEVER = toVerseId(40, 8, 14);

const verses: Record<number, string> = {
  [ISAAC]:
    'And Isaac spake unto Abraham his father, and said, My father: and he said, Here am I, my son. ' +
    'And he said, Behold the fire and the wood: but where is the lamb for a burnt offering?',
  [BASKET]: 'And when she could not longer hide him, she took for him an ark of bulrushes.',
  [NAMED]: 'And she called his name Moses: and she said, Because I drew him out of the water.',
  [FEVER]: 'And when Jesus was come into Peter’s house, he saw his wife’s mother laid, and sick of a fever.',
};

const module: VerseReader = {
  verse: (id) => (verses[id] === undefined ? null : { text: verses[id] }),
  chapter: (book, chapter) =>
    Object.entries(verses)
      .filter(([id]) => {
        const ref = fromVerseId(Number(id));
        return ref.book === book && ref.chapter === chapter;
      })
      .map(([, text]) => ({ text })),
};

function question(overrides: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id: 'q1',
    type: 'multiple-choice',
    prompt: 'Who said, “where is the lamb for a burnt offering?”',
    promptVerseId: ISAAC,
    answer: 'Isaac',
    accept: [],
    contextNote: null,
    difficulty: 2,
    audience: 'all',
    book: 1,
    section: 'law',
    tags: [GAME_TAGS.whoSaidIt],
    source: null,
    reviewedBy: null,
    distractors: ['Jacob', 'Esau', 'Joseph'],
    clues: [],
    ...overrides,
  };
}

let db: ContentDatabase;
beforeEach(() => {
  db = ContentDatabase.openInMemory();
});
afterEach(() => {
  db.close();
});

function findings(reader: VerseReader | null = module): ContentFinding[] {
  return validateContent(db, reader).filter((finding) => finding.kind !== 'game');
}

function messages(severity: ContentFinding['severity'], reader: VerseReader | null = module): string[] {
  return findings(reader)
    .filter((finding) => finding.severity === severity)
    .map((finding) => finding.message);
}

describe('questions that pass', () => {
  it('finds nothing wrong with a faithful quotation', () => {
    db.putQuestion(question());
    expect(findings()).toEqual([]);
  });
});

describe('errors', () => {
  it('refuses a quotation the verse does not contain', () => {
    db.putQuestion(question({ prompt: 'Who said, “where is the goat for a burnt offering?”' }));
    expect(messages('error')).toEqual(['the quotation is not in Genesis 22:7 as written']);
  });

  it('refuses a reference the module does not carry', () => {
    db.putQuestion(question({ promptVerseId: toVerseId(1, 50, 99) }));
    expect(messages('error')).toEqual(['Genesis 50:99 is not in the installed module']);
  });

  it('refuses a prompt that names its own answer in a guessing game', () => {
    db.putQuestion(question({ prompt: 'Who said, “Isaac is here”', promptVerseId: null }));
    expect(messages('error')).toEqual(['the prompt names the answer, Isaac']);
  });

  it('only warns when a board question names its answer, which can be fair', () => {
    db.putQuestion(
      question({ prompt: 'Whose father was Isaac?', tags: [GAME_TAGS.categoryBoard], promptVerseId: null })
    );
    expect(messages('warning')).toEqual(['the prompt names the answer, Isaac']);
    expect(messages('error')).toEqual([]);
  });

  it('refuses a clue that names the answer, under any accepted name', () => {
    db.putQuestion(
      question({
        prompt: 'Who am I? I was hidden in a basket',
        promptVerseId: null,
        answer: 'Moses',
        tags: [GAME_TAGS.whoAmI],
        clues: [{ text: 'Pharaoh’s daughter called me Moses', verseId: NAMED }],
      })
    );
    expect(messages('error')).toEqual(['a clue names the answer: Pharaoh’s daughter called me Moses']);
  });

  it('refuses a wrong answer the matcher would mark right', () => {
    db.putQuestion(question({ answer: 'Nathanael', distractors: ['Nathaniel', 'Philip', 'Andrew'] }));
    expect(messages('error')).toContain('Nathaniel would be marked right if typed');
  });

  it('refuses a clue resting on a verse the module does not carry', () => {
    db.putQuestion(
      question({ clues: [{ text: 'I carried wood up a hill', verseId: toVerseId(1, 50, 99) }] })
    );
    expect(messages('error')).toEqual(['Genesis 50:99 is not in the installed module']);
  });
});

describe('warnings', () => {
  it('flags a clue whose chapter never names the person', () => {
    db.putQuestion(
      question({
        answer: 'Aaron',
        promptVerseId: null,
        prompt: 'Who am I? A priest',
        tags: [GAME_TAGS.whoAmI],
        clues: [{ text: 'I was put in a basket', verseId: BASKET }],
      })
    );
    expect(messages('warning')[0]).toContain('never names Aaron');
  });

  it('accepts a clue whose chapter names the person elsewhere', () => {
    db.putQuestion(
      question({
        answer: 'Moses',
        promptVerseId: null,
        prompt: 'Who am I? A baby in a basket',
        tags: [GAME_TAGS.whoAmI],
        clues: [{ text: 'I was put in a basket', verseId: BASKET }],
      })
    );
    expect(findings()).toEqual([]);
  });

  it('accepts a chapter that names the person only in the possessive', () => {
    db.putQuestion(
      question({
        answer: 'Peter',
        promptVerseId: null,
        prompt: 'Who am I? A fisherman',
        tags: [GAME_TAGS.whoAmI],
        clues: [{ text: 'My wife’s mother was healed of a fever', verseId: FEVER }],
      })
    );
    expect(findings()).toEqual([]);
  });

  it('flags an answer picked out by its length', () => {
    db.putQuestion(
      question({ answer: 'Isaac the son of Abraham', accept: [], distractors: ['Jacob', 'Esau', 'Lot'] })
    );
    expect(messages('warning')).toContain('the answer is much the longest option, which gives it away');
  });

  it('flags the same verse quoted twice', () => {
    db.putQuestion(question());
    db.putQuestion(question({ id: 'q2', prompt: 'Who said, “Behold the fire and the wood”' }));
    expect(messages('warning')).toEqual(['quotes the same verse as q1']);
  });

  it('flags a game too small for an evening and one with nothing easy', () => {
    db.putQuestion(question({ difficulty: 4 }));
    const game = validateContent(db, module).filter((finding) => finding.kind === 'game');
    expect(game.map((finding) => finding.message)).toEqual([
      `only 1 items; fewer than ${MIN_GAME_ITEMS} repeats inside an evening`,
      'nothing at difficulty 2 or below, so a mixed group has no way in',
    ]);
  });

  it('flags a board column that is short or does not climb', () => {
    db.putQuestion(question({ tags: [GAME_TAGS.categoryBoard] }));
    db.putQuestion(question({ id: 'q2', prompt: 'Another?', tags: [GAME_TAGS.categoryBoard] }));
    db.putQuestionSet({
      id: 'board-patriarchs',
      name: 'Patriarchs',
      description: null,
      difficulty: 2,
      audience: 'all',
      book: null,
      section: null,
      tags: [GAME_TAGS.categoryBoard],
      questionIds: ['q1', 'q2'],
    });
    const set = findings().filter((finding) => finding.kind === 'set');
    expect(set.map((finding) => finding.message)).toEqual([
      '2 questions; a board column wants 5',
      'every question is the same difficulty, so the column does not climb',
    ]);
  });
});

describe('without a module', () => {
  it('still runs every check that needs no verse text', () => {
    db.putQuestion(question({ prompt: 'Who said, “Isaac is here”', promptVerseId: toVerseId(1, 50, 99) }));
    expect(messages('error', null)).toEqual(['the prompt names the answer, Isaac']);
  });
});
