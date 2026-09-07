import { IUserNoteRepository } from '../Data/Repositories/IUserNoteRepository';
import { UserNote } from '../Data/Models/User/UserNote';
import { VerseId, NoteType } from '../Data/Core/Types';
import { RepositoryQueryOptions } from '../Data/Core/IRepository';

/** Input for creating a new note. Partial because ID and timestamps are auto-assigned. */
export interface CreateNoteInput {
  title?: string;
  content: string;
  noteType?: NoteType;
  documentType?: string;
  verseIdStart?: VerseId;
  verseIdEnd?: VerseId;
  tags?: string[];
  userCommentaryId?: number;
  parentNoteId?: number;
  seriesName?: string;
  entryDate?: string;
}

/** Filter criteria for querying notes. All fields are optional - omitted fields are not filtered. */
export interface NoteFilter {
  noteType?: NoteType;
  tag?: string;
  searchQuery?: string;
  verseId?: VerseId;
  verseRange?: { start: VerseId; end: VerseId };
  parentNoteId?: number;
  modifiedSince?: string;
  modifiedBefore?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'modified_date' | 'created_date' | 'title';
  orderDirection?: 'ASC' | 'DESC';
}

/**
 * Controller for user notes operations.
 * Provides business logic layer between UI and data repositories.
 */
export class NotesController {
  constructor(private noteRepository: IUserNoteRepository) {}

  /**
   * Get a note by ID
   */
  /** Get a note by its ID (SQLite auto-increment integer from the user_note table). */
  getNoteById(id: number): UserNote | undefined {
    return this.noteRepository.getById(id);
  }

  /**
   * Get all notes with optional filtering and sorting.
   * See also getFilteredNotes() for more specific filtering (by type, date, tag, etc.).
   */
  getAllNotes(options?: RepositoryQueryOptions): UserNote[] {
    return this.noteRepository.getAll(options);
  }

  /**
   * Get notes by type (verse_note, document, sermon, study, journal, prayer)
   */
  getNotesByType(noteType: NoteType): UserNote[] {
    return this.noteRepository.getByType(noteType);
  }

  /**
   * Get verse notes (commentary-style notes about specific verses)
   */
  getVerseNotes(): UserNote[] {
    return this.noteRepository.getByType('verse_note');
  }

  /**
   * Get document notes (freeform documents)
   */
  getDocumentNotes(): UserNote[] {
    return this.noteRepository.getByType('document');
  }

  /**
   * Get sermon notes
   */
  getSermonNotes(): UserNote[] {
    return this.noteRepository.getByType('sermon');
  }

  /**
   * Get journal entries
   */
  getJournalEntries(): UserNote[] {
    return this.noteRepository.getByType('journal');
  }

  /**
   * Get prayer notes
   */
  getPrayerNotes(): UserNote[] {
    return this.noteRepository.getByType('prayer');
  }

  /**
   * Get notes for a specific verse
   */
  getNotesForVerse(verseId: VerseId): UserNote[] {
    return this.noteRepository.getForVerse(verseId);
  }

  /**
   * Get notes for a verse range
   */
  getNotesForVerseRange(startVerseId: VerseId, endVerseId: VerseId): UserNote[] {
    return this.noteRepository.getForVerseRange(startVerseId, endVerseId);
  }

  /**
   * Get top-level notes (no parent)
   */
  getTopLevelNotes(): UserNote[] {
    return this.noteRepository.getTopLevelNotes();
  }

  /**
   * Get child notes for a parent note
   */
  getChildNotes(parentNoteId: number): UserNote[] {
    return this.noteRepository.getChildNotes(parentNoteId);
  }

  /**
   * Count all descendants of a note. Deleting a note cascades to its subtree,
   * so callers use this to confirm before a destructive cascade delete (A6).
   */
  countDescendants(noteId: number): number {
    return this.noteRepository.countDescendants(noteId);
  }

  /**
   * Search notes by content using FTS
   */
  searchNotes(query: string): UserNote[] {
    if (!query || query.trim().length === 0) {
      return [];
    }
    return this.noteRepository.search(query);
  }

  /**
   * Get notes by tag
   */
  getNotesByTag(tag: string): UserNote[] {
    return this.noteRepository.getByTag(tag);
  }

  /**
   * Get all unique tags from all notes
   */
  getAllTags(): string[] {
    const allNotes = this.noteRepository.getAll();
    const tagSet = new Set<string>();

    allNotes.forEach(note => {
      note.tags.forEach(tag => tagSet.add(tag));
    });

    return Array.from(tagSet).sort();
  }

