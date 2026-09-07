import { VerseId, ContentFormat, NoteType, Visibility, Metadata } from '../../Core/Types';

/**
 * User note entity from the user database
 * Represents a user-created note (verse note, sermon, study, journal entry, etc.)
 */
export class UserNote {
  noteId?: number;
  userCommentaryId?: number;
  parentNoteId?: number;
  verseIdStart?: VerseId;
  verseIdEnd?: VerseId;
  title?: string;
  content: string;
  contentFormat: ContentFormat;
  noteType: NoteType;
  documentType?: string;
  visibility: Visibility;
  createdDate?: string;
  modifiedDate?: string;
  tags: string[];
  seriesName?: string;
  entryDate?: string;
  metadata?: Metadata;

  // Child notes (for hierarchical structure)
  private childNotes: UserNote[] = [];

  // Linked verses (from note_verse_link table)
  private linkedVerses: VerseLink[] = [];

  constructor(data: {
    noteId?: number;
    userCommentaryId?: number;
    parentNoteId?: number;
    verseIdStart?: VerseId;
    verseIdEnd?: VerseId;
    title?: string;
    content: string;
    contentFormat?: ContentFormat;
    noteType?: NoteType;
    documentType?: string;
    visibility?: Visibility;
    createdDate?: string;
    modifiedDate?: string;
    tags?: string[];
    seriesName?: string;
    entryDate?: string;
    metadata?: Metadata;
  }) {
    this.noteId = data.noteId;
    this.userCommentaryId = data.userCommentaryId;
    this.parentNoteId = data.parentNoteId;
    this.verseIdStart = data.verseIdStart;
    this.verseIdEnd = data.verseIdEnd;
    this.title = data.title;
    this.content = data.content;
    this.contentFormat = data.contentFormat ?? 'html';
    this.noteType = data.noteType ?? 'verse_note';
    this.documentType = data.documentType;
    this.visibility = data.visibility ?? 'private';
    this.createdDate = data.createdDate;
    this.modifiedDate = data.modifiedDate;
    this.tags = data.tags ?? [];
    this.seriesName = data.seriesName;
    this.entryDate = data.entryDate;
    this.metadata = data.metadata;
  }

  /**
   * Check if this note is about a specific verse passage
   */
  isAboutVerse(): boolean {
    return this.verseIdStart !== undefined;
  }

  /**
   * Check if this is a verse range (multiple verses)
   */
  isVerseRange(): boolean {
    return this.verseIdEnd !== undefined && this.verseIdEnd !== this.verseIdStart;
  }

  /**
   * Check if this note has child notes
   */
  hasChildren(): boolean {
    return this.childNotes.length > 0;
  }

  /**
   * Get child notes
   */
  getChildren(): UserNote[] {
    return this.childNotes;
  }

  /**
   * Add a child note
   */
  addChild(note: UserNote): void {
    note.parentNoteId = this.noteId;
    this.childNotes.push(note);
  }

  /**
   * Remove a child note
   */
  removeChild(noteId: number): boolean {
    const index = this.childNotes.findIndex(n => n.noteId === noteId);
    if (index !== -1) {
      this.childNotes.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Add a tag
   */
  addTag(tag: string): void {
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
    }
  }

  /**
   * Remove a tag
   */
  removeTag(tag: string): boolean {
    const index = this.tags.indexOf(tag);
    if (index !== -1) {
      this.tags.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Check if note has a specific tag
   */
  hasTag(tag: string): boolean {
    return this.tags.includes(tag);
  }

  /**
   * Get linked verses
   */
  getLinkedVerses(): VerseLink[] {
    return this.linkedVerses;
  }

  /**
   * Add a linked verse
   */
  addLinkedVerse(link: VerseLink): void {
    this.linkedVerses.push(link);
  }

  /**
   * Set all linked verses (from repository query)
   */
  setLinkedVerses(links: VerseLink[]): void {
    this.linkedVerses = links;
  }

  /**
   * Update the modified date to now
   */
  touch(): void {
    this.modifiedDate = new Date().toISOString();
  }

  /**
   * Get a brief excerpt of the content (for previews)
   */
  getExcerpt(maxLength: number = 100): string {
    const plainText = this.content.replace(/<[^>]*>/g, ''); // Strip HTML
    return plainText.length > maxLength
      ? plainText.substring(0, maxLength) + '...'
      : plainText;
  }
}

/**
 * Verse link attached to a note.
 *
 * The shape of the legacy `note_verse_link` table. Superseded by the unified `verse_link` table
 * (`source_type='note'`) and `VerseLinkRecord`
 * (`Models/Common/VerseLinkRecord`). `UserNoteRepository` reads and writes
 * whichever table the connected user database has, and always presents the
 * result in this shape so consumers - including `@bible/desktop`, which imports
 * `VerseLink` from `@bible/core` - keep working.
 *
 *
 * That is a breaking change to the published `@bible/core` surface, so it is
 * deliberately deferred.
 *
 * `wordStart` / `wordEnd` are 0-based inclusive word offsets; they have
 * no column in the unified table and round-trip through `metadata` there.
 */
export interface VerseLink {
  linkId?: number;
  noteId: number;
  verseIdStart: VerseId;
  verseIdEnd?: VerseId;
  linkType: 'reference' | 'annotation' | 'primary_passage';
  wordStart?: number;
  wordEnd?: number;
  metadata?: Metadata;
}
