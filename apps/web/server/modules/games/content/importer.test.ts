import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContentDatabase } from './ContentDatabase.js';
import {
  formatImportReport,
  importContent,
  importCsv,
  importCsvFile,
  importJson,
  importJsonFile,
} from './importer.js';
import type { ImportReport, RejectionReason } from './importer.js';
import { makeTempDir, removeTempDir } from './fixtures.js';
import { toVerseId } from '../../../../src/modules/games/shared/verseId.js';

let db: ContentDatabase;

beforeEach(() => {
  db = ContentDatabase.openInMemory();
});

afterEach(() => {
  db.close();
});

/** A row that imports cleanly, so a test can spoil exactly one thing. */
function goodQuestion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'q1',
    type: 'multiple-choice',
    prompt: 'Who was thrown into the lions den?',
    answer: 'Daniel',
    difficulty: 2,
    audience: 'children',
    book: 27,
    distractors: ['Joseph', 'Jonah', 'Elijah'],
    ...overrides,
  };
}

function goodSet(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'set1',
    name: 'Opening round',
    questionIds: ['q1'],
    difficulty: 2,
    ...overrides,
  };
}

function goodList(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'l1',
    title: 'Days of creation',
    items: ['Light', 'Sky', 'Dry land'],
    difficulty: 1,
    ...overrides,
  };
}

function goodCard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'c1',
    concept: 'Noah',
    category: 'person',
    forbidden: ['ark', 'flood'],
    difficulty: 2,
    ...overrides,
  };
}

function reasons(report: ImportReport): RejectionReason[] {
  return report.rejected.map((rejection) => rejection.reason);
}

describe('importing what is good', () => {
  it('accepts a whole payload and counts what went in', () => {
    const report = importContent(db, {
      questions: [goodQuestion()],
      sets: [goodSet()],
      orderedLists: [goodList()],
      promptCards: [goodCard()],
    });

    expect(report.rejected).toEqual([]);
    expect(report.accepted.questions).toBe(1);
    expect(report.accepted.distractors).toBe(3);
    expect(report.accepted.sets).toBe(1);
    expect(report.accepted.setMembers).toBe(1);
    expect(report.accepted.orderedLists).toBe(1);
    expect(report.accepted.orderedItems).toBe(3);
    expect(report.accepted.promptCards).toBe(1);
    expect(db.getQuestion('q1')?.answer).toBe('Daniel');
    expect(db.getOrderedList('l1')?.items).toHaveLength(3);
  });

  it('reads a bare array as questions', () => {
    const report = importJson(db, JSON.stringify([goodQuestion()]));
    expect(report.accepted.questions).toBe(1);
  });

  it('fills book and section in from the prompt’s verse', () => {
    importContent(db, {
      questions: [goodQuestion({ book: undefined, prompt_verse_id: toVerseId(43, 3, 16) })],
    });
    const stored = db.getQuestion('q1');
    expect(stored?.book).toBe(43);
    expect(stored?.section).toBe('gospels');
  });

  it('reads snake_case as readily as camelCase', () => {
    importContent(db, {
      questions: [
        goodQuestion({
          type: 'short-answer',
          context_note: 'the prophet, not the book',
          reviewed_by: 'Anna',
        }),
      ],
    });
    expect(db.getQuestion('q1')?.contextNote).toBe('the prophet, not the book');
    expect(db.getQuestion('q1')?.reviewedBy).toBe('Anna');
  });

  it('derives a stable id from the prompt, so re-importing updates in place', () => {
    const first = importContent(db, { questions: [goodQuestion({ id: undefined })] });
    const second = importContent(db, {
      questions: [goodQuestion({ id: undefined, answer: 'Daniel the prophet' })],
    });
    expect(second.rejected).toEqual([]);
    expect(first.accepted.questions).toBe(1);
    expect(db.findQuestions()).toHaveLength(1);
    expect(db.findQuestions()[0]?.answer).toBe('Daniel the prophet');
  });

  it('validates without writing when asked for a dry run', () => {
    const report = importContent(db, { questions: [goodQuestion()] }, { dryRun: true });
    expect(report.accepted.questions).toBe(1);
    expect(db.findQuestions()).toEqual([]);
  });

  it('warns rather than refusing when a question is merely thin', () => {
    const report = importContent(db, {
      questions: [goodQuestion(), goodQuestion({ id: 'q2', type: 'short-answer', prompt: 'Who?' })],
      promptCards: [goodCard({ forbidden: [] })],
    });
    expect(report.rejected).toEqual([]);
    expect(report.warnings.map((warning) => warning.id).sort()).toEqual(['c1', 'q1', 'q2']);
  });

  it('prints a report that says what happened', () => {
    const report = importContent(db, {
      questions: [goodQuestion(), goodQuestion({ id: 'q2', prompt: '  ' })],
    });
    const printed = formatImportReport(report);
    expect(printed).toContain('accepted: 1 questions');
    expect(printed).toContain('rejected: 1');
    expect(printed).toContain('empty-prompt');
  });
});

