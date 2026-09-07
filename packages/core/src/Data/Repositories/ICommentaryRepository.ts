import { CommentaryEntry, CommentaryEntryLevel } from '../Models/Commentary/CommentaryEntry';
import { CommentaryModuleInfo } from '../Models/Commentary/CommentaryModuleInfo';
import { VerseLinkRecord } from '../Models/Common/VerseLinkRecord';
import { VerseId } from '../Core/Types';

/**
 * Summary of a commentary entry for tree view/navigation
 */
export interface CommentaryEntrySummary {
  verseIdStart: VerseId;
  verseIdEnd?: VerseId;
  entryLevel: CommentaryEntryLevel;
  wordCount?: number;
}

/**
 * A commentary entry's anchor and size, with its id but WITHOUT its content.
 *
 * The shape `VerseLinksService` needs to answer "which commentaries have an
 * entry on this verse" - see {@link ICommentaryRepository.getBestEntryAnchorsForRange}.
 */
export interface CommentaryEntryAnchor {
  entryId: number;
  verseIdStart: VerseId;
  verseIdEnd?: VerseId;
  entryLevel: CommentaryEntryLevel;
}

/**
 * One "this entry mentions a verse in the range" row - see
 * {@link ICommentaryRepository.getVerseMentionRowsForRange}.
 */
export interface CommentaryMentionRow {
  entryId: number;
  /** Anchor of the MENTIONING entry (used to exclude self-anchored links). */
  entryVerseIdStart: VerseId;
  /** Start of the mentioned passage. */
  linkVerseIdStart: VerseId;
  /** End of the mentioned passage (equals the start for a single verse). */
  linkVerseIdEnd: VerseId;
}

/**
 * Interface for Commentary repository
 * Defines all operations for working with commentary databases
 */
export interface ICommentaryRepository {
  // Module Info Operations
  getModuleInfo(): CommentaryModuleInfo | undefined;
  updateModuleInfo(info: CommentaryModuleInfo): void;

  // Commentary Entry Operations
  getEntry(entryId: number): CommentaryEntry | undefined;
  getEntriesForVerse(verseId: VerseId): CommentaryEntry[];
  getEntriesByLevel(level: CommentaryEntryLevel): CommentaryEntry[];
  getEntriesForRange(startVerseId: VerseId, endVerseId: VerseId): CommentaryEntry[];
  /**
   * Anchors and sizes for a range, without the `content` blobs.
   *
   * For callers that only need to know what exists and how big it is - the
   * chapter-overview endpoint and the client's prefetch budget. Reading full
   * entries for that is enormously wasteful: a module like Matthew Henry
   * stores the same ~73 KB chapter blob on every verse row it covers, so a
   * `SELECT *` over one chapter of every installed commentary reads tens of
   * megabytes to compute a handful of word counts.
   */
  getEntrySummariesForRange(startVerseId: VerseId, endVerseId: VerseId): CommentaryEntrySummary[];
  searchEntries(query: string, options?: { limit?: number }): CommentaryEntry[];

  // Verse Link Operations (used by VerseLinksService)
  /** Get the single best-match entry for a verse (first match by verse_id_start). */
  getBestEntryForVerse(verseId: VerseId): CommentaryEntry | undefined;
  /**
   * Bulk variant of {@link getBestEntryForVerse}: every entry ANCHOR (no
   * `content` blob) whose range overlaps the inclusive verse range, ordered by
   * `verse_id_start`.
   *
   * `VerseLinksService.getBatchVerseLinks` reconstructs the per-verse answer by
   * taking the first row that covers each verse, which is exactly what
   * `getBestEntryForVerse`'s `ORDER BY verse_id_start LIMIT 1` returns. Reading
   * anchors rather than entries matters: a module like Matthew Henry stores the
   * same ~73 KB chapter blob on every verse row it covers, so a `SELECT *` over
   * a chapter reads tens of megabytes to answer "is there an entry here".
   */
  getBestEntryAnchorsForRange(startVerseId: VerseId, endVerseId: VerseId): CommentaryEntryAnchor[];
  /**
   * Bulk variant of {@link getVerseMentions}: one row per (entry, verse-link)
   * pair whose link range overlaps [startVerseId, endVerseId].
   *
   * Left un-aggregated on purpose - the per-verse counts `getVerseMentions`
   * returns depend on which verse is being asked about, and a link row may
   * span several of the verses in the range.
   */
  getVerseMentionRowsForRange(startVerseId: VerseId, endVerseId: VerseId): CommentaryMentionRow[];
  /**
   * Get entries from other verses that mention/reference this verse.
   * Reads the unified `verse_link` table.
   */
  getVerseMentions(verseId: VerseId): Array<{ entryId: number; verseIdStart: number; count: number }>;

  /**
   * Scripture references carried by one entry, from the unified `verse_link`
   * table (`source_type='commentary_entry'`).
   */
  getVerseLinksForEntry(entryId: number): VerseLinkRecord[];

  /** Entry ids whose `verse_link` rows reference the given verse. */
  getEntryIdsReferencingVerse(verseId: VerseId): number[];

  // Navigation Operations
  getNextVerseWithContent(currentVerseId: VerseId): VerseId | undefined;
  getPreviousVerseWithContent(currentVerseId: VerseId): VerseId | undefined;
  getAllEntrySummaries(): CommentaryEntrySummary[];

  // Entry Modification (for module creation/import)
  createEntry(entry: CommentaryEntry): CommentaryEntry;
  updateEntry(entry: CommentaryEntry): CommentaryEntry;
  deleteEntry(entryId: number): boolean;
}
