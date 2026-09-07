/**
 * Dictionary module operations.
 *
 * Covers Strong's concordance, general dictionaries, and word lookups.
 */

import type { DictionaryModuleSummary, DictionaryEntryResult, PassageRange } from './ApiTypes';

export interface IDictionaryApi {
  // --- Module Discovery -------------------------------------------
  getAvailableDictionaries(): Promise<DictionaryModuleSummary[]>;
  getDictionaryInfo(abbreviation: string): Promise<DictionaryModuleSummary | null>;

  // --- Entry Retrieval --------------------------------------------
  getEntry(abbreviation: string, entryId: number): Promise<DictionaryEntryResult | null>;
  getEntryByKey(abbreviation: string, key: string): Promise<DictionaryEntryResult | null>;
  getAllEntries(abbreviation: string, options?: { limit?: number; offset?: number }): Promise<DictionaryEntryResult[]>;

  // --- Search -----------------------------------------------------
  searchEntries(abbreviation: string, query: string, limit?: number): Promise<DictionaryEntryResult[]>;

  // --- Strong's / Interlinear -------------------------------------
  /** Get verses where a Strong's number occurs. Optionally filter to specific passage ranges. */
  getOccurrences(abbreviation: string, strongsNumber: string, verseRanges?: PassageRange[]): Promise<Array<{
    verseId: number;
    bookName: string;
    chapter: number;
    verse: number;
  }>>;
  getOccurrencesForVerse(abbreviation: string, verseId: number): Promise<Array<{
    strongsNumber: string;
    word: string;
    count: number;
  }>>;
}
