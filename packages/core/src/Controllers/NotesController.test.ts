import { describe, it, expect, beforeEach } from 'vitest';
import { NotesController } from './NotesController';
import { MockUserNoteRepository } from '../__tests__/helpers/MockRepositories';
import { Book, VerseIdHelper } from '../Data/Core/Types';

describe('NotesController', () => {
  let controller: NotesController;
  let mockRepo: MockUserNoteRepository;

  beforeEach(() => {
    mockRepo = new MockUserNoteRepository();
    controller = new NotesController(mockRepo);
  });

  // ==========================================================================
  // Create Note Tests
  // ==========================================================================

  describe('createNote', () => {
    it('should create a basic document note', () => {
      const note = controller.createNote({
        title: 'Test Note',
        content: 'This is a test note',
        noteType: 'document',
      });

      expect(note.noteId).toBeDefined();
      expect(note.title).toBe('Test Note');
      expect(note.content).toBe('This is a test note');
      expect(note.noteType).toBe('document');
      expect(note.createdDate).toBeDefined();
      expect(note.modifiedDate).toBeDefined();
    });

    it('should create a verse note linked to a verse', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const note = controller.createNote({
        title: 'John 3:16 Study',
        content: 'This verse teaches about God\'s love',
        noteType: 'verse_note',
        verseIdStart: verseId,
      });

      expect(note.noteType).toBe('verse_note');
      expect(note.verseIdStart).toBe(verseId);
    });

    it('should default to document type if not specified', () => {
      const note = controller.createNote({
        content: 'Test content',
      });

      expect(note.noteType).toBe('document');
    });

    it('should handle tags', () => {
      const note = controller.createNote({
        content: 'Tagged note',
        tags: ['theology', 'gospel'],
      });

      expect(note.tags).toEqual(['theology', 'gospel']);
    });
  });

  describe('createVerseNote', () => {
    it('should create a verse note with minimum options', () => {
      const verseId = VerseIdHelper.calculate(Book.Romans, 8, 28);
      const note = controller.createVerseNote(
        verseId,
        'All things work together for good'
      );

      expect(note.noteType).toBe('verse_note');
      expect(note.verseIdStart).toBe(verseId);
      expect(note.content).toBe('All things work together for good');
    });

    it('should create a verse note with verse range', () => {
      const start = VerseIdHelper.calculate(Book.Romans, 8, 28);
      const end = VerseIdHelper.calculate(Book.Romans, 8, 39);
      const note = controller.createVerseNote(start, 'Study on Romans 8', {
        verseIdEnd: end,
        title: 'Romans 8:28-39',
      });

      expect(note.verseIdStart).toBe(start);
      expect(note.verseIdEnd).toBe(end);
      expect(note.title).toBe('Romans 8:28-39');
    });

    it('should handle tags in verse notes', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const note = controller.createVerseNote(verseId, 'Gospel message', {
        tags: ['salvation', 'gospel'],
      });

      expect(note.tags).toEqual(['salvation', 'gospel']);
    });
  });

  describe('createDocument', () => {
    it('should create a document note', () => {
      const note = controller.createDocument(
        'My Study',
        'This is my study content',
        'Study',
        ['bible-study']
      );

      expect(note.noteType).toBe('document');
      expect(note.title).toBe('My Study');
      expect(note.content).toBe('This is my study content');
      expect(note.documentType).toBe('Study');
      expect(note.tags).toEqual(['bible-study']);
    });

    it('should default document type to General', () => {
      const note = controller.createDocument('Title', 'Content');

      expect(note.documentType).toBe('General');
    });
  });

  describe('createSermon', () => {
    it('should create a sermon note', () => {
      const note = controller.createSermon(
        'Love of God',
        'Sermon on love',
        undefined,
        'Love Series'
      );

      expect(note.noteType).toBe('sermon');
      expect(note.title).toBe('Love of God');
      expect(note.seriesName).toBe('Love Series');
      expect(note.documentType).toBe('Sermon');
    });

    it('should link sermon to a passage', () => {
      const verseId = VerseIdHelper.calculate(Book.FirstCorinthians, 13, 1);
      const note = controller.createSermon(
        'Love Chapter',
        'Sermon on 1 Cor 13',
        verseId
      );

      expect(note.verseIdStart).toBe(verseId);
    });
  });

  describe('createJournalEntry', () => {
    it('should create a journal entry with date', () => {
      const note = controller.createJournalEntry(
        'Today\'s reflection',
        'I learned something today',
        '2025-01-15'
      );

      expect(note.noteType).toBe('journal');
      expect(note.entryDate).toBe('2025-01-15');
      expect(note.documentType).toBe('Journal');
    });

    it('should default to today\'s date if not provided', () => {
      const note = controller.createJournalEntry(
        'Today',
        'Content'
      );

      expect(note.entryDate).toBeDefined();
      expect(note.entryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('createPrayer', () => {
    it('should create a prayer note', () => {
      const note = controller.createPrayer(
        'Prayer request',
        'Please pray for...',
        ['prayer']
      );

      expect(note.noteType).toBe('prayer');
      expect(note.documentType).toBe('Prayer');
    });
  });

  // ==========================================================================
  // Query Note Tests
  // ==========================================================================

  describe('getNoteById', () => {
    it('should retrieve note by ID', () => {
      const created = controller.createNote({
        content: 'Test',
      });

      const retrieved = controller.getNoteById(created.noteId!);

      expect(retrieved).toBeDefined();
      expect(retrieved?.noteId).toBe(created.noteId);
    });

    it('should return undefined for non-existent ID', () => {
      const note = controller.getNoteById(999);
      expect(note).toBeUndefined();
    });
  });

  describe('getAllNotes', () => {
    it('should return all notes', () => {
      controller.createNote({ content: 'Note 1' });
      controller.createNote({ content: 'Note 2' });
      controller.createNote({ content: 'Note 3' });

      const all = controller.getAllNotes();

      expect(all).toHaveLength(3);
    });

    it('should return empty array when no notes exist', () => {
      const all = controller.getAllNotes();
      expect(all).toEqual([]);
    });

    it('should respect options', () => {
      controller.createNote({ content: 'Note 1' });
      controller.createNote({ content: 'Note 2' });
      controller.createNote({ content: 'Note 3' });

      const limited = controller.getAllNotes({ limit: 2 });

      expect(limited).toHaveLength(2);
    });
  });

  describe('getNotesByType', () => {
    beforeEach(() => {
      controller.createDocument('Doc 1', 'Content 1');
      controller.createDocument('Doc 2', 'Content 2');
      controller.createVerseNote(43003016, 'Verse note');
      controller.createSermon('Sermon 1', 'Sermon content');
    });

    it('should get all document notes', () => {
      const docs = controller.getDocumentNotes();
      expect(docs).toHaveLength(2);
      expect(docs.every(n => n.noteType === 'document')).toBe(true);
    });

    it('should get all verse notes', () => {
      const verses = controller.getVerseNotes();
      expect(verses).toHaveLength(1);
      expect(verses[0].noteType).toBe('verse_note');
    });

    it('should get all sermon notes', () => {
      const sermons = controller.getSermonNotes();
      expect(sermons).toHaveLength(1);
      expect(sermons[0].noteType).toBe('sermon');
    });

    it('should get all journal entries', () => {
      const journals = controller.getJournalEntries();
      expect(journals).toHaveLength(0);
    });

    it('should get all prayer notes', () => {
      const prayers = controller.getPrayerNotes();
      expect(prayers).toHaveLength(0);
    });
  });

  describe('getNotesForVerse', () => {
    it('should get notes for specific verse', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      controller.createVerseNote(verseId, 'Note 1');
      controller.createVerseNote(verseId, 'Note 2');
      controller.createVerseNote(43003017, 'Note 3'); // Different verse

      const notes = controller.getNotesForVerse(verseId);

      expect(notes).toHaveLength(2);
      expect(notes.every(n => n.verseIdStart === verseId)).toBe(true);
    });

    it('should return empty array if no notes for verse', () => {
      const notes = controller.getNotesForVerse(43003016);
      expect(notes).toEqual([]);
    });
  });

  describe('getNotesForVerseRange', () => {
    it('should get notes within verse range', () => {
      const start = VerseIdHelper.calculate(Book.Romans, 8, 28);
      const end = VerseIdHelper.calculate(Book.Romans, 8, 39);

      controller.createVerseNote(VerseIdHelper.calculate(Book.Romans, 8, 28), 'Note 1');
      controller.createVerseNote(VerseIdHelper.calculate(Book.Romans, 8, 30), 'Note 2');
      controller.createVerseNote(VerseIdHelper.calculate(Book.Romans, 8, 35), 'Note 3');
      controller.createVerseNote(VerseIdHelper.calculate(Book.Romans, 9, 1), 'Note 4'); // Outside range

      const notes = controller.getNotesForVerseRange(start, end);

      expect(notes).toHaveLength(3);
    });
  });

  // ==========================================================================
  // Tag Management Tests
  // ==========================================================================

  describe('Tags', () => {
    it('should get notes by tag', () => {
      controller.createNote({ content: 'Note 1', tags: ['theology'] });
      controller.createNote({ content: 'Note 2', tags: ['theology', 'gospel'] });
      controller.createNote({ content: 'Note 3', tags: ['prayer'] });

      const theologyNotes = controller.getNotesByTag('theology');

      expect(theologyNotes).toHaveLength(2);
    });

    it('should get all unique tags', () => {
      controller.createNote({ content: 'Note 1', tags: ['theology', 'gospel'] });
      controller.createNote({ content: 'Note 2', tags: ['theology', 'prayer'] });
      controller.createNote({ content: 'Note 3', tags: ['study'] });

      const allTags = controller.getAllTags();

      expect(allTags).toHaveLength(4);
      expect(allTags.sort()).toEqual(['gospel', 'prayer', 'study', 'theology']);
    });

    it('should add tag to note', () => {
      const note = controller.createNote({ content: 'Test', tags: ['tag1'] });

      const updated = controller.addTagToNote(note.noteId!, 'tag2');

      expect(updated?.tags).toContain('tag1');
      expect(updated?.tags).toContain('tag2');
    });

    it('should remove tag from note', () => {
      const note = controller.createNote({ content: 'Test', tags: ['tag1', 'tag2'] });

      const updated = controller.removeTagFromNote(note.noteId!, 'tag1');

      expect(updated?.tags).not.toContain('tag1');
      expect(updated?.tags).toContain('tag2');
    });

    it('should return undefined when adding tag to non-existent note', () => {
      const result = controller.addTagToNote(999, 'tag');
      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // Update Note Tests
  // ==========================================================================

  describe('updateNote', () => {
    it('should update note content', () => {
      const note = controller.createNote({ content: 'Original' });

      const updated = controller.updateNoteContent(note.noteId!, 'Updated');

      expect(updated?.content).toBe('Updated');
    });

    it('should update note title', () => {
      const note = controller.createNote({ title: 'Original', content: 'Content' });

      const updated = controller.updateNoteTitle(note.noteId!, 'New Title');

      expect(updated?.title).toBe('New Title');
    });

    it('should return undefined when updating non-existent note', () => {
      const result = controller.updateNoteContent(999, 'Content');
      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // Search Tests
  // ==========================================================================

  describe('searchNotes', () => {
    beforeEach(() => {
      controller.createNote({ title: 'Theology', content: 'Study of God' });
      controller.createNote({ title: 'Gospel', content: 'Good news of salvation' });
      controller.createNote({ title: 'Prayer', content: 'Communication with God' });
    });

    it('should search notes by content', () => {
      const results = controller.searchNotes('God');

      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('should search notes by title', () => {
      const results = controller.searchNotes('Gospel');

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Gospel');
    });

    it('should return empty array for empty query', () => {
      const results = controller.searchNotes('');
      expect(results).toEqual([]);
    });

    it('should return empty array for whitespace query', () => {
      const results = controller.searchNotes('   ');
      expect(results).toEqual([]);
    });

    it('should return empty array when no matches', () => {
      const results = controller.searchNotes('xyz123notfound');
      expect(results).toEqual([]);
    });
  });

  // ==========================================================================
  // Delete Tests
  // ==========================================================================

  describe('deleteNote', () => {
    it('should delete a note', () => {
      const note = controller.createNote({ content: 'Test' });

      const deleted = controller.deleteNote(note.noteId!);

      expect(deleted).toBe(true);
      expect(controller.getNoteById(note.noteId!)).toBeUndefined();
    });

    it('should return false when deleting non-existent note', () => {
      const result = controller.deleteNote(999);
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // Hierarchy Tests
  // ==========================================================================

  describe('Hierarchical Notes', () => {
    it('should get top-level notes', () => {
      controller.createNote({ content: 'Top 1' });
      controller.createNote({ content: 'Top 2' });
      const parent = controller.createNote({ content: 'Parent' });
      controller.createNote({ content: 'Child', parentNoteId: parent.noteId });

      const topLevel = controller.getTopLevelNotes();

      expect(topLevel).toHaveLength(3);
    });

    it('should get child notes', () => {
      const parent = controller.createNote({ content: 'Parent' });
      controller.createNote({ content: 'Child 1', parentNoteId: parent.noteId });
      controller.createNote({ content: 'Child 2', parentNoteId: parent.noteId });
      controller.createNote({ content: 'Other' });

      const children = controller.getChildNotes(parent.noteId!);

      expect(children).toHaveLength(2);
    });
  });

  // ==========================================================================
  // Statistics Tests
  // ==========================================================================

  describe('getNoteStatistics', () => {
    it('should return statistics for notes', () => {
      controller.createDocument('Doc 1', 'Content');
      controller.createDocument('Doc 2', 'Content');
      controller.createVerseNote(43003016, 'Verse note');
      controller.createSermon('Sermon', 'Content');

      const stats = controller.getNoteStatistics();

      expect(stats.total).toBe(4);
      expect(stats.byType.document).toBe(2);
      expect(stats.byType.verse_note).toBe(1);
      expect(stats.byType.sermon).toBe(1);
    });

    it('should count unique tags', () => {
      controller.createNote({ content: 'Note 1', tags: ['tag1', 'tag2'] });
      controller.createNote({ content: 'Note 2', tags: ['tag2', 'tag3'] });

      const stats = controller.getNoteStatistics();

      expect(stats.totalTags).toBe(3);
    });
  });

  // ==========================================================================
  // Recent Notes Tests
  // ==========================================================================

  describe('getRecentNotes', () => {
    it('should get recent notes with default limit', () => {
      for (let i = 0; i < 15; i++) {
        controller.createNote({ content: `Note ${i}` });
      }

      const recent = controller.getRecentNotes();

      expect(recent).toHaveLength(10); // Default limit is 10
    });

    it('should get recent notes with custom limit', () => {
      for (let i = 0; i < 10; i++) {
        controller.createNote({ content: `Note ${i}` });
      }

      const recent = controller.getRecentNotes(5);

      expect(recent).toHaveLength(5);
    });
  });

  // ==========================================================================
  // Navigation Tests
  // ==========================================================================

  describe('Verse Navigation', () => {
    beforeEach(() => {
      controller.createVerseNote(43001001, 'John 1:1');
      controller.createVerseNote(43003016, 'John 3:16');
      controller.createVerseNote(43014006, 'John 14:6');
    });

    it('should get next verse with content', () => {
      const current = 43003016; // John 3:16
      const next = controller.getNextVerseWithContent(current);

      expect(next).toBe(43014006); // John 14:6
    });

    it('should get previous verse with content', () => {
      const current = 43014006; // John 14:6
      const prev = controller.getPreviousVerseWithContent(current);

      expect(prev).toBe(43003016); // John 3:16
    });

    it('should return undefined if no next verse', () => {
      const next = controller.getNextVerseWithContent(99999999);
      expect(next).toBeUndefined();
    });

    it('should return undefined if no previous verse', () => {
      const prev = controller.getPreviousVerseWithContent(1);
      expect(prev).toBeUndefined();
    });
  });

  // ==========================================================================
  // Summary Tests
  // ==========================================================================

  describe('getAllNoteSummaries', () => {
    it('should return note summaries', () => {
      controller.createNote({ title: 'Note 1', content: 'Content 1' });
      controller.createNote({ title: 'Note 2', content: 'Content 2' });

      const summaries = controller.getAllNoteSummaries();

      expect(summaries).toHaveLength(2);
      expect(summaries[0].noteId).toBeDefined();
      expect(summaries[0].title).toBeDefined();
      // No `contentPreview` assertion: `NoteSummary` does not carry one.
      expect(summaries[0].modifiedDate).toBeDefined();
    });
  });
});
