/**
 * The authored-content database: questions, sets, orderings and prompt cards.
 *
 * This is deliberately a different file from a Bible module. Modules are
 * third-party assets, read only and interchangeable; this is the work of the
 * people running the games, it is written to, and it is backed up with the
 * rest of the server's data. Mixing the two would mean either writing into
 * somebody else's module or losing authored content the next time a module is
 * replaced.
 *
 * Content is tagged by book, section, difficulty and audience so that a host
 * can say "gospels, easy, children" and get a playable set without reading a
 * single question first. Those four are columns rather than free tags because
 * they are the four every screen filters on.
 *
 * Every value reaches SQL as a bound parameter. Clauses whose *shape* varies —
 * an `IN` list, an optional filter — are built from placeholders and the values
 * are bound alongside; nothing is ever spliced into SQL text.
 */

import Database from 'better-sqlite3';
import type { Database as SqliteDatabase, Statement } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SectionName, VerseId } from '../../../../src/modules/games/shared/verseId.js';

export const SCHEMA_VERSION = 2;

export type QuestionType =
  | 'multiple-choice'
  | 'short-answer'
  | 'true-false'
  | 'fill-in-the-blank'
  | 'reference';

export const QUESTION_TYPES: readonly QuestionType[] = [
  'multiple-choice',
  'short-answer',
  'true-false',
  'fill-in-the-blank',
  'reference',
];

/** Who the item is pitched at. `all` matches every request. */
export type Audience = 'children' | 'youth' | 'adult' | 'all';

export const AUDIENCES: readonly Audience[] = ['children', 'youth', 'adult', 'all'];

export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 5;

/**
 * The standard three wrong answers every multiple-choice round needs. Authors
 * are asked for more than this so that a question replayed in the same evening
 * does not offer the same four options twice.
 */
export const STANDARD_DISTRACTOR_COUNT = 3;
export const PREFERRED_DISTRACTOR_COUNT = 8;

/** Tags shared by every authored item, and the only ones the host UI filters on. */
export interface ContentTags {
  /** Book number, or null for a question that spans the canon. */
  book: number | null;
  section: SectionName | null;
  difficulty: number;
  audience: Audience;
  /** Free-form, lowercased, e.g. `parable`, `memory-verse`. */
  tags: string[];
}

/**
 * One clue in a question that is answered from clues rather than from its
 * prompt alone: a who-am-I that reveals them one at a time, or a detective case
 * that deals one to each phone.
 */
export interface ClueRecord {
  text: string;
  /** Where the clue comes from, so a reveal can cite it and a check can verify it. */
  verseId: VerseId | null;
}

export interface QuestionRecord extends ContentTags {
  id: string;
  type: QuestionType;
  prompt: string;
  /** The verse the prompt is drawn from, when there is one. */
  promptVerseId: VerseId | null;
  /** The answer as it should be shown on the reveal screen. */
  answer: string;
  /** Alternate spellings and phrasings that count as correct. */
  accept: string[];
  /** One line from the author for a judge, for cases the accept list misses. */
  contextNote: string | null;
  source: string | null;
  reviewedBy: string | null;
  /**
   * Ordered wrong answers. The first three are the standard set — the most
   * plausible ones — and the rest give a repeat playthrough some variety.
   */
  distractors: string[];
  /**
   * Clues in the order they are meant to be revealed, vaguest first. Empty for
   * a question that is answered from its prompt.
   */
  clues: ClueRecord[];
}

export interface QuestionSetRecord extends ContentTags {
  id: string;
  name: string;
  description: string | null;
  questionIds: string[];
}

export interface OrderedItemRecord {
  label: string;
  /** Where the event or saying is found, when it has a single home. */
  verseId: VerseId | null;
  /** Shown on the reveal screen after the ordering is graded. */
  note: string | null;
}

export interface OrderedListRecord extends ContentTags {
  id: string;
  title: string;
  instructions: string | null;
  source: string | null;
  reviewedBy: string | null;
  /** Canonical order. The game shuffles; this is the answer key. */
  items: OrderedItemRecord[];
}

export interface PromptCardRecord extends ContentTags {
  id: string;
  concept: string;
  /** `person`, `place`, `event`, `object`, `parable`, and so on. */
  category: string;
  /** Words the clue-giver may not say. The concept itself is always implied. */
  forbidden: string[];
  source: string | null;
  reviewedBy: string | null;
}

