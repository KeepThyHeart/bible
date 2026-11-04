/**
 * Maps bibsearch passage ids to the core verse-id format.
 *
 * bibsearch ids are opaque strings defined by its corpus export:
 *   `KJV.JHN.3.16`        one verse
 *   `KJV.JHN.3.16-17`     a window of verses in one chapter
 *   `KJV.JHN.3.16-4.2`    (tolerated) a window that crosses a chapter
 * `KJV` is the translation the index was built from, `JHN` the USFM book code.
 * Facet rows carry a suffix (`KJV.GEN.1.1#s0`) that does not parse here; the client
 * then maps the row through its `passage` id or its numeric range (`passageFromRange`).
 * Core verse ids are `book * 1_000_000 + chapter * 1000 + verse`.
 */

import { getUsfmBookByCode } from '../Export/UsfmBookCodes';
import { VerseIdHelper } from '../Data/Core/Types';

export interface MappedPassage {
  /** The id exactly as bibsearch sent it. */
  id: string;
  /** Translation prefix of the id (the index's own translation), e.g. `KJV`. */
  translation: string;
  startVerseId: number;
  /** Equal to `startVerseId` for a single verse. */
  endVerseId: number;
}

const ID_PATTERN = /^([A-Za-z0-9_]+)\.([A-Za-z0-9]{3})\.(\d{1,3})\.(\d{1,3})(?:-(?:(\d{1,3})\.)?(\d{1,3}))?$/;

/**
 * Parse one bibsearch id. Returns null for anything that is not a recognisable
 * passage id, so a caller can drop the row instead of showing a wrong verse.
 */
export function parseBibsearchId(id: unknown): MappedPassage | null {
  if (typeof id !== 'string') return null;
  const m = ID_PATTERN.exec(id.trim());
  if (!m) return null;
  const book = getUsfmBookByCode(m[2].toUpperCase());
  if (!book) return null;
  const chapter = Number(m[3]);
  const verse = Number(m[4]);
  const endChapter = m[5] !== undefined ? Number(m[5]) : chapter;
  const endVerse = m[6] !== undefined ? Number(m[6]) : verse;
  if (chapter < 1 || verse < 1 || endChapter < 1 || endVerse < 1) return null;
  const startVerseId = VerseIdHelper.calculate(book.bookNumber, chapter, verse);
  const endVerseId = VerseIdHelper.calculate(book.bookNumber, endChapter, endVerse);
  if (endVerseId < startVerseId) return null;
  return { id, translation: m[1], startVerseId, endVerseId };
}

/** True when `n` is an integer core verse id with a canonical book (1-66) and chapter and verse >= 1. */
function isValidVerseId(n: number): boolean {
  if (!Number.isInteger(n)) return false;
  const book = Math.floor(n / 1_000_000);
  const chapter = Math.floor(n / 1000) % 1000;
  const verse = n % 1000;
  return book >= 1 && book <= 66 && chapter >= 1 && verse >= 1;
}

/**
 * A passage from a row's numeric `start` / `end` (core verse ids), for facet rows whose
 * id carries a suffix (`KJV.GEN.1.1#s0`). Returns null unless both name real verses in
 * order, so topic rows (`start = end = 0`, or no range) are skipped.
 */
export function passageFromRange(id: string, start: unknown, end: unknown, translation: string): MappedPassage | null {
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  if (!isValidVerseId(start) || !isValidVerseId(end) || end < start) return null;
  return { id, translation, startVerseId: start, endVerseId: end };
}
