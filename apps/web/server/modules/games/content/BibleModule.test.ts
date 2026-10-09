import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BibleModule, ModuleFormatError } from './BibleModule.js';
import { SAMPLE_VERSES, makeTempDir, removeTempDir, writeFixtureModule } from './fixtures.js';
import { toVerseId } from '../../../../src/modules/games/shared/verseId.js';

let directory: string;
let modulePath: string;
let module: BibleModule;

beforeAll(() => {
  directory = makeTempDir('bible-module-');
  modulePath = join(directory, 'fixture.db');
  // The apparatus is the interesting part: a module gains tables over time and
  // that must not be visible to a game.
  writeFixtureModule(modulePath, { abbreviation: 'FIX', extraTable: true });
  module = BibleModule.open(modulePath);
});

afterAll(() => {
  module.close();
  removeTempDir(directory);
  expect(existsSync(directory)).toBe(false);
});

describe('reading a module', () => {
  it('reads its identity from the file rather than the filename', () => {
    expect(module.info.abbreviation).toBe('FIX');
    expect(module.info.fullName).toBe('Fixture Version');
    expect(module.info.canon).toBe('protestant-66');
    expect(module.info.versification).toBe('kjv-english');
  });

  it('ignores tables it knows nothing about', () => {
    expect(module.verseCount()).toBe(SAMPLE_VERSES.length);
    expect(module.verse(toVerseId(43, 3, 16))?.text).toContain('For God so loved');
  });

  it('returns null for a verse the module does not carry', () => {
    expect(module.verse(toVerseId(2, 40, 38))).toBeNull();
  });

  it('reads a chapter in canonical order', () => {
    const genesis = module.chapter(1, 1);
    expect(genesis.map((verse) => verse.id)).toEqual([
      toVerseId(1, 1, 1),
      toVerseId(1, 1, 2),
      toVerseId(1, 1, 3),
    ]);
  });

  it('skips ids it does not carry rather than returning holes', () => {
    const found = module.verses([toVerseId(1, 1, 1), toVerseId(5, 6, 4), toVerseId(66, 1, 1)]);
    expect(found.map((verse) => verse.id)).toEqual([toVerseId(1, 1, 1), toVerseId(66, 1, 1)]);
  });

  it('counts word counts the writer computed', () => {
    expect(module.verse(toVerseId(43, 11, 35))?.wordCount).toBe(2);
  });
});

describe('filtering', () => {
  it('narrows to named books', () => {
    expect(module.verseCount({ books: [1] })).toBe(3);
  });

  it('narrows to a section', () => {
    expect(module.verseCount({ sections: ['gospels'] })).toBe(2);
  });

  it('unions books and sections, counting a verse in both only once', () => {
    expect(module.verseCount({ books: [43], sections: ['gospels'] })).toBe(2);
  });

  it('collapses adjacent books into one range', () => {
    // Genesis and Revelation are not adjacent, so this is two ranges; the
    // answer must still be the sum of the two.
    expect(module.verseCount({ books: [1, 66] })).toBe(4);
  });

  it('keeps short verses out of a draw that needs words', () => {
    const gospels = module.verseCount({ sections: ['gospels'], minWords: 5 });
    expect(gospels).toBe(1);
  });

  it('counts nothing for a filter no verse satisfies', () => {
    expect(module.verseCount({ books: [30] })).toBe(0);
    expect(module.randomVerse({ books: [30] })).toBeNull();
  });
});

describe('drawing', () => {
  it('draws from the caller’s generator, so a replay draws the same verse', () => {
    const fixed = (): number => 0.5;
    const first = module.randomVerse({}, fixed);
    const second = module.randomVerse({}, fixed);
    expect(first?.id).toBe(second?.id);
  });

  it('never indexes off the end when the generator returns one', () => {
    const verse = module.randomVerse({}, () => 1);
    expect(verse).not.toBeNull();
  });

  it('draws distinct verses', () => {
    const drawn = module.randomVerses(4, {}, Math.random);
    expect(drawn).toHaveLength(4);
    expect(new Set(drawn.map((verse) => verse.id)).size).toBe(4);
  });

  it('returns everything it has when asked for more than exists', () => {
    const drawn = module.randomVerses(50, { books: [1] });
    expect(drawn).toHaveLength(3);
  });
});

describe('refusing what is not a module', () => {
  it('names the missing table', () => {
    const path = join(directory, 'no-verses.db');
    writeFixtureModule(path, { omitVerseTable: true });
    expect(() => BibleModule.open(path)).toThrow(ModuleFormatError);
    expect(() => BibleModule.open(path)).toThrow(/bible_verse/);
  });

  it('refuses a module with no metadata row', () => {
    const path = join(directory, 'no-info.db');
    writeFixtureModule(path, { omitInfoRow: true });
    expect(() => BibleModule.open(path)).toThrow(/module_info is empty/);
  });

  it('refuses a dictionary, which shares the envelope but has no verses to play', () => {
    const path = join(directory, 'dictionary.db');
    writeFixtureModule(path, { moduleType: 'dictionary' });
    expect(() => BibleModule.open(path)).toThrow(/not bible/);
  });

  it('refuses a module that will not say what it is', () => {
    const path = join(directory, 'nameless.db');
    // An abbreviation is how a host names a translation, so a blank one is as
    // unusable as a missing column.
    writeFixtureModule(path, { abbreviation: '' });
    expect(() => BibleModule.open(path)).toThrow(/no abbreviation/);
  });

  it('refuses a file that is not a database at all', () => {
    expect(() => BibleModule.open(join(directory, 'absent.db'))).toThrow();
  });

  it('hands the file back when it refuses one', () => {
    const notADatabase = join(directory, 'README.txt');
    writeFileSync(notADatabase, 'modules go here');
    const dictionary = join(directory, 'refused.db');
    writeFixtureModule(dictionary, { moduleType: 'dictionary' });

    expect(() => BibleModule.open(notADatabase)).toThrow();
    expect(() => BibleModule.open(dictionary)).toThrow();

    // A held handle shows up as a file that cannot be deleted, which is what a
    // scan of a modules directory full of odds and ends would leave behind.
    rmSync(notADatabase);
    rmSync(dictionary);
    expect(existsSync(notADatabase)).toBe(false);
  });
});
