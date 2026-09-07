import { UserNote } from '../Models/User/UserNote';
import { NoteType, VerseId } from '../Core/Types';
import { RepositoryQueryOptions } from '../Core/IRepository';

/**
 * Summary of a user note for tree view/navigation
 */
export interface NoteSummary {
  noteId: number;
  verseIdStart: VerseId;
  verseIdEnd?: VerseId;
  title?: string;
  modifiedDate: string;
}

/**
 * Interface for User Note repository
 * Defines all operations for working with user notes in the user database
 */
export interface IUserNoteRepository {
  getById(id: number): UserNote | undefined;
  getAll(options?: RepositoryQueryOptions): UserNote[];
  getByType(noteType: NoteType): UserNote[];
  getForVerse(verseId: VerseId): UserNote[];
  getForVerseRange(startVerseId: VerseId, endVerseId: VerseId): UserNote[];
  getTopLevelNotes(): UserNote[];
  getChildNotes(parentNoteId: number): UserNote[];
  countDescendants(noteId: number): number;

  search(query: string): UserNote[];
  getByTag(tag: string): UserNote[];
  getModifiedSince(since: string, limit?: number): UserNote[];

  // Navigation operations
  getNextVerseWithContent(currentVerseId: VerseId): VerseId | undefined;
  getPreviousVerseWithContent(currentVerseId: VerseId): VerseId | undefined;
  getAllNoteSummaries(): NoteSummary[];
  getVersesWithNotesInRange(startVerseId: VerseId, endVerseId: VerseId): VerseId[];

  create(entity: UserNote): UserNote;
  update(entity: UserNote): UserNote;
  delete(id: number): boolean;
}
