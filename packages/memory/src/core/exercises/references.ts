/**
 * The reference activities' shared building blocks: a genre map for the
 * 66-book canon, one formatter both the correct answer and every distractor
 * go through, distractor generation for `refmatch`, and the display
 * truncation `refprovide` sends for an unusually long verse.
 *
 * ## Why distractors are GENERATED, not drawn from sibling passages
 *
 * The pre-T8 `refmatch` picked its distractors from the user's own other
 * passages. That was fine when the question was "which of these three
 * passages I'm memorising is this?", but T8 changes the question to "which
 * reference is this verse?", asked once per verse of the passage - and a
 * plan with two passages would run out of distractors after the first
 * question. So distractors are built from the Bible's own structure instead:
 * any book (tier 0), the correct book's genre (tier 1), or the correct book
 * itself (tier 2) - see `buildReferenceDistractors`.
 *
 * ## Why `formatReference` exists at all
 *
 * A user who has done this exercise a few times will notice if the correct
 * answer is spelled differently from the distractors - trailing punctuation,
 * "Ch." vs "chapter", a different dash. `formatReference` is the ONE place a
 * book/chapter/verse triple becomes display text, and both the correct
 * reference and every distractor go through it, so there is no such tell to
 * notice.
 */

import type { Line, VerseText } from '../types';
import { PREVIEW_MAX_LINES, PREVIEW_MAX_WORDS } from './ordering';
import type { Rng } from './rng';

// ---------------------------------------------------------------------------
// Genre map
// ---------------------------------------------------------------------------

export type Genre =
  | 'law'
  | 'history'
  | 'wisdom'
  | 'prophets'
  | 'gospels'
  | 'acts'
  | 'epistles'
  | 'apocalyptic';

/**
 * Book number -> genre, for the standard 66-book Protestant canon,
 * Genesis = 1 through Revelation = 66.
 *
 * ## Numbering assumption and how it was checked
 *
 * `@bible/core`'s `listBooks` is the authority on book numbering at runtime,
 * and this extension has no independent parser of its own (see
 * `reference.ts`'s header). Nothing in this repository ships a fixture that
 * enumerates all 66 `listBooks` rows, so the numbering here cannot be
 * checked against one directly. What IS checked: `test/session.test.ts`'s own
 * verse fixtures encode verse ids as `book * 1_000_000 + chapter * 1_000 +
 * verse` (the same scheme `main.ts`'s `BOOK_FACTOR`/`CHAPTER_FACTOR` use and
 * verify against `listChapters` at activation - see
 * `main.ts#verifyVerseIdEncoding`), and those fixtures use book 19 for a
 * Psalm and book 43 for John - exactly where Psalms and John sit in the
 * standard Protestant canon order. That is consistent with, though not a
 * substitute for, the assumption below: the standard order (law
 * Genesis-Deuteronomy, history Joshua-Esther, wisdom Job-Song of Solomon,
 * major+minor prophets Isaiah-Malachi, gospels Matthew-John, Acts alone,
 * epistles Romans-Jude, Revelation alone) is used verbatim.
 */
export const BOOK_GENRE: Readonly<Record<number, Genre>> = buildGenreMap([
  [1, 5, 'law'],
  [6, 17, 'history'],
  [18, 22, 'wisdom'],
  [23, 39, 'prophets'],
  [40, 43, 'gospels'],
  [44, 44, 'acts'],
  [45, 65, 'epistles'],
  [66, 66, 'apocalyptic'],
]);

function buildGenreMap(
  ranges: readonly [start: number, end: number, genre: Genre][],
): Record<number, Genre> {
  const map: Record<number, Genre> = {};
  for (const [start, end, genre] of ranges) {
    for (let book = start; book <= end; book += 1) map[book] = genre;
  }
  return map;
}

/** The only valid book numbers - the standard 66-book Protestant canon. */
export const MIN_BOOK_NUMBER = 1;
export const MAX_BOOK_NUMBER = 66;