describe('csv', () => {
  it('reads quoted fields, doubled quotes and pipe-separated lists', () => {
    const csv = [
      'id,Prompt,answer,distractors,difficulty',
      'q1,"Who said, ""Let there be light""?",God,Moses|Adam|Noah,2',
      '',
    ].join('\n');

    const report = importCsv(db, csv);
    expect(report.rejected).toEqual([]);
    expect(db.getQuestion('q1')?.prompt).toBe('Who said, "Let there be light"?');
    expect(db.getQuestion('q1')?.distractors).toEqual(['Moses', 'Adam', 'Noah']);
  });

  it('reads a header exported with spaces and capitals', () => {
    const csv = 'Id,Prompt,Answer,Distractors,Prompt Verse Id\nq1,Who wept?,Jesus,Peter|Paul|John,43011035\n';
    importCsv(db, csv);
    expect(db.getQuestion('q1')?.promptVerseId).toBe(toVerseId(43, 11, 35));
  });
});

describe('importing from files', () => {
  let directory: string;

  beforeEach(() => {
    directory = makeTempDir('content-import-');
  });

  afterEach(() => {
    removeTempDir(directory);
    expect(existsSync(directory)).toBe(false);
  });

  it('imports json and csv from disk', () => {
    const jsonPath = join(directory, 'questions.json');
    writeFileSync(jsonPath, JSON.stringify({ questions: [goodQuestion()] }), 'utf8');
    expect(importJsonFile(db, jsonPath).accepted.questions).toBe(1);

    const csvPath = join(directory, 'more.csv');
    writeFileSync(csvPath, 'id,prompt,answer,distractors\nq2,Who wept?,Jesus,Peter|Paul|John\n', 'utf8');
    expect(importCsvFile(db, csvPath).accepted.questions).toBe(1);
  });
});

