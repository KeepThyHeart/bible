/**
 * Bringing authored content in from JSON or CSV.
 *
 * Content is the long pole of this project, and the expensive failure is not a
 * file that refuses to import — it is a file that imports quietly and puts a
 * broken question on a screen in front of thirty people. So every row is
 * checked before it is written, a row that fails is rejected with a named
 * reason, and the caller gets a report saying exactly what went in and what
 * did not.
 *
 * Rejection is per row rather than per file: an author who mistyped one verse
 * id should not have to re-import two hundred good questions. The write itself
 * is one transaction, so an import either lands whole or not at all.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  AUDIENCES,
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  PREFERRED_DISTRACTOR_COUNT,
  QUESTION_TYPES,
  STANDARD_DISTRACTOR_COUNT,
  contentKey,
} from './ContentDatabase.js';
import type {
  Audience,
  ClueRecord,
  ContentDatabase,
  CuratedVerseRecord,
  OrderedItemRecord,
  OrderedListRecord,
  PromptCardRecord,
  QuestionRecord,
  QuestionSetRecord,
  QuestionType,
} from './ContentDatabase.js';
import {
  BOOK_COUNT,
  SECTIONS,
  fromVerseId,
  isValidVerseId,
  parseRef,
  sectionOf,
} from '../../../../src/modules/games/shared/verseId.js';
import type { SectionName, VerseId } from '../../../../src/modules/games/shared/verseId.js';

/** A put-in-order round with two items is a coin toss, not a game. */
export const MIN_ORDERED_ITEMS = 3;

export type ContentKind = 'question' | 'set' | 'ordered-list' | 'prompt-card' | 'verse';

export type RejectionReason =
  | 'not-an-object'
  | 'unknown-type'
  | 'empty-prompt'
  | 'empty-answer'
  | 'invalid-verse-id'
  | 'invalid-difficulty'
  | 'unknown-audience'
  | 'unknown-section'
  | 'invalid-book'
  | 'duplicate-id'
  | 'duplicate-prompt'
  | 'answer-among-distractors'
  | 'duplicate-distractor'
  | 'malformed-distractors'
  | 'too-few-distractors'
  | 'malformed-clues'
  | 'duplicate-clue'
  | 'empty-name'
  | 'empty-set'
  | 'unknown-question'
  | 'empty-title'
  | 'duplicate-title'
  | 'too-few-items'
  | 'duplicate-item'
  | 'empty-item-label'
  | 'unreadable-reference'
  | 'duplicate-verse'
  | 'empty-concept'
  | 'empty-category'
  | 'duplicate-concept'
  | 'forbidden-repeats-concept';

export interface ImportRejection {
  kind: ContentKind;
  /** The row's id, or its prompt when it had no usable id. */
  id: string;
  reason: RejectionReason;
  detail: string;
}

/** Something worth an author's attention that is not bad enough to refuse. */
export interface ImportWarning {
  kind: ContentKind;
  id: string;
  note: string;
}

export interface ImportCounts {
  questions: number;
  curatedVerses: number;
  distractors: number;
  sets: number;
  setMembers: number;
  orderedLists: number;
  orderedItems: number;
  promptCards: number;
}

export interface ImportReport {
  accepted: ImportCounts;
  rejected: ImportRejection[];
  warnings: ImportWarning[];
}

export interface ImportOptions {
  /** Validate and report without writing anything. */
  dryRun?: boolean;
  /**
   * What a flat CSV holds. A JSON file names its own kinds; a CSV has only
   * columns, so this says which. Left unset, a file whose rows carry a
   * reference and no prompt is read as the verse pool — the two shapes have no
   * column in common, so the guess is never a close call.
   */
  csvKind?: 'question' | 'verse';
}

