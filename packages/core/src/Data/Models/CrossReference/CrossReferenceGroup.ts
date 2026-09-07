import { VerseId, Metadata } from '../../Core/Types';

/**
 * A group of cross-references for a source passage.
 * Phrase-level: one group per clause/phrase within the passage (phrase IS NOT NULL).
 * Verse-level: one group for the whole passage (phrase IS NULL).
 *
 * The anchor is the canonical inclusive range of ModuleFormat section 5. `verseId` is
 * the range start and keeps its original name because existing consumers read
 * it as "the source verse"; `verseIdEnd` exposes the end of the range.
 */
export class CrossReferenceGroup {
  groupId?: number;
  /** First verse of the source passage (inclusive). */
  verseId: VerseId;
  /** Last verse of the source passage (inclusive). Equals `verseId` for a single verse. */
  verseIdEnd: VerseId;
  phrase?: string;
  sortOrder?: number;
  metadata?: Metadata;

  constructor(data: {
    groupId?: number;
    verseId: VerseId;
    verseIdEnd?: VerseId;
    phrase?: string;
    sortOrder?: number;
    metadata?: Metadata;
  }) {
    this.groupId = data.groupId;
    this.verseId = data.verseId;
    // section 5: a single verse is encoded as end = start, never NULL, so callers that
    // only know the start still get a well-formed range.
    this.verseIdEnd = data.verseIdEnd ?? data.verseId;
    this.phrase = data.phrase;
    this.sortOrder = data.sortOrder;
    this.metadata = data.metadata;
  }

  /**
   * Check if this is a phrase-level group (vs verse-level)
   */
  isPhraseLevel(): boolean {
    return this.phrase !== undefined && this.phrase !== null;
  }

  /**
   * Check if the source anchor spans more than one verse
   */
  isRange(): boolean {
    return this.verseIdEnd > this.verseId;
  }
}