/**
 * One verse somebody decided is worth asking about.
 *
 * The pool exists because a uniform draw from 31,102 verses is a draw from Job
 * and the back half of Judges: correct, and no fun. Difficulty here is not how
 * hard the *question* is — a game decides that — it is how far from common
 * knowledge the verse sits, 1 being the handful everyone can finish out loud.
 *
 * `book` and `section` are derived from the verse rather than authored, so a
 * host's "gospels" filter cannot disagree with the reference.
 */
export interface CuratedVerseRecord extends ContentTags {
  verseId: VerseId;
  book: number;
  section: SectionName;
  /** A short reason the verse is in the pool, for whoever curates it next. */
  note: string | null;
  source: string | null;
  reviewedBy: string | null;
}

/** Narrows any authored item to a scope a host chose. */
export interface ContentFilter {
  books?: readonly number[];
  sections?: readonly SectionName[];
  minDifficulty?: number;
  maxDifficulty?: number;
  /** Matches items for this audience and items tagged for everyone. */
  audience?: Audience;
  tag?: string;
}

export interface QuestionFilter extends ContentFilter {
  type?: QuestionType;
  setId?: string;
}

/**
 * Comparison key for text that must be unique or must not collide with itself:
 * prompts, answers, distractors, concepts. Case, surrounding punctuation and
 * runs of whitespace are noise for that purpose — "Who was Moses' brother?" and
 * "who was moses' brother" are the same question asked twice.
 */
