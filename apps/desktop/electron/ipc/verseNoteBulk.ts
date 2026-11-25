import type { BnFile } from '../services/BibleNotesFileService';
import { IpcKnownError } from './result';

/** One chapter (or a verse range of it) to read verse notes from. */
export interface VerseNoteQuery {
  bookName: string;
  chapter: number;
  fromVerse?: number;
  toVerse?: number;
}

/** A verse note with content, as returned by `file-notes:read-verse-notes`. */
export interface VerseNoteRecord {
  bookName: string;
  chapter: number;
  verse: number;
  /** Relative to the notes folder, forward slashes. */
  relativePath: string;
  note: BnFile;
}

export const MAX_VERSE_NOTE_QUERIES = 1300;

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/**
 * Validate the argument of `file-notes:read-verse-notes`. Throws
 * `IpcKnownError('invalid_input')` for the first bad item.
 */
export function assertVerseNoteQueries(queries: unknown): asserts queries is VerseNoteQuery[] {
  if (!Array.isArray(queries)) throw new IpcKnownError('invalid_input', 'Queries must be an array');
  if (queries.length > MAX_VERSE_NOTE_QUERIES) {
    throw new IpcKnownError('invalid_input', `At most ${MAX_VERSE_NOTE_QUERIES} queries are allowed`);
  }
  for (const q of queries as Array<Partial<VerseNoteQuery> | null>) {
    if (!q || typeof q !== 'object') throw new IpcKnownError('invalid_input', 'Invalid query');
    if (typeof q.bookName !== 'string' || !q.bookName || /[\\/]|\.\./.test(q.bookName)) {
      throw new IpcKnownError('invalid_input', 'Invalid book name');
    }
    if (!isInt(q.chapter, 1, 200)) throw new IpcKnownError('invalid_input', 'Invalid chapter');
    if (q.fromVerse !== undefined && !isInt(q.fromVerse, 1, 999)) {
      throw new IpcKnownError('invalid_input', 'Invalid from-verse');
    }
    if (q.toVerse !== undefined && !isInt(q.toVerse, 1, 999)) {
      throw new IpcKnownError('invalid_input', 'Invalid to-verse');
    }
  }
}
