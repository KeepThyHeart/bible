/**
 * The passage queue: the list of passages the player reads through, and the
 * bookmark (resume point) that remembers a tab's place. Pure helpers with no
 * player or UI dependencies, so the store, the desktop session and the web
 * app can share one model.
 */

import type { ReferenceRange } from '@bible/core/browser';

export type PassageLoop = 'once' | 'list' | 'passage';

/** One contiguous passage; the shape of a core ReferenceRange minus `wholeBook` (expanded to `endChapter`). */
export interface AudioPassage {
  book: number;
  chapter: number;
  verse?: number;
  endChapter?: number;
  endVerse?: number;
}

/**
 * `chapter` is the default list: the chapter Listen started in (it moves along as
 * reading continues to later chapters). `list` is the passages the reader typed.
 */
export interface PassageQueue {
  readonly kind: 'chapter' | 'list';
  readonly passages: readonly AudioPassage[];
  readonly index: number;
}

/** A tab's resume point. */
export interface AudioBookmark {
  moduleAbbr: string;
  book: number;
  chapter: number;
  verse: number;
  queue?: PassageQueue;
  /** The tab's selected verse (verse id) when this was saved: a selection equal to it is stale, not a new choice. */
  selAtSave?: number;
}

export const MAX_PASSAGES = 50;

/** Parsed ranges to passages; a whole book becomes chapter 1 to its last chapter. */
export function toPassages(ranges: readonly ReferenceRange[], chapterCount: (book: number) => number): AudioPassage[] {
  const out: AudioPassage[] = [];
  for (const r of ranges) {
    if (out.length >= MAX_PASSAGES) break;
    if (r.wholeBook) {
      const last = Math.max(1, chapterCount(r.book));
      const p: AudioPassage = { book: r.book, chapter: 1 };
      if (last > 1) p.endChapter = last;
      out.push(p);
      continue;
    }
    const p: AudioPassage = { book: r.book, chapter: r.chapter };
    if (r.verse !== undefined) p.verse = r.verse;
    if (r.endChapter !== undefined) p.endChapter = r.endChapter;
    if (r.endVerse !== undefined) p.endVerse = r.endVerse;
    out.push(p);
  }
  return out;
}

export function passageStart(p: AudioPassage): { book: number; chapter: number; verse: number } {
  return { book: p.book, chapter: p.chapter, verse: p.verse ?? 1 };
}

export function passageLastChapter(p: AudioPassage): number {
  return p.endChapter ?? p.chapter;
}

/** Verse after which reading stops in (book, chapter), or null = read to the chapter end. */
export function stopVerseIn(p: AudioPassage, book: number, chapter: number): number | null {
  if (p.book !== book || chapter !== passageLastChapter(p)) return null;
  if (p.endVerse !== undefined) return p.endVerse;
  if (p.verse !== undefined && p.endChapter === undefined) return p.verse; // a single verse
  return null;
}

export function passageContains(p: AudioPassage, book: number, chapter: number, verse: number): boolean {
  if (p.book !== book) return false;
  const start = passageStart(p);
  if (chapter < start.chapter || (chapter === start.chapter && verse < start.verse)) return false;
  const lastChapter = passageLastChapter(p);
  if (chapter > lastChapter) return false;
  if (chapter < lastChapter) return true;
  const stop = stopVerseIn(p, book, chapter);
  return stop === null || verse <= stop;
}

/** once: i+1 or null at the end; list: wraps; passage: stays. */
export function nextIndex(q: PassageQueue, loop: PassageLoop): number | null {
  const n = q.passages.length;
  if (n === 0) return null;
  if (loop === 'passage') return q.index;
  if (loop === 'list') return (q.index + 1) % n;
  return q.index + 1 < n ? q.index + 1 : null;
}

/** i-1 or null (no wrap). */
export function prevIndex(q: PassageQueue): number | null {
  return q.index > 0 && q.passages.length > 0 ? q.index - 1 : null;
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isPosInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 1;

function sanitizePassage(raw: unknown): AudioPassage | null {
  if (!isObject(raw) || !isPosInt(raw.book) || !isPosInt(raw.chapter)) return null;
  const p: AudioPassage = { book: raw.book, chapter: raw.chapter };
  if (raw.verse !== undefined) { if (!isPosInt(raw.verse)) return null; p.verse = raw.verse; }
  if (raw.endChapter !== undefined) {
    if (!isPosInt(raw.endChapter) || raw.endChapter < raw.chapter) return null;
    p.endChapter = raw.endChapter;
  }
  if (raw.endVerse !== undefined) { if (!isPosInt(raw.endVerse)) return null; p.endVerse = raw.endVerse; }
  return p;
}

/** Validate an unknown payload (session restore) into a queue; null when unusable. Never throws. */
export function sanitizeQueue(raw: unknown, chapterCount?: (book: number) => number): PassageQueue | null {
  if (!isObject(raw)) return null;
  if (raw.kind !== 'chapter' && raw.kind !== 'list') return null;
  if (!Array.isArray(raw.passages)) return null;
  const passages: AudioPassage[] = [];
  for (const item of raw.passages) {
    if (passages.length >= MAX_PASSAGES) break;
    const p = sanitizePassage(item);
    if (p && chapterCount) {
      const last = chapterCount(p.book);
      if (last < 1 || p.chapter > last || (p.endChapter ?? p.chapter) > last) continue;
    }
    if (p) passages.push(p);
  }
  if (passages.length === 0) return null;
  const index = typeof raw.index === 'number' && Number.isInteger(raw.index) && raw.index >= 0 && raw.index < passages.length
    ? raw.index : 0;
  return { kind: raw.kind, passages, index };
}

/** Validate an unknown payload into a bookmark; null when unusable. A bad queue is dropped, the bookmark kept. */
export function sanitizeBookmark(raw: unknown, chapterCount?: (book: number) => number): AudioBookmark | null {
  if (!isObject(raw)) return null;
  if (typeof raw.moduleAbbr !== 'string' || !raw.moduleAbbr) return null;
  if (!isPosInt(raw.book) || !isPosInt(raw.chapter) || !isPosInt(raw.verse)) return null;
  const out: AudioBookmark = { moduleAbbr: raw.moduleAbbr, book: raw.book, chapter: raw.chapter, verse: raw.verse };
  const queue = sanitizeQueue(raw.queue, chapterCount);
  if (queue) out.queue = queue;
  if (isPosInt(raw.selAtSave)) out.selAtSave = raw.selAtSave;
  return out;
}