/** The shape an authored JSON file takes. A bare array is read as questions. */
export interface ContentPayload {
  questions?: unknown;
  verses?: unknown;
  sets?: unknown;
  orderedLists?: unknown;
  promptCards?: unknown;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * A file that is not valid JSON is not a row-level problem and there is
 * nothing partial to salvage, so the parse error is allowed to travel.
 */
export function importJsonFile(
  db: ContentDatabase,
  path: string,
  options: ImportOptions = {}
): ImportReport {
  return importJson(db, readFileSync(path, 'utf8'), options);
}

export function importJson(
  db: ContentDatabase,
  json: string,
  options: ImportOptions = {}
): ImportReport {
  return importContent(db, JSON.parse(json) as unknown, options);
}

export function importCsvFile(
  db: ContentDatabase,
  path: string,
  options: ImportOptions = {}
): ImportReport {
  return importCsv(db, readFileSync(path, 'utf8'), options);
}

/**
 * CSV carries the two flat kinds — questions and the verse pool. Sets, ordered
 * lists and prompt cards are nested and belong in JSON.
 */
export function importCsv(
  db: ContentDatabase,
  csv: string,
  options: ImportOptions = {}
): ImportReport {
  const rows = parseCsv(csv);
  const kind = options.csvKind ?? (looksLikeVerses(rows) ? 'verse' : 'question');
  return importContent(db, kind === 'verse' ? { verses: rows } : { questions: rows }, options);
}

/** A verse row names a reference and asks nothing; a question row has a prompt. */
function looksLikeVerses(rows: readonly Record<string, unknown>[]): boolean {
  return (
    rows.length > 0 &&
    rows.every((row) => field(row, 'reference', 'ref', 'verse') !== undefined) &&
    rows.every((row) => field(row, 'prompt') === undefined)
  );
}

export function importContent(
  db: ContentDatabase,
  payload: unknown,
  options: ImportOptions = {}
): ImportReport {
  const rejected: ImportRejection[] = [];
  const warnings: ImportWarning[] = [];

  const source = Array.isArray(payload) ? { questions: payload } : (asRecord(payload) ?? {});
  const questionRows = asArray(source['questions']);
  const setRows = asArray(source['sets']);
  const listRows = asArray(source['orderedLists'] ?? source['ordered_lists']);
  const cardRows = asArray(source['promptCards'] ?? source['prompt_cards']);
  const verseRows = asArray(source['verses'] ?? source['curatedVerses'] ?? source['curated_verses']);

  const questions = collectQuestions(db, questionRows, rejected, warnings);
  const sets = collectSets(db, setRows, questions, rejected);
  const lists = collectOrderedLists(db, listRows, rejected);
  const cards = collectPromptCards(db, cardRows, rejected, warnings);
  const verses = collectCuratedVerses(verseRows, rejected);

  const accepted: ImportCounts = {
    curatedVerses: verses.length,
    questions: questions.length,
    distractors: questions.reduce((total, question) => total + question.distractors.length, 0),
    sets: sets.length,
    setMembers: sets.reduce((total, set) => total + set.questionIds.length, 0),
    orderedLists: lists.length,
    orderedItems: lists.reduce((total, list) => total + list.items.length, 0),
    promptCards: cards.length,
  };

  if (options.dryRun !== true) {
    db.transaction(() => {
      for (const question of questions) db.putQuestion(question);
      for (const set of sets) db.putQuestionSet(set);
      for (const list of lists) db.putOrderedList(list);
      for (const card of cards) db.putPromptCard(card);
      for (const verse of verses) db.putCuratedVerse(verse);
    });
  }

  return { accepted, rejected, warnings };
}

/** A summary meant to be printed. Silence is what this tool must never produce. */
export function formatImportReport(report: ImportReport): string {
  const lines: string[] = [];
  const { accepted } = report;
  lines.push(
    `accepted: ${accepted.questions} questions (${accepted.distractors} distractors), ` +
      `${accepted.sets} sets (${accepted.setMembers} members), ` +
      `${accepted.orderedLists} ordered lists (${accepted.orderedItems} items), ` +
      `${accepted.promptCards} prompt cards, ` +
      `${accepted.curatedVerses} curated verses`
  );
  lines.push(`rejected: ${report.rejected.length}`);
  for (const rejection of report.rejected) {
    lines.push(`  [${rejection.kind}] ${rejection.id}: ${rejection.reason} — ${rejection.detail}`);
  }
  if (report.warnings.length > 0) {
    lines.push(`warnings: ${report.warnings.length}`);
    for (const warning of report.warnings) {
      lines.push(`  [${warning.kind}] ${warning.id}: ${warning.note}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

function collectQuestions(
  db: ContentDatabase,
  rows: unknown[],
  rejected: ImportRejection[],
  warnings: ImportWarning[]
): QuestionRecord[] {
  const accepted: QuestionRecord[] = [];
  const idsSeen = new Set<string>();
  const promptKeysSeen = new Set<string>();

  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row) {
      rejected.push({ kind: 'question', id: '?', reason: 'not-an-object', detail: describe(raw) });
      continue;
    }

    const prompt = text(field(row, 'prompt'));
    if (prompt === null) {
      rejected.push({
        kind: 'question',
        id: text(field(row, 'id')) ?? '?',
        reason: 'empty-prompt',
        detail: 'a question needs something to ask',
      });
      continue;
    }

    const id = text(field(row, 'id')) ?? derivedId('q', prompt);
    const reject = (reason: RejectionReason, detail: string): void => {
      rejected.push({ kind: 'question', id, reason, detail });
    };

    if (idsSeen.has(id)) {
      reject('duplicate-id', 'another row in this file already claims this id');
      continue;
    }

    const promptKey = contentKey(prompt);
    if (promptKeysSeen.has(promptKey)) {
      reject('duplicate-prompt', 'another row in this file asks the same thing');
      continue;
    }
    const incumbent = db.questionIdForPrompt(prompt);
    if (incumbent !== null && incumbent !== id) {
      reject('duplicate-prompt', `already asked by ${incumbent}`);
      continue;
    }

    const typeValue = field(row, 'type');
    const type = typeValue === undefined || typeValue === null || typeValue === ''
      ? 'multiple-choice'
      : (text(typeValue) ?? describe(typeValue));
    if (!QUESTION_TYPES.includes(type as QuestionType)) {
      reject('unknown-type', `${type} is not one of ${QUESTION_TYPES.join(', ')}`);
      continue;
    }

    const answer = text(field(row, 'answer'));
    if (answer === null) {
      reject('empty-answer', 'a question needs a canonical answer');
      continue;
    }

    const verseValue = field(row, 'promptVerseId', 'prompt_verse_id');
    let promptVerseId: VerseId | null = null;
    if (verseValue !== undefined && verseValue !== null && verseValue !== '') {
      const parsed = integer(verseValue);
      if (parsed === null || !isValidVerseId(parsed)) {
        reject('invalid-verse-id', `${describe(verseValue)} is not a verse id`);
        continue;
      }
      promptVerseId = parsed;
    }

    const difficulty = readDifficulty(field(row, 'difficulty'));
    if (difficulty === null) {
      reject(
        'invalid-difficulty',
        `difficulty must be a whole number from ${MIN_DIFFICULTY} to ${MAX_DIFFICULTY}`
      );
      continue;
    }

    const audience = readAudience(field(row, 'audience'));
    if (audience === null) {
      reject('unknown-audience', `audience must be one of ${AUDIENCES.join(', ')}`);
      continue;
    }

    const scope = readScope(row, promptVerseId);
    if (scope.error) {
      reject(scope.error.reason, scope.error.detail);
      continue;
    }

    const accept = textList(field(row, 'accept')) ?? [];
    const distractors = textList(field(row, 'distractors'));
    if (distractors === null) {
      reject('malformed-distractors', 'distractors must be a list of strings');
      continue;
    }

    const duplicate = firstDuplicate(distractors);
    if (duplicate !== null) {
      reject('duplicate-distractor', `${duplicate} appears twice`);
      continue;
    }

    // A distractor that is also the right answer turns a question into a trap
    // no player can win, and the accept list is just as answerable as the
    // canonical wording.
    const answerKeys = new Set([answer, ...accept].map(contentKey));
    const collision = distractors.find((entry) => answerKeys.has(contentKey(entry)));
    if (collision !== undefined) {
      reject('answer-among-distractors', `${collision} is also a correct answer`);
      continue;
    }

    const clues = readClues(field(row, 'clues'));
    if (clues.error) {
      reject(clues.error.reason, clues.error.detail);
      continue;
    }

    if (type === 'multiple-choice' && distractors.length < STANDARD_DISTRACTOR_COUNT) {
      reject(
        'too-few-distractors',
        `multiple choice needs at least ${STANDARD_DISTRACTOR_COUNT}, found ${distractors.length}`
      );
      continue;
    }

    if (type === 'multiple-choice' && distractors.length < PREFERRED_DISTRACTOR_COUNT) {
      warnings.push({
        kind: 'question',
        id,
        note:
          `${distractors.length} distractors; ${PREFERRED_DISTRACTOR_COUNT} or more keeps a ` +
          'repeat playthrough from offering the same four options',
      });
    }
    if (type === 'short-answer' && text(field(row, 'contextNote', 'context_note')) === null) {
      warnings.push({
        kind: 'question',
        id,
        note: 'no context note; a judge has only the accept list to go on',
      });
    }

    idsSeen.add(id);
    promptKeysSeen.add(promptKey);
    accepted.push({
      id,
      type: type as QuestionType,
      prompt,
      promptVerseId,
      answer,
      accept,
      contextNote: text(field(row, 'contextNote', 'context_note')),
      difficulty,
      audience,
      book: scope.book,
      section: scope.section,
      tags: normaliseTags(textList(field(row, 'tags')) ?? []),
      source: text(field(row, 'source')),
      reviewedBy: text(field(row, 'reviewedBy', 'reviewed_by')),
      distractors,
      clues: clues.clues,
    });
  }

  return accepted;
}

interface CluesResult {
  clues: ClueRecord[];
  error: { reason: RejectionReason; detail: string } | null;
}

/**
 * Clues, vaguest first. A clue may be a bare sentence or an object carrying the
 * verse it comes from, written as a reference the way the verse pool is. A
 * spreadsheet column may hold them pipe-separated, as it does distractors.
 *
 * The same clue twice is refused rather than collapsed: in a game that deals
 * one clue to each phone, two phones would hold identical evidence and the
 * group would have one clue fewer than the author thought.
 */
function readClues(value: unknown): CluesResult {
  const clues: ClueRecord[] = [];
  if (value === undefined || value === null || value === '') return { clues, error: null };
  const entries: unknown = typeof value === 'string' ? value.split('|') : value;
  if (!Array.isArray(entries)) {
    return { clues, error: { reason: 'malformed-clues', detail: 'clues must be a list' } };
  }

  const seen = new Set<string>();
  for (const raw of entries) {
    const record = asRecord(raw);
    const clueText = typeof raw === 'string' ? text(raw) : text(field(record ?? {}, 'text'));
    if (clueText === null) {
      return { clues, error: { reason: 'malformed-clues', detail: 'a clue has no text' } };
    }
    const key = contentKey(clueText);
    if (seen.has(key)) {
      return { clues, error: { reason: 'duplicate-clue', detail: `${clueText} appears twice` } };
    }
    seen.add(key);

    let verseId: VerseId | null = null;
    if (record) {
      const reference = text(field(record, 'ref', 'reference'));
      const verseValue = field(record, 'verseId', 'verse_id');
      if (reference !== null) {
        verseId = parseRef(reference);
        if (verseId === null) {
          return {
            clues,
            error: {
              reason: 'unreadable-reference',
              detail: `${reference} is not a book, chapter and verse`,
            },
          };
        }
      } else if (verseValue !== undefined && verseValue !== null && verseValue !== '') {
        const parsed = integer(verseValue);
        if (parsed === null || !isValidVerseId(parsed)) {
          return {
            clues,
            error: { reason: 'invalid-verse-id', detail: `${describe(verseValue)} is not a verse id` },
          };
        }
        verseId = parsed;
      }
    }
    clues.push({ text: clueText, verseId });
  }
  return { clues, error: null };
}

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

function collectSets(
  db: ContentDatabase,
  rows: unknown[],
  incoming: readonly QuestionRecord[],
  rejected: ImportRejection[]
): QuestionSetRecord[] {
  const accepted: QuestionSetRecord[] = [];
  const idsSeen = new Set<string>();
  const availableIds = new Set(incoming.map((question) => question.id));

  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row) {
      rejected.push({ kind: 'set', id: '?', reason: 'not-an-object', detail: describe(raw) });
      continue;
    }

    const name = text(field(row, 'name'));
    if (name === null) {
      rejected.push({
        kind: 'set',
        id: text(field(row, 'id')) ?? '?',
        reason: 'empty-name',
        detail: 'a set needs a name a host can recognise',
      });
      continue;
    }

    const id = text(field(row, 'id')) ?? derivedId('set', name);
    const reject = (reason: RejectionReason, detail: string): void => {
      rejected.push({ kind: 'set', id, reason, detail });
    };

    if (idsSeen.has(id)) {
      reject('duplicate-id', 'another row in this file already claims this id');
      continue;
    }

    const questionIds = textList(field(row, 'questionIds', 'question_ids', 'questions')) ?? [];
    if (questionIds.length === 0) {
      reject('empty-set', 'a set with no questions is not playable');
      continue;
    }

    const missing = questionIds.find(
      (questionId) => !availableIds.has(questionId) && db.getQuestion(questionId) === null
    );
    if (missing !== undefined) {
      reject('unknown-question', `${missing} is neither in this file nor already imported`);
      continue;
    }

    const difficulty = readDifficulty(field(row, 'difficulty'));
    if (difficulty === null) {
      reject(
        'invalid-difficulty',
        `difficulty must be a whole number from ${MIN_DIFFICULTY} to ${MAX_DIFFICULTY}`
      );
      continue;
    }

    const audience = readAudience(field(row, 'audience'));
    if (audience === null) {
      reject('unknown-audience', `audience must be one of ${AUDIENCES.join(', ')}`);
      continue;
    }

    const scope = readScope(row, null);
    if (scope.error) {
      reject(scope.error.reason, scope.error.detail);
      continue;
    }

    idsSeen.add(id);
    accepted.push({
      id,
      name,
      description: text(field(row, 'description')),
      difficulty,
      audience,
      book: scope.book,
      section: scope.section,
      tags: normaliseTags(textList(field(row, 'tags')) ?? []),
      questionIds,
    });
  }

  return accepted;
}

// ---------------------------------------------------------------------------
// Ordered lists
// ---------------------------------------------------------------------------

function collectOrderedLists(
  db: ContentDatabase,
  rows: unknown[],
  rejected: ImportRejection[]
): OrderedListRecord[] {
  const accepted: OrderedListRecord[] = [];
  const idsSeen = new Set<string>();
  const titleKeysSeen = new Set<string>();

  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row) {
      rejected.push({ kind: 'ordered-list', id: '?', reason: 'not-an-object', detail: describe(raw) });
      continue;
    }

    const title = text(field(row, 'title'));
    if (title === null) {
      rejected.push({
        kind: 'ordered-list',
        id: text(field(row, 'id')) ?? '?',
        reason: 'empty-title',
        detail: 'an ordering needs a title to put on the screen',
      });
      continue;
    }

    const id = text(field(row, 'id')) ?? derivedId('list', title);
    const reject = (reason: RejectionReason, detail: string): void => {
      rejected.push({ kind: 'ordered-list', id, reason, detail });
    };

    if (idsSeen.has(id)) {
      reject('duplicate-id', 'another row in this file already claims this id');
      continue;
    }

    const titleKey = contentKey(title);
    const incumbent = db.orderedListIdForTitle(title);
    if (titleKeysSeen.has(titleKey) || (incumbent !== null && incumbent !== id)) {
      reject('duplicate-title', 'an ordering with this title already exists');
      continue;
    }

    const items = readOrderedItems(field(row, 'items'));
    if (items.error) {
      reject(items.error.reason, items.error.detail);
      continue;
    }
    if (items.items.length < MIN_ORDERED_ITEMS) {
      reject(
        'too-few-items',
        `an ordering needs at least ${MIN_ORDERED_ITEMS} items, found ${items.items.length}`
      );
      continue;
    }

    const duplicate = firstDuplicate(items.items.map((item) => item.label));
    if (duplicate !== null) {
      reject('duplicate-item', `${duplicate} appears twice, so no ordering is unique`);
      continue;
    }

    const difficulty = readDifficulty(field(row, 'difficulty'));
    if (difficulty === null) {
      reject(
        'invalid-difficulty',
        `difficulty must be a whole number from ${MIN_DIFFICULTY} to ${MAX_DIFFICULTY}`
      );
      continue;
    }

    const audience = readAudience(field(row, 'audience'));
    if (audience === null) {
      reject('unknown-audience', `audience must be one of ${AUDIENCES.join(', ')}`);
      continue;
    }

    const firstVerse = items.items.find((item) => item.verseId !== null)?.verseId ?? null;
    const scope = readScope(row, firstVerse);
    if (scope.error) {
      reject(scope.error.reason, scope.error.detail);
      continue;
    }

    idsSeen.add(id);
    titleKeysSeen.add(titleKey);
    accepted.push({
      id,
      title,
      instructions: text(field(row, 'instructions')),
      difficulty,
      audience,
      book: scope.book,
      section: scope.section,
      tags: normaliseTags(textList(field(row, 'tags')) ?? []),
      source: text(field(row, 'source')),
      reviewedBy: text(field(row, 'reviewedBy', 'reviewed_by')),
      items: items.items,
    });
  }

  return accepted;
}

interface OrderedItemsResult {
  items: OrderedItemRecord[];
  error: { reason: RejectionReason; detail: string } | null;
}

function readOrderedItems(value: unknown): OrderedItemsResult {
  const items: OrderedItemRecord[] = [];
  for (const raw of asArray(value)) {
    // An item may be a bare label or an object carrying a reference and a note.
    const label = typeof raw === 'string' ? text(raw) : text(field(asRecord(raw) ?? {}, 'label'));
    if (label === null) {
      return { items, error: { reason: 'empty-item-label', detail: 'an item has no label' } };
    }

    const record = asRecord(raw);
    let verseId: VerseId | null = null;
    if (record) {
      const verseValue = field(record, 'verseId', 'verse_id');
      if (verseValue !== undefined && verseValue !== null && verseValue !== '') {
        const parsed = integer(verseValue);
        if (parsed === null || !isValidVerseId(parsed)) {
          return {
            items,
            error: { reason: 'invalid-verse-id', detail: `${describe(verseValue)} is not a verse id` },
          };
        }
        verseId = parsed;
      }
    }

    items.push({ label, verseId, note: record ? text(field(record, 'note')) : null });
  }
  return { items, error: null };
}

// ---------------------------------------------------------------------------
// Prompt cards
// ---------------------------------------------------------------------------

function collectPromptCards(
  db: ContentDatabase,
  rows: unknown[],
  rejected: ImportRejection[],
  warnings: ImportWarning[]
): PromptCardRecord[] {
  const accepted: PromptCardRecord[] = [];
  const idsSeen = new Set<string>();
  const conceptKeysSeen = new Set<string>();

  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row) {
      rejected.push({ kind: 'prompt-card', id: '?', reason: 'not-an-object', detail: describe(raw) });
      continue;
    }

    const concept = text(field(row, 'concept'));
    if (concept === null) {
      rejected.push({
        kind: 'prompt-card',
        id: text(field(row, 'id')) ?? '?',
        reason: 'empty-concept',
        detail: 'a card needs something to act out',
      });
      continue;
    }

    const id = text(field(row, 'id')) ?? derivedId('card', concept);
    const reject = (reason: RejectionReason, detail: string): void => {
      rejected.push({ kind: 'prompt-card', id, reason, detail });
    };

    if (idsSeen.has(id)) {
      reject('duplicate-id', 'another row in this file already claims this id');
      continue;
    }

    const conceptKey = contentKey(concept);
    const incumbent = db.promptCardIdForConcept(concept);
    if (conceptKeysSeen.has(conceptKey) || (incumbent !== null && incumbent !== id)) {
      reject('duplicate-concept', 'a card for this concept already exists');
      continue;
    }

    const category = text(field(row, 'category'));
    if (category === null) {
      reject('empty-category', 'a card needs a category so a host can filter by it');
      continue;
    }

    const forbidden = textList(field(row, 'forbidden', 'forbidden_words', 'forbiddenWords')) ?? [];
    // Every word of the concept is forbidden by definition; listing one wastes
    // a slot and reads as an author who has misunderstood the game.
    const conceptWords = new Set(cardWords(concept));
    const repeated = forbidden.find((word) => cardWords(word).some((part) => conceptWords.has(part)));
    if (repeated !== undefined) {
      reject(
        'forbidden-repeats-concept',
        `"${repeated}" is already on the card in "${concept}", and the concept's own words are always forbidden`
      );
      continue;
    }

    const difficulty = readDifficulty(field(row, 'difficulty'));
    if (difficulty === null) {
      reject(
        'invalid-difficulty',
        `difficulty must be a whole number from ${MIN_DIFFICULTY} to ${MAX_DIFFICULTY}`
      );
      continue;
    }

    const audience = readAudience(field(row, 'audience'));
    if (audience === null) {
      reject('unknown-audience', `audience must be one of ${AUDIENCES.join(', ')}`);
      continue;
    }

    const scope = readScope(row, null);
    if (scope.error) {
      reject(scope.error.reason, scope.error.detail);
      continue;
    }

    if (forbidden.length === 0) {
      warnings.push({
        kind: 'prompt-card',
        id,
        note: 'no forbidden words, so the clue-giver may simply say the answer',
      });
    }

    idsSeen.add(id);
    conceptKeysSeen.add(conceptKey);
    accepted.push({
      id,
      concept,
      category,
      forbidden,
      difficulty,
      audience,
      book: scope.book,
      section: scope.section,
      tags: normaliseTags(textList(field(row, 'tags')) ?? []),
      source: text(field(row, 'source')),
      reviewedBy: text(field(row, 'reviewedBy', 'reviewed_by')),
    });
  }

  return accepted;
}

/**
 * Words too small to carry a concept. "The" and "of" appear on half the cards,
 * so counting them would refuse a forbidden "of" nobody would list and match
 * nothing an author meant.
 */
const FUNCTION_WORDS = new Set([
  'a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with',
]);

/**
 * The words of a card's text as a clue-giver would say them. A possessive is
 * its base word — "lions' den" says "lions" and "Balaam's donkey" says
 * "Balaam" — so the ending is dropped before contentKey would fold "Balaam's"
 * into "balaams".
 */
function cardWords(value: string): string[] {
  const withoutPossessives = value.replace(/['’]s?(?![\p{Letter}\p{Number}])/giu, '');
  return contentKey(withoutPossessives)
    .split(' ')
    .filter((word) => word !== '' && !FUNCTION_WORDS.has(word));
}

// ---------------------------------------------------------------------------
// Curated verses
// ---------------------------------------------------------------------------

/**
 * The verse pool: a reference and how far from common knowledge it sits.
 *
 * The reference is authored as people write it — `Romans 8:28` — rather than as
 * an id, because a list of eight-digit integers is a list nobody will ever
 * proof-read. Whatever cannot be read back is rejected by name.
 *
 * Book and section are derived, never authored. They exist so a host can filter
 * to the gospels, and a hand-typed book number that disagreed with the
 * reference would make that filter quietly wrong.
 *
 * A verse listed twice in one file is a rejection rather than a last-one-wins,
 * because the two rows usually disagree about difficulty and there is no way to
 * tell which pass the author meant. Re-importing a file that changes a verse's
 * tier is a different thing, and that is allowed: the row replaces the stored
 * one.
 */
function collectCuratedVerses(rows: unknown[], rejected: ImportRejection[]): CuratedVerseRecord[] {
  const accepted: CuratedVerseRecord[] = [];
  const seen = new Set<VerseId>();

  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row) {
      rejected.push({ kind: 'verse', id: '?', reason: 'not-an-object', detail: describe(raw) });
      continue;
    }

    const reference = text(field(row, 'reference', 'ref', 'verse'));
    const rawId = field(row, 'verseId', 'verse_id');
    const label = reference ?? describe(rawId);
    const reject = (reason: RejectionReason, detail: string): void => {
      rejected.push({ kind: 'verse', id: label, reason, detail });
    };

    let verseId: VerseId | null = null;
    if (reference !== null) {
      verseId = parseRef(reference);
      if (verseId === null) {
        reject('unreadable-reference', `${reference} is not a book, chapter and verse`);
        continue;
      }
    } else {
      verseId = integer(rawId);
      if (verseId === null || !isValidVerseId(verseId)) {
        reject('invalid-verse-id', `${describe(rawId)} is not a verse id`);
        continue;
      }
    }

    if (seen.has(verseId)) {
      reject('duplicate-verse', 'another row in this file already curates this verse');
      continue;
    }

    const difficulty = readDifficulty(field(row, 'difficulty', 'tier'));
    if (difficulty === null) {
      reject(
        'invalid-difficulty',
        `difficulty must be a whole number from ${MIN_DIFFICULTY} to ${MAX_DIFFICULTY}`
      );
      continue;
    }

    const audience = readAudience(field(row, 'audience'));
    if (audience === null) {
      reject('unknown-audience', `audience must be one of ${AUDIENCES.join(', ')}`);
      continue;
    }

    const book = fromVerseId(verseId).book;
    seen.add(verseId);
    accepted.push({
      verseId,
      difficulty,
      audience,
      book,
      section: sectionOf(book),
      tags: normaliseTags(textList(field(row, 'tags')) ?? []),
      note: text(field(row, 'note')),
      source: text(field(row, 'source')),
      reviewedBy: text(field(row, 'reviewedBy', 'reviewed_by')),
    });
  }

  return accepted;
}

// ---------------------------------------------------------------------------
// Shared field reading
// ---------------------------------------------------------------------------

interface ScopeResult {
  book: number | null;
  section: SectionName | null;
  error: { reason: RejectionReason; detail: string } | null;
}

/**
 * Book and section, filled in from the prompt's verse where the author did not
 * state them. Deriving costs nothing and every unfilled tag is a question a
 * host's scope filter will silently miss.
 */
function readScope(row: Record<string, unknown>, verseId: VerseId | null): ScopeResult {
  let book: number | null = null;
  const bookValue = field(row, 'book');
  if (bookValue !== undefined && bookValue !== null && bookValue !== '') {
    const parsed = integer(bookValue);
    if (parsed === null || parsed < 1 || parsed > BOOK_COUNT) {
      return {
        book: null,
        section: null,
        error: { reason: 'invalid-book', detail: `${describe(bookValue)} is not a book number` },
      };
    }
    book = parsed;
  } else if (verseId !== null) {
    book = fromVerseId(verseId).book;
  }

  let section: SectionName | null = null;
  const sectionValue = text(field(row, 'section'));
  if (sectionValue !== null) {
    if (!Object.prototype.hasOwnProperty.call(SECTIONS, sectionValue)) {
      return {
        book: null,
        section: null,
        error: {
          reason: 'unknown-section',
          detail: `${sectionValue} is not one of ${Object.keys(SECTIONS).join(', ')}`,
        },
      };
    }
    section = sectionValue as SectionName;
  } else if (book !== null) {
    section = sectionOf(book);
  }

  return { book, section, error: null };
}

function readDifficulty(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return 3;
  const parsed = integer(value);
  if (parsed === null || parsed < MIN_DIFFICULTY || parsed > MAX_DIFFICULTY) return null;
  return parsed;
}

function readAudience(value: unknown): Audience | null {
  const raw = text(value);
  if (raw === null) return 'all';
  const lowered = raw.toLowerCase();
  return AUDIENCES.includes(lowered as Audience) ? (lowered as Audience) : null;
}

/** Tags are compared, not displayed, so they are stored in one casing. */
function normaliseTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const tag of tags) {
    const lowered = tag.trim().toLowerCase();
    if (lowered.length > 0) seen.add(lowered);
  }
  return [...seen];
}