export function contentKey(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    // NFKD then dropping everything but letters, digits and spaces also drops
    // combining marks, so accented spellings compare equal.
    .replace(/[^\p{Letter}\p{Number}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS content_schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS question (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  prompt          TEXT NOT NULL,
  prompt_key      TEXT NOT NULL UNIQUE,
  prompt_verse_id INTEGER,
  answer          TEXT NOT NULL,
  accept          TEXT NOT NULL DEFAULT '[]',
  context_note    TEXT,
  difficulty      INTEGER NOT NULL,
  audience        TEXT NOT NULL DEFAULT 'all',
  book            INTEGER,
  section         TEXT,
  tags            TEXT NOT NULL DEFAULT '[]',
  source          TEXT,
  reviewed_by     TEXT,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS question_scope ON question (book, section, difficulty, audience);
CREATE INDEX IF NOT EXISTS question_type ON question (type);

CREATE TABLE IF NOT EXISTS distractor (
  question_id TEXT NOT NULL REFERENCES question (id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  text        TEXT NOT NULL,
  PRIMARY KEY (question_id, position)
);

CREATE TABLE IF NOT EXISTS clue (
  question_id TEXT NOT NULL REFERENCES question (id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  text        TEXT NOT NULL,
  verse_id    INTEGER,
  PRIMARY KEY (question_id, position)
);

CREATE TABLE IF NOT EXISTS question_set (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  difficulty  INTEGER NOT NULL,
  audience    TEXT NOT NULL DEFAULT 'all',
  book        INTEGER,
  section     TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS question_set_member (
  set_id      TEXT NOT NULL REFERENCES question_set (id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES question (id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  PRIMARY KEY (set_id, question_id)
);

CREATE INDEX IF NOT EXISTS question_set_member_order ON question_set_member (set_id, position);

CREATE TABLE IF NOT EXISTS ordered_list (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  title_key    TEXT NOT NULL UNIQUE,
  instructions TEXT,
  difficulty   INTEGER NOT NULL,
  audience     TEXT NOT NULL DEFAULT 'all',
  book         INTEGER,
  section      TEXT,
  tags         TEXT NOT NULL DEFAULT '[]',
  source       TEXT,
  reviewed_by  TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ordered_item (
  list_id  TEXT NOT NULL REFERENCES ordered_list (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label    TEXT NOT NULL,
  verse_id INTEGER,
  note     TEXT,
  PRIMARY KEY (list_id, position)
);

CREATE TABLE IF NOT EXISTS prompt_card (
  id          TEXT PRIMARY KEY,
  concept     TEXT NOT NULL,
  concept_key TEXT NOT NULL UNIQUE,
  category    TEXT NOT NULL,
  forbidden   TEXT NOT NULL DEFAULT '[]',
  difficulty  INTEGER NOT NULL,
  audience    TEXT NOT NULL DEFAULT 'all',
  book        INTEGER,
  section     TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  source      TEXT,
  reviewed_by TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS prompt_card_scope ON prompt_card (category, difficulty, audience);

CREATE TABLE IF NOT EXISTS curated_verse (
  verse_id    INTEGER PRIMARY KEY,
  difficulty  INTEGER NOT NULL,
  audience    TEXT NOT NULL DEFAULT 'all',
  book        INTEGER NOT NULL,
  section     TEXT NOT NULL,
  tags        TEXT NOT NULL DEFAULT '[]',
  note        TEXT,
  source      TEXT,
  reviewed_by TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS curated_verse_scope ON curated_verse (difficulty, audience, book);
`;

interface CountRow {
  c: number;
}

interface QuestionRow {
  id: string;
  type: string;
  prompt: string;
  prompt_verse_id: number | null;
  answer: string;
  accept: string;
  context_note: string | null;
  difficulty: number;
  audience: string;
  book: number | null;
  section: string | null;
  tags: string;
  source: string | null;
  reviewed_by: string | null;
}

interface IdRow {
  id: string;
}

export class ContentDatabase {
  private readonly db: SqliteDatabase;
  /** One prepared statement per SQL text, including the generated shapes. */
  private readonly statements = new Map<string, Statement>();

  readonly path: string;

  private constructor(db: SqliteDatabase, path: string) {
    this.db = db;
    this.path = path;
  }

  /** Opens or creates the database and brings the schema up to date. */
  static open(path: string): ContentDatabase {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    db.pragma('journal_mode = WAL');
    // Set membership and distractors are meaningless without their parent, so
    // the cascades in the schema have to actually fire.
    db.pragma('foreign_keys = ON');
    const content = new ContentDatabase(db, path);
    content.migrate();
    return content;
  }

  static openInMemory(): ContentDatabase {
    return ContentDatabase.open(':memory:');
  }

  /**
   * Idempotent by construction: every statement is `IF NOT EXISTS` and the
   * version row is inserted only if absent, so running this against a current
   * database is a no-op and running it against an empty file builds the lot.
   */
  migrate(): void {
    this.db.exec(SCHEMA);
    this.prepared('INSERT OR IGNORE INTO content_schema_version (version, applied_at) VALUES (?, ?)').run(
      SCHEMA_VERSION,
      new Date().toISOString()
    );
  }

  schemaVersion(): number {
    const row = this.prepared('SELECT MAX(version) AS c FROM content_schema_version').get() as
      | CountRow
      | undefined;
    return row?.c ?? 0;
  }

  /** Groups writes so a half-applied import cannot reach disk. */
  transaction<T>(work: () => T): T {
    return this.db.transaction(work)();
  }

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  /** Inserts or replaces a question along with its ordered distractors. */
  putQuestion(record: QuestionRecord): void {
    this.prepared(
      `INSERT INTO question (
         id, type, prompt, prompt_key, prompt_verse_id, answer, accept, context_note,
         difficulty, audience, book, section, tags, source, reviewed_by, created_at
       ) VALUES (
         @id, @type, @prompt, @prompt_key, @prompt_verse_id, @answer, @accept, @context_note,
         @difficulty, @audience, @book, @section, @tags, @source, @reviewed_by, @created_at
       )
       ON CONFLICT (id) DO UPDATE SET
         type = excluded.type, prompt = excluded.prompt, prompt_key = excluded.prompt_key,
         prompt_verse_id = excluded.prompt_verse_id, answer = excluded.answer,
         accept = excluded.accept, context_note = excluded.context_note,
         difficulty = excluded.difficulty, audience = excluded.audience, book = excluded.book,
         section = excluded.section, tags = excluded.tags, source = excluded.source,
         reviewed_by = excluded.reviewed_by`
    ).run({
      id: record.id,
      type: record.type,
      prompt: record.prompt,
      prompt_key: contentKey(record.prompt),
      prompt_verse_id: record.promptVerseId,
      answer: record.answer,
      accept: JSON.stringify(record.accept),
      context_note: record.contextNote,
      difficulty: record.difficulty,
      audience: record.audience,
      book: record.book,
      section: record.section,
      tags: JSON.stringify(record.tags),
      source: record.source,
      reviewed_by: record.reviewedBy,
      created_at: new Date().toISOString(),
    });

    this.prepared('DELETE FROM distractor WHERE question_id = ?').run(record.id);
    const insert = this.prepared(
      'INSERT INTO distractor (question_id, position, text) VALUES (?, ?, ?)'
    );
    record.distractors.forEach((text, position) => insert.run(record.id, position, text));

    this.prepared('DELETE FROM clue WHERE question_id = ?').run(record.id);
    const insertClue = this.prepared(
      'INSERT INTO clue (question_id, position, text, verse_id) VALUES (?, ?, ?, ?)'
    );
    record.clues.forEach((clue, position) =>
      insertClue.run(record.id, position, clue.text, clue.verseId)
    );
  }

  putQuestionSet(record: QuestionSetRecord): void {
    this.prepared(
      `INSERT INTO question_set (id, name, description, difficulty, audience, book, section, tags, created_at)
       VALUES (@id, @name, @description, @difficulty, @audience, @book, @section, @tags, @created_at)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name, description = excluded.description,
         difficulty = excluded.difficulty, audience = excluded.audience,
         book = excluded.book, section = excluded.section, tags = excluded.tags`
    ).run({
      id: record.id,
      name: record.name,
      description: record.description,
      difficulty: record.difficulty,
      audience: record.audience,
      book: record.book,
      section: record.section,
      tags: JSON.stringify(record.tags),
      created_at: new Date().toISOString(),
    });

    this.prepared('DELETE FROM question_set_member WHERE set_id = ?').run(record.id);
    const insert = this.prepared(
      'INSERT INTO question_set_member (set_id, question_id, position) VALUES (?, ?, ?)'
    );
    record.questionIds.forEach((questionId, position) => insert.run(record.id, questionId, position));
  }

  putOrderedList(record: OrderedListRecord): void {
    this.prepared(
      `INSERT INTO ordered_list (
         id, title, title_key, instructions, difficulty, audience, book, section, tags,
         source, reviewed_by, created_at
       ) VALUES (
         @id, @title, @title_key, @instructions, @difficulty, @audience, @book, @section, @tags,
         @source, @reviewed_by, @created_at
       )
       ON CONFLICT (id) DO UPDATE SET
         title = excluded.title, title_key = excluded.title_key,
         instructions = excluded.instructions, difficulty = excluded.difficulty,
         audience = excluded.audience, book = excluded.book, section = excluded.section,
         tags = excluded.tags, source = excluded.source, reviewed_by = excluded.reviewed_by`
    ).run({
      id: record.id,
      title: record.title,
      title_key: contentKey(record.title),
      instructions: record.instructions,
      difficulty: record.difficulty,
      audience: record.audience,
      book: record.book,
      section: record.section,
      tags: JSON.stringify(record.tags),
      source: record.source,
      reviewed_by: record.reviewedBy,
      created_at: new Date().toISOString(),
    });

    this.prepared('DELETE FROM ordered_item WHERE list_id = ?').run(record.id);
    const insert = this.prepared(
      'INSERT INTO ordered_item (list_id, position, label, verse_id, note) VALUES (?, ?, ?, ?, ?)'
    );
    record.items.forEach((item, position) =>
      insert.run(record.id, position, item.label, item.verseId, item.note)
    );
  }

  putPromptCard(record: PromptCardRecord): void {
    this.prepared(
      `INSERT INTO prompt_card (
         id, concept, concept_key, category, forbidden, difficulty, audience, book, section,
         tags, source, reviewed_by, created_at
       ) VALUES (
         @id, @concept, @concept_key, @category, @forbidden, @difficulty, @audience, @book, @section,
         @tags, @source, @reviewed_by, @created_at
       )
       ON CONFLICT (id) DO UPDATE SET
         concept = excluded.concept, concept_key = excluded.concept_key,
         category = excluded.category, forbidden = excluded.forbidden,
         difficulty = excluded.difficulty, audience = excluded.audience, book = excluded.book,
         section = excluded.section, tags = excluded.tags, source = excluded.source,
         reviewed_by = excluded.reviewed_by`
    ).run({
      id: record.id,
      concept: record.concept,
      concept_key: contentKey(record.concept),
      category: record.category,
      forbidden: JSON.stringify(record.forbidden),
      difficulty: record.difficulty,
      audience: record.audience,
      book: record.book,
      section: record.section,
      tags: JSON.stringify(record.tags),
      source: record.source,
      reviewed_by: record.reviewedBy,
      created_at: new Date().toISOString(),
    });
  }

  /**
   * Adds a verse to the pool, or re-tiers one already in it. The verse id is
   * the identity, so curating the same verse twice at two difficulties is a
   * correction rather than a duplicate — which is what a second pass over a
   * list is.
   */
  putCuratedVerse(record: CuratedVerseRecord): void {
    this.prepared(
      `INSERT INTO curated_verse (
         verse_id, difficulty, audience, book, section, tags, note, source, reviewed_by, created_at
       ) VALUES (
         @verse_id, @difficulty, @audience, @book, @section, @tags, @note, @source, @reviewed_by,
         @created_at
       )
       ON CONFLICT (verse_id) DO UPDATE SET
         difficulty = excluded.difficulty, audience = excluded.audience, book = excluded.book,
         section = excluded.section, tags = excluded.tags, note = excluded.note,
         source = excluded.source, reviewed_by = excluded.reviewed_by`
    ).run({
      verse_id: record.verseId,
      difficulty: record.difficulty,
      audience: record.audience,
      book: record.book,
      section: record.section,
      tags: JSON.stringify(record.tags),
      note: record.note,
      source: record.source,
      reviewed_by: record.reviewedBy,
      created_at: new Date().toISOString(),
    });
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  getQuestion(id: string): QuestionRecord | null {
    const row = this.prepared('SELECT * FROM question WHERE id = ?').get(id) as
      | QuestionRow
      | undefined;
    return row ? this.hydrateQuestion(row) : null;
  }

  /** The id of the question already holding this prompt, if any. */
  questionIdForPrompt(prompt: string): string | null {
    const row = this.prepared('SELECT id FROM question WHERE prompt_key = ?').get(
      contentKey(prompt)
    ) as IdRow | undefined;
    return row?.id ?? null;
  }

  promptCardIdForConcept(concept: string): string | null {
    const row = this.prepared('SELECT id FROM prompt_card WHERE concept_key = ?').get(
      contentKey(concept)
    ) as IdRow | undefined;
    return row?.id ?? null;
  }

  orderedListIdForTitle(title: string): string | null {
    const row = this.prepared('SELECT id FROM ordered_list WHERE title_key = ?').get(
      contentKey(title)
    ) as IdRow | undefined;
    return row?.id ?? null;
  }

  findQuestions(filter: QuestionFilter = {}): QuestionRecord[] {
    const where = filterClauses(filter, 'question');
    if (filter.type !== undefined) {
      where.sql.push('question.type = ?');
      where.params.push(filter.type);
    }

    let sql = 'SELECT question.* FROM question';
    if (filter.setId !== undefined) {
      // Membership order is the author's running order, so a host who built a
      // set gets it back in the order they built it.
      sql += ' JOIN question_set_member ON question_set_member.question_id = question.id';
      where.sql.unshift('question_set_member.set_id = ?');
      where.params.unshift(filter.setId);
    }
    if (where.sql.length > 0) sql += ` WHERE ${where.sql.join(' AND ')}`;
    sql += filter.setId !== undefined ? ' ORDER BY question_set_member.position' : ' ORDER BY question.id';

    const rows = this.prepared(sql).all(...where.params) as QuestionRow[];
    return rows.map((row) => this.hydrateQuestion(row));
  }

  /**
   * Questions for one game, already shuffled. `random` is the room's generator
   * so the same room replays the same questions in the same order.
   */
  drawQuestions(
    count: number,
    filter: QuestionFilter = {},
    random: () => number = Math.random
  ): QuestionRecord[] {
    return shuffle(this.findQuestions(filter), random).slice(0, count);
  }

  listQuestionSets(filter: ContentFilter = {}): QuestionSetRecord[] {
    const where = filterClauses(filter, 'question_set');
    let sql = 'SELECT id FROM question_set';
    if (where.sql.length > 0) sql += ` WHERE ${where.sql.join(' AND ')}`;
    sql += ' ORDER BY name';
    const rows = this.prepared(sql).all(...where.params) as IdRow[];
    return rows.flatMap((row) => {
      const set = this.getQuestionSet(row.id);
      return set ? [set] : [];
    });
  }

  getQuestionSet(id: string): QuestionSetRecord | null {
    const row = this.prepared('SELECT * FROM question_set WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    const members = this.prepared(
      'SELECT question_id AS id FROM question_set_member WHERE set_id = ? ORDER BY position'
    ).all(id) as IdRow[];
    return {
      id: String(row['id']),
      name: String(row['name']),
      description: (row['description'] as string | null) ?? null,
      difficulty: Number(row['difficulty']),
      audience: row['audience'] as Audience,
      book: (row['book'] as number | null) ?? null,
      section: (row['section'] as SectionName | null) ?? null,
      tags: parseStringArray(row['tags']),
      questionIds: members.map((member) => member.id),
    };
  }

  listOrderedLists(filter: ContentFilter = {}): OrderedListRecord[] {
    const where = filterClauses(filter, 'ordered_list');
    let sql = 'SELECT id FROM ordered_list';
    if (where.sql.length > 0) sql += ` WHERE ${where.sql.join(' AND ')}`;
    sql += ' ORDER BY title';
    const rows = this.prepared(sql).all(...where.params) as IdRow[];
    return rows.flatMap((row) => {
      const list = this.getOrderedList(row.id);
      return list ? [list] : [];
    });
  }

  getOrderedList(id: string): OrderedListRecord | null {
    const row = this.prepared('SELECT * FROM ordered_list WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    const items = this.prepared(
      'SELECT label, verse_id, note FROM ordered_item WHERE list_id = ? ORDER BY position'
    ).all(id) as { label: string; verse_id: number | null; note: string | null }[];
    return {
      id: String(row['id']),
      title: String(row['title']),
      instructions: (row['instructions'] as string | null) ?? null,
      difficulty: Number(row['difficulty']),
      audience: row['audience'] as Audience,
      book: (row['book'] as number | null) ?? null,
      section: (row['section'] as SectionName | null) ?? null,
      tags: parseStringArray(row['tags']),
      source: (row['source'] as string | null) ?? null,
      reviewedBy: (row['reviewed_by'] as string | null) ?? null,
      items: items.map((item) => ({ label: item.label, verseId: item.verse_id, note: item.note })),
    };
  }

  findPromptCards(filter: ContentFilter & { category?: string } = {}): PromptCardRecord[] {
    const where = filterClauses(filter, 'prompt_card');
    if (filter.category !== undefined) {
      where.sql.push('prompt_card.category = ?');
      where.params.push(filter.category);
    }
    let sql = 'SELECT * FROM prompt_card';
    if (where.sql.length > 0) sql += ` WHERE ${where.sql.join(' AND ')}`;
    sql += ' ORDER BY id';
    const rows = this.prepared(sql).all(...where.params) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row['id']),
      concept: String(row['concept']),
      category: String(row['category']),
      forbidden: parseStringArray(row['forbidden']),
      difficulty: Number(row['difficulty']),
      audience: row['audience'] as Audience,
      book: (row['book'] as number | null) ?? null,
      section: (row['section'] as SectionName | null) ?? null,
      tags: parseStringArray(row['tags']),
      source: (row['source'] as string | null) ?? null,
      reviewedBy: (row['reviewed_by'] as string | null) ?? null,
    }));
  }

  drawPromptCards(
    count: number,
    filter: ContentFilter & { category?: string } = {},
    random: () => number = Math.random
  ): PromptCardRecord[] {
    return shuffle(this.findPromptCards(filter), random).slice(0, count);
  }

  findCuratedVerses(filter: ContentFilter = {}): CuratedVerseRecord[] {
    const where = filterClauses(filter, 'curated_verse');
    let sql = 'SELECT * FROM curated_verse';
    if (where.sql.length > 0) sql += ` WHERE ${where.sql.join(' AND ')}`;
    sql += ' ORDER BY verse_id';
    const rows = this.prepared(sql).all(...where.params) as Record<string, unknown>[];
    return rows.map((row) => ({
      verseId: Number(row['verse_id']),
      difficulty: Number(row['difficulty']),
      audience: row['audience'] as Audience,
      book: Number(row['book']),
      section: row['section'] as SectionName,
      tags: parseStringArray(row['tags']),
      note: (row['note'] as string | null) ?? null,
      source: (row['source'] as string | null) ?? null,
      reviewedBy: (row['reviewed_by'] as string | null) ?? null,
    }));
  }

  /** How many verses a scope holds, which is how a caller knows to fall back. */
  curatedVerseCount(filter: ContentFilter = {}): number {
    const where = filterClauses(filter, 'curated_verse');
    let sql = 'SELECT COUNT(*) AS c FROM curated_verse';
    if (where.sql.length > 0) sql += ` WHERE ${where.sql.join(' AND ')}`;
    const row = this.prepared(sql).get(...where.params) as CountRow | undefined;
    return row?.c ?? 0;
  }

  /**
   * Distinct curated verses in a random order. The whole scope is read and
   * shuffled rather than sampled, because the pool is hundreds of rows and a
   * game asking for ten of them must not offer the same verse twice.
   */
  drawCuratedVerses(
    count: number,
    filter: ContentFilter = {},
    random: () => number = Math.random
  ): CuratedVerseRecord[] {
    return shuffle(this.findCuratedVerses(filter), random).slice(0, count);
  }

  close(): void {
    this.db.close();
  }

  private hydrateQuestion(row: QuestionRow): QuestionRecord {
    const distractors = this.prepared(
      'SELECT text FROM distractor WHERE question_id = ? ORDER BY position'
    ).all(row.id) as { text: string }[];
    const clues = this.prepared(
      'SELECT text, verse_id FROM clue WHERE question_id = ? ORDER BY position'
    ).all(row.id) as { text: string; verse_id: number | null }[];
    return {
      id: row.id,
      type: row.type as QuestionType,
      prompt: row.prompt,
      promptVerseId: row.prompt_verse_id,
      answer: row.answer,
      accept: parseStringArray(row.accept),
      contextNote: row.context_note,
      difficulty: row.difficulty,
      audience: row.audience as Audience,
      book: row.book,
      section: row.section as SectionName | null,
      tags: parseStringArray(row.tags),
      source: row.source,
      reviewedBy: row.reviewed_by,
      distractors: distractors.map((distractor) => distractor.text),
      clues: clues.map((clue) => ({ text: clue.text, verseId: clue.verse_id })),
    };
  }

  private prepared(sql: string): Statement {
    const existing = this.statements.get(sql);
    if (existing) return existing;
    const statement = this.db.prepare(sql);
    this.statements.set(sql, statement);
    return statement;
  }
}

interface BuiltClauses {
  sql: string[];
  params: unknown[];
}

/**
 * The filter shared by every authored table. The column names are identical
 * across them on purpose: one builder, one set of semantics, and a host's
 * "gospels, easy, children" means the same thing whichever kind of content it
 * is applied to.
 *
 * `table` is a constant chosen by the caller in this file, never anything a
 * user typed; the values it filters on are all bound.
 */
function filterClauses(filter: ContentFilter, table: string): BuiltClauses {
  const sql: string[] = [];
  const params: unknown[] = [];

  const books = filter.books ?? [];
  const sections = filter.sections ?? [];
  if (books.length > 0 || sections.length > 0) {
    const alternatives: string[] = [];
    if (books.length > 0) {
      alternatives.push(`${table}.book IN (${placeholders(books.length)})`);
      params.push(...books);
    }
    if (sections.length > 0) {
      alternatives.push(`${table}.section IN (${placeholders(sections.length)})`);
      params.push(...sections);
    }
    sql.push(`(${alternatives.join(' OR ')})`);
  }

  if (filter.minDifficulty !== undefined) {
    sql.push(`${table}.difficulty >= ?`);
    params.push(filter.minDifficulty);
  }
  if (filter.maxDifficulty !== undefined) {
    sql.push(`${table}.difficulty <= ?`);
    params.push(filter.maxDifficulty);
  }
  if (filter.audience !== undefined) {
    // Content pitched at everyone belongs in every audience's pool.
    sql.push(`(${table}.audience = ? OR ${table}.audience = ?)`);
    params.push(filter.audience, 'all');
  }
  if (filter.tag !== undefined) {
    sql.push(`EXISTS (SELECT 1 FROM json_each(${table}.tags) WHERE value = ?)`);
    params.push(filter.tag.toLowerCase());
  }

  return { sql, params };
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== 'string' || value.length === 0) return [];
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
}

/** Fisher-Yates over a copy, driven by the caller's generator. */
function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const held = copy[index] as T;
    copy[index] = copy[swap] as T;
    copy[swap] = held;
  }
  return copy;
}
