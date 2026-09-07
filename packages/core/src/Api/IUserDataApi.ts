/**
 * User data operations - notes, highlights, cross-references, collections.
 *
 * These are the user's own data stored in user_*.db, distinct from module
 * content. All operations are scoped to a user context.
 */

import type {
  UserCrossReferenceResult,
  UserHighlightResult,
  UserNoteResult
} from './ApiTypes';

export interface IUserDataApi {
  // --- Cross-References -------------------------------------------
  getUserCrossReferences(verseId: number): Promise<UserCrossReferenceResult[]>;
  createUserCrossReference(sourceVerseId: number, targetVerseId: number, notes?: string): Promise<UserCrossReferenceResult>;
  deleteUserCrossReference(crossRefId: number): Promise<void>;

  // --- Highlights -------------------------------------------------
  getHighlightsForVerse(verseId: number): Promise<UserHighlightResult[]>;
  getHighlightsForModule(moduleAbbreviation: string): Promise<UserHighlightResult[]>;
  createHighlight(verseId: number, moduleAbbreviation: string, colorCode: string): Promise<UserHighlightResult>;
  updateHighlight(highlightId: number, colorCode: string): Promise<UserHighlightResult>;
  deleteHighlight(highlightId: number): Promise<void>;

  // --- Notes ------------------------------------------------------
  getNoteById(noteId: number): Promise<UserNoteResult | null>;
  getNotesForVerse(verseId: number): Promise<UserNoteResult[]>;
  searchNotes(query: string): Promise<UserNoteResult[]>;
  createNote(note: {
    noteType: string;
    title: string;
    content: string;
    verseId?: number;
    tags?: string[];
  }): Promise<UserNoteResult>;
  updateNote(noteId: number, updates: {
    title?: string;
    content?: string;
    tags?: string[];
  }): Promise<UserNoteResult>;
  deleteNote(noteId: number): Promise<void>;

  // --- Collections / Bookmarks ------------------------------------
  getCollections(): Promise<Array<{ collectionId: number; name: string; parentId?: number }>>;
  createCollection(name: string, parentId?: number): Promise<{ collectionId: number; name: string }>;
  addVerseToCollection(collectionId: number, verseId: number): Promise<void>;
  removeVerseFromCollection(collectionId: number, verseId: number): Promise<void>;
  isVerseBookmarked(verseId: number): Promise<boolean>;
}