function firstDuplicate(values: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    const key = contentKey(value);
    if (seen.has(key)) return value;
    seen.add(key);
  }
  return null;
}

/** A stable id from the text itself, so re-importing a file updates in place. */
function derivedId(prefix: string, text: string): string {
  return `${prefix}_${createHash('sha1').update(contentKey(text)).digest('hex').slice(0, 12)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Authors write snake_case as readily as camelCase; both are read. */
function field(row: Record<string, unknown>, ...names: readonly string[]): unknown {
  for (const name of names) {
    if (row[name] !== undefined) return row[name];
  }
  return undefined;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function integer(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/**
 * A list of strings, or null when the value is present but is something else.
 * A pipe-separated string is accepted because that is what a spreadsheet
 * column can hold.
 */
function textList(value: unknown): string[] | null {
  if (value === undefined || value === null || value === '') return [];
  if (typeof value === 'string') {
    return value
      .split('|')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (!Array.isArray(value)) return null;
  const entries: string[] = [];
  for (const entry of value) {
    const trimmed = text(entry);
    if (trimmed === null) return null;
    entries.push(trimmed);
  }
  return entries;
}

function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? String(value);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * A small RFC 4180 reader: quoted fields, doubled quotes inside them, newlines
 * inside quotes. Header names are matched loosely so a spreadsheet exported
 * with `Prompt Verse Id` lines up with `prompt_verse_id`.
 */
function parseCsv(csv: string): Record<string, unknown>[] {
  const rows = splitCsvRows(csv);
  const header = rows.shift();
  if (!header) return [];
  const names = header.map((name) => name.trim().toLowerCase().replace(/[\s-]+/g, '_'));

  return rows
    .filter((cells) => cells.some((cell) => cell.trim().length > 0))
    .map((cells) => {
      const row: Record<string, unknown> = {};
      names.forEach((name, index) => {
        row[name] = cells[index] ?? '';
      });
      return row;
    });
}

function splitCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      cells.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      // Treat CRLF as one break rather than an empty row between the two.
      if (character === '\r' && csv[index + 1] === '\n') index += 1;
      cells.push(cell);
      rows.push(cells);
      cells = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  if (cell.length > 0 || cells.length > 0) {
    cells.push(cell);
    rows.push(cells);
  }
  return rows;
}
