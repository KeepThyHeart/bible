/**
 * Pure helpers for the Notes pane's Chapter mode entry points: which chapter a
 * path points at, and what the folder browser's "Compile passage notes..." item
 * asks the compile dialog to prefill.
 */
import * as fileNotesAPI from '../../../services/fileNotesAPI';
import { getBookNumberFromName } from '../../../utils/verseReference';
import { VERSE_NOTES_FOLDER } from './utils';
import { parseVerseNotePath } from '../chapter/verseNotePath';
import type { CompileOptions } from '../../../services/compile/compilePassageNotes';

export interface PathChapter {
  book: number;
  chapter: number;
  /** Set when the path is a verse note. */
  verse?: number;
}

const segments = (path: string): string[] => path.replace(/\\/g, '/').split('/').filter(Boolean);

/** The chapter a verse-note path or a `Verse Notes/<Book>[/<ch>]` folder path points at. */
export function chapterFromPath(path: string): PathChapter | null {
  const note = parseVerseNotePath(path);
  if (note) {
    const book = getBookNumberFromName(note.folderName);
    return book ? { book, chapter: note.chapter, verse: note.verse } : null;
  }
  const parts = segments(path);
  if (parts[0] !== VERSE_NOTES_FOLDER || parts.length < 2 || parts.length > 3) return null;
  const book = getBookNumberFromName(parts[1]);
  if (!book) return null;
  const chapter = parts.length === 3 ? Number(parts[2]) : 1;
  return Number.isInteger(chapter) && chapter >= 1 ? { book, chapter } : null;
}

/** True for `Verse Notes/<Book>` and `Verse Notes/<Book>/<ch>` (the folders Compile is offered on). */
export function isCompilableVerseFolder(path: string): boolean {
  const parts = segments(path);
  return parts[0] === VERSE_NOTES_FOLDER && (parts.length === 2 || parts.length === 3);
}

/** The book as the compile dialog's parser reads it: the localized name, else the folder's own. */
async function bookLabel(folderName: string): Promise<string> {
  const book = getBookNumberFromName(folderName);
  if (!book) return folderName;
  // Loaded on demand: the parser starts locale loading as soon as it is imported.
  const { getLocalizedReferenceParser } = await import('../../../services/localizedReferenceParser');
  return getLocalizedReferenceParser().getBookName(book);
}

/**
 * The compile request for a Verse Notes book or chapter folder: a chapter folder is
 * "<Book> <ch>"; a book folder lists its chapters that have notes ("<Book> 1; <Book> 5"),
 * numerically sorted, with blank verses skipped.
 */
export async function compileRequestForFolder(
  path: string
): Promise<{ reference: string; initialOptions?: Partial<CompileOptions> } | null> {
  if (!isCompilableVerseFolder(path)) return null;
  const parts = segments(path);
  const folderName = parts[1];
  const label = await bookLabel(folderName);
  if (parts.length === 3) return { reference: `${label} ${parts[2]}` };
  const folders = await fileNotesAPI.listVerseNoteChapters(folderName);
  const candidates = folders
    .filter(f => f.isDirectory && /^\d+$/.test(f.name))
    .map(f => Number(f.name))
    .sort((a, b) => a - b);
  const records = candidates.length === 0
    ? []
    : await fileNotesAPI.readVerseNotes(candidates.map(chapter => ({ bookName: folderName, chapter })));
  const withNotes = new Set(records.map(r => r.chapter));
  const list = candidates.filter(c => withNotes.has(c));
  return { reference: list.map(c => `${label} ${c}`).join('; '), initialOptions: { versesWithoutNotes: 'skip' } };
}
