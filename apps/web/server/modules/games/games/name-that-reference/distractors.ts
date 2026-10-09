/**
 * Wrong references that sit a chosen distance from the right one.
 *
 * This is the whole difficulty knob of the game. "Genesis 1:2" offered against
 * "Genesis 1:1" is a different question from "Revelation 4:11" offered against
 * it, and the difference is not the verse — it is how far the wrong options
 * were drawn from the true one. Naming that distance makes hard and easy a
 * setting rather than an accident of whatever the generator happened to pick.
 *
 * The rungs partition the canon: each one is exactly the verses at that
 * distance and none of the verses nearer in. So a `section` distractor is
 * always a different book of the same section, and `anywhere` — everything
 * that is not already covered by a nearer rung — always lands in the other
 * testament. A rung that overlapped its neighbour would quietly make a hard
 * question easy, which is the failure this shape rules out.
 *
 * Two properties matter more than the mix:
 *
 * - every distractor is a verse the module actually carries, so a chapter or
 *   verse number a book does not have can never be offered;
 * - a distractor is never the true answer and never a repeat.
 *
 * When a rung is empty — a one-chapter book has no `book` rung, Acts and
 * Revelation are sections of one book so they have no `section` rung — the
 * draw walks outward to the next rung and then, if it must, inward. A question
 * with three options is a worse question than a slightly easier one.
 */

import {
  BOOK_COUNT,
  SECTIONS,
  bookRange,
  fromVerseId,
  isOldTestament,
  sectionOf,
} from '../../../../../src/modules/games/shared/verseId.js';
import type { SectionName, VerseId } from '../../../../../src/modules/games/shared/verseId.js';
import type { Verse, VerseFilter } from '../../content/index.js';

/** How far a wrong option sits from the true reference. */
export type Distance = 'chapter' | 'book' | 'section' | 'testament' | 'anywhere';

/** Nearest first. The order is the ladder the draw walks when a rung is empty. */
export const DISTANCES: readonly Distance[] = [
  'chapter',
  'book',
  'section',
  'testament',
  'anywhere',
];

/**
 * The reading the draw needs, and nothing else. A module satisfies it, and so
 * does anything a test builds by hand, which is what keeps the interesting
 * arithmetic here testable without a file on disk.
 */
export interface VerseSource {
  chapter(book: number, chapter: number): Verse[];
  range(first: VerseId, last: VerseId): Verse[];
  randomVerse(filter: VerseFilter, random: () => number): Verse | null;
}

export interface Distractor {
  id: VerseId;
  /** The rung it actually came from, which is not always the one asked for. */
  distance: Distance;
}

export interface DistractorRequest {
  source: VerseSource;
  /** The true reference. Never offered back as a distractor. */
  answer: VerseId;
  /** One rung per wanted distractor. Repeats are allowed. */
  wanted: readonly Distance[];
  random: () => number;
}

/**
 * A shell of verses is enumerated when it is small enough to hold in hand and
 * sampled when it is not. Beyond a chapter or a book the rung is a set of whole
 * books, which the module can draw from uniformly on its own; asking it for
 * every verse of the epistles to pick one would be several thousand rows for a
 * single option.
 */
const SAMPLE_ATTEMPTS = 16;

/**
 * Book numbers outside the canon reach this module through content that was
 * authored against a different versification, and `sectionOf` answers for any
 * number it is handed — so nothing it says means anything until the number has
 * been checked here.
 */
function isCanonical(book: number): boolean {
  return Number.isInteger(book) && book >= 1 && book <= BOOK_COUNT;
}

function booksBetween(first: number, last: number): number[] {
  const books: number[] = [];
  for (let book = first; book <= last; book += 1) books.push(book);
  return books;
}

function booksOfSection(section: SectionName): number[] {
  const [first, last] = SECTIONS[section];
  return booksBetween(first, last);
}

function booksOfTestament(old: boolean): number[] {
  return old ? booksBetween(1, 39) : booksBetween(40, BOOK_COUNT);
}

/**
 * The books a rung covers, with everything nearer in removed. Empty means the
 * rung does not exist for this verse — a book that is its own whole section
 * has no `section` rung at all.
 */
