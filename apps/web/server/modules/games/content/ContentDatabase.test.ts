import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ContentDatabase, SCHEMA_VERSION, contentKey } from './ContentDatabase.js';
import type { PromptCardRecord, QuestionRecord } from './ContentDatabase.js';
import { makeTempDir, removeTempDir } from './fixtures.js';
import { toVerseId } from '../../../../src/modules/games/shared/verseId.js';

const opened: ContentDatabase[] = [];
const directories: string[] = [];

function inMemory(): ContentDatabase {
  const db = ContentDatabase.openInMemory();
  opened.push(db);
  return db;
}

function scratch(): string {
  const directory = makeTempDir('content-db-');
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  for (const directory of directories.splice(0)) {
    removeTempDir(directory);
    expect(existsSync(directory)).toBe(false);
  }
});

function question(overrides: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id: 'q1',
    type: 'multiple-choice',
    prompt: 'Who was thrown into the lions’ den?',
    promptVerseId: toVerseId(27, 6, 16),
    answer: 'Daniel',
    accept: [],
    contextNote: null,
    difficulty: 2,
    audience: 'children',
    book: 27,
    section: 'majorProphets',
    tags: ['prophets'],
    source: null,
    reviewedBy: null,
    distractors: ['Joseph', 'Jonah', 'Elijah'],
    clues: [],
    ...overrides,
  };
}

function card(overrides: Partial<PromptCardRecord> = {}): PromptCardRecord {
  return {
    id: 'c1',
    concept: 'Noah’s ark',
    category: 'object',
    forbidden: ['boat', 'flood'],
    difficulty: 2,
    audience: 'all',
    book: 1,
    section: 'law',
    tags: ['acting'],
    source: null,
    reviewedBy: null,
    ...overrides,
  };
}

describe('schema', () => {
  it('creates the schema and records its version', () => {
    const db = inMemory();
    expect(db.schemaVersion()).toBe(SCHEMA_VERSION);
  });

  it('creates the database file and the directory holding it', () => {
    const path = join(scratch(), 'nested', 'content.db');
    const db = ContentDatabase.open(path);
    opened.push(db);
    expect(existsSync(path)).toBe(true);
  });

  it('re-migrating changes nothing', () => {
    const db = inMemory();
    db.putQuestion(question());
    db.migrate();
    db.migrate();
    expect(db.schemaVersion()).toBe(SCHEMA_VERSION);
    expect(db.getQuestion('q1')?.answer).toBe('Daniel');
  });

  it('reopening an existing file finds the content still there', () => {
    const path = join(scratch(), 'content.db');
    const first = ContentDatabase.open(path);
    first.putQuestion(question());
    first.close();

    const second = ContentDatabase.open(path);
    opened.push(second);
    expect(second.schemaVersion()).toBe(SCHEMA_VERSION);
    expect(second.getQuestion('q1')?.prompt).toContain('lions');
  });

  it('brings a database written before clues existed up to date without losing it', () => {
    const path = join(scratch(), 'content.db');
    const first = ContentDatabase.open(path);
    first.putQuestion(question());
    first.close();

    // Put the file back the way the first schema left it.
    const raw = new Database(path);
    raw.exec('DROP TABLE clue');
    raw.prepare('DELETE FROM content_schema_version WHERE version > 1').run();
    raw.close();

    const second = ContentDatabase.open(path);
    opened.push(second);
    expect(second.schemaVersion()).toBe(SCHEMA_VERSION);
    expect(second.getQuestion('q1')?.clues).toEqual([]);
    second.putQuestion(question({ clues: [{ text: 'A dream reader', verseId: null }] }));
    expect(second.getQuestion('q1')?.clues).toHaveLength(1);
  });
});

describe('clues', () => {
  const clues = [
    { text: 'I was taken from Jerusalem as a young man', verseId: toVerseId(27, 1, 6) },
    { text: 'I read writing on a wall', verseId: toVerseId(27, 5, 25) },
    { text: 'I prayed three times a day', verseId: null },
  ];

  it('round-trips in the order they are revealed, with where each comes from', () => {
    const db = inMemory();
    db.putQuestion(question({ clues }));
    expect(db.getQuestion('q1')?.clues).toEqual(clues);
  });

  it('writing the same id again replaces the clues rather than adding to them', () => {
    const db = inMemory();
    db.putQuestion(question({ clues }));
    db.putQuestion(question({ clues: [{ text: 'I served three kings', verseId: null }] }));
    expect(db.getQuestion('q1')?.clues).toEqual([{ text: 'I served three kings', verseId: null }]);
  });
});