function assertValidBook(bookNumber: number, context: string): void {
  if (
    !Number.isInteger(bookNumber) ||
    bookNumber < MIN_BOOK_NUMBER ||
    bookNumber > MAX_BOOK_NUMBER
  ) {
    throw new Error(
      `${context}: book ${bookNumber} is outside the 66-book canon (1-${MAX_BOOK_NUMBER}).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Formatting - the one code path a correct reference and every distractor
// both go through.
// ---------------------------------------------------------------------------

/**
 * Format a book/chapter/verse triple as display text, e.g. "John 3:16" or
 * (with `verseEnd`) "John 3:16-18".
 *
 * `book` is a display name already resolved by the caller (`main.ts`'s
 * `bookNames`, itself from `listBooks`) rather than a number - this module
 * has no access to the host and does not fetch names itself.
 */
export function formatReference(
  book: string,
  chapter: number,
  verse: number,
  verseEnd?: number,
): string {
  const range = verseEnd !== undefined && verseEnd !== verse ? `${verse}-${verseEnd}` : `${verse}`;
  return `${book} ${chapter}:${range}`;
}

// ---------------------------------------------------------------------------
// Distractor generation
// ---------------------------------------------------------------------------

/** One book, as much of `BibleBookDto` as distractor generation needs. */
export interface BookInfo {
  bookNumber: number;
  chapterCount: number;
}

/** One chapter's extent, as much of `BibleChapterDto` as distractor generation needs. */
export interface ChapterInfo {
  chapter: number;
  verseCount: number;
}

/** A book/chapter/verse triple - the correct answer, or a candidate distractor. */
export interface ReferencePoint {
  bookNumber: number;
  chapter: number;
  verse: number;
}

export interface DistractorReference extends ReferencePoint {
  /** Formatted through the same `formatReference` the correct answer uses. */
  reference: string;
}

export interface BuildDistractorsOpts {
  /** The verse actually being asked about. */
  correct: ReferencePoint;
  /** 0 (any book), 1 (same genre), 2 (same book) - `ladder.ts#TIERS.refmatch`. */
  tier: number;
  /** The full book catalog, or at least every book distractors may be drawn from. */
  books: readonly BookInfo[];
  /**
   * Pre-fetched chapter extents, keyed by book number. Distractors are only
   * ever drawn from a book present here - `listChapters` is a host call, and
   * this module does no I/O, so the caller decides (and caches) which books'
   * chapters were worth fetching before calling this. See the file header on
   * `main.ts`'s side of that cache.
   */
  chapters: Readonly<Record<number, readonly ChapterInfo[]>>;
  /** Display names, keyed by book number. A missing name falls back to "Book N". */
  bookNames: Readonly<Record<number, string>>;
  /** How many distractors to try to produce. Fewer may come back - see below. */
  count: number;
  rng: Rng;
}

/**
 * Build up to `count` distractor references for one `refmatch` step.
 *
 * Never a sibling PASSAGE - every distractor is a GENERATED book/chapter/verse
 * combination, valid against `chapters` (so a book with 21 chapters never
 * offers chapter 47, and a chapter's verse never exceeds its own
 * `verseCount`), and never the correct answer or a repeat of another
 * distractor already chosen.
 *
 * Regeneration is capped rather than exact: a genuinely tiny pool (a
 * one-chapter book at tier 2, say) may not have `count` distinct options left
 * once the correct answer and any earlier picks are excluded, and this
 * returns whatever it managed rather than looping forever or throwing - the
 * same "shorter than asked, not an error" contract `ordering.ts#buildCandidates`
 * uses for the same reason.
 */
export function buildReferenceDistractors(opts: BuildDistractorsOpts): DistractorReference[] {
  const { correct, tier, books, chapters, bookNames, count, rng } = opts;
  assertValidBook(correct.bookNumber, 'buildReferenceDistractors');
  for (const book of books) assertValidBook(book.bookNumber, 'buildReferenceDistractors');

  const pool = poolBooks(tier, correct.bookNumber, books, chapters);
  const wanted = Math.max(0, Math.floor(count));
  if (pool.length === 0 || wanted === 0) return [];

  const seen = new Set<string>([pointKey(correct)]);
  const out: DistractorReference[] = [];

  // A bounded number of rejection-sampling attempts, not an exact target: see
  // the doc comment above on why running out of room is handled, not thrown.
  const maxAttempts = Math.max(50, wanted * 40);
  for (let attempt = 0; attempt < maxAttempts && out.length < wanted; attempt += 1) {
    const book = pool[Math.floor(rng() * pool.length)];
    if (!book) continue;
    const bookChapters = chapters[book.bookNumber];
    if (!bookChapters || bookChapters.length === 0) continue;
    const chapter = bookChapters[Math.floor(rng() * bookChapters.length)];
    if (!chapter || chapter.verseCount < 1) continue;
    const verse = 1 + Math.floor(rng() * chapter.verseCount);

    const point: ReferencePoint = { bookNumber: book.bookNumber, chapter: chapter.chapter, verse };
    const key = pointKey(point);
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      ...point,
      reference: formatReference(
        bookNames[book.bookNumber] ?? `Book ${book.bookNumber}`,
        chapter.chapter,
        verse,
      ),
    });
  }

  return out;
}