  /**
   * Create a new note
   */
  /**
   * Create a new note. Accepts a partial input object rather than a full UserNote
   * because the ID, timestamps, and defaults are assigned during creation.
   */
  createNote(noteData: CreateNoteInput): UserNote {
    const note = new UserNote({
      title: noteData.title,
      content: noteData.content,
      noteType: noteData.noteType ?? 'document',
      documentType: noteData.documentType,
      verseIdStart: noteData.verseIdStart,
      verseIdEnd: noteData.verseIdEnd,
      tags: noteData.tags ?? [],
      userCommentaryId: noteData.userCommentaryId,
      parentNoteId: noteData.parentNoteId,
      seriesName: noteData.seriesName,
      entryDate: noteData.entryDate
    });

    return this.noteRepository.create(note);
  }

  /**
   * Create a verse note (commentary-style note about a verse or passage)
   */
  createVerseNote(
    verseIdStart: VerseId,
    content: string,
    options?: {
      verseIdEnd?: VerseId;
      title?: string;
      userCommentaryId?: number;
      tags?: string[];
    }
  ): UserNote {
    return this.createNote({
      title: options?.title,
      content,
      noteType: 'verse_note',
      verseIdStart,
      verseIdEnd: options?.verseIdEnd,
      userCommentaryId: options?.userCommentaryId,
      tags: options?.tags
    });
  }

  /**
   * Create a document note (freeform document)
   */
  createDocument(
    title: string,
    content: string,
    documentType?: string,
    tags?: string[]
  ): UserNote {
    return this.createNote({
      title,
      content,
      noteType: 'document',
      documentType: documentType ?? 'General',
      tags
    });
  }

  /**
   * Create a sermon note
   */
  createSermon(
    title: string,
    content: string,
    passageVerseId?: VerseId,
    seriesName?: string,
    tags?: string[]
  ): UserNote {
    return this.createNote({
      title,
      content,
      noteType: 'sermon',
      documentType: 'Sermon',
      verseIdStart: passageVerseId,
      seriesName,
      tags
    });
  }

  /**
   * Create a journal entry
   */
  createJournalEntry(
    title: string,
    content: string,
    entryDate?: string,
    tags?: string[]
  ): UserNote {
    const note = new UserNote({
      title,
      content,
      noteType: 'journal',
      documentType: 'Journal',
      entryDate: entryDate ?? new Date().toISOString().split('T')[0], // YYYY-MM-DD
      tags
    });

    return this.noteRepository.create(note);
  }

  /**
   * Create a prayer note
   */
  createPrayer(
    title: string,
    content: string,
    tags?: string[]
  ): UserNote {
    return this.createNote({
      title,
      content,
      noteType: 'prayer',
      documentType: 'Prayer',
      tags
    });
  }

  /**
   * Update an existing note
   */
  updateNote(note: UserNote): UserNote {
    return this.noteRepository.update(note);
  }

  /**
   * Update note content
   */
  updateNoteContent(noteId: number, content: string): UserNote | undefined {
    const note = this.noteRepository.getById(noteId);
    if (!note) return undefined;

    note.content = content;
    return this.noteRepository.update(note);
  }

  /**
   * Update note title
   */
  updateNoteTitle(noteId: number, title: string): UserNote | undefined {
    const note = this.noteRepository.getById(noteId);
    if (!note) return undefined;

    note.title = title;
    return this.noteRepository.update(note);
  }

  /**
   * Add tag to note
   */
  addTagToNote(noteId: number, tag: string): UserNote | undefined {
    const note = this.noteRepository.getById(noteId);
    if (!note) return undefined;

    note.addTag(tag);
    return this.noteRepository.update(note);
  }

  /**
   * Remove tag from note
   */
  removeTagFromNote(noteId: number, tag: string): UserNote | undefined {
    const note = this.noteRepository.getById(noteId);
    if (!note) return undefined;

    note.removeTag(tag);
    return this.noteRepository.update(note);
  }

  /**
   * Delete a note
   */
  deleteNote(noteId: number): boolean {
    return this.noteRepository.delete(noteId);
  }

  /**
   * Get recent notes (last N modified)
   */
  getRecentNotes(limit: number = 10): UserNote[] {
    return this.noteRepository.getAll({
      orderBy: 'modified_date',
      orderDirection: 'DESC',
      limit
    });
  }

  /**
   * Get notes modified after a specific date.
   */
  getNotesModifiedSince(since: string, limit?: number): UserNote[] {
    return this.noteRepository.getModifiedSince(since, limit);
  }

