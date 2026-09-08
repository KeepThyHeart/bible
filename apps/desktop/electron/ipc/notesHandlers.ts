import log from 'electron-log/main';
import { EncryptedSqliteProvider } from '../providers/EncryptedSqliteProvider';
import { UserNoteRepository } from '@bible/core';
import { UserCommentaryRepository } from '@bible/core';
import { NotesController } from '@bible/core';
import { UserNote } from '@bible/core';
import { UserCommentary } from '@bible/core';
import { NoteType, VerseId, ContentFormat, Visibility, Metadata, RepositoryQueryOptions } from '@bible/core';
import { initializeCollectionService } from './collectionHandlers';
import { indexContentVerseReferences } from '../utils/verseIndexing';
import { getSharedUserDb } from '../services/sharedUserDb';
import { initializeUserSchema } from '../schema/userSchema';
import { ipcHandler, IpcKnownError } from './handler-helper';

/** Shape of note data received over IPC for creation */
interface CreateNoteData {
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

/** Shape of note data received over IPC for updates (includes noteId and all fields) */
interface UpdateNoteData extends CreateNoteData {
  noteId?: number;
  contentFormat?: ContentFormat;
  visibility?: Visibility;
  createdDate?: string;
  modifiedDate?: string;
  metadata?: Metadata;
  linkedVerses?: Array<{
    linkId?: number;
    noteId: number;
    verseIdStart: VerseId;
    verseIdEnd?: VerseId;
    linkType: string;
    wordStart?: number;
    wordEnd?: number;
    metadata?: Metadata;
  }>;
}

/** Shape of prayer list data received over IPC */
interface PrayerListData {
  userCommentaryId?: number;
  name: string;
  description?: string;
  createdDate?: string;
  modifiedDate?: string;
  isDefault?: boolean;
  color?: string;
  metadata?: Metadata;
}

/** Serialized representation of a UserNote for IPC transmission */
interface SerializedNote {
  noteId?: number;
  userCommentaryId?: number;
  parentNoteId?: number;
  verseIdStart?: VerseId;
  verseIdEnd?: VerseId;
  title?: string;
  content: string;
  contentFormat: string;
  noteType: string;
  documentType?: string;
  visibility: string;
  createdDate?: string;
  modifiedDate?: string;
  tags: string[];
  seriesName?: string;
  entryDate?: string;
  metadata?: Metadata;
  linkedVerses: Array<{
    linkId?: number;
    noteId: number;
    verseIdStart: VerseId;
    verseIdEnd?: VerseId;
    linkType: string;
    wordStart?: number;
    wordEnd?: number;
    metadata?: Metadata;
  }>;
  children: SerializedNote[];
}

/** Serialized representation of a UserCommentary for IPC transmission */
interface SerializedCommentary {
  userCommentaryId?: number;
  name: string;
  description?: string;
  createdDate?: string;
  modifiedDate?: string;
  isDefault: boolean;
  color?: string;
  metadata?: Metadata;
}

// Singleton instances
let notesController: NotesController | null = null;
let commentaryRepository: UserCommentaryRepository | null = null;

/**
 * Initialize the notes controller using shared user database
 * Call this on app startup or when user logs in
 */
export async function initializeNotesDatabase(username: string = 'default') {
  const userDb = await getSharedUserDb(username);

  // Check if database is new by checking for user_note table
  const noteTableCheck = userDb.queryOne(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='user_note'"
  );

  if (!noteTableCheck) {
    initializeUserDatabaseSchema(userDb);
  } else {
    ensureUserDatabaseSchema(userDb);
  }

  const noteRepository = new UserNoteRepository(userDb);
  notesController = new NotesController(noteRepository);
  commentaryRepository = new UserCommentaryRepository(userDb);

  // Initialize collection service with the same user database
  initializeCollectionService(userDb);

  console.log('Notes controller initialized successfully');

  return notesController;
}

/**
 * Initialize the user database schema
 */
function initializeUserDatabaseSchema(db: EncryptedSqliteProvider): void {
  initializeUserSchema(db);
}

/**
 * Ensure user database schema is complete (for existing databases).
 * Delegates to the centralized schema which uses IF NOT EXISTS for idempotency.
 */
function ensureUserDatabaseSchema(db: EncryptedSqliteProvider): void {
  initializeUserSchema(db);
}

/**
 * Get the notes controller instance.
 * If the controller has not been initialized yet, throws an
 * `IpcKnownError('unavailable', ...)` so the renderer gets a classified
 * envelope instead of crashing.
 */
function getNotesController(): NotesController {
  if (!notesController) {
    // Kick off initialization; the promise is intentionally ignored - the
    // next call will find it ready. In the meantime, callers get a clean
    // "unavailable" error instead of an unhandled null dereference.
    void initializeNotesDatabase();
    throw new IpcKnownError('unavailable', 'Notes database not initialized yet');
  }
  return notesController;
}

function getCommentaryRepository(): UserCommentaryRepository {
  if (!commentaryRepository) {
    void initializeNotesDatabase();
    throw new IpcKnownError('unavailable', 'Prayer list repository not initialized yet');
  }
  return commentaryRepository;
}

/**
 * Register all IPC handlers for notes operations.
 *
 * Uses the `Result<T>` envelope convention. Replies
 * are shaped as `{ ok, value } | { ok: false, error }`. The renderer side
 * lives in `src/ui/services/notesAPI.ts` and `prayerListsAPI.ts`, both of
 * which use `unwrap` from `src/ui/services/ipcResult.ts`.
 */
export function registerNotesHandlers() {
  // Get note by ID - returns null if not found (empty state, not an error).
  ipcHandler<[number], SerializedNote | null>('notes:get-by-id', (noteId) => {
    const controller = getNotesController();
    const note = controller.getNoteById(noteId);
    return note ? serializeNote(note) : null;
  });

  // Get all notes
  ipcHandler<[RepositoryQueryOptions | undefined], SerializedNote[]>('notes:get-all', (options) => {
    const controller = getNotesController();
    const notes = controller.getAllNotes(options);
    return notes.map(serializeNote);
  });

  // Get notes by type
  ipcHandler<[NoteType], SerializedNote[]>('notes:get-by-type', (noteType) => {
    const controller = getNotesController();
    const notes = controller.getNotesByType(noteType);
    return notes.map(serializeNote);
  });

  // Get verse notes
  ipcHandler<[], SerializedNote[]>('notes:get-verse-notes', () => {
    const controller = getNotesController();
    const notes = controller.getVerseNotes();
    return notes.map(serializeNote);
  });

  // Get document notes
  ipcHandler<[], SerializedNote[]>('notes:get-documents', () => {
    const controller = getNotesController();
    const notes = controller.getDocumentNotes();
    return notes.map(serializeNote);
  });

  // Get journal entries
  ipcHandler<[], SerializedNote[]>('notes:get-journals', () => {
    const controller = getNotesController();
    const notes = controller.getJournalEntries();
    return notes.map(serializeNote);
  });

  // Get prayer notes
  ipcHandler<[], SerializedNote[]>('notes:get-prayers', () => {
    const controller = getNotesController();
    const notes = controller.getPrayerNotes();
    return notes.map(serializeNote);
  });

  // Get notes for verse (special handling: return empty if user DB schema
  // hasn't been created yet instead of surfacing a misleading error).
  ipcHandler<[VerseId], SerializedNote[]>('notes:get-for-verse', (verseId) => {
    try {
      const controller = getNotesController();
      const notes = controller.getNotesForVerse(verseId);
      return notes.map(serializeNote);
    } catch (error: unknown) {
      if (error instanceof Error && error.message?.includes('no such table: user_note')) {
        log.warn('User database not fully initialized yet, returning empty notes array');
        return [];
      }
      throw error;
    }
  });

  // Get notes for verse range (same fallback as above).
  ipcHandler<[VerseId, VerseId], SerializedNote[]>(
    'notes:get-for-verse-range',
    (startVerseId, endVerseId) => {
      try {
        const controller = getNotesController();
        const notes = controller.getNotesForVerseRange(startVerseId, endVerseId);
        return notes.map(serializeNote);
      } catch (error: unknown) {
        if (error instanceof Error && error.message?.includes('no such table: user_note')) {
          log.warn('User database not fully initialized yet, returning empty notes array');
          return [];
        }
        throw error;
      }
    }
  );

  // Search notes
  ipcHandler<[string], SerializedNote[]>('notes:search', (query) => {
    const controller = getNotesController();
    const notes = controller.searchNotes(query);
    return notes.map(serializeNote);
  });

  // Get notes by tag
  ipcHandler<[string], SerializedNote[]>('notes:get-by-tag', (tag) => {
    const controller = getNotesController();
    const notes = controller.getNotesByTag(tag);
    return notes.map(serializeNote);
  });

  // Get all tags
  ipcHandler<[], string[]>('notes:get-all-tags', () => {
    const controller = getNotesController();
    return controller.getAllTags();
  });

  // Create note
  ipcHandler<[CreateNoteData], SerializedNote>('notes:create', async (noteData) => {
    const controller = getNotesController();
    const note = controller.createNote(noteData);

    // Index verse references automatically
    if (note.content) {
      const noteTypeMapping: Record<string, 'note' | 'journal' | 'prayer' | 'document'> = {
        'journal': 'journal',
        'prayer': 'prayer',
        'document': 'document',
        'sermon': 'document',
        'study': 'document',
        'verse_note': 'note'
      };

      const contentType = noteTypeMapping[note.noteType] || 'note';

      try {
        const db = await getSharedUserDb();
        await indexContentVerseReferences(db, contentType, note.noteId!, note.content);
      } catch (error) {
        log.error('Error indexing verse references (non-fatal):', error);
      }
    }

    return serializeNote(note);
  });

  // Create verse note
  ipcHandler<
    [VerseId, string, { verseIdEnd?: VerseId; title?: string; userCommentaryId?: number; tags?: string[] } | undefined],
    SerializedNote
  >('notes:create-verse-note', (verseIdStart, content, options) => {
    const controller = getNotesController();
    const note = controller.createVerseNote(verseIdStart, content, options);
    return serializeNote(note);
  });

  // Create document
  ipcHandler<[string, string, string | undefined, string[] | undefined], SerializedNote>(
    'notes:create-document',
    (title, content, documentType, tags) => {
      const controller = getNotesController();
      const note = controller.createDocument(title, content, documentType, tags);
      return serializeNote(note);
    }
  );

  // Update note
  ipcHandler<[UpdateNoteData], SerializedNote>('notes:update', async (noteData) => {
    const controller = getNotesController();
    const note = deserializeNote(noteData);
    const updated = controller.updateNote(note);

    // Index verse references automatically
    if (updated.content) {
      const noteTypeMapping: Record<string, 'note' | 'journal' | 'prayer' | 'document'> = {
        'journal': 'journal',
        'prayer': 'prayer',
        'document': 'document',
        'sermon': 'document',
        'study': 'document',
        'verse_note': 'note'
      };

      const contentType = noteTypeMapping[updated.noteType] || 'note';

      try {
        const db = await getSharedUserDb();
        await indexContentVerseReferences(db, contentType, updated.noteId!, updated.content);
      } catch (error) {
        log.error('Error indexing verse references (non-fatal):', error);
      }
    }

    return serializeNote(updated);
  });

  // Update note content
  ipcHandler<[number, string], SerializedNote | null>(
    'notes:update-content',
    (noteId, content) => {
      const controller = getNotesController();
      const note = controller.updateNoteContent(noteId, content);
      return note ? serializeNote(note) : null;
    }
  );

  // Update note title
  ipcHandler<[number, string], SerializedNote | null>('notes:update-title', (noteId, title) => {
    const controller = getNotesController();
    const note = controller.updateNoteTitle(noteId, title);
    return note ? serializeNote(note) : null;
  });

  // Add tag
  ipcHandler<[number, string], SerializedNote | null>('notes:add-tag', (noteId, tag) => {
    const controller = getNotesController();
    const note = controller.addTagToNote(noteId, tag);
    return note ? serializeNote(note) : null;
  });

  // Remove tag
  ipcHandler<[number, string], SerializedNote | null>('notes:remove-tag', (noteId, tag) => {
    const controller = getNotesController();
    const note = controller.removeTagFromNote(noteId, tag);
    return note ? serializeNote(note) : null;
  });

  // Count descendants (for cascade-delete confirmation, A6)
  ipcHandler<[number], number>('notes:count-descendants', (noteId) => {
    const controller = getNotesController();
    return controller.countDescendants(noteId);
  });

  // Delete note
  ipcHandler<[number], boolean>('notes:delete', (noteId) => {
    const controller = getNotesController();
    return controller.deleteNote(noteId);
  });

  // Get recent notes
  ipcHandler<[number | undefined], SerializedNote[]>('notes:get-recent', (limit) => {
    const controller = getNotesController();
    const notes = controller.getRecentNotes(limit);
    return notes.map(serializeNote);
  });

  // Get note statistics
  ipcHandler<[], unknown>('notes:get-statistics', () => {
    const controller = getNotesController();
    return controller.getNoteStatistics();
  });

  // Navigation: Get next verse with content
  ipcHandler<[VerseId], VerseId | null>('notes:getNextVerseWithContent', (currentVerseId) => {
    const controller = getNotesController();
    return controller.getNextVerseWithContent(currentVerseId) ?? null;
  });

  // Navigation: Get previous verse with content
  ipcHandler<[VerseId], VerseId | null>('notes:getPreviousVerseWithContent', (currentVerseId) => {
    const controller = getNotesController();
    return controller.getPreviousVerseWithContent(currentVerseId) ?? null;
  });

  // Navigation: Get all note summaries
  ipcHandler<[], unknown>('notes:getAllNoteSummaries', () => {
    const controller = getNotesController();
    return controller.getAllNoteSummaries();
  });

  // Get verses that have notes in a range (same uninitialized-DB fallback).
  ipcHandler<[VerseId, VerseId], VerseId[]>(
    'notes:get-verses-with-notes',
    (startVerseId, endVerseId) => {
      try {
        const controller = getNotesController();
        return controller.getVersesWithNotesInRange(startVerseId, endVerseId);
      } catch (error: unknown) {
        if (error instanceof Error && error.message?.includes('no such table: user_note')) {
          log.warn('User database not fully initialized yet, returning empty verses array');
          return [];
        }
        throw error;
      }
    }
  );

  // === Prayer List Handlers ===

  // Get all prayer lists
  ipcHandler<[], SerializedCommentary[]>('prayer-lists:get-all', () => {
    const repo = getCommentaryRepository();
    const lists = repo.getAll();
    const sortedLists = lists.sort((a, b) => {
      const orderA = typeof a.metadata?.sortOrder === 'number' ? a.metadata.sortOrder : Number.MAX_SAFE_INTEGER;
      const orderB = typeof b.metadata?.sortOrder === 'number' ? b.metadata.sortOrder : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });
    return sortedLists.map(serializeCommentary);
  });

  // Get prayer list by ID
  ipcHandler<[number], SerializedCommentary | null>('prayer-lists:get-by-id', (id) => {
    const repo = getCommentaryRepository();
    const list = repo.getById(id);
    return list ? serializeCommentary(list) : null;
  });

  // Create prayer list
  ipcHandler<[PrayerListData], SerializedCommentary>('prayer-lists:create', (listData) => {
    const repo = getCommentaryRepository();
    const list = new UserCommentary({
      name: listData.name,
      description: listData.description,
      color: listData.color,
      metadata: listData.metadata
    });
    const created = repo.create(list);
    return serializeCommentary(created);
  });

  // Update prayer list
  ipcHandler<[PrayerListData], SerializedCommentary>('prayer-lists:update', (listData) => {
    const repo = getCommentaryRepository();
    const list = new UserCommentary({
      userCommentaryId: listData.userCommentaryId,
      name: listData.name,
      description: listData.description,
      createdDate: listData.createdDate,
      modifiedDate: listData.modifiedDate,
      isDefault: listData.isDefault,
      color: listData.color,
      metadata: listData.metadata
    });
    const updated = repo.update(list);
    return serializeCommentary(updated);
  });

  // Delete prayer list
  ipcHandler<[number], boolean>('prayer-lists:delete', (id) => {
    const repo = getCommentaryRepository();
    return repo.delete(id);
  });

  // Get prayers for a list
  ipcHandler<[number], SerializedNote[]>('prayer-lists:get-prayers', (listId) => {
    const controller = getNotesController();
    const notes = controller.getNotesByType('prayer').filter(
      n => n.userCommentaryId === listId
    );
    const sortedNotes = notes.sort((a, b) => {
      const orderA = typeof a.metadata?.sortOrder === 'number' ? a.metadata.sortOrder : Number.MAX_SAFE_INTEGER;
      const orderB = typeof b.metadata?.sortOrder === 'number' ? b.metadata.sortOrder : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      const dateA = a.createdDate ? new Date(a.createdDate).getTime() : 0;
      const dateB = b.createdDate ? new Date(b.createdDate).getTime() : 0;
      return dateB - dateA;
    });
    return sortedNotes.map(serializeNote);
  });

  // Get prayer count for a list
  ipcHandler<[number], number>('prayer-lists:get-prayer-count', (listId) => {
    const repo = getCommentaryRepository();
    return repo.countNotes(listId);
  });

  // Reorder prayers in a list
  ipcHandler<[number, number[]], void>(
    'prayer-lists:reorder-prayers',
    (_listId, prayerIds) => {
      const controller = getNotesController();
      prayerIds.forEach((prayerId, index) => {
        const note = controller.getNoteById(prayerId);
        if (note) {
          note.metadata = { ...note.metadata, sortOrder: index };
          controller.updateNote(note);
        }
      });
    }
  );

  // Reorder prayer lists
  ipcHandler<[number[]], void>('prayer-lists:reorder', (listIds) => {
    const repo = getCommentaryRepository();
    listIds.forEach((listId, index) => {
      const list = repo.getById(listId);
      if (list) {
        list.metadata = { ...list.metadata, sortOrder: index };
        repo.update(list);
      }
    });
  });
}

/**
 * Serialize UserNote for IPC transmission
 * Converts class instance to plain object
 * Uses JSON serialization to ensure all data is cloneable
 */
function serializeNote(note: UserNote): SerializedNote {
  try {
    const plainObject = {
      noteId: note.noteId ?? undefined,
      userCommentaryId: note.userCommentaryId ?? undefined,
      parentNoteId: note.parentNoteId ?? undefined,
      verseIdStart: note.verseIdStart ?? undefined,
      verseIdEnd: note.verseIdEnd ?? undefined,
      title: note.title ?? undefined,
      content: note.content ?? '',
      contentFormat: note.contentFormat ?? 'html',
      noteType: note.noteType ?? 'verse_note',
      documentType: note.documentType ?? undefined,
      visibility: note.visibility ?? 'private',
      createdDate: note.createdDate ?? undefined,
      modifiedDate: note.modifiedDate ?? undefined,
      tags: Array.isArray(note.tags) ? [...note.tags] : [],
      seriesName: note.seriesName ?? undefined,
      entryDate: note.entryDate ?? undefined,
      metadata: note.metadata ?? undefined,
      linkedVerses: note.getLinkedVerses().map(link => ({
        linkId: link.linkId ?? undefined,
        noteId: link.noteId,
        verseIdStart: link.verseIdStart,
        verseIdEnd: link.verseIdEnd ?? undefined,
        linkType: link.linkType,
        wordStart: link.wordStart ?? undefined,
        wordEnd: link.wordEnd ?? undefined,
        metadata: link.metadata ?? undefined
      })),
      children: note.getChildren().map(child => serializeNote(child))
    };

    // Use JSON round-trip to ensure complete serialization
    const jsonString = JSON.stringify(plainObject);
    return JSON.parse(jsonString);
  } catch (error) {
    log.error('[serializeNote] Error serializing note:', error);
    log.error('[serializeNote] Note data:', {
      noteId: note.noteId,
      noteType: note.noteType,
      hasChildren: note.getChildren().length > 0,
      hasLinkedVerses: note.getLinkedVerses().length > 0
    });
    throw error;
  }
}

/**
 * Deserialize note data to UserNote instance
 */
function deserializeNote(data: UpdateNoteData): UserNote {
  const note = new UserNote({
    noteId: data.noteId,
    userCommentaryId: data.userCommentaryId,
    parentNoteId: data.parentNoteId,
    verseIdStart: data.verseIdStart,
    verseIdEnd: data.verseIdEnd,
    title: data.title,
    content: data.content,
    contentFormat: data.contentFormat,
    noteType: data.noteType,
    documentType: data.documentType,
    visibility: data.visibility,
    createdDate: data.createdDate,
    modifiedDate: data.modifiedDate,
    tags: data.tags,
    seriesName: data.seriesName,
    entryDate: data.entryDate,
    metadata: data.metadata
  });

  if (data.linkedVerses) {
    note.setLinkedVerses(data.linkedVerses as import('@bible/core').VerseLink[]);
  }

  return note;
}

/**
 * Serialize UserCommentary for IPC transmission
 */
function serializeCommentary(commentary: UserCommentary): SerializedCommentary {
  return {
    userCommentaryId: commentary.userCommentaryId,
    name: commentary.name,
    description: commentary.description,
    createdDate: commentary.createdDate,
    modifiedDate: commentary.modifiedDate,
    isDefault: commentary.isDefault,
    color: commentary.color,
    metadata: commentary.metadata
  };
}

/**
 * Clean up notes controller (DB is closed by sharedUserDb)
 */
export function closeNotesDatabase() {
  notesController = null;
  commentaryRepository = null;
}