describe('refusing a question', () => {
  it('not-an-object', () => {
    const report = importContent(db, { questions: ['Daniel'] });
    expect(reasons(report)).toEqual(['not-an-object']);
    expect(report.rejected[0]?.kind).toBe('question');
  });

  it('empty-prompt', () => {
    expect(reasons(importContent(db, { questions: [goodQuestion({ prompt: '   ' })] }))).toEqual([
      'empty-prompt',
    ]);
  });

  it('unknown-type', () => {
    expect(reasons(importContent(db, { questions: [goodQuestion({ type: 'essay' })] }))).toEqual([
      'unknown-type',
    ]);
  });

  it('empty-answer', () => {
    expect(reasons(importContent(db, { questions: [goodQuestion({ answer: '' })] }))).toEqual([
      'empty-answer',
    ]);
  });

  it('invalid-verse-id', () => {
    // Book 99 does not exist, so the number is well formed and still not a verse.
    const report = importContent(db, { questions: [goodQuestion({ promptVerseId: 99003016 })] });
    expect(reasons(report)).toEqual(['invalid-verse-id']);
  });

  it('invalid-difficulty', () => {
    expect(reasons(importContent(db, { questions: [goodQuestion({ difficulty: 9 })] }))).toEqual([
      'invalid-difficulty',
    ]);
  });

  it('unknown-audience', () => {
    expect(reasons(importContent(db, { questions: [goodQuestion({ audience: 'toddlers' })] }))).toEqual(
      ['unknown-audience']
    );
  });

  it('invalid-book', () => {
    expect(reasons(importContent(db, { questions: [goodQuestion({ book: 0 })] }))).toEqual([
      'invalid-book',
    ]);
  });

  it('unknown-section', () => {
    expect(
      reasons(importContent(db, { questions: [goodQuestion({ section: 'apocrypha' })] }))
    ).toEqual(['unknown-section']);
  });

  it('duplicate-id', () => {
    const report = importContent(db, {
      questions: [goodQuestion(), goodQuestion({ prompt: 'Who baptised Jesus?', answer: 'John' })],
    });
    expect(reasons(report)).toEqual(['duplicate-id']);
    expect(report.accepted.questions).toBe(1);
  });

  it('duplicate-prompt within one file', () => {
    const report = importContent(db, {
      questions: [goodQuestion(), goodQuestion({ id: 'q2' })],
    });
    expect(reasons(report)).toEqual(['duplicate-prompt']);
  });

  it('duplicate-prompt against what is already imported', () => {
    importContent(db, { questions: [goodQuestion()] });
    // Same question asked with different punctuation and casing.
    const report = importContent(db, {
      questions: [goodQuestion({ id: 'q2', prompt: 'who was thrown into the LIONS DEN?' })],
    });
    expect(reasons(report)).toEqual(['duplicate-prompt']);
    expect(report.rejected[0]?.detail).toContain('q1');
  });

  it('answer-among-distractors', () => {
    const report = importContent(db, {
      questions: [goodQuestion({ distractors: ['Joseph', 'daniel', 'Elijah'] })],
    });
    expect(reasons(report)).toEqual(['answer-among-distractors']);
    expect(db.findQuestions()).toEqual([]);
  });

  it('answer-among-distractors catches an accepted spelling too', () => {
    const report = importContent(db, {
      questions: [goodQuestion({ accept: ['Daniel the prophet'], distractors: ['Joseph', 'Jonah', 'daniel the prophet'] })],
    });
    expect(reasons(report)).toEqual(['answer-among-distractors']);
  });

  it('duplicate-distractor', () => {
    const report = importContent(db, {
      questions: [goodQuestion({ distractors: ['Joseph', 'Jonah', 'joseph'] })],
    });
    expect(reasons(report)).toEqual(['duplicate-distractor']);
  });

  it('malformed-distractors', () => {
    const report = importContent(db, { questions: [goodQuestion({ distractors: { a: 1 } })] });
    expect(reasons(report)).toEqual(['malformed-distractors']);
  });

  it('too-few-distractors', () => {
    const report = importContent(db, {
      questions: [goodQuestion({ distractors: ['Joseph', 'Jonah'] })],
    });
    expect(reasons(report)).toEqual(['too-few-distractors']);
    expect(report.rejected[0]?.detail).toContain('found 2');
  });

  it('lets a short-answer question through with no distractors at all', () => {
    const report = importContent(db, {
      questions: [goodQuestion({ type: 'short-answer', distractors: [], contextNote: 'the prophet' })],
    });
    expect(report.rejected).toEqual([]);
  });

  it('rejects one row without taking the good ones with it', () => {
    const report = importContent(db, {
      questions: [
        goodQuestion(),
        goodQuestion({ id: 'q2', prompt: 'Who wept?', promptVerseId: 'not a number' }),
        goodQuestion({ id: 'q3', prompt: 'Who baptised Jesus?', answer: 'John', book: 40 }),
      ],
    });
    expect(reasons(report)).toEqual(['invalid-verse-id']);
    expect(db.findQuestions().map((row) => row.id)).toEqual(['q1', 'q3']);
  });
});