describe('questions', () => {
  it('round-trips a question with its distractors in order', () => {
    const db = inMemory();
    db.putQuestion(question());
    const read = db.getQuestion('q1');
    expect(read?.distractors).toEqual(['Joseph', 'Jonah', 'Elijah']);
    expect(read?.promptVerseId).toBe(toVerseId(27, 6, 16));
    expect(read?.tags).toEqual(['prophets']);
  });

  it('writing the same id again replaces the row and its distractors', () => {
    const db = inMemory();
    db.putQuestion(question());
    db.putQuestion(question({ answer: 'Daniel the prophet', distractors: ['Job'] }));
    const read = db.getQuestion('q1');
    expect(read?.answer).toBe('Daniel the prophet');
    expect(read?.distractors).toEqual(['Job']);
  });

  it('finds the question already holding a prompt, whatever its punctuation', () => {
    const db = inMemory();
    db.putQuestion(question());
    expect(db.questionIdForPrompt('who was thrown into the lions den')).toBe('q1');
    expect(db.questionIdForPrompt('Something else entirely')).toBeNull();
  });

  it('filters by book, section, difficulty and audience', () => {
    const db = inMemory();
    db.putQuestion(question());
    db.putQuestion(
      question({
        id: 'q2',
        prompt: 'Who baptised Jesus?',
        answer: 'John the Baptist',
        book: 40,
        section: 'gospels',
        difficulty: 4,
        audience: 'adult',
        tags: ['gospel'],
      })
    );

    expect(db.findQuestions({ books: [27] }).map((row) => row.id)).toEqual(['q1']);
    expect(db.findQuestions({ sections: ['gospels'] }).map((row) => row.id)).toEqual(['q2']);
    expect(db.findQuestions({ maxDifficulty: 3 }).map((row) => row.id)).toEqual(['q1']);
    expect(db.findQuestions({ audience: 'adult' }).map((row) => row.id)).toEqual(['q2']);
    expect(db.findQuestions({ tag: 'gospel' }).map((row) => row.id)).toEqual(['q2']);
    expect(db.findQuestions({ type: 'short-answer' })).toEqual([]);
  });

  it('puts content pitched at everyone in every audience pool', () => {
    const db = inMemory();
    db.putQuestion(question({ audience: 'all' }));
    expect(db.findQuestions({ audience: 'children' }).map((row) => row.id)).toEqual(['q1']);
    expect(db.findQuestions({ audience: 'adult' }).map((row) => row.id)).toEqual(['q1']);
  });

  it('draws through the caller’s generator, so a replay draws the same round', () => {
    const db = inMemory();
    for (let index = 0; index < 6; index += 1) {
      db.putQuestion(question({ id: `q${index}`, prompt: `Question number ${index}?` }));
    }
    const drawn = db.drawQuestions(3, {}, sequence([0.1, 0.9, 0.4, 0.7, 0.2, 0.6]));
    const again = db.drawQuestions(3, {}, sequence([0.1, 0.9, 0.4, 0.7, 0.2, 0.6]));
    expect(drawn.map((row) => row.id)).toEqual(again.map((row) => row.id));
    expect(drawn).toHaveLength(3);
  });
});