function pointKey(p: ReferencePoint): string {
  return `${p.bookNumber}:${p.chapter}:${p.verse}`;
}

/** Which books distractors may be drawn from, for one tier. */
function poolBooks(
  tier: number,
  correctBook: number,
  books: readonly BookInfo[],
  chapters: Readonly<Record<number, readonly ChapterInfo[]>>,
): BookInfo[] {
  // Only a book whose chapters were actually fetched is usable - see
  // `BuildDistractorsOpts.chapters`'s doc comment.
  const available = books.filter((b) => (chapters[b.bookNumber]?.length ?? 0) > 0);

  if (tier >= 2) return available.filter((b) => b.bookNumber === correctBook);

  if (tier === 1) {
    const genre = BOOK_GENRE[correctBook];
    return available.filter((b) => BOOK_GENRE[b.bookNumber] === genre);
  }

  return available;
}

// ---------------------------------------------------------------------------
// refprovide's display truncation
// ---------------------------------------------------------------------------

/**
 * Cap a verse for `refprovide`'s display, the same ~25-word/3-line rule
 * `ordering.ts#preview` uses for picker candidates.
 *
 * `refprovide` shows the whole verse as the memory cue (that is the point of
 * the activity - the words are given, the reference is what is being asked
 * for), so this only bites for an unusually long verse. Unlike `preview`,
 * which returns a joined string for a picker candidate's label, this returns
 * a `VerseText` - `RefProvideStep.verse` carries real `words`/`lines` like
 * every other step, and the panel renders it the same way, never
 * re-tokenising (see `VerseText`'s own doc comment). Grading does not depend
 * on this at all - `refprovide` is graded from the *typed reference*, not
 * from `verse.words` - so trimming it here is purely a display decision with
 * no correctness risk.
 */
export function truncateForProvide(verse: VerseText): { verse: VerseText; truncated: boolean } {
  const words = verse.words;
  if (!words || words.length === 0) return { verse, truncated: false };

  let limit = words.length;
  const lines = verse.lines;
  if (lines && lines.length > PREVIEW_MAX_LINES) {
    const lastKept = lines[PREVIEW_MAX_LINES - 1];
    const bound = lastKept ? lastKept.end + 1 : limit;
    if (bound > 0 && bound < limit) limit = bound;
  }
  if (limit > PREVIEW_MAX_WORDS) limit = PREVIEW_MAX_WORDS;

  if (limit >= words.length) return { verse, truncated: false };

  const cappedLines: Line[] | null = lines
    ? lines
        .filter((l) => l.start < limit)
        .map((l) => (l.end < limit ? l : { ...l, end: limit - 1 }))
    : null;

  return {
    verse: { ...verse, words: words.slice(0, limit), lines: cappedLines },
    truncated: true,
  };
}
