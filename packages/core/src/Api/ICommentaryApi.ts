/**
 * Commentary module operations.
 *
 * Covers all read operations for commentary entries, navigation, and search.
 */

import type {
  CommentaryModuleSummary,
  CommentaryEntryResult,
  CommentaryEntrySummaryResult,
  VerseSearchResult
} from './ApiTypes';

export interface ICommentaryApi {
  // --- Module Discovery -------------------------------------------
  getAvailableCommentaries(): Promise<CommentaryModuleSummary[]>;
  getCommentaryInfo(abbreviation: string): Promise<CommentaryModuleSummary | null>;

  // --- Entry Retrieval --------------------------------------------
  getEntriesForVerse(abbreviation: string, verseId: number): Promise<CommentaryEntryResult[]>;
  hasContentForVerse(abbreviation: string, verseId: number): Promise<boolean>;
  getAllEntrySummaries(abbreviation: string): Promise<CommentaryEntrySummaryResult[]>;

  // --- Navigation -------------------------------------------------
  getNextVerseWithContent(abbreviation: string, verseId: number): Promise<number | null>;
  getPreviousVerseWithContent(abbreviation: string, verseId: number): Promise<number | null>;

  // --- Search -----------------------------------------------------
  search(abbreviation: string, query: string, limit?: number): Promise<VerseSearchResult[]>;

  // --- Batch / Session --------------------------------------------
  /**
   * Batch-load entries for multiple tabs/verses at once (session restore).
   */
  batchRestoreSession(requests: Array<{
    abbreviation: string;
    verseId: number;
  }>): Promise<Record<string, CommentaryEntryResult[]>>;
}
