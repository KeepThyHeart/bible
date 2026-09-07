import { VerseId, Metadata, EntryLevel, RelationshipType } from '../../Core/Types';

/**
 * Commentary entry level.
 *
 * Alias of {@link EntryLevel}, which lives in `Core/Types.ts` - the single source
 * of truth for the open enums whose SQL CHECK constraints were dropped in Module
 * Format v2.
 */
export type CommentaryEntryLevel = EntryLevel;

/**
 * Commentary entry entity from a commentary module database
 */
export class CommentaryEntry {
  entryId?: number;
  verseIdStart?: VerseId;
  verseIdEnd?: VerseId;
  entryLevel: CommentaryEntryLevel;
  content: string;
  contentFile?: string;
  wordCount?: number;
  metadata?: Metadata;

  constructor(data: {
    entryId?: number;
    verseIdStart?: VerseId;
    verseIdEnd?: VerseId;
    entryLevel: CommentaryEntryLevel;
    content: string;
    contentFile?: string;
    wordCount?: number;
    metadata?: Metadata;
  }) {
    this.entryId = data.entryId;
    this.verseIdStart = data.verseIdStart;
    this.verseIdEnd = data.verseIdEnd;
    this.entryLevel = data.entryLevel;
    this.content = data.content;
    this.contentFile = data.contentFile;
    this.wordCount = data.wordCount;
    this.metadata = data.metadata;
  }

  /**
   * Check if this is a book-level entry
   */
  isBookLevel(): boolean {
    return this.entryLevel === 'book';
  }

  /**
   * Check if this is a chapter-level entry
   */
  isChapterLevel(): boolean {
    return this.entryLevel === 'chapter';
  }

  /**
   * Check if this is a verse-level entry
   */
  isVerseLevel(): boolean {
    return this.entryLevel === 'verse';
  }

  /**
   * Check if this entry covers a verse range
   */
  isVerseRange(): boolean {
    return this.verseIdEnd !== undefined && this.verseIdEnd !== this.verseIdStart;
  }

  /**
   * Get an excerpt of the content
   */
  getExcerpt(maxLength: number = 200): string {
    const plainText = this.content.replace(/<[^>]*>/g, ''); // Strip HTML
    return plainText.length > maxLength
      ? plainText.substring(0, maxLength) + '...'
      : plainText;
  }
}

/**
 * Cross-reference from commentary
 */
export class CommentaryCrossReference {
  xrefId?: number;
  fromVerseId: VerseId;
  toVerseId: VerseId;
  relationshipType?: CrossReferenceRelationship;
  notes?: string;
  metadata?: Metadata;

  constructor(data: {
    xrefId?: number;
    fromVerseId: VerseId;
    toVerseId: VerseId;
    relationshipType?: CrossReferenceRelationship;
    notes?: string;
    metadata?: Metadata;
  }) {
    this.xrefId = data.xrefId;
    this.fromVerseId = data.fromVerseId;
    this.toVerseId = data.toVerseId;
    this.relationshipType = data.relationshipType;
    this.notes = data.notes;
    this.metadata = data.metadata;
  }
}

/**
 * Types of relationships between cross-referenced verses.
 *
 * Alias of {@link RelationshipType} in `Core/Types.ts`. This is an intentionally
 * An OPEN set - there is no SQL CHECK constraint, so a publisher can
 * introduce a new relationship without rebuilding every shipped module. The six
 * names we ship are listed in `RELATIONSHIP_TYPES`.
 */
export type CrossReferenceRelationship = RelationshipType;
