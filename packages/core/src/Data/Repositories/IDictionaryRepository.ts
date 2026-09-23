import { DictionaryEntry, WordOccurrence, ExampleVerse } from '../Models/Dictionary/DictionaryEntry';
import { DictionaryModuleInfo } from '../Models/Dictionary/DictionaryModuleInfo';
import { VerseLinkRecord } from '../Models/Common/VerseLinkRecord';
import { VerseId } from '../Core/Types';
import { IIndexSource } from '../Access/KeywordTypes';

/**
 * Interface for Dictionary repository
 * Defines all operations for working with dictionary/lexicon databases
 */
export interface IDictionaryRepository {
  // Module Info Operations
  getModuleInfo(): DictionaryModuleInfo | undefined;
  updateModuleInfo(info: DictionaryModuleInfo): void;

  // Dictionary Entry Operations
  getEntry(entryId: number): DictionaryEntry | undefined;
  getEntryByKey(entryKey: string): DictionaryEntry | undefined;
  getAllEntries(options?: { limit?: number; offset?: number }): DictionaryEntry[];
  searchEntries(query: string, options?: { limit?: number }): DictionaryEntry[];
  searchByTitle(query: string, options?: { limit?: number }): DictionaryEntry[];

  // Entry Modification (for module creation/import)
  createEntry(entry: DictionaryEntry): DictionaryEntry;
  updateEntry(entry: DictionaryEntry): DictionaryEntry;
  deleteEntry(entryId: number): boolean;

  // Verse Link Operations
  /**
   * Example verses cited by an entry, from the unified `verse_link` table
   * (`source_type='dictionary_entry'`).
   */
  getExampleVerses(entryId: number): ExampleVerse[];

  /** An entry's verse links. */
  getVerseLinksForEntry(entryId: number): VerseLinkRecord[];

  /**
   * Entries citing a given verse.
   */
  getEntriesReferencingVerse(verseId: VerseId): DictionaryEntry[];

  // Word Occurrence Operations (for concordances)
  getOccurrences(entryKey: string): WordOccurrence[];
  getOccurrencesForVerse(verseId: VerseId): WordOccurrence[];

  // Letter Index
  getLetterIndex(): Array<{ letter: string; count: number }>;

  // Browsing (pagination, navigation)
  browseByLetter(letter: string | null, limit: number, offset: number): { entries: Array<{ entryKey: string; word: string }>; total: number };
  getAdjacentEntries(entryKey: string): { prev: { entryKey: string; word: string } | null; next: { entryKey: string; word: string } | null };
  getEntryCount(): number;

  /**
   * The keyword-index source for this module's content (M5, task 0026
   * revision 2): every `dictionary_entry` row, streamed as `IndexDocument`s.
   *
   * Purely additive - `searchEntries`/`searchByTitle` above (no
   * registry-backed provider exists yet for dictionary content) are
   * unrelated and unchanged.
   */
  getIndexSource(): IIndexSource;
}
