/**
 * `exercises/references.ts` - the genre map, the shared formatter, the
 * `refmatch` distractor generator, and `refprovide`'s display truncation.
 *
 * The central risk this file guards against is the one the task exists to
 * prevent: a distractor that is not actually a valid reference (a chapter
 * past the book's end, a verse past the chapter's end), a distractor that
 * silently duplicates the correct answer or another distractor, and a tier 2
 * (same book) pool that leaks a reference from a different book. Every one of
 * those would be invisible in a UI screenshot and obvious the moment a real
 * user hit it.
 */

import { describe, it, expect } from 'vitest';
import {
  BOOK_GENRE,
  buildReferenceDistractors,
  formatReference,
  truncateForProvide,
  type BookInfo,
  type ChapterInfo,
} from '../src/core/exercises/references';
import { mulberry32 } from '../src/core/exercises/rng';
import type { VerseText } from '../src/core/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** John (gospels), three chapters, plausible verse counts. */
const JOHN: BookInfo = { bookNumber: 43, chapterCount: 21 };
const JOHN_CHAPTERS: ChapterInfo[] = [
  { chapter: 1, verseCount: 51 },
  { chapter: 2, verseCount: 25 },
  { chapter: 3, verseCount: 36 },
];

/** Romans (epistles). */
const ROMANS: BookInfo = { bookNumber: 45, chapterCount: 16 };
const ROMANS_CHAPTERS: ChapterInfo[] = [
  { chapter: 1, verseCount: 32 },
  { chapter: 8, verseCount: 39 },
];

/** Philippians (epistles) - a second same-genre book distinct from Romans. */
const PHILIPPIANS: BookInfo = { bookNumber: 50, chapterCount: 4 };
const PHILIPPIANS_CHAPTERS: ChapterInfo[] = [{ chapter: 1, verseCount: 30 }];

/** Obadiah - the one-chapter book this task calls out by name. */
const OBADIAH: BookInfo = { bookNumber: 31, chapterCount: 1 };
const OBADIAH_CHAPTERS: ChapterInfo[] = [{ chapter: 1, verseCount: 21 }];

const BOOKS: BookInfo[] = [JOHN, ROMANS, PHILIPPIANS, OBADIAH];
const BOOK_NAMES: Record<number, string> = {
  43: 'John',
  45: 'Romans',
  50: 'Philippians',
  31: 'Obadiah',
};
const CHAPTERS: Record<number, ChapterInfo[]> = {
  43: JOHN_CHAPTERS,
  45: ROMANS_CHAPTERS,
  50: PHILIPPIANS_CHAPTERS,
  31: OBADIAH_CHAPTERS,
};

