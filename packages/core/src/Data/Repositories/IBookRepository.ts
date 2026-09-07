import { BookSection, BookSectionSummary } from '../Models/Book/BookSection';
import { BookModuleInfo } from '../Models/Book/BookModuleInfo';
import { ScriptureReference } from '../Models/Book/ScriptureReference';
import { VerseLinkRecord } from '../Models/Common/VerseLinkRecord';
import { VerseId } from '../Core/Types';

/**
 * Interface for Book repository
 * Defines all operations for working with book module databases
 */
export interface IBookRepository {
  // ========================================================================
  // Module Info Operations
  // ========================================================================

  /**
   * Get the module information for this book
   */
  getModuleInfo(): BookModuleInfo | undefined;

  /**
   * Update the module information
   */
  updateModuleInfo(info: BookModuleInfo): void;

  // ========================================================================
  // Book Section Operations
  // ========================================================================

  /**
   * Get a book section by ID
   */
  getSection(sectionId: number): BookSection | undefined;

  /**
   * Get all top-level sections (sections with no parent)
   */
  getTopLevelSections(): BookSection[];

  /**
   * Get all child sections of a parent section
   */
  getSectionsByParent(parentSectionId: number): BookSection[];

  /**
   * Get all sections (for tree view or search)
   */
  getAllSections(): BookSection[];

  /**
   * Get all section summaries (lighter weight for tree view)
   */
  getAllSectionSummaries(): BookSectionSummary[];

  /**
   * Search book sections using full-text search
   */
  searchSections(query: string, options?: { limit?: number }): BookSection[];

  // ========================================================================
  // Navigation Operations
  // ========================================================================

  /**
   * Get the next section in reading order (depth-first traversal)
   */
  getNextSection(currentSectionId: number): BookSection | undefined;

  /**
   * Get the previous section in reading order
   */
  getPreviousSection(currentSectionId: number): BookSection | undefined;

  /**
   * Get the parent section of the current section
   */
  getParentSection(currentSectionId: number): BookSection | undefined;

  // ========================================================================
  // Scripture Reference Operations
  // ========================================================================

  /**
   * Get all scripture references mentioned in a specific section.
   *
   * Reads the unified `verse_link` table (`source_type='book_section'`).
   */
  getScriptureReferences(sectionId: number): ScriptureReference[];

  /**
   * Get a section's verse links.
   */
  getVerseLinksForSection(sectionId: number): VerseLinkRecord[];

  /**
   * Get all sections that reference a specific verse
   * This is the inverse lookup - find all places in the book that mention this verse
   */
  getSectionsReferencingVerse(verseId: VerseId): BookSection[];

  /**
   * Get scripture references for a verse with their section titles.
   * Used by VerseLinksService to display book references without N+1 queries.
   */
  getVerseReferencesWithSections(verseId: VerseId): Array<{ referenceId: number; sectionId: number; sectionTitle: string; context?: string }>;

  /**
   * Bulk variant of {@link getVerseReferencesWithSections}: every reference
   * whose passage overlaps the inclusive range, each carrying its own passage
   * bounds so the caller can attribute it to the individual verses it covers.
   */
  getVerseReferencesWithSectionsForRange(
    startVerseId: VerseId,
    endVerseId: VerseId
  ): Array<{ referenceId: number; sectionId: number; sectionTitle: string; context?: string; verseIdStart: VerseId; verseIdEnd: VerseId }>;

  /**
   * Get all scripture references for a verse range
   */
  getScriptureReferencesForRange(startVerseId: VerseId, endVerseId: VerseId): ScriptureReference[];

  // ========================================================================
  // Section Modification (for module creation/import)
  // ========================================================================

  /**
   * Create a new book section
   */
  createSection(section: BookSection): BookSection;

  /**
   * Update an existing book section
   */
  updateSection(section: BookSection): BookSection;

  /**
   * Delete a book section (and all its children)
   */
  deleteSection(sectionId: number): boolean;

  /**
   * Create a scripture reference
   */
  createScriptureReference(reference: ScriptureReference): ScriptureReference;

  /**
   * Delete a scripture reference
   */
  deleteScriptureReference(referenceId: number): boolean;
}