  /**
   * Query notes using a flexible filter. Dispatches to the most specific
   * repository method available, then applies remaining filters in-memory.
   */
  getFilteredNotes(filter: NoteFilter): UserNote[] {
    let notes: UserNote[];

    // Use the most specific repository method available
    if (filter.searchQuery) {
      notes = this.noteRepository.search(filter.searchQuery);
    } else if (filter.tag) {
      notes = this.noteRepository.getByTag(filter.tag);
    } else if (filter.verseId) {
      notes = this.noteRepository.getForVerse(filter.verseId);
    } else if (filter.verseRange) {
      notes = this.noteRepository.getForVerseRange(filter.verseRange.start, filter.verseRange.end);
    } else if (filter.noteType) {
      notes = this.noteRepository.getByType(filter.noteType);
    } else if (filter.modifiedSince) {
      notes = this.noteRepository.getModifiedSince(filter.modifiedSince);
    } else {
      notes = this.noteRepository.getAll({
        orderBy: filter.orderBy,
        orderDirection: filter.orderDirection,
        limit: filter.limit,
        offset: filter.offset
      });
    }

    // Apply remaining in-memory filters for criteria the initial query didn't cover
    if (filter.noteType && !filter.verseId && !filter.verseRange && !filter.tag && !filter.searchQuery) {
      // Already filtered by type above
    } else if (filter.noteType) {
      notes = notes.filter(n => n.noteType === filter.noteType);
    }

    if (filter.parentNoteId !== undefined) {
      notes = notes.filter(n => n.parentNoteId === filter.parentNoteId);
    }

    if (filter.modifiedBefore) {
      notes = notes.filter(n => n.modifiedDate && n.modifiedDate < filter.modifiedBefore!);
    }

    if (filter.modifiedSince && !filter.searchQuery && !filter.tag && !filter.verseId && !filter.verseRange && !filter.noteType) {
      // Already filtered by modifiedSince above
    } else if (filter.modifiedSince) {
      notes = notes.filter(n => n.modifiedDate && n.modifiedDate > filter.modifiedSince!);
    }

    // Apply ordering and pagination if not already applied
    if (filter.orderBy) {
      const dir = filter.orderDirection === 'ASC' ? 1 : -1;
      const field = filter.orderBy === 'modified_date' ? 'modifiedDate' : filter.orderBy === 'created_date' ? 'createdDate' : 'title';
      notes.sort((a, b) => {
        const aVal = (field === 'modifiedDate' ? a.modifiedDate : field === 'createdDate' ? a.createdDate : a.title) ?? '';
        const bVal = (field === 'modifiedDate' ? b.modifiedDate : field === 'createdDate' ? b.createdDate : b.title) ?? '';
        return aVal < bVal ? -dir : aVal > bVal ? dir : 0;
      });
    }

    if (filter.offset) {
      notes = notes.slice(filter.offset);
    }
    if (filter.limit) {
      notes = notes.slice(0, filter.limit);
    }

    return notes;
  }

  /**
   * Get the next verse ID that has a note
   */
  getNextVerseWithContent(currentVerseId: VerseId): VerseId | undefined {
    return this.noteRepository.getNextVerseWithContent(currentVerseId);
  }

  /**
   * Get the previous verse ID that has a note
   */
  getPreviousVerseWithContent(currentVerseId: VerseId): VerseId | undefined {
    return this.noteRepository.getPreviousVerseWithContent(currentVerseId);
  }

  /**
   * Get all note summaries for tree view/navigation
   */
  getAllNoteSummaries() {
    return this.noteRepository.getAllNoteSummaries();
  }

  /**
   * Get verse IDs that have notes attached within a range
   * Used for displaying note indicators in the Bible view
   */
  getVersesWithNotesInRange(startVerseId: VerseId, endVerseId: VerseId): VerseId[] {
    return this.noteRepository.getVersesWithNotesInRange(startVerseId, endVerseId);
  }

  /**
   * Get note statistics
   */
  getNoteStatistics(): {
    total: number;
    byType: Record<NoteType, number>;
    totalTags: number;
    recentlyModified: number; // Last 7 days
  } {
    const allNotes = this.noteRepository.getAll();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString();

    const byType: Record<NoteType, number> = {
      verse_note: 0,
      document: 0,
      sermon: 0,
      study: 0,
      journal: 0,
      prayer: 0
    };

    let recentlyModified = 0;

    allNotes.forEach(note => {
      byType[note.noteType] = (byType[note.noteType] || 0) + 1;
      if (note.modifiedDate && note.modifiedDate > sevenDaysAgoStr) {
        recentlyModified++;
      }
    });

    return {
      total: allNotes.length,
      byType,
      totalTags: this.getAllTags().length,
      recentlyModified
    };
  }
}
