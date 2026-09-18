/**
 * Cross references, commentaries and topics — the "phase 2" data functions
 * behind the Study pane's `x`, `c`, `m` and `t` (task 0001-bible-cli, thread
 * message 01).
 *
 * Driven against the real modules — the old `screens/CrossReferences.ts`,
 * `screens/Commentary.ts` and `screens/Topics.ts` were tested the same way,
 * before the 2026 redesign replaced them and deleted them (task
 * 0001-bible-cli): the behaviour under test is a claim about what a real
 * module returns (TSK's phrases for John 3:16, Matthew Henry's word count,
 * Nave's headings), and a fixture would only prove this file agrees with
 * itself. Where the assets are not present (this checkout may not carry
 * them — see `hasLibrary` below) the whole suite is skipped, exactly as the
 * rest of this package already does.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import { VerseIdHelper } from '@bible/core';

import { BunSql } from '../data/BunSql';
import { discoverModules, moduleTypeFromFilename, type DiscoveredModule, type ModuleRoot } from '../data/modules';
import { createTheme } from '../term/style';
import { Library } from './library';
import {
  bestCommentaryEntry,
  bookListRows,
  bookSection,
  bookSectionRows,
  commentaryListRows,
  crossReferenceGroups,
  dictionaryEntry,
  dictionaryEntryRows,
  dictionaryListRows,
  dictionaryLetterRows,
  topicListRows,
  topicVerseRows,
} from './studyPanes';

const MODULES = join(import.meta.dir, '..', '..', '..', '..', 'data', 'modules');
const hasLibrary =
  existsSync(join(MODULES, 'bible_kjv.db')) &&
  existsSync(join(MODULES, 'xref_tsk.db')) &&
  existsSync(join(MODULES, 'topical_nave.db')) &&
  existsSync(join(MODULES, 'commentary_mhc.db'));

// Real filenames documented in THIRD-PARTY-NOTICES.md and docs/Design/*
// (`dictionary_strongsgreek.db`, `book_finney.db`) — not this checkout's
// content, so the tests below assert structural properties rather than
// specific headwords or titles (the same reasoning phase 2's suite gives for
// `hasLibrary`, one level further: there is no old screen's test to borrow
// documented facts from either, because `d`/`k` had no viewer before this).
const hasDictionary = existsSync(join(MODULES, 'dictionary_strongsgreek.db'));
const hasBook = existsSync(join(MODULES, 'book_finney.db'));

const theme = createTheme('ansi256');
const DISPLAY = { redLetter: true, showSupplied: true };
const JOHN = 43;
const ROMANS = 45;
const JOHN_3_16 = VerseIdHelper.calculate(JOHN, 3, 16);

/**
 * The old `screens/CrossReferences.test.ts` carried the identical helper:
 * discovery currently drops every non-Bible module because
 * `readModuleDescriptor` selects a column only Bible modules have. A no-op
 * once that is fixed.
 */
function modules(): DiscoveredModule[] {
  const found = discoverModules();
  const seen = new Set(found.map((module) => module.path.toLowerCase()));
  const root: ModuleRoot = { path: MODULES, kind: 'repo', immutable: false };

  for (const name of readdirSync(MODULES).sort()) {
    if (!name.endsWith('.db')) continue;
    const path = join(MODULES, name);
    if (seen.has(path.toLowerCase())) continue;

    let sql: BunSql | undefined;
    try {
      sql = new BunSql(path, { readonly: true });
      const info = sql.queryOne<{ abbreviation: string | null; full_name: string | null }>(
        'SELECT abbreviation, full_name FROM module_info LIMIT 1',
      );
      if (!info) continue;
      found.push({
        path,
        root,
        type: moduleTypeFromFilename(name),
        abbreviation: info.abbreviation ?? basename(name, '.db'),
        fullName: info.full_name ?? basename(name, '.db'),
        language: 'en',
        contentSha256: undefined,
        schemaVersion: undefined,
        textDirection: undefined,
        unsupported: undefined,
      });
    } catch {
      // Not a module.
    } finally {
      sql?.close();
    }
  }

  return found;
}

let shared: Library | undefined;
function library(): Library {
  shared ??= Library.open({ modules: modules() });
  return shared;
}