function distractorsFor(
  opts: Partial<Parameters<typeof buildReferenceDistractors>[0]> = {},
) {
  return buildReferenceDistractors({
    correct: { bookNumber: 43, chapter: 3, verse: 16 },
    tier: 0,
    books: BOOKS,
    chapters: CHAPTERS,
    bookNames: BOOK_NAMES,
    count: 3,
    rng: mulberry32(2026),
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// Genre map
// ---------------------------------------------------------------------------

describe('BOOK_GENRE', () => {
  it('covers exactly the 66-book canon with the documented ranges', () => {
    for (let book = 1; book <= 66; book += 1) {
      expect(BOOK_GENRE[book]).toBeDefined();
    }
    expect(BOOK_GENRE[67]).toBeUndefined();
    expect(BOOK_GENRE[0]).toBeUndefined();
  });

  it('places the boundary books where the standard canon does', () => {
    expect(BOOK_GENRE[1]).toBe('law'); // Genesis
    expect(BOOK_GENRE[5]).toBe('law'); // Deuteronomy
    expect(BOOK_GENRE[6]).toBe('history'); // Joshua
    expect(BOOK_GENRE[17]).toBe('history'); // Esther
    expect(BOOK_GENRE[18]).toBe('wisdom'); // Job
    expect(BOOK_GENRE[19]).toBe('wisdom'); // Psalms
    expect(BOOK_GENRE[22]).toBe('wisdom'); // Song of Solomon
    expect(BOOK_GENRE[23]).toBe('prophets'); // Isaiah
    expect(BOOK_GENRE[39]).toBe('prophets'); // Malachi
    expect(BOOK_GENRE[40]).toBe('gospels'); // Matthew
    expect(BOOK_GENRE[43]).toBe('gospels'); // John
    expect(BOOK_GENRE[44]).toBe('acts'); // Acts
    expect(BOOK_GENRE[45]).toBe('epistles'); // Romans
    expect(BOOK_GENRE[65]).toBe('epistles'); // Jude
    expect(BOOK_GENRE[66]).toBe('apocalyptic'); // Revelation
  });

  it('assigns every one-chapter book (Obadiah, Philemon, 2 John, 3 John, Jude) its genre', () => {
    expect(BOOK_GENRE[31]).toBe('prophets'); // Obadiah
    expect(BOOK_GENRE[57]).toBe('epistles'); // Philemon
    expect(BOOK_GENRE[63]).toBe('epistles'); // 2 John
    expect(BOOK_GENRE[64]).toBe('epistles'); // 3 John
    expect(BOOK_GENRE[65]).toBe('epistles'); // Jude
  });
});

// ---------------------------------------------------------------------------
// formatReference - the shared formatter
// ---------------------------------------------------------------------------

describe('formatReference', () => {
  it('formats a single verse', () => {
    expect(formatReference('John', 3, 16)).toBe('John 3:16');
  });

  it('formats a range when verseEnd differs from verse', () => {
    expect(formatReference('John', 3, 16, 18)).toBe('John 3:16-18');
  });

  it('does not add a range when verseEnd equals verse', () => {
    expect(formatReference('John', 3, 16, 16)).toBe('John 3:16');
  });
});

// ---------------------------------------------------------------------------
// buildReferenceDistractors
// ---------------------------------------------------------------------------

describe('buildReferenceDistractors', () => {
  it('never includes the correct answer', () => {
    const correct = { bookNumber: 43, chapter: 3, verse: 16 };
    for (let seed = 0; seed < 20; seed += 1) {
      const out = distractorsFor({ correct, rng: mulberry32(seed) });
      for (const d of out) {
        expect(`${d.bookNumber}:${d.chapter}:${d.verse}`).not.toBe('43:3:16');
      }
    }
  });

  it('never duplicates another distractor within the same call', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const out = distractorsFor({ rng: mulberry32(seed), count: 3 });
      const keys = out.map((d) => `${d.bookNumber}:${d.chapter}:${d.verse}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('only generates chapter/verse combinations valid against the chapters data', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const out = distractorsFor({ rng: mulberry32(seed), count: 3, tier: 0 });
      for (const d of out) {
        const chapters = CHAPTERS[d.bookNumber];
        expect(chapters).toBeDefined();
        const chapter = chapters?.find((c) => c.chapter === d.chapter);
        expect(chapter, `book ${d.bookNumber} has no chapter ${d.chapter}`).toBeDefined();
        expect(d.verse).toBeGreaterThanOrEqual(1);
        expect(d.verse).toBeLessThanOrEqual(chapter?.verseCount ?? 0);
      }
    }
  });

  it('formats distractors through the same formatReference the correct answer uses', () => {
    const out = distractorsFor({ tier: 2, count: 2 });
    for (const d of out) {
      expect(d.reference).toBe(formatReference(BOOK_NAMES[d.bookNumber] ?? '', d.chapter, d.verse));
    }
  });

  describe('tier 2 (same book)', () => {
    it('draws every distractor from the correct reference\'s own book', () => {
      const correct = { bookNumber: 43, chapter: 3, verse: 16 };
      for (let seed = 0; seed < 15; seed += 1) {
        const out = buildReferenceDistractors({
          correct,
          tier: 2,
          books: BOOKS,
          chapters: CHAPTERS,
          bookNames: BOOK_NAMES,
          count: 3,
          rng: mulberry32(seed),
        });
        expect(out.length).toBeGreaterThan(0);
        for (const d of out) expect(d.bookNumber).toBe(43);
      }
    });

    it('handles a one-chapter book (Obadiah): distinct distractors, never the correct verse', () => {
      const correct = { bookNumber: 31, chapter: 1, verse: 3 };
      for (let seed = 0; seed < 15; seed += 1) {
        const out = buildReferenceDistractors({
          correct,
          tier: 2,
          books: BOOKS,
          chapters: CHAPTERS,
          bookNames: BOOK_NAMES,
          count: 3,
          rng: mulberry32(seed),
        });
        for (const d of out) {
          expect(d.bookNumber).toBe(31);
          expect(d.chapter).toBe(1);
          expect(d.verse).not.toBe(3);
        }
        const keys = out.map((d) => d.verse);
        expect(new Set(keys).size).toBe(keys.length);
      }
    });
  });

  describe('tier 1 (same genre)', () => {
    it('draws every distractor from a book of the same genre, never a different genre', () => {
      // Romans is 'epistles'; Philippians is also 'epistles'; John (gospels)
      // and Obadiah (prophets) must never appear.
      const correct = { bookNumber: 45, chapter: 8, verse: 28 };
      const seenBooks = new Set<number>();
      for (let seed = 0; seed < 30; seed += 1) {
        const out = buildReferenceDistractors({
          correct,
          tier: 1,
          books: BOOKS,
          chapters: CHAPTERS,
          bookNames: BOOK_NAMES,
          count: 3,
          rng: mulberry32(seed),
        });
        for (const d of out) {
          seenBooks.add(d.bookNumber);
          expect(BOOK_GENRE[d.bookNumber]).toBe('epistles');
        }
      }
      // Confirms the pool is not accidentally collapsing to just the correct
      // book (which would make tier 1 indistinguishable from tier 2).
      expect(seenBooks.has(50)).toBe(true);
    });
  });

  describe('tier 0 (any book)', () => {
    it('may draw from any book in the catalog, not just the correct one\'s', () => {
      const correct = { bookNumber: 43, chapter: 3, verse: 16 };
      const seenBooks = new Set<number>();
      for (let seed = 0; seed < 30; seed += 1) {
        const out = buildReferenceDistractors({
          correct,
          tier: 0,
          books: BOOKS,
          chapters: CHAPTERS,
          bookNames: BOOK_NAMES,
          count: 3,
          rng: mulberry32(seed),
        });
        for (const d of out) seenBooks.add(d.bookNumber);
      }
      expect(seenBooks.size).toBeGreaterThan(1);
    });
  });

  it('regenerates on collision rather than returning a duplicate, and degrades gracefully when the pool runs out', () => {
    // A single-verse "chapter" leaves nothing else to pick at tier 2: the
    // only combination that exists IS the correct answer.
    const tinyChapters: Record<number, ChapterInfo[]> = {
      31: [{ chapter: 1, verseCount: 1 }],
    };
    const out = buildReferenceDistractors({
      correct: { bookNumber: 31, chapter: 1, verse: 1 },
      tier: 2,
      books: [OBADIAH],
      chapters: tinyChapters,
      bookNames: BOOK_NAMES,
      count: 3,
      rng: mulberry32(1),
    });
    // No infinite loop (this test completing at all is the assertion), and no
    // duplicate/incorrect entry smuggled in to hit the requested count.
    expect(out).toEqual([]);
  });

  it('returns no distractors when the pool is entirely absent from the chapters cache', () => {
    const out = buildReferenceDistractors({
      correct: { bookNumber: 43, chapter: 3, verse: 16 },
      tier: 2,
      books: BOOKS,
      chapters: {}, // nothing pre-fetched
      bookNames: BOOK_NAMES,
      count: 3,
      rng: mulberry32(1),
    });
    expect(out).toEqual([]);
  });

  it('rejects a correct reference outside the 66-book canon', () => {
    expect(() =>
      buildReferenceDistractors({
        correct: { bookNumber: 67, chapter: 1, verse: 1 },
        tier: 0,
        books: BOOKS,
        chapters: CHAPTERS,
        bookNames: BOOK_NAMES,
        count: 3,
        rng: mulberry32(1),
      }),
    ).toThrow(/66-book canon/);

    expect(() =>
      buildReferenceDistractors({
        correct: { bookNumber: 0, chapter: 1, verse: 1 },
        tier: 0,
        books: BOOKS,
        chapters: CHAPTERS,
        bookNames: BOOK_NAMES,
        count: 3,
        rng: mulberry32(1),
      }),
    ).toThrow(/66-book canon/);
  });

  it('rejects a book in the catalog outside the 66-book canon', () => {
    expect(() =>
      buildReferenceDistractors({
        correct: { bookNumber: 43, chapter: 3, verse: 16 },
        tier: 0,
        books: [...BOOKS, { bookNumber: 99, chapterCount: 3 }],
        chapters: { ...CHAPTERS, 99: [{ chapter: 1, verseCount: 10 }] },
        bookNames: BOOK_NAMES,
        count: 3,
        rng: mulberry32(1),
      }),
    ).toThrow(/66-book canon/);
  });
});

// ---------------------------------------------------------------------------
// truncateForProvide
// ---------------------------------------------------------------------------

describe('truncateForProvide', () => {
  const words = (text: string): string[] => text.split(' ');

  it('leaves a short verse untouched', () => {
    const verse: VerseText = {
      verseId: 43003016,
      label: '3:16',
      words: words('For God so loved the world.'),
      lines: null,
      psalmTitle: null,
      paragraphStart: true,
    };
    const { verse: out, truncated } = truncateForProvide(verse);
    expect(truncated).toBe(false);
    expect(out).toBe(verse);
  });

  it('truncates a verse past the word cap and reports it', () => {
    const longWords = Array.from({ length: 40 }, (_, i) => `word${i}`);
    const verse: VerseText = {
      verseId: 19119001,
      label: '119:1',
      words: longWords,
      lines: null,
      psalmTitle: null,
      paragraphStart: false,
    };
    const { verse: out, truncated } = truncateForProvide(verse);
    expect(truncated).toBe(true);
    expect(out.words.length).toBeLessThan(longWords.length);
    expect(out.words).toEqual(longWords.slice(0, out.words.length));
  });

  it('cuts at a poetic line boundary before the word cap, and clips lines beyond it', () => {
    const longWords = Array.from({ length: 40 }, (_, i) => `word${i}`);
    const verse: VerseText = {
      verseId: 19001001,
      label: '1:1',
      words: longWords,
      lines: [
        { start: 0, end: 4, level: 1 },
        { start: 5, end: 9, level: 2 },
        { start: 10, end: 14, level: 2 },
        { start: 15, end: 19, level: 1 },
      ],
      psalmTitle: null,
      paragraphStart: false,
    };
    const { verse: out, truncated } = truncateForProvide(verse);
    expect(truncated).toBe(true);
    // 3 lines kept (PREVIEW_MAX_LINES), cutting after word index 14 (inclusive).
    expect(out.words.length).toBe(15);
    expect(out.lines).not.toBeNull();
    expect(out.lines?.length).toBe(3);
  });
});
