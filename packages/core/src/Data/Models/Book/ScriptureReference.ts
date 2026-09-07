/** Universal scripture reference for tracking Bible verse mentions across all content types. */

import { VerseId, Metadata, resolveRangeEnd } from '../../Core/Types';

/**
 * Universal scripture reference model for tracking Bible verse mentions
 * across all content types (books, commentaries, dictionaries, user notes, etc.)
 *
 * Each module database (book_*.db, commentary_*.db, etc.) will have its own
 * scripture_reference table linking to its content entries.
 *
 * This allows the application to find all places in the user's library
 * where a particular verse is mentioned or discussed.
 */
export class ScriptureReference {
  referenceId?: number;

  /**
   * The ID of the content entry that contains this reference
   * For books: sectionId
   * For commentaries: entryId
   * For dictionaries: entryId
   * For user content: noteId or documentId
   */
  contentId: number;

  /**
   * Start of the verse reference range
   */
  verseIdStart: VerseId;

  /**
   * End of the verse reference range (NULL for single verse)
   * e.g., for "Romans 8:28-39", verseIdEnd would be Romans 8:39
   */
  verseIdEnd?: VerseId;

  /**
   * The surrounding text or context where the reference appears
   * Useful for showing preview snippets in search results
   */
  context?: string;

  /** Position within the source content entry, for ordering multiple references */
  position?: number;

  /**
   * Extensible metadata
   */
  metadata?: Metadata;

  constructor(data: {
    referenceId?: number;
    contentId: number;
    verseIdStart: VerseId;
    verseIdEnd?: VerseId | null;
    context?: string;
    position?: number;
    metadata?: Metadata;
  }) {
    this.referenceId = data.referenceId;
    this.contentId = data.contentId;
    this.verseIdStart = data.verseIdStart;
    // A SQL NULL arrives as `null`, not `undefined`. Normalise so the two
    // encodings of "single verse" behave identically - see the range convention
    // in `Core/Types.ts`.
    this.verseIdEnd = data.verseIdEnd ?? undefined;
    this.context = data.context;
    this.position = data.position;
    this.metadata = data.metadata;
  }

  /** Inclusive end of the range, defaulting to the start for single verses. */
  effectiveEnd(): VerseId {
    return resolveRangeEnd(this.verseIdStart, this.verseIdEnd);
  }

  /**
   * Check if this is a single verse reference (not a range)
   */
  isSingleVerse(): boolean {
    return this.effectiveEnd() === this.verseIdStart;
  }

  /**
   * Check if this reference is a verse range
   */
  isRange(): boolean {
    return !this.isSingleVerse();
  }

  /**
   * Get truncated context for display
   */
  getTruncatedContext(maxLength: number = 150): string | undefined {
    if (!this.context) return undefined;
    if (this.context.length <= maxLength) return this.context;
    return this.context.substring(0, maxLength) + '...';
  }

  /**
   * Check if this reference contains a specific verse
   */
  containsVerse(verseId: VerseId): boolean {
    return verseId >= this.verseIdStart && verseId <= this.effectiveEnd();
  }

  /**
   * Get the verse range as a count
   */
  getVerseCount(): number {
    return this.effectiveEnd() - this.verseIdStart + 1;
  }
}

/**
 * Summary of scripture references for a verse
 * Used when showing all places where a verse is mentioned
 */
export interface ScriptureReferenceSummary {
  referenceId: number;
  contentId: number;
  verseIdStart: VerseId;
  verseIdEnd?: VerseId;
  context?: string;

  // Additional fields that might be joined from content tables
  contentTitle?: string; // e.g., section title, entry key
  moduleAbbreviation?: string; // e.g., "MHC", "Strongs", book abbreviation
  moduleType?: string; // e.g., "book", "commentary", "dictionary"
}
