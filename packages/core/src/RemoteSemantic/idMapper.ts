/**
 * Maps bibsearch passage ids to the core verse-id format.
 *
 * bibsearch ids are opaque strings defined by its corpus export:
 *   `KJV.JHN.3.16`        one verse
 *   `KJV.JHN.3.16-17`     a window of verses in one chapter
 *   `KJV.JHN.3.16-4.2`    (tolerated) a window that crosses a chapter
 * `KJV` is the translation the index was built from, `JHN` the USFM book code.
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
