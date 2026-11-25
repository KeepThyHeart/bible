/**
 * Draft verse notes.
 *
 * A verse note that has no file yet opens as an in-memory draft: a `BnFile`
 * with `type: 'verse_note'` and `updated === DRAFT_UPDATED` (a real save always
 * stamps a timestamp, so the empty string cannot be a loaded note). The file
 * (`Verse Notes/<Book>/<chapter>/<verse>.bn`) is written only by the first save
 * with real content; saving an empty draft writes nothing.
 */
import * as fileNotesAPI from '../../../services/fileNotesAPI';
import type { BnFile } from '../../../services/fileNotesAPI';
import { noteHasContent } from '../../../../../electron/utils/noteHasContent';
import { useFileNotesStore } from '../../../stores/useFileNotesStore';
import { parseVerseId, getBookNameFromCache, getBookNumberFromName } from '../../../utils/verseReference';
import { VERSE_NOTES_FOLDER } from './utils';

/** The `updated` value of a draft: it has no file, so no baseline. */
export const DRAFT_UPDATED = '';

export function isDraftNote(note: BnFile | null | undefined): boolean {
  return !!note && note.type === 'verse_note' && note.updated === DRAFT_UPDATED;
}

/** Relative path (forward slashes) the draft's file will have once saved. */
export function verseNoteRelativePath(bookName: string, chapter: number, verse: number): string {
  return `${VERSE_NOTES_FOLDER}/${bookName}/${chapter}/${verse}.bn`;
}

export function buildDraftVerseNote(
  bookName: string,
  chapter: number,
  verse: number,
  verseId: number
): { note: BnFile; relativePath: string } {
  const now = new Date().toISOString();
  return {
    relativePath: verseNoteRelativePath(bookName, chapter, verse),
    note: {
      bn: 1,
      type: 'verse_note',
      title: `${bookName} ${chapter}:${verse}`,
      tags: [],
      passages: [{ start: verseId, end: verseId, association: 'primary' }],
      created: now,
      updated: DRAFT_UPDATED,
      content: '',
      metadata: {},
    },
  };
}

/**
 * The verse a `Verse Notes/<Book>/<chapter>/<verse>.bn` path stands for, or
 * null when the path is not one (or the book name is not known to this window).
 */
export function parseVerseNotePath(
  path: string
): { bookName: string; chapter: number; verse: number; verseId: number } | null {
  const m = /^Verse Notes\/([^/]+)\/(\d+)\/(\d+)\.bn$/.exec(path.replace(/\\/g, '/'));
  if (!m) return null;
  const bookNumber = getBookNumberFromName(m[1]);
  if (!bookNumber) return null;
  const chapter = Number(m[2]);
  const verse = Number(m[3]);
  const verseId = bookNumber * 1_000_000 + chapter * 1000 + verse;
  return { bookName: m[1], chapter, verse, verseId };
}

/** The draft for a verse note path that has no file, or null if the path is not a verse note's. */
export function draftForPath(path: string): { note: BnFile; relativePath: string } | null {
  const info = parseVerseNotePath(path);
  return info ? buildDraftVerseNote(info.bookName, info.chapter, info.verse, info.verseId) : null;
}

/** Draft for a verse id, named with the current book-name cache. */
export function draftForVerse(verseId: number): { note: BnFile; relativePath: string; bookName: string; chapter: number; verse: number } {
  const { bookNumber, chapter, verse } = parseVerseId(verseId);
  const bookName = getBookNameFromCache(bookNumber);
  return { ...buildDraftVerseNote(bookName, chapter, verse, verseId), bookName, chapter, verse };
}

/**
 * Save a draft: writes nothing (and returns `DRAFT_UPDATED`, so the note stays a
 * draft) while the content is empty; creates the file on the first save with
 * content and returns its `updated`.
 */
export async function saveDraftNote(path: string, note: BnFile): Promise<string> {
  const html = typeof note.content === 'string' ? note.content : '';
  if (!noteHasContent(html)) return DRAFT_UPDATED;
  const verseId = note.passages[0]?.start;
  if (!verseId) return DRAFT_UPDATED;
  // The book folder the draft was opened under, so the file lands exactly where `path` says.
  const book = path.replace(/\\/g, '/').split('/')[1];
  const saved = await fileNotesAPI.saveVerseNote(verseId, html, undefined, book);
  useFileNotesStore.getState().addRecentFile(saved.relativePath, saved.note.title); // allow-getstate: async save callback - imperative store update outside render
  return saved.note.updated;
}
