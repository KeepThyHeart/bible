/**
 * Default verse corpus for smoke testing.
 *
 * Curated list of ~100 verses / ranges chosen to stress the edge cases that
 * most commonly break naive verse hooks: book and testament boundaries, the
 * shortest and longest chapters, single-chapter books, and ranges that span a
 * chapter break. Every entry is a raw `VerseId` (single verse) or a
 * `{ startVerseId, endVerseId }` range computed via `VerseIdHelper`.
 */

import { Book, VerseIdHelper, type VerseId, type VerseRange } from '@bible/core';

const v = (book: Book, chapter: number, verse: number): VerseId =>
  VerseIdHelper.calculate(book, chapter, verse);

const range = (
  book: Book,
  startCh: number,
  startV: number,
  endCh: number,
  endV: number,
): VerseRange => ({
  startVerseId: VerseIdHelper.calculate(book, startCh, startV),
  endVerseId: VerseIdHelper.calculate(book, endCh, endV),
});

export const DEFAULT_VERSE_ID_CORPUS: readonly VerseId[] = Object.freeze([
  // ── OT Law ────────────────────────────────────────────────────────
  v(Book.Genesis, 1, 1),
  v(Book.Genesis, 1, 31),
  v(Book.Genesis, 2, 1),
  v(Book.Exodus, 20, 1),
  v(Book.Leviticus, 19, 18),
  v(Book.Numbers, 6, 24),
  v(Book.Deuteronomy, 6, 4),
  v(Book.Deuteronomy, 6, 5),
  v(Book.Deuteronomy, 34, 12),

  // ── OT History ────────────────────────────────────────────────────
  v(Book.Joshua, 1, 9),
  v(Book.Judges, 1, 1),
  v(Book.Ruth, 1, 16),
  v(Book.FirstSamuel, 1, 1),
  v(Book.SecondSamuel, 7, 16),
  v(Book.FirstKings, 19, 12),
  v(Book.SecondKings, 2, 11),
  v(Book.FirstChronicles, 29, 11),
  v(Book.SecondChronicles, 7, 14),
  v(Book.Ezra, 1, 1),
  v(Book.Nehemiah, 8, 10),
  v(Book.Esther, 4, 14),

  // ── OT Wisdom / Poetry ────────────────────────────────────────────
  v(Book.Job, 1, 1),
  v(Book.Job, 19, 25),
  v(Book.Psalms, 1, 1),
  v(Book.Psalms, 23, 1),
  v(Book.Psalms, 51, 10),
  // Psalm 117 — shortest chapter in the Bible (2 verses).
  v(Book.Psalms, 117, 1),
  v(Book.Psalms, 117, 2),
  // Psalm 119 — longest chapter in the Bible (176 verses, acrostic headings).
  v(Book.Psalms, 119, 1),
  v(Book.Psalms, 119, 105),
  v(Book.Psalms, 119, 176),
  v(Book.Proverbs, 3, 5),
  v(Book.Ecclesiastes, 3, 1),
  v(Book.SongOfSolomon, 2, 1),

  // ── OT Prophets ───────────────────────────────────────────────────
  v(Book.Isaiah, 9, 6),
  v(Book.Isaiah, 53, 5),
  v(Book.Jeremiah, 29, 11),
  v(Book.Lamentations, 3, 22),
  v(Book.Ezekiel, 37, 4),
  v(Book.Daniel, 3, 17),
  v(Book.Hosea, 6, 6),
  v(Book.Joel, 2, 28),
  v(Book.Amos, 5, 24),
  // Obadiah — single-chapter book, 21 verses total.
  v(Book.Obadiah, 1, 1),
  v(Book.Obadiah, 1, 21),
  v(Book.Jonah, 1, 17),
  v(Book.Micah, 6, 8),
  v(Book.Nahum, 1, 7),
  v(Book.Habakkuk, 3, 19),
  v(Book.Zephaniah, 3, 17),
  v(Book.Haggai, 2, 9),
  v(Book.Zechariah, 9, 9),
  // Mal 4:6 — last verse of the OT.
  v(Book.Malachi, 4, 6),

  // ── NT Gospels ────────────────────────────────────────────────────
  // Matt 1:1 — first verse of the NT (book boundary with Malachi above).
  v(Book.Matthew, 1, 1),
  v(Book.Matthew, 5, 3),
  v(Book.Matthew, 28, 19),
  v(Book.Mark, 1, 1),
  v(Book.Mark, 16, 15),
  v(Book.Luke, 2, 10),
  v(Book.Luke, 23, 34),
  v(Book.John, 1, 1),
  v(Book.John, 3, 16),
  v(Book.John, 11, 35),
  v(Book.John, 21, 25),

  // ── NT History ────────────────────────────────────────────────────
  v(Book.Acts, 1, 8),
  v(Book.Acts, 2, 38),

  // ── NT Epistles ───────────────────────────────────────────────────
  v(Book.Romans, 3, 23),
  v(Book.Romans, 8, 28),
  v(Book.Romans, 12, 1),
  v(Book.FirstCorinthians, 13, 4),
  v(Book.FirstCorinthians, 13, 13),
  v(Book.SecondCorinthians, 5, 17),
  v(Book.Galatians, 2, 20),
  v(Book.Ephesians, 2, 8),
  v(Book.Philippians, 4, 13),
  v(Book.Colossians, 3, 2),
  v(Book.FirstThessalonians, 5, 17),
  v(Book.SecondThessalonians, 3, 3),
  v(Book.FirstTimothy, 6, 12),
  v(Book.SecondTimothy, 3, 16),
  v(Book.Titus, 2, 11),
  // Philemon — single-chapter book, 25 verses.
  v(Book.Philemon, 1, 1),
  v(Book.Philemon, 1, 25),
  v(Book.Hebrews, 11, 1),
  v(Book.Hebrews, 13, 8),
  v(Book.James, 1, 5),
  v(Book.FirstPeter, 5, 7),
  v(Book.SecondPeter, 1, 21),
  v(Book.FirstJohn, 1, 9),
  v(Book.FirstJohn, 4, 8),
  // 2 John — single-chapter, 13 verses.
  v(Book.SecondJohn, 1, 1),
  v(Book.SecondJohn, 1, 13),
  // 3 John — single-chapter, 14 verses.
  v(Book.ThirdJohn, 1, 1),
  v(Book.ThirdJohn, 1, 14),
  // Jude — single-chapter, 25 verses.
  v(Book.Jude, 1, 1),
  v(Book.Jude, 1, 25),

  // ── NT Apocalyptic ────────────────────────────────────────────────
  v(Book.Revelation, 1, 1),
  v(Book.Revelation, 3, 20),
  v(Book.Revelation, 21, 4),
  // Rev 22:21 — very last verse of the Bible.
  v(Book.Revelation, 22, 21),
]);

