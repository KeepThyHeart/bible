/**
 * Building a Bible module from scratch.
 *
 * A real module is 50 MB of somebody else's data and cannot be committed, so
 * the reader is exercised against modules written here instead: a handful of
 * verses, the same two tables a real one carries, and — because that is the
 * case most likely to break — the option of extra apparatus the games are
 * supposed to ignore.
 *
 * This lives beside the reader rather than inside a test file because writing
 * a module is the reader's format knowledge spelled out the other way round.
 * If the two ever disagree, one of them is wrong about the format.
 */

import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { toVerseId } from '../../../../src/modules/games/shared/verseId.js';
import type { VerseId } from '../../../../src/modules/games/shared/verseId.js';

export interface FixtureVerse {
  id: VerseId;
  text: string;
  /** Left to be counted from the text when absent, as a real module does. */
  wordCount?: number | null;
}

export interface FixtureModuleOptions {
  abbreviation?: string;
  fullName?: string;
  /** A dictionary or commentary module shares the envelope but has no verses. */
  moduleType?: string | null;
  verses?: readonly FixtureVerse[];
  /**
   * Adds a table the games know nothing about. Real modules are full of them —
   * interlinear words, full-text indexes — and a module that gains one must
   * keep working.
   */
  extraTable?: boolean;
  /** Writes the tables but leaves `module_info` empty. */
  omitInfoRow?: boolean;
  /** Writes `module_info` but no `bible_verse` table at all. */
  omitVerseTable?: boolean;
}

/** Enough of John 3 and Genesis 1 to filter, count and draw from. */
export const SAMPLE_VERSES: readonly FixtureVerse[] = [
  { id: toVerseId(1, 1, 1), text: 'In the beginning God created the heaven and the earth.' },
  {
    id: toVerseId(1, 1, 2),
    text: 'And the earth was without form, and void; and darkness was upon the face of the deep.',
  },
  { id: toVerseId(1, 1, 3), text: 'And God said, Let there be light: and there was light.' },
  { id: toVerseId(19, 117, 1), text: 'O praise the LORD, all ye nations: praise him, all ye people.' },
  { id: toVerseId(43, 3, 16), text: 'For God so loved the world, that he gave his only begotten Son.' },
  { id: toVerseId(43, 11, 35), text: 'Jesus wept.' },
  { id: toVerseId(66, 1, 1), text: 'The Revelation of Jesus Christ, which God gave unto him.' },
];

function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

/** Writes a module file at `path`, replacing anything already there. */
export function writeFixtureModule(path: string, options: FixtureModuleOptions = {}): void {
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { force: true });

  const db = new Database(path);
  db.exec(`
    CREATE TABLE module_info (
      info_id       INTEGER PRIMARY KEY,
      module_type   TEXT,
      abbreviation  TEXT,
      full_name     TEXT,
      language_code TEXT,
      copyright     TEXT,
      license_spdx  TEXT,
      license_url   TEXT,
      canon         TEXT,
      versification TEXT
    );
  `);

  if (options.omitVerseTable !== true) {
    db.exec(`
      CREATE TABLE bible_verse (
        verse_id   INTEGER PRIMARY KEY,
        text       TEXT NOT NULL,
        formatting TEXT,
        word_count INTEGER,
        metadata   TEXT
      );
    `);
    const insert = db.prepare(
      'INSERT INTO bible_verse (verse_id, text, word_count) VALUES (?, ?, ?)'
    );
    for (const verse of options.verses ?? SAMPLE_VERSES) {
      insert.run(verse.id, verse.text, verse.wordCount ?? countWords(verse.text));
    }
  }

  if (options.omitInfoRow !== true) {
    db.prepare(
      `INSERT INTO module_info (
         info_id, module_type, abbreviation, full_name, language_code,
         copyright, license_spdx, license_url, canon, versification
       ) VALUES (1, ?, ?, ?, 'en', 'Public domain', 'CC0-1.0', null, 'protestant-66', 'kjv-english')`
    ).run(
      options.moduleType === undefined ? 'bible' : options.moduleType,
      options.abbreviation ?? 'FIX',
      options.fullName ?? 'Fixture Version'
    );
  }

  if (options.extraTable === true) {
    db.exec(`
      CREATE TABLE interlinear_word (
        word_id  INTEGER PRIMARY KEY,
        verse_id INTEGER NOT NULL,
        strongs  TEXT
      );
      INSERT INTO interlinear_word (word_id, verse_id, strongs) VALUES (1, 43003016, 'G2316');
    `);
  }

  db.close();
}

/** A directory of the caller's own, to be removed with `removeTempDir`. */
export function makeTempDir(prefix = 'bible-games-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeTempDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
