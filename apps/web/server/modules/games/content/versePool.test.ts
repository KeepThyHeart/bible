import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ContentLibrary } from './index.js';
import { importContent } from './importer.js';
import { makeTempDir, removeTempDir, writeFixtureModule } from './fixtures.js';
import { SECTIONS, toVerseId } from '../../../../src/modules/games/shared/verseId.js';

/**
 * The curated verse pool.
 *
 * The thing being protected here is the reason the pool exists at all: a draw
 * from the whole canon is a draw from Job and the back half of Judges, which is
 * correct and no fun. So the tests are about which verses a room can be handed,
 * and about the three ways that can go wrong — an empty pool, a pool smaller
 * than the game, and a host who asked for the whole Bible on purpose.
 */

const GENESIS = toVerseId(1, 1, 1);
const PSALM = toVerseId(19, 117, 1);
const JOHN = toVerseId(43, 3, 16);
const REVELATION = toVerseId(66, 1, 1);

let directory: string;
let library: ContentLibrary;

/** A verse row as an author writes it, by reference rather than by id. */
function verseRow(reference: string, difficulty: number, tags = 'memory'): Record<string, unknown> {
  return { reference, difficulty, tags };
}

function importVerses(rows: Record<string, unknown>[]): ReturnType<typeof importContent> {
  return importContent(library.db, { verses: rows });
}

beforeEach(() => {
  directory = makeTempDir('verse-pool-');
  writeFixtureModule(join(directory, 'modules', 'fixture.db'), { abbreviation: 'FIX' });
  library = ContentLibrary.open({
    moduleDir: join(directory, 'modules'),
    contentPath: ':memory:',
    defaultTranslation: 'FIX',
  });
});

afterEach(() => {
  library.close();
  removeTempDir(directory);
});

describe('importing a pool', () => {
  it('reads references as people write them', () => {
    // Long name, short name, the punctuation people actually type. Anything
    // outside that — "Jn 3:16" — is rejected by name rather than guessed at.
    const report = importVerses([verseRow('Genesis 1:1', 1), verseRow('John 3:16', 2)]);

    expect(report.rejected).toEqual([]);
    expect(report.accepted.curatedVerses).toBe(2);
    expect(library.db.findCuratedVerses().map((verse) => verse.verseId)).toEqual([GENESIS, JOHN]);
  });

  it('derives the book and section rather than trusting a typed one', () => {
    importVerses([verseRow('John 3:16', 1)]);
    const [record] = library.db.findCuratedVerses();

    expect(record?.book).toBe(43);
    expect(record?.section).toBe('gospels');
    expect(SECTIONS.gospels[0]).toBeLessThanOrEqual(record?.book ?? 0);
  });

  it('rejects a reference it cannot read, by name', () => {
    const report = importVerses([verseRow('Hezekiah 3:16', 1), verseRow('Genesis 1:1', 1)]);

    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0]?.reason).toBe('unreadable-reference');
    expect(report.rejected[0]?.id).toBe('Hezekiah 3:16');
    // The good row still lands: one typo must not cost an author the file.
    expect(report.accepted.curatedVerses).toBe(1);
  });

  it('rejects the same verse twice in one file, because the two rows disagree', () => {
    const report = importVerses([verseRow('Genesis 1:1', 1), verseRow('Gen 1:1', 4)]);

    expect(report.rejected[0]?.reason).toBe('duplicate-verse');
    expect(report.accepted.curatedVerses).toBe(1);
  });

  it('re-tiers a verse on a second import rather than duplicating it', () => {
    importVerses([verseRow('Genesis 1:1', 1)]);
    importVerses([verseRow('Genesis 1:1', 4)]);

    const records = library.db.findCuratedVerses();
    expect(records).toHaveLength(1);
    expect(records[0]?.difficulty).toBe(4);
  });
});

describe('drawing at a familiarity', () => {
  beforeEach(() => {
    importVerses([
      verseRow('Genesis 1:1', 1),
      verseRow('John 3:16', 2),
      verseRow('Psalms 117:1', 4),
      verseRow('Revelation 1:1', 5),
    ]);
  });

  it('draws only the best-known tier for a room set to core', () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(library.drawVerse({ familiarity: 'core' })?.id).toBe(GENESIS);
    }
  });

  it('draws every tier up to the ceiling, not the ceiling alone', () => {
    const seen = new Set<number>();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const verse = library.drawVerse({ familiarity: 'familiar' });
      if (verse) seen.add(verse.id);
    }
    // A group that asked to go one step further still gets Genesis 1:1.
    expect(seen).toEqual(new Set([GENESIS, JOHN]));
  });

  it('reaches the deepest curated tier only when asked to', () => {
    const seen = new Set<number>();
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const verse = library.drawVerse({ familiarity: 'deep' });
      if (verse) seen.add(verse.id);
    }
    expect(seen.has(PSALM)).toBe(true);
    expect(seen.has(REVELATION)).toBe(true);
  });

  it('does not offer a verse the caller has already asked about', () => {
    const drawn = library.drawVerse({ familiarity: 'familiar', exclude: [GENESIS] });
    expect(drawn?.id).toBe(JOHN);
  });

  it('repeats a verse rather than leaving a round empty when the pool runs out', () => {
    // Sixty core verses and a twenty-round game is a real configuration, and
    // asking one of them twice beats an empty screen.
    const drawn = library.drawVerse({ familiarity: 'core', exclude: [GENESIS] });
    expect(drawn?.id).toBe(GENESIS);
  });

  it('honours a word floor by skipping pool verses the module renders too short', () => {
    importVerses([verseRow('John 11:35', 1)]);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      // "Jesus wept." is a fine verse and a hopeless question.
      expect(library.drawVerse({ familiarity: 'core', minWords: 8 })?.id).toBe(GENESIS);
    }
  });
});

describe('when the pool cannot answer', () => {
  it('draws from the whole canon for a host who chose exactly that', () => {
    importVerses([verseRow('Genesis 1:1', 1)]);
    const seen = new Set<number>();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const verse = library.drawVerse({ familiarity: 'any' });
      if (verse) seen.add(verse.id);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('draws from the whole canon when no content has been imported yet', () => {
    // A server whose content is not loaded still plays; it just plays worse.
    const seen = new Set<number>();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const verse = library.drawVerse({ familiarity: 'core' });
      if (verse) seen.add(verse.id);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('falls back for a scope the pool has nothing in, not for the pool as a whole', () => {
    importVerses([verseRow('John 3:16', 1)]);
    // Curated verses exist, but none in the law, so a room scoped to Genesis
    // gets the canon rather than the gospels it did not ask for.
    const verse = library.drawVerse({ familiarity: 'core', books: [1] });
    expect(verse?.id).not.toBe(JOHN);
    expect(verse?.id).toBeGreaterThan(1_000_000);
    expect(verse?.id).toBeLessThan(2_000_000);
  });

  it('returns nothing at all when there is no module to read from', () => {
    const empty = ContentLibrary.open({
      moduleDir: join(directory, 'no-modules'),
      contentPath: ':memory:',
      defaultTranslation: 'FIX',
    });
    expect(empty.drawVerse({ familiarity: 'core' })).toBeNull();
    empty.close();
  });
});