describe('refusing a set', () => {
  it('not-an-object', () => {
    expect(reasons(importContent(db, { sets: [42] }))).toEqual(['not-an-object']);
  });

  it('empty-name', () => {
    expect(reasons(importContent(db, { sets: [goodSet({ name: '' })] }))).toEqual(['empty-name']);
  });

  it('empty-set', () => {
    const report = importContent(db, {
      questions: [goodQuestion()],
      sets: [goodSet({ questionIds: [] })],
    });
    expect(reasons(report)).toEqual(['empty-set']);
  });

  it('unknown-question', () => {
    const report = importContent(db, { sets: [goodSet({ questionIds: ['nowhere'] })] });
    expect(reasons(report)).toEqual(['unknown-question']);
  });

  it('duplicate-id', () => {
    const report = importContent(db, {
      questions: [goodQuestion()],
      sets: [goodSet(), goodSet({ name: 'Second round' })],
    });
    expect(reasons(report)).toEqual(['duplicate-id']);
  });

  it('invalid-difficulty', () => {
    const report = importContent(db, {
      questions: [goodQuestion()],
      sets: [goodSet({ difficulty: 0 })],
    });
    expect(reasons(report)).toEqual(['invalid-difficulty']);
  });

  it('unknown-audience', () => {
    const report = importContent(db, {
      questions: [goodQuestion()],
      sets: [goodSet({ audience: 'grown-ups' })],
    });
    expect(reasons(report)).toEqual(['unknown-audience']);
  });

  it('takes a question imported earlier as a member', () => {
    importContent(db, { questions: [goodQuestion()] });
    const report = importContent(db, { sets: [goodSet()] });
    expect(report.rejected).toEqual([]);
    expect(db.getQuestionSet('set1')?.questionIds).toEqual(['q1']);
  });
});

describe('refusing an ordering', () => {
  it('not-an-object', () => {
    expect(reasons(importContent(db, { orderedLists: [null] }))).toEqual(['not-an-object']);
  });

  it('empty-title', () => {
    expect(reasons(importContent(db, { orderedLists: [goodList({ title: ' ' })] }))).toEqual([
      'empty-title',
    ]);
  });

  it('duplicate-title', () => {
    importContent(db, { orderedLists: [goodList()] });
    const report = importContent(db, {
      orderedLists: [goodList({ id: 'l2', title: 'days of creation' })],
    });
    expect(reasons(report)).toEqual(['duplicate-title']);
  });

  it('duplicate-id', () => {
    const report = importContent(db, {
      orderedLists: [goodList(), goodList({ title: 'Plagues of Egypt' })],
    });
    expect(reasons(report)).toEqual(['duplicate-id']);
  });

  it('too-few-items', () => {
    const report = importContent(db, { orderedLists: [goodList({ items: ['Light', 'Sky'] })] });
    expect(reasons(report)).toEqual(['too-few-items']);
  });

  it('duplicate-item', () => {
    const report = importContent(db, {
      orderedLists: [goodList({ items: ['Light', 'Sky', 'light'] })],
    });
    expect(reasons(report)).toEqual(['duplicate-item']);
  });

  it('empty-item-label', () => {
    const report = importContent(db, {
      orderedLists: [goodList({ items: ['Light', { label: '' }, 'Dry land'] })],
    });
    expect(reasons(report)).toEqual(['empty-item-label']);
  });

  it('invalid-verse-id', () => {
    const report = importContent(db, {
      orderedLists: [
        goodList({
          items: ['Light', { label: 'Sky', verse_id: 0 }, 'Dry land'],
        }),
      ],
    });
    expect(reasons(report)).toEqual(['invalid-verse-id']);
  });

  it('invalid-difficulty', () => {
    expect(reasons(importContent(db, { orderedLists: [goodList({ difficulty: 6 })] }))).toEqual([
      'invalid-difficulty',
    ]);
  });

  it('unknown-audience', () => {
    expect(reasons(importContent(db, { orderedLists: [goodList({ audience: 'elders' })] }))).toEqual(
      ['unknown-audience']
    );
  });

  it('takes the scope from the first item that names a verse', () => {
    importContent(db, {
      orderedLists: [
        goodList({ items: [{ label: 'Light', verseId: toVerseId(1, 1, 3) }, 'Sky', 'Dry land'] }),
      ],
    });
    expect(db.getOrderedList('l1')?.book).toBe(1);
    expect(db.getOrderedList('l1')?.section).toBe('law');
  });
});

