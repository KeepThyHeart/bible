/**
 * A small canon with the shapes that break reference arithmetic.
 *
 * No Bible module is installed in a checkout, and the interesting cases are not
 * the ordinary ones anyway. What this carries is chosen for the edges: a book
 * that is a whole section on its own, a book of a single chapter, a book at the
 * start of the canon and one at the end, and at least two books in most
 * sections so that a same-section option is reachable.
 *
 * It is written through the content layer's own fixture writer, so a module
 * built here is a module in exactly the sense the reader means.
 */

import { join } from 'node:path';
import { bookName, toVerseId } from '../../../../../src/modules/games/shared/verseId.js';
import { BibleModule } from '../../content/index.js';
import { makeTempDir, removeTempDir, writeFixtureModule } from '../../content/fixtures.js';
import type { FixtureVerse } from '../../content/fixtures.js';

export interface FixtureBook {
  book: number;
  chapters: number;
  versesPerChapter: number;
}

/**
 * Genesis opens the canon and Revelation closes it; Obadiah and Jude have one
 * chapter each, so neither has a rung of "elsewhere in the book"; Acts and
 * Revelation are each a section of one book, so neither has a rung of "another
 * book of this section".
 */
export const FIXTURE_CANON: readonly FixtureBook[] = [
  { book: 1, chapters: 3, versesPerChapter: 10 }, // Genesis, law
  { book: 5, chapters: 2, versesPerChapter: 6 }, // Deuteronomy, law
  { book: 19, chapters: 2, versesPerChapter: 8 }, // Psalms, wisdom
  { book: 23, chapters: 2, versesPerChapter: 6 }, // Isaiah, major prophets
  { book: 31, chapters: 1, versesPerChapter: 21 }, // Obadiah, minor prophets
  { book: 33, chapters: 2, versesPerChapter: 5 }, // Micah, minor prophets
  { book: 40, chapters: 2, versesPerChapter: 8 }, // Matthew, gospels
  { book: 43, chapters: 3, versesPerChapter: 10 }, // John, gospels
  { book: 44, chapters: 2, versesPerChapter: 6 }, // Acts, a section of one book
  { book: 45, chapters: 3, versesPerChapter: 8 }, // Romans, epistles
  { book: 65, chapters: 1, versesPerChapter: 25 }, // Jude, one chapter
  { book: 66, chapters: 2, versesPerChapter: 10 }, // Revelation, a section of one book
];

/** Long enough that a word-count filter never rejects a fixture verse. */
function lineFor(book: number, chapter: number, verse: number): string {
  return (
    `In this place the words of ${bookName(book)} stand written down ` +
    `for chapter ${chapter} and for verse ${verse}.`
  );
}

export function fixtureVerses(canon: readonly FixtureBook[] = FIXTURE_CANON): FixtureVerse[] {
  const verses: FixtureVerse[] = [];
  for (const entry of canon) {
    for (let chapter = 1; chapter <= entry.chapters; chapter += 1) {
      for (let verse = 1; verse <= entry.versesPerChapter; verse += 1) {
        verses.push({
          id: toVerseId(entry.book, chapter, verse),
          text: lineFor(entry.book, chapter, verse),
        });
      }
    }
  }
  return verses;
}

export interface OpenFixture {
  module: BibleModule;
  /** Closes the module and removes the file it was written to. */
  close(): void;
}

/** Writes a module and opens it. The caller closes it. */
export function openFixtureCanon(verses: readonly FixtureVerse[] = fixtureVerses()): OpenFixture {
  const directory = makeTempDir('name-that-reference-');
  const path = join(directory, 'fixture.db');
  writeFixtureModule(path, { abbreviation: 'FIX', verses });
  const opened = BibleModule.open(path);
  return {
    module: opened,
    close: () => {
      opened.close();
      removeTempDir(directory);
    },
  };
}