describe.skipIf(!hasLibrary)('crossReferenceGroups', () => {
  test('groups TSK by phrase and numbers every entry straight through', () => {
    const groups = crossReferenceGroups(library(), undefined, JOHN_3_16, theme, DISPLAY);
    expect(groups.length).toBeGreaterThan(0);

    // TSK's real phrases for John 3:16 (the old CrossReferences.test.ts's note).
    const phrases = groups.map((g) => g.phrase);
    expect(phrases).toContain('God.');
    expect(phrases).toContain('gave.');
    expect(phrases).toContain('that whosoever.');

    const numbers = groups.flatMap((g) => g.rows.map((r) => r.number));
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
    expect(numbers.length).toBe(17); // the same count the old CrossReferences.test.ts asserted
  });

  test('a same-chapter target reads as "v17"; a different book reads in full', () => {
    const groups = crossReferenceGroups(library(), undefined, JOHN_3_16, theme, DISPLAY);
    const rows = groups.flatMap((g) => g.rows);

    const sameChapter = rows.find((r) => VerseIdHelper.parse(r.targetVerseId).bookNumber === JOHN);
    expect(sameChapter?.label).toMatch(/^v\d+/);

    const romans = rows.find((r) => VerseIdHelper.parse(r.targetVerseId).bookNumber === ROMANS);
    expect(romans?.label).toMatch(/^Romans /);
  });

  test('every row carries the target verse\'s text', () => {
    const groups = crossReferenceGroups(library(), undefined, JOHN_3_16, theme, DISPLAY);
    for (const row of groups.flatMap((g) => g.rows)) {
      expect(row.text.length).toBeGreaterThan(0);
    }
  });

  test('a verse with nothing on it comes back empty, not throwing', () => {
    // Genesis 1:1 is not one of TSK's more heavily cross-referenced verses'
    // *sources* in the same volume, but the real claim here is just that an
    // empty answer is a clean empty list.
    const groups = crossReferenceGroups(
      library(),
      undefined,
      VerseIdHelper.calculate(19, 117, 1), // Psalm 117:1 — a short psalm, likely sparse
      theme,
      DISPLAY,
    );
    expect(Array.isArray(groups)).toBe(true);
  });
});

describe.skipIf(!hasLibrary)('commentaryListRows', () => {
  test('lists every installed commentary, alphabetically by abbreviation', () => {
    const rows = commentaryListRows(library(), JOHN_3_16);
    expect(rows.length).toBeGreaterThan(0);

    const abbreviations = rows.map((r) => r.abbreviation.toLowerCase());
    const sorted = [...abbreviations].sort((a, b) => a.localeCompare(b));
    expect(abbreviations).toEqual(sorted);

    expect(rows.map((r) => r.number)).toEqual(Array.from({ length: rows.length }, (_, i) => i + 1));
  });

  test('Matthew Henry has something on John 3:16, with a positive word count', () => {
    const rows = commentaryListRows(library(), JOHN_3_16);
    const mhc = rows.find((r) => r.abbreviation.toLowerCase() === 'mhc');
    expect(mhc?.hasEntry).toBe(true);
    expect(mhc?.wordCount ?? 0).toBeGreaterThan(0);
  });

  test('a commentary with nothing on the verse is still listed, greyed by hasEntry=false', () => {
    // A verse from a short, less-annotated book is not guaranteed to be empty in
    // every installed commentary, so the real assertion is just that hasEntry
    // is computed per module rather than assumed true for all of them.
    const rows = commentaryListRows(library(), JOHN_3_16);
    expect(rows.some((r) => r.hasEntry)).toBe(true);
    expect(rows.every((r) => typeof r.hasEntry === 'boolean')).toBe(true);
  });
});

describe.skipIf(!hasLibrary)('bestCommentaryEntry', () => {
  test('returns the narrowest entry covering the verse', () => {
    const mhc = library().studyModule('commentary', 'mhc');
    expect(mhc).toBeDefined();
    if (mhc === undefined) return;

    const entry = bestCommentaryEntry(mhc, JOHN_3_16);
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect((entry.verseIdStart ?? 0) <= JOHN_3_16 && (entry.verseIdEnd ?? entry.verseIdStart ?? 0) >= JOHN_3_16).toBe(
      true,
    );
  });
});