describe('refusing a prompt card', () => {
  it('not-an-object', () => {
    expect(reasons(importContent(db, { promptCards: [['Noah']] }))).toEqual(['not-an-object']);
  });

  it('empty-concept', () => {
    expect(reasons(importContent(db, { promptCards: [goodCard({ concept: '' })] }))).toEqual([
      'empty-concept',
    ]);
  });

  it('empty-category', () => {
    expect(reasons(importContent(db, { promptCards: [goodCard({ category: '' })] }))).toEqual([
      'empty-category',
    ]);
  });

  it('duplicate-concept', () => {
    importContent(db, { promptCards: [goodCard()] });
    const report = importContent(db, { promptCards: [goodCard({ id: 'c2', concept: 'noah' })] });
    expect(reasons(report)).toEqual(['duplicate-concept']);
  });

  it('duplicate-id', () => {
    const report = importContent(db, {
      promptCards: [goodCard(), goodCard({ concept: 'Moses' })],
    });
    expect(reasons(report)).toEqual(['duplicate-id']);
  });

  it('forbidden-repeats-concept', () => {
    const report = importContent(db, { promptCards: [goodCard({ forbidden: ['ark', 'Noah'] })] });
    expect(reasons(report)).toEqual(['forbidden-repeats-concept']);
  });

  it('forbidden-repeats-concept for any one word of the concept', () => {
    const report = importContent(db, {
      promptCards: [goodCard({ concept: 'Jonah and the great fish', forbidden: ['whale', 'Fish'] })],
    });
    expect(reasons(report)).toEqual(['forbidden-repeats-concept']);
    expect(report.rejected[0]?.detail).toContain('"Fish"');
  });

  it('forbidden-repeats-concept through a possessive', () => {
    const report = importContent(db, {
      promptCards: [
        goodCard({ concept: "Daniel in the lions' den", forbidden: ['king', 'lions'] }),
        goodCard({ id: 'c2', concept: "Balaam's donkey", forbidden: ['angel', 'Balaam'] }),
      ],
    });
    expect(reasons(report)).toEqual(['forbidden-repeats-concept', 'forbidden-repeats-concept']);
  });

  it('forbidden-repeats-concept for a phrase that says a concept word', () => {
    const report = importContent(db, {
      promptCards: [goodCard({ concept: 'The burning bush', forbidden: ['Moses', 'thorn bush'] })],
    });
    expect(reasons(report)).toEqual(['forbidden-repeats-concept']);
  });

  it('lets a forbidden word share only a function word or a word stem with the concept', () => {
    const report = importContent(db, {
      promptCards: [
        goodCard({ concept: 'The parable of the sower', forbidden: ['the seed', 'sow', 'of'] }),
      ],
    });
    expect(report.rejected).toEqual([]);
  });

  it('invalid-difficulty', () => {
    expect(reasons(importContent(db, { promptCards: [goodCard({ difficulty: 1.5 })] }))).toEqual([
      'invalid-difficulty',
    ]);
  });

  it('unknown-audience', () => {
    expect(reasons(importContent(db, { promptCards: [goodCard({ audience: 'anyone' })] }))).toEqual([
      'unknown-audience',
    ]);
  });

  it('unknown-section', () => {
    expect(reasons(importContent(db, { promptCards: [goodCard({ section: 'poetry' })] }))).toEqual([
      'unknown-section',
    ]);
  });

  it('invalid-book', () => {
    expect(reasons(importContent(db, { promptCards: [goodCard({ book: 67 })] }))).toEqual([
      'invalid-book',
    ]);
  });
});

/**
 * Authored files come from spreadsheets and from other people, which makes
 * every field untrusted text. Text that reads as SQL has to survive the whole
 * journey — validation, comparison keys, storage, reading back — as text.
 */
