/**
 * The distractor draw, which is the part of this game that can be wrong in a
 * way nobody notices: an option nobody could have chosen because the book has
 * no such chapter, or a "hard" question whose wrong answers are three books
 * away. Both are silent on the screen, so they are loud here.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BOOK_COUNT,
  bookName,
  formatRef,
  fromVerseId,
  isOldTestament,
  sectionOf,
  toVerseId,
} from '../../../../../src/modules/games/shared/verseId.js';
import type { VerseId } from '../../../../../src/modules/games/shared/verseId.js';
import type { Verse, VerseFilter } from '../../content/index.js';
import type { BibleModule } from '../../content/index.js';
import { DISTANCES, booksAtDistance, drawDistractors, ladderFrom } from './distractors.js';
import type { Distance, VerseSource } from './distractors.js';
import { FIXTURE_CANON, openFixtureCanon } from './fixtureCanon.js';
import type { OpenFixture } from './fixtureCanon.js';

/** A generator a test can replay. Nothing here may reach for `Math.random`. */
function seeded(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

let fixture: OpenFixture;
let canon: BibleModule;

beforeAll(() => {
  fixture = openFixtureCanon();
  canon = fixture.module;
});

afterAll(() => {
  fixture.close();
});

function draw(answer: VerseId, wanted: readonly Distance[], seed = 7) {
  return drawDistractors({ source: canon, answer, wanted, random: seeded(seed) });
}

/** Every verse the fixture carries, so a test can sweep the whole canon it has. */
function everyFixtureVerse(): VerseId[] {
  const ids: VerseId[] = [];
  for (const entry of FIXTURE_CANON) {
    for (let chapter = 1; chapter <= entry.chapters; chapter += 1) {
      for (let verse = 1; verse <= entry.versesPerChapter; verse += 1) {
        ids.push(toVerseId(entry.book, chapter, verse));
      }
    }
  }
  return ids;
}

describe('the rungs', () => {
  it('walks outward from a rung and then back inward', () => {
    expect(ladderFrom('section')).toEqual(['section', 'testament', 'anywhere', 'book', 'chapter']);
    expect(ladderFrom('chapter')).toEqual(DISTANCES);
    expect(ladderFrom('anywhere')).toEqual([
      'anywhere',
      'testament',
      'section',
      'book',
      'chapter',
    ]);
  });

  it('covers the whole canon exactly once, for every book', () => {
    for (let book = 1; book <= BOOK_COUNT; book += 1) {
      const section = booksAtDistance('section', book);
      const testament = booksAtDistance('testament', book);
      const anywhere = booksAtDistance('anywhere', book);
      const all = [book, ...section, ...testament, ...anywhere];

      expect(new Set(all).size, `${bookName(book)} has an overlapping rung`).toBe(all.length);
      expect(all.length, `${bookName(book)} does not reach the whole canon`).toBe(BOOK_COUNT);
    }
  });

  it('leaves no same-section rung for a book that is its own section', () => {
    expect(booksAtDistance('section', 44)).toEqual([]);
    expect(booksAtDistance('section', 66)).toEqual([]);
  });

  it('puts the far rung in the other testament, both ways round', () => {
    for (const book of booksAtDistance('anywhere', 1)) {
      expect(isOldTestament(book)).toBe(false);
    }
    for (const book of booksAtDistance('anywhere', 66)) {
      expect(isOldTestament(book)).toBe(true);
    }
  });

  it('says nothing about a book outside the canon rather than guessing', () => {
    // `sectionOf` answers for any number it is given, so a book number from a
    // different versification must not quietly become part of the law.
    expect(booksAtDistance('section', 70)).toEqual([]);
    expect(booksAtDistance('anywhere', 0)).toEqual([]);
    expect(draw(toVerseId(70, 1, 1), ['section', 'chapter'])).toEqual([]);
  });
});

describe('where a distractor comes from', () => {
  it('draws a near option from the same chapter', () => {
    const [near] = draw(toVerseId(43, 3, 4), ['chapter']);

    expect(near?.distance).toBe('chapter');
    const ref = fromVerseId(near?.id ?? 0);
    expect(ref.book).toBe(43);
    expect(ref.chapter).toBe(3);
    expect(ref.verse).not.toBe(4);
  });

  it('draws a book option from another chapter of the same book', () => {
    const [option] = draw(toVerseId(43, 3, 4), ['book']);

    expect(option?.distance).toBe('book');
    const ref = fromVerseId(option?.id ?? 0);
    expect(ref.book).toBe(43);
    expect(ref.chapter).not.toBe(3);
  });

  it('draws a section option from a different book of the same section', () => {
    const [option] = draw(toVerseId(43, 3, 4), ['section']);

    expect(option?.distance).toBe('section');
    const ref = fromVerseId(option?.id ?? 0);
    expect(ref.book).not.toBe(43);
    expect(sectionOf(ref.book)).toBe('gospels');
  });

  it('draws a testament option from another section of the same testament', () => {
    const [option] = draw(toVerseId(43, 3, 4), ['testament']);

    expect(option?.distance).toBe('testament');
    const ref = fromVerseId(option?.id ?? 0);
    expect(isOldTestament(ref.book)).toBe(false);
    expect(sectionOf(ref.book)).not.toBe('gospels');
  });

  it('draws a far option from the other testament', () => {
    const [option] = draw(toVerseId(43, 3, 4), ['anywhere']);

    expect(option?.distance).toBe('anywhere');
    expect(isOldTestament(fromVerseId(option?.id ?? 0).book)).toBe(true);
  });
});

describe('the guarantees that hold for every verse', () => {
  const mixes: Distance[][] = [
    ['chapter', 'chapter', 'book'],
    ['chapter', 'book', 'section'],
    ['section', 'testament', 'anywhere'],
  ];

  it('never offers a reference the module does not carry', () => {
    for (const answer of everyFixtureVerse()) {
      for (const [index, mix] of mixes.entries()) {
        for (const option of draw(answer, mix, index + 1)) {
          expect(
            canon.verse(option.id),
            `${formatRef(option.id)} was offered against ${formatRef(answer)}`
          ).not.toBeNull();
        }
      }
    }
  });

  it('never offers the true reference back, and never repeats one', () => {
    for (const answer of everyFixtureVerse()) {
      for (const [index, mix] of mixes.entries()) {
        const ids = draw(answer, mix, index + 11).map((option) => option.id);

        expect(ids).not.toContain(answer);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it('fills every asked-for option wherever the canon is wide enough', () => {
    for (const answer of everyFixtureVerse()) {
      for (const mix of mixes) {
        expect(draw(answer, mix).length, formatRef(answer)).toBe(mix.length);
      }
    }
  });

  it('replays exactly, given the same generator', () => {
    const answer = toVerseId(19, 2, 3);

    expect(draw(answer, mixes[1] as Distance[], 99)).toEqual(
      draw(answer, mixes[1] as Distance[], 99)
    );
  });
});

describe('the awkward books', () => {
  it('steps outward from a book with only one chapter', () => {
    // Jude has no second chapter, so "elsewhere in this book" does not exist.
    const [option] = draw(toVerseId(65, 1, 4), ['book']);

    expect(option?.distance).not.toBe('book');
    expect(fromVerseId(option?.id ?? 0).book).not.toBe(65);
  });

  it('steps outward from a book that is a section on its own', () => {
    const [option] = draw(toVerseId(44, 1, 2), ['section']);

    expect(option?.distance).toBe('testament');
    expect(fromVerseId(option?.id ?? 0).book).not.toBe(44);
  });

  it('handles the first book of the canon and the last', () => {
    for (const answer of [toVerseId(1, 1, 1), toVerseId(66, 2, 10)]) {
      const options = draw(answer, ['chapter', 'book', 'section']);

      expect(options).toHaveLength(3);
      expect(options.map((option) => option.id)).not.toContain(answer);
    }
  });

  it('gives back what it can when a rung holds a single verse', () => {
    const oneChapter = openFixtureCanon([
      { id: toVerseId(65, 1, 1), text: 'the first of two verses in the whole of this module' },
      { id: toVerseId(65, 1, 2), text: 'the second of two verses in the whole of this module' },
    ]);

    const options = drawDistractors({
      source: oneChapter.module,
      answer: toVerseId(65, 1, 1),
      wanted: ['chapter', 'chapter', 'chapter'],
      random: seeded(3),
    });
    oneChapter.close();

    expect(options.map((option) => option.id)).toEqual([toVerseId(65, 1, 2)]);
  });
});

describe('what the draw asks of a module', () => {
  it('reads a book once however many options come out of it', () => {
    const reads: string[] = [];
    const counting: VerseSource = {
      chapter: (book, chapter) => {
        reads.push(`chapter ${book}:${chapter}`);
        return canon.chapter(book, chapter);
      },
      range: (first, last) => {
        reads.push(`range ${first}-${last}`);
        return canon.range(first, last);
      },
      randomVerse: (filter: VerseFilter, random: () => number): Verse | null =>
        canon.randomVerse(filter, random),
    };

    drawDistractors({
      source: counting,
      answer: toVerseId(1, 1, 1),
      wanted: ['chapter', 'chapter', 'book', 'book'],
      random: seeded(5),
    });

    expect(reads.filter((read) => read.startsWith('chapter'))).toHaveLength(1);
    expect(reads.filter((read) => read.startsWith('range'))).toHaveLength(1);
  });
});