describe('sets, orderings and cards', () => {
  it('returns a set’s questions in the order its author put them', () => {
    const db = inMemory();
    db.putQuestion(question({ id: 'a', prompt: 'First question?' }));
    db.putQuestion(question({ id: 'b', prompt: 'Second question?' }));
    db.putQuestion(question({ id: 'c', prompt: 'Third question?' }));
    db.putQuestionSet({
      id: 'set1',
      name: 'Opening round',
      description: null,
      difficulty: 2,
      audience: 'all',
      book: null,
      section: null,
      tags: [],
      questionIds: ['c', 'a', 'b'],
    });

    expect(db.getQuestionSet('set1')?.questionIds).toEqual(['c', 'a', 'b']);
    expect(db.findQuestions({ setId: 'set1' }).map((row) => row.id)).toEqual(['c', 'a', 'b']);
    expect(db.listQuestionSets().map((row) => row.name)).toEqual(['Opening round']);
  });

  it('drops set membership when the question goes', () => {
    const db = inMemory();
    db.putQuestion(question({ id: 'a', prompt: 'First question?' }));
    db.putQuestionSet({
      id: 'set1',
      name: 'Opening round',
      description: null,
      difficulty: 2,
      audience: 'all',
      book: null,
      section: null,
      tags: [],
      questionIds: ['a'],
    });
    db.putQuestionSet({
      id: 'set1',
      name: 'Opening round',
      description: null,
      difficulty: 2,
      audience: 'all',
      book: null,
      section: null,
      tags: [],
      questionIds: [],
    });
    expect(db.getQuestionSet('set1')?.questionIds).toEqual([]);
  });

  it('keeps an ordering’s answer key in position order', () => {
    const db = inMemory();
    db.putOrderedList({
      id: 'l1',
      title: 'Days of creation',
      instructions: null,
      difficulty: 1,
      audience: 'children',
      book: 1,
      section: 'law',
      tags: [],
      source: null,
      reviewedBy: null,
      items: [
        { label: 'Light', verseId: toVerseId(1, 1, 3), note: null },
        { label: 'Sky', verseId: toVerseId(1, 1, 6), note: null },
        { label: 'Dry land', verseId: null, note: 'and plants' },
      ],
    });

    const list = db.getOrderedList('l1');
    expect(list?.items.map((item) => item.label)).toEqual(['Light', 'Sky', 'Dry land']);
    expect(list?.items[2]?.note).toBe('and plants');
    expect(db.orderedListIdForTitle('days of creation')).toBe('l1');
    expect(db.listOrderedLists({ books: [1] })).toHaveLength(1);
  });

  it('filters prompt cards by category', () => {
    const db = inMemory();
    db.putPromptCard(card());
    db.putPromptCard(card({ id: 'c2', concept: 'Moses', category: 'person' }));
    expect(db.findPromptCards({ category: 'person' }).map((row) => row.id)).toEqual(['c2']);
    expect(db.drawPromptCards(1, {}, () => 0)).toHaveLength(1);
    expect(db.promptCardIdForConcept('noahs ark')).toBe('c1');
  });
});

/**
 * The hostile case. Authored content arrives from spreadsheets and other
 * people's files, so it is untrusted text, and text that would be a syntax
 * error or a dropped table if it ever reached SQL as SQL must survive a round
 * trip unchanged instead.
 */
describe('adversarial text', () => {
  const hostile = `Robert'); DROP TABLE question; --`;

  it('stores quotes and statement terminators as data', () => {
    const db = inMemory();
    db.putQuestion(
      question({
        prompt: `Who said "${hostile}"?`,
        answer: hostile,
        accept: [`" OR 1=1 --`],
        distractors: [`'; DELETE FROM distractor; --`, '100% "sure"', 'a\\b'],
        tags: ['drop table'],
      })
    );

    const read = db.getQuestion('q1');
    expect(read?.answer).toBe(hostile);
    expect(read?.accept).toEqual([`" OR 1=1 --`]);
    expect(read?.distractors[0]).toBe(`'; DELETE FROM distractor; --`);
    // Still queryable, which it would not be had the table been dropped.
    expect(db.findQuestions()).toHaveLength(1);
  });

  it('matches a hostile prompt back to its own row rather than a second one', () => {
    const db = inMemory();
    db.putQuestion(question({ prompt: hostile }));
    expect(db.questionIdForPrompt(hostile)).toBe('q1');
    expect(db.findQuestions()).toHaveLength(1);
  });

  it('treats a filter value as a value even when it reads as SQL', () => {
    const db = inMemory();
    db.putQuestion(question({ tags: ['parable'] }));
    expect(db.findQuestions({ tag: `parable' OR '1'='1` })).toEqual([]);
    expect(db.findQuestions({ tag: 'parable' })).toHaveLength(1);
    expect(db.findPromptCards({ category: `object'; DROP TABLE prompt_card; --` })).toEqual([]);
    expect(db.getQuestion(`q1' OR '1'='1`)).toBeNull();
    // The tables the hostile strings named are all still standing.
    expect(db.schemaVersion()).toBe(SCHEMA_VERSION);
  });

  it('reduces punctuation-only differences to the same comparison key', () => {
    expect(contentKey('Who was Moses’ brother?')).toBe(contentKey('who was moses brother'));
    expect(contentKey('  Daniel  ')).toBe('daniel');
    expect(contentKey(hostile)).not.toContain(';');
  });
});

/** A generator that walks a fixed list, so a shuffle is reproducible. */
function sequence(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length] ?? 0;
    index += 1;
    return value;
  };
}