describe('adversarial input', () => {
  const hostile = `Robert'); DROP TABLE question; --`;

  it('imports quotes and statement terminators as data', () => {
    const report = importContent(db, {
      questions: [
        goodQuestion({
          prompt: `Who was called "${hostile}"?`,
          answer: hostile,
          distractors: [`'; DROP TABLE distractor; --`, '" OR ""="', 'a|b'],
          tags: ['drop table question'],
        }),
      ],
    });

    expect(report.rejected).toEqual([]);
    const stored = db.getQuestion('q1');
    expect(stored?.answer).toBe(hostile);
    expect(stored?.distractors[0]).toBe(`'; DROP TABLE distractor; --`);
    expect(db.findQuestions()).toHaveLength(1);
  });

  it('still refuses a hostile string that is both answer and distractor', () => {
    const report = importContent(db, {
      questions: [goodQuestion({ answer: hostile, distractors: ['Joseph', 'Jonah', hostile] })],
    });
    expect(reasons(report)).toEqual(['answer-among-distractors']);
  });

  it('leaves the schema standing after a hostile duplicate check', () => {
    importContent(db, { questions: [goodQuestion({ prompt: hostile })] });
    const report = importContent(db, {
      questions: [goodQuestion({ id: 'q2', prompt: hostile })],
    });
    expect(reasons(report)).toEqual(['duplicate-prompt']);
    expect(db.findQuestions()).toHaveLength(1);
  });

  it('reads a hostile csv cell as one field', () => {
    const csv = `id,prompt,answer,distractors\nq1,"He said ""${hostile}""",Daniel,Joseph|Jonah|Elijah\n`;
    const report = importCsv(db, csv);
    expect(report.rejected).toEqual([]);
    expect(db.getQuestion('q1')?.prompt).toBe(`He said "${hostile}"`);
  });
});

describe('clues', () => {
  it('accepts bare sentences and sentences carrying a reference, in order', () => {
    const report = importContent(db, {
      questions: [
        goodQuestion({
          clues: ['I served three kings', { text: 'I read writing on a wall', ref: 'Dan 5:25' }],
        }),
      ],
    });
    expect(report.rejected).toEqual([]);
    expect(db.getQuestion('q1')?.clues).toEqual([
      { text: 'I served three kings', verseId: null },
      { text: 'I read writing on a wall', verseId: toVerseId(27, 5, 25) },
    ]);
  });

  it('reads a pipe-separated spreadsheet cell as a list', () => {
    const csv = 'id,prompt,answer,distractors,clues\nq1,Who am I?,Daniel,Joseph|Jonah|Elijah,A captive|A dreamer\n';
    importCsv(db, csv, { csvKind: 'question' });
    expect(db.getQuestion('q1')?.clues.map((clue) => clue.text)).toEqual(['A captive', 'A dreamer']);
  });

  it('leaves a question with no clues holding none', () => {
    importContent(db, { questions: [goodQuestion()] });
    expect(db.getQuestion('q1')?.clues).toEqual([]);
  });

  it('refuses the same clue twice, whatever its punctuation', () => {
    const report = importContent(db, {
      questions: [goodQuestion({ clues: ['I prayed daily.', 'i prayed daily'] })],
    });
    expect(reasons(report)).toEqual(['duplicate-clue']);
  });

  it('refuses a clue with nothing in it', () => {
    const report = importContent(db, {
      questions: [goodQuestion({ clues: [{ ref: 'Dan 5:25' }] })],
    });
    expect(reasons(report)).toEqual(['malformed-clues']);
  });

  it('refuses clues that are not a list', () => {
    const report = importContent(db, { questions: [goodQuestion({ clues: { first: 'x' } })] });
    expect(reasons(report)).toEqual(['malformed-clues']);
  });

  it('refuses a clue whose reference cannot be read back', () => {
    const report = importContent(db, {
      questions: [goodQuestion({ clues: [{ text: 'A captive', ref: 'Danielle 5:25' }] })],
    });
    expect(reasons(report)).toEqual(['unreadable-reference']);
  });
});