export function booksAtDistance(distance: Distance, book: number): number[] {
  if (!isCanonical(book)) return [];
  const section = sectionOf(book);
  if (distance === 'section') {
    return booksOfSection(section).filter((other) => other !== book);
  }
  if (distance === 'testament') {
    const inSection = new Set(booksOfSection(section));
    return booksOfTestament(isOldTestament(book)).filter((other) => !inSection.has(other));
  }
  if (distance === 'anywhere') {
    return booksOfTestament(!isOldTestament(book));
  }
  // `chapter` and `book` are shells inside one book, not sets of books.
  return [book];
}

/** The ladder to walk from a rung: outward first, then back inward. */
export function ladderFrom(distance: Distance): Distance[] {
  const start = DISTANCES.indexOf(distance);
  const outward = DISTANCES.slice(start + 1);
  const inward = DISTANCES.slice(0, start).reverse();
  return [distance, ...outward, ...inward];
}

function pickFrom<T>(items: readonly T[], random: () => number): T | null {
  if (items.length === 0) return null;
  const index = Math.floor(random() * items.length);
  // A generator that returns exactly 1, or a shade under 0, would index off the
  // end of the list rather than pick from it.
  const clamped = index < 0 ? 0 : Math.min(index, items.length - 1);
  return items[clamped] as T;
}

/**
 * Enumerated shells, kept for the life of one draw. Three options from the same
 * book would otherwise read every verse of it three times.
 */
class ShellCache {
  private readonly source: VerseSource;
  private readonly lists = new Map<string, VerseId[]>();

  constructor(source: VerseSource) {
    this.source = source;
  }

  sameChapter(book: number, chapter: number): VerseId[] {
    return this.remember(`chapter:${book}:${chapter}`, () =>
      this.source.chapter(book, chapter).map((verse) => verse.id)
    );
  }

  /** Same book, but not the chapter the answer is in. */
  sameBook(book: number, chapter: number): VerseId[] {
    return this.remember(`book:${book}:${chapter}`, () => {
      const { first, last } = bookRange(book);
      return this.source
        .range(first, last)
        .map((verse) => verse.id)
        .filter((id) => fromVerseId(id).chapter !== chapter);
    });
  }

  private remember(key: string, build: () => VerseId[]): VerseId[] {
    const existing = this.lists.get(key);
    if (existing) return existing;
    const built = build();
    this.lists.set(key, built);
    return built;
  }
}

function drawAtDistance(
  distance: Distance,
  answer: VerseId,
  taken: ReadonlySet<VerseId>,
  cache: ShellCache,
  source: VerseSource,
  random: () => number
): VerseId | null {
  const { book, chapter } = fromVerseId(answer);
  if (!isCanonical(book)) return null;

  if (distance === 'chapter' || distance === 'book') {
    const shell =
      distance === 'chapter' ? cache.sameChapter(book, chapter) : cache.sameBook(book, chapter);
    return pickFrom(
      shell.filter((id) => !taken.has(id)),
      random
    );
  }

  const books = booksAtDistance(distance, book);
  if (books.length === 0) return null;
  for (let attempt = 0; attempt < SAMPLE_ATTEMPTS; attempt += 1) {
    const drawn = source.randomVerse({ books }, random);
    if (!drawn) return null;
    if (!taken.has(drawn.id)) return drawn.id;
  }
  // Every attempt came back with something already offered, which means the
  // rung holds almost nothing. The next rung out is a better question than a
  // repeated option.
  return null;
}

/**
 * One distractor per requested rung, in the order requested. Returns fewer only
 * when the module itself holds fewer distinct references than were asked for —
 * a fixture of six verses, or a room playing a module with one book in it.
 */
export function drawDistractors(request: DistractorRequest): Distractor[] {
  const { source, answer, wanted, random } = request;
  const cache = new ShellCache(source);
  const taken = new Set<VerseId>([answer]);
  const drawn: Distractor[] = [];

  for (const distance of wanted) {
    for (const rung of ladderFrom(distance)) {
      const id = drawAtDistance(rung, answer, taken, cache, source, random);
      if (id === null) continue;
      taken.add(id);
      drawn.push({ id, distance: rung });
      break;
    }
  }
  return drawn;
}