export const DEFAULT_VERSE_RANGE_CORPUS: readonly VerseRange[] = Object.freeze([
  // Single-verse ranges (sanity).
  range(Book.John, 3, 16, 3, 16),
  range(Book.Genesis, 1, 1, 1, 1),

  // Short ranges within one chapter.
  range(Book.FirstCorinthians, 13, 4, 13, 7),
  range(Book.Psalms, 23, 1, 23, 6),
  range(Book.Romans, 8, 28, 8, 30),

  // Full-chapter ranges.
  range(Book.Psalms, 117, 1, 117, 2),     // shortest
  range(Book.Psalms, 119, 1, 119, 176),   // longest
  range(Book.Psalms, 1, 1, 1, 6),
  range(Book.John, 3, 1, 3, 36),

  // Cross-chapter ranges.
  range(Book.Genesis, 1, 31, 2, 1),
  range(Book.Romans, 8, 38, 9, 1),
  range(Book.Psalms, 22, 31, 23, 1),

  // Full-book ranges (single-chapter books).
  range(Book.Obadiah, 1, 1, 1, 21),
  range(Book.Philemon, 1, 1, 1, 25),
  range(Book.SecondJohn, 1, 1, 1, 13),
  range(Book.ThirdJohn, 1, 1, 1, 14),
  range(Book.Jude, 1, 1, 1, 25),

  // Testament boundary (end of OT to start of NT is not a valid single range
  // in practice — but authors sometimes get passed odd ranges; include the
  // last OT verse and first NT verse as separate adjacent ranges).
  range(Book.Malachi, 4, 6, 4, 6),
  range(Book.Matthew, 1, 1, 1, 1),

  // Bible boundary.
  range(Book.Revelation, 22, 20, 22, 21),
]);
