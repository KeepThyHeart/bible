/**
 * Worker repo `annotations` (S2, design §4): a plain-DTO facade over markup, notes and collections, one round trip
 * per chapter. Whole-verse/passage only in M3. Read methods are named `get*`/`list*` (no `changed` event).
 * STUB (C3): signatures and DTOs only; S2 fills the bodies. No side effects at module load.
 */
import type { Sync } from '@bible/core/browser';

export interface HighlightDto { id: number; moduleId: number; start: number; end: number; color: string /* #RRGGBB */ }
export interface NoteDto { id: number; start: number; end: number; title: string | null; content: string; modified: string }
export interface BookmarkDto { id: number; start: number; end: number; title: string | null }
export interface ChapterAnnotations { highlights: HighlightDto[]; notes: NoteDto[]; bookmarks: BookmarkDto[] }

export interface AnnotationsRepo {
  getChapter(moduleId: number, startVerseId: number, endVerseId: number): ChapterAnnotations;
  /** Replaces markup on the same range. */
  setHighlight(a: { moduleId: number; start: number; end: number; color: string }): HighlightDto;
  removeHighlight(a: { moduleId: number; start: number; end: number }): number;
  /** Creates the note_verse_link via the repo. */
  saveNote(a: { id?: number; start: number; end: number; title?: string; content: string }): NoteDto;
  deleteNote(id: number): boolean;
  /** In the default collection (`isDefaultBookmarks`). */
  toggleBookmark(a: { start: number; end: number; moduleId?: number; title?: string }): BookmarkDto | null;
  listNotes(limit?: number): NoteDto[];
  listBookmarks(): BookmarkDto[];
}

export function createAnnotationsRepo(sql: Sync.ISql): AnnotationsRepo {
  void sql;
  throw new Error('not implemented');
}