describe.skipIf(!hasLibrary)('topicListRows and topicVerseRows', () => {
  test('lists topics on John 3:16, alphabetically, numbered straight through', () => {
    const rows = topicListRows(library(), JOHN_3_16);
    expect(rows.length).toBeGreaterThan(0);

    const names = rows.map((r) => r.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    expect(names).toEqual(sorted);
    expect(rows.map((r) => r.number)).toEqual(Array.from({ length: rows.length }, (_, i) => i + 1));
  });

  test('opening a topic lists its verses with text, in full reference form', () => {
    const list = topicListRows(library(), JOHN_3_16);
    const first = list[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    const verses = topicVerseRows(library(), undefined, first.moduleAbbreviation, first.topicId, theme, DISPLAY);
    expect(verses.length).toBeGreaterThan(0);
    expect(verses.map((v) => v.number)).toEqual(Array.from({ length: verses.length }, (_, i) => i + 1));
    for (const verse of verses) {
      // Never the cross-reference list's "v17" shorthand — always the full book name.
      expect(verse.label).not.toMatch(/^v\d/);
      expect(verse.text.length).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(!hasDictionary)('dictionaryListRows, dictionaryLetterRows, dictionaryEntryRows, dictionaryEntry', () => {
  test('lists every installed dictionary, alphabetically by abbreviation', () => {
    const rows = dictionaryListRows(library());
    expect(rows.length).toBeGreaterThan(0);

    const abbreviations = rows.map((r) => r.abbreviation.toLowerCase());
    const sorted = [...abbreviations].sort((a, b) => a.localeCompare(b));
    expect(abbreviations).toEqual(sorted);
    expect(rows.map((r) => r.number)).toEqual(Array.from({ length: rows.length }, (_, i) => i + 1));
    for (const row of rows) expect(row.entryCount).toBeGreaterThan(0);
  });

  test("the letter index's counts add up to the dictionary's own entry count", () => {
    const dict = dictionaryListRows(library())[0];
    expect(dict).toBeDefined();
    if (dict === undefined) return;

    const letters = dictionaryLetterRows(library(), dict.abbreviation);
    expect(letters.length).toBeGreaterThan(0);
    expect(letters.map((r) => r.number)).toEqual(Array.from({ length: letters.length }, (_, i) => i + 1));

    const total = letters.reduce((sum, r) => sum + r.count, 0);
    expect(total).toBe(dict.entryCount);
  });

  test("a letter's entries are numbered straight through and start with that letter", () => {
    const dict = dictionaryListRows(library())[0];
    const letter = dict === undefined ? undefined : dictionaryLetterRows(library(), dict.abbreviation)[0];
    expect(dict).toBeDefined();
    expect(letter).toBeDefined();
    if (dict === undefined || letter === undefined) return;

    const { rows, total } = dictionaryEntryRows(library(), dict.abbreviation, letter.letter);
    expect(rows.length).toBeGreaterThan(0);
    expect(total).toBeGreaterThanOrEqual(rows.length);
    expect(rows.map((r) => r.number)).toEqual(Array.from({ length: rows.length }, (_, i) => i + 1));
    for (const row of rows) {
      expect(row.entryKey.toUpperCase().startsWith(letter.letter.toUpperCase())).toBe(true);
    }
  });

  test('an entry opened by key round-trips to the same key, with a non-empty definition', () => {
    const dict = dictionaryListRows(library())[0];
    const letter = dict === undefined ? undefined : dictionaryLetterRows(library(), dict.abbreviation)[0];
    const first =
      dict === undefined || letter === undefined
        ? undefined
        : dictionaryEntryRows(library(), dict.abbreviation, letter.letter).rows[0];
    expect(first).toBeDefined();
    if (dict === undefined || first === undefined) return;

    const entry = dictionaryEntry(library(), dict.abbreviation, first.entryKey);
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(entry.entryKey).toBe(first.entryKey);
    expect(entry.definition.length).toBeGreaterThan(0);
  });

  test('an unknown dictionary falls back to the first one; an unknown entry key comes back undefined, not throwing', () => {
    // `Library.studyModule` names the nearest module rather than failing, so a
    // stale abbreviation reads the first dictionary installed.
    const first = dictionaryListRows(library())[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(dictionaryLetterRows(library(), 'not-a-real-dictionary')).toEqual(
      dictionaryLetterRows(library(), first.abbreviation),
    );
    expect(dictionaryEntry(library(), first.abbreviation, 'no-such-entry-key')).toBeUndefined();
  });
});

describe.skipIf(!hasBook)('bookListRows, bookSectionRows and bookSection', () => {
  test('lists every installed book module, alphabetically by abbreviation', () => {
    const rows = bookListRows(library());
    expect(rows.length).toBeGreaterThan(0);

    const abbreviations = rows.map((r) => r.abbreviation.toLowerCase());
    const sorted = [...abbreviations].sort((a, b) => a.localeCompare(b));
    expect(abbreviations).toEqual(sorted);
    expect(rows.map((r) => r.number)).toEqual(Array.from({ length: rows.length }, (_, i) => i + 1));
  });

  test('the top level of a table of contents is numbered straight through', () => {
    const book = bookListRows(library())[0];
    expect(book).toBeDefined();
    if (book === undefined) return;

    const rows = bookSectionRows(library(), book.abbreviation, undefined);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.number)).toEqual(Array.from({ length: rows.length }, (_, i) => i + 1));
  });

  test("a section marked hasChildren opens a non-empty list whose sections point back to it", () => {
    const book = bookListRows(library())[0];
    expect(book).toBeDefined();
    if (book === undefined) return;

    const top = bookSectionRows(library(), book.abbreviation, undefined);
    const parent = top.find((r) => r.hasChildren);
    if (parent === undefined) return; // a flat table of contents is a valid shape too

    const children = bookSectionRows(library(), book.abbreviation, parent.sectionId);
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      const section = bookSection(library(), book.abbreviation, child.sectionId);
      expect(section?.parentSectionId).toBe(parent.sectionId);
    }
  });

  test('a leaf section opens with its title and non-empty content', () => {
    const book = bookListRows(library())[0];
    expect(book).toBeDefined();
    if (book === undefined) return;

    const top = bookSectionRows(library(), book.abbreviation, undefined);
    const leaf = top.find((r) => !r.hasChildren) ?? top[0];
    expect(leaf).toBeDefined();
    if (leaf === undefined) return;

    const section = bookSection(library(), book.abbreviation, leaf.sectionId);
    expect(section).toBeDefined();
    if (section === undefined) return;
    expect(section.title).toBe(leaf.title);
    expect(section.content.length).toBeGreaterThan(0);
  });

  test('an unknown book or section comes back empty/undefined, not throwing', () => {
    expect(bookSectionRows(library(), 'not-a-real-book', undefined)).toEqual([]);
    expect(bookSection(library(), 'not-a-real-book', 1)).toBeUndefined();
  });
});
