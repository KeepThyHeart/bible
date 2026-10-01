/** Verse-count helpers over the static KJV table. Pure. */
import { VERSE_COUNTS } from './versificationData';
import type { Reading, ScopeRange, VerseIdNumber } from './types';

export const TOTAL_VERSES = 31102;

export function vid(book: number, chapter: number, verse: number): VerseIdNumber {
  return book * 1_000_000 + chapter * 1000 + verse;
}

export function splitVid(id: VerseIdNumber): { book: number; chapter: number; verse: number } {
  return { book: Math.floor(id / 1_000_000), chapter: Math.floor((id % 1_000_000) / 1000), verse: id % 1000 };
}

export function chapterCount(book: number): number {
  return VERSE_COUNTS[book - 1]?.length ?? 0;
}

export function versesInChapter(book: number, chapter: number): number {
  return VERSE_COUNTS[book - 1]?.[chapter - 1] ?? 0;
}

/** True when the id names a verse that exists in KJV numbering. */
export function isValidVerseId(id: VerseIdNumber): boolean {
  if (!Number.isInteger(id)) return false;
  const { book, chapter, verse } = splitVid(id);
  return verse >= 1 && verse <= versesInChapter(book, chapter);
}

export function bookStart(book: number): VerseIdNumber {
  return vid(book, 1, 1);
}

export function bookEnd(book: number): VerseIdNumber {
  const c = chapterCount(book);
  return vid(book, c, versesInChapter(book, c));
}

/** Whole books `from`..`to` (inclusive) as one scope range. */
export function booksRange(from: number, to: number = from): ScopeRange {
  return { start: bookStart(from), end: bookEnd(to) };
}

/** The verse after `id`, or null after Revelation 22:21. */
export function nextVerse(id: VerseIdNumber): VerseIdNumber | null {
  const { book, chapter, verse } = splitVid(id);
  if (verse < versesInChapter(book, chapter)) return id + 1;
  if (chapter < chapterCount(book)) return vid(book, chapter + 1, 1);
  if (book < 66) return vid(book + 1, 1, 1);
  return null;
}

/** Every verse id from `start` to `end` inclusive, in canonical order. */
export function* versesBetween(start: VerseIdNumber, end: VerseIdNumber): Generator<VerseIdNumber> {
  let cur: VerseIdNumber | null = start;
  while (cur !== null && cur <= end) {
    yield cur;
    cur = nextVerse(cur);
  }
}

/** Number of verses in an inclusive range (0 when end < start). */
export function countVerses(start: VerseIdNumber, end: VerseIdNumber): number {
  if (end < start) return 0;
  const a = splitVid(start);
  const z = splitVid(end);
  if (a.book === z.book && a.chapter === z.chapter) return z.verse - a.verse + 1;
  let n = 0;
  for (let b = a.book; b <= z.book; b++) {
    const firstC = b === a.book ? a.chapter : 1;
    const lastC = b === z.book ? z.chapter : chapterCount(b);
    for (let c = firstC; c <= lastC; c++) {
      const from = b === a.book && c === a.chapter ? a.verse : 1;
      const to = b === z.book && c === z.chapter ? z.verse : versesInChapter(b, c);
      n += Math.max(0, to - from + 1);
    }
  }
  return n;
}

export function readingVerseCount(r: { start: VerseIdNumber; end: VerseIdNumber }): number {
  return countVerses(r.start, r.end);
}

/** Split a range at book boundaries (a reading never crosses a book). */
export function splitByBook(range: ScopeRange): ScopeRange[] {
  const a = splitVid(range.start);
  const z = splitVid(range.end);
  if (a.book === z.book) return [range];
  const out: ScopeRange[] = [];
  for (let b = a.book; b <= z.book; b++) {
    out.push({ start: b === a.book ? range.start : bookStart(b), end: b === z.book ? range.end : bookEnd(b) });
  }
  return out;
}

/** True when the range is whole chapters (starts at verse 1 and ends at a chapter's last verse). */
export function isWholeChapters(r: { start: VerseIdNumber; end: VerseIdNumber }): boolean {
  const a = splitVid(r.start);
  const z = splitVid(r.end);
  return a.verse === 1 && z.verse === versesInChapter(z.book, z.chapter);
}

/**
 * Format a reading for display: "Genesis 1-3", "Psalms 119:1-24", "Jude 1-8", "John 3:16".
 * `bookName` supplies the (possibly localized) name. Single-chapter books print verses only.
 */
export function formatReading(r: Pick<Reading, 'start' | 'end'>, bookName: (book: number) => string): string {
  const a = splitVid(r.start);
  const z = splitVid(r.end);
  const name = bookName(a.book);
  const single = chapterCount(a.book) === 1;
  const startsChapter = a.verse === 1;
  const endsChapter = z.verse === versesInChapter(z.book, z.chapter);
  if (single) {
    if (startsChapter && endsChapter) return name;
    return a.verse === z.verse ? `${name} ${a.verse}` : `${name} ${a.verse}-${z.verse}`;
  }
  if (startsChapter && endsChapter) {
    if (a.chapter === 1 && z.chapter === chapterCount(a.book) && chapterCount(a.book) > 1) return name;
    return a.chapter === z.chapter ? `${name} ${a.chapter}` : `${name} ${a.chapter}-${z.chapter}`;
  }
  if (a.chapter === z.chapter) {
    return a.verse === z.verse ? `${name} ${a.chapter}:${a.verse}` : `${name} ${a.chapter}:${a.verse}-${z.verse}`;
  }
  return `${name} ${a.chapter}:${a.verse}-${z.chapter}:${z.verse}`;
}

/** Average reading speed used for "about N minutes": ~25 words a verse at ~200 words a minute. */
export const MINUTES_PER_VERSE = 0.125;

export function estimateMinutes(verses: number): number {
  return Math.max(1, Math.round(verses * MINUTES_PER_VERSE));
}
