import { ISql } from '../Core/ISql';
import { BookSection, BookSectionSummary } from '../Models/Book/BookSection';
import { BookModuleInfo } from '../Models/Book/BookModuleInfo';
import { ScriptureReference } from '../Models/Book/ScriptureReference';
import { VerseLinkRecord } from '../Models/Common/VerseLinkRecord';
import { VerseId } from '../Core/Types';
import { IBookRepository } from './IBookRepository';
import { BaseModuleRepository, mapModuleIdentity, buildIdentityAssignments } from './BaseModuleRepository';
import { ModuleInfoRow, BookSectionRow } from '../Core/RowTypes';
import { parseJsonField, stringifyJsonField } from '../Core/JsonHelpers';
import { verseRangeOverlapsRangeNullable } from '../Core/VerseRangeQuery';
import { VerseLinkRepository } from './VerseLinkRepository';

/**
 * Repository for Book module databases (book_*.db)
 *
 * This repository handles ALL operations for a book database:
 * - Module information (metadata about the book)
 * - Book sections (hierarchical table of contents and content)
 * - Scripture references (verses mentioned in the book)
 *
 * @example
 * ```typescript
 * const bookDb = new SqliteProvider('data/modules/book_theology.db');
 * const repo = new BookRepository(bookDb);
 *
 * // Get module info
 * const info = repo.getModuleInfo();
 * console.log(info.getDisplayName()); // "Systematic Theology by Louis Berkhof"
 *
 * // Get table of contents
 * const topSections = repo.getTopLevelSections();
 * ```
 */
export class BookRepository extends BaseModuleRepository<BookModuleInfo> implements IBookRepository {
  private readonly verseLinks: VerseLinkRepository;

  constructor(sql: ISql) {
    super(sql);
    this.verseLinks = new VerseLinkRepository(sql);
  }

  // ========================================================================
  // Helper Methods
  // ========================================================================

  /**
   * Natural sort comparison for hierarchical section numbers
   * Handles: "1", "2", "3", "10", "28", "1.1", "1.2", "1.10", etc.
   */
  private compareSectionNumbers(a: string | undefined | null, b: string | undefined | null): number {
    // Handle null/undefined cases
    if (!a && !b) return 0;
    if (!a) return 1;  // null sorts last
    if (!b) return -1;

    // Split by dots and compare each part numerically
    const aParts = a.split('.').map(p => parseInt(p, 10) || 0);
    const bParts = b.split('.').map(p => parseInt(p, 10) || 0);

    const maxLength = Math.max(aParts.length, bParts.length);

    for (let i = 0; i < maxLength; i++) {
      const aNum = i < aParts.length ? aParts[i] : 0;
      const bNum = i < bParts.length ? bParts[i] : 0;

      if (aNum !== bNum) {
        return aNum - bNum;
      }
    }

    return 0;
  }

  /**
   * Sort sections by section_number using natural sort
   */
  private sortSections<T extends { sectionNumber?: string }>(sections: T[]): T[] {
    return sections.sort((a, b) => this.compareSectionNumbers(a.sectionNumber, b.sectionNumber));
  }

  // ========================================================================
  // Module Info Operations
  // ========================================================================

  /**
   * Update the module information
   */
  updateModuleInfo(info: BookModuleInfo): void {
    const identity = buildIdentityAssignments(info);
    this.sql.execute(
      `UPDATE module_info SET
        abbreviation = ?, full_name = ?, author = ?, year_published = ?,
        copyright = ?, description = ?, language_code = ?, publisher = ?,
        metadata = ?${identity.sql}
      WHERE info_id = 1`,
      [
        info.abbreviation,
        info.fullName,
        info.author ?? null,
        info.yearPublished ?? null,
        info.copyright ?? null,
        info.description ?? null,
        info.languageCode,
        info.publisher ?? null,
        stringifyJsonField(info.metadata),
        ...identity.params
      ]
    );
  }

  // ========================================================================
  // Book Section Operations
  // ========================================================================

  /**
   * Get a book section by ID
   */
  getSection(sectionId: number): BookSection | undefined {
    const row = this.sql.queryOne<BookSectionRow>(
      'SELECT * FROM book_section WHERE section_id = ?',
      [sectionId]
    );

    return row ? this.mapRowToSection(row) : undefined;
  }

  /**
   * Get all top-level sections (sections with no parent)
   */
  getTopLevelSections(): BookSection[] {
    const rows = this.sql.queryAll<BookSectionRow>(
      `SELECT * FROM book_section
       WHERE parent_section_id IS NULL`
    );

    const sections = rows.map(row => this.mapRowToSection(row));
    return this.sortSections(sections);
  }

  /**
   * Get all child sections of a parent section
   */
  getSectionsByParent(parentSectionId: number): BookSection[] {
    const rows = this.sql.queryAll<BookSectionRow>(
      `SELECT * FROM book_section
       WHERE parent_section_id = ?`,
      [parentSectionId]
    );

    const sections = rows.map(row => this.mapRowToSection(row));
    return this.sortSections(sections);
  }

  /**
   * Get all sections (for tree view or search)
   */
  getAllSections(): BookSection[] {
    const rows = this.sql.queryAll<BookSectionRow>(
      'SELECT * FROM book_section'
    );

    const sections = rows.map(row => this.mapRowToSection(row));
    return this.sortSections(sections);
  }

  /**
   * Get all section summaries (lighter weight for tree view)
   */
  getAllSectionSummaries(): BookSectionSummary[] {
    const rows = this.sql.queryAll(
      `SELECT section_id, parent_section_id, section_number, title, word_count,
              (SELECT COUNT(*) FROM book_section bs2 WHERE bs2.parent_section_id = book_section.section_id) as child_count
       FROM book_section`
    );

    const summaries = rows.map(row => ({
      sectionId: row.section_id as number,
      parentSectionId: row.parent_section_id ? (row.parent_section_id as number) : undefined,
      sectionNumber: row.section_number != null ? String(row.section_number) : undefined,
      title: row.title as string,
      wordCount: row.word_count as number,
      hasChildren: (row.child_count as number || 0) > 0
    }));

    return this.sortSections(summaries);
  }

  /**
   * Search book sections using full-text search
   */
  searchSections(query: string, options?: { limit?: number }): BookSection[] {
    const limit = options?.limit ?? 100;

    const rows = this.sql.queryAll<BookSectionRow>(
      `SELECT bs.* FROM book_section bs
       JOIN book_section_fts fts ON bs.section_id = fts.rowid
       WHERE book_section_fts MATCH ?
       ORDER BY bs.section_number
       LIMIT ?`,
      [query, limit]
    );

    return rows.map(row => this.mapRowToSection(row));
  }

  // ========================================================================
  // Navigation Operations
  // ========================================================================

  /**
   * Get the next section in reading order (depth-first traversal)
   */
  getNextSection(currentSectionId: number): BookSection | undefined {
    // First, try to get the first child
    const firstChild = this.sql.queryOne<BookSectionRow>(
      `SELECT * FROM book_section
       WHERE parent_section_id = ?
       ORDER BY section_number, section_id
       LIMIT 1`,
      [currentSectionId]
    );

    if (firstChild) {
      return this.mapRowToSection(firstChild);
    }

    // If no children, get the next sibling or ancestor's next sibling
    const current = this.getSection(currentSectionId);
    if (!current) return undefined;

    // Try to get next sibling
    const nextSibling = this.sql.queryOne<BookSectionRow>(
      `SELECT * FROM book_section
       WHERE parent_section_id ${current.parentSectionId ? '= ?' : 'IS NULL'}
       AND section_id > ?
       ORDER BY section_number, section_id
       LIMIT 1`,
      current.parentSectionId ? [current.parentSectionId, currentSectionId] : [currentSectionId]
    );

    if (nextSibling) {
      return this.mapRowToSection(nextSibling);
    }

    // If no next sibling, go up to parent and try to get parent's next sibling
    if (current.parentSectionId) {
      return this.getNextSection(current.parentSectionId);
    }

    return undefined;
  }

  /**
   * Get the previous section in reading order
   */
  getPreviousSection(currentSectionId: number): BookSection | undefined {
    const current = this.getSection(currentSectionId);
    if (!current) return undefined;

    // Get previous sibling
    const prevSibling = this.sql.queryOne<BookSectionRow>(
      `SELECT * FROM book_section
       WHERE parent_section_id ${current.parentSectionId ? '= ?' : 'IS NULL'}
       AND section_id < ?
       ORDER BY section_number DESC, section_id DESC
       LIMIT 1`,
      current.parentSectionId ? [current.parentSectionId, currentSectionId] : [currentSectionId]
    );

    if (prevSibling) {
      // Get the last descendant of this sibling (deepest last child)
      let lastDescendant = this.mapRowToSection(prevSibling);
      while (true) {
        const lastChild = this.sql.queryOne<BookSectionRow>(
          `SELECT * FROM book_section
           WHERE parent_section_id = ?
           ORDER BY section_number DESC, section_id DESC
           LIMIT 1`,
          [lastDescendant.sectionId ?? null]
        );

        if (!lastChild) {
          return lastDescendant;
        }

        lastDescendant = this.mapRowToSection(lastChild);
      }
    }

    // If no previous sibling, return parent
    if (current.parentSectionId) {
      return this.getSection(current.parentSectionId);
    }

    return undefined;
  }

  /**
   * Get the parent section of the current section
   */
  getParentSection(currentSectionId: number): BookSection | undefined {
    const current = this.getSection(currentSectionId);
    if (!current || !current.parentSectionId) {
      return undefined;
    }

    return this.getSection(current.parentSectionId);
  }

  // ========================================================================
  // Scripture Reference Operations
  // ========================================================================

  /**
   * Get all scripture references mentioned in a specific section.
   *
   * Read from the unified `verse_link` table (`source_type='book_section'`).
   */
  getScriptureReferences(sectionId: number): ScriptureReference[] {
    return this.verseLinks
      .getForSource('book_section', sectionId)
      .map(link => verseLinkToScriptureReference(link));
  }

  /**
   * Get all verse links carried by a section.
   */
  getVerseLinksForSection(sectionId: number): VerseLinkRecord[] {
    return this.verseLinks.getForSource('book_section', sectionId);
  }

  /**
   * Get all sections that reference a specific verse.
   */
  getSectionsReferencingVerse(verseId: VerseId): BookSection[] {
    const range = verseRangeOverlapsRangeNullable('vl.verse_id_start', 'vl.verse_id_end', verseId, verseId);
    const rows = this.sql.queryAll<BookSectionRow>(
      `SELECT DISTINCT bs.* FROM book_section bs
       JOIN verse_link vl ON bs.section_id = vl.source_id AND vl.source_type = 'book_section'
       WHERE ${range.sql}
       ORDER BY bs.section_number, bs.section_id`,
      range.params
    );
    return rows.map(row => this.mapRowToSection(row));
  }

  /**
   * Get scripture references for a verse with their section titles.
   * Single JOIN query avoids N+1 lookups in VerseLinksService.
   */
  /** @inheritdoc */
  getVerseReferencesWithSectionsForRange(
    startVerseId: VerseId,
    endVerseId: VerseId
  ): Array<{ referenceId: number; sectionId: number; sectionTitle: string; context?: string; verseIdStart: VerseId; verseIdEnd: VerseId }> {
    const range = verseRangeOverlapsRangeNullable('vl.verse_id_start', 'vl.verse_id_end', startVerseId, endVerseId);
    const rows = this.sql.queryAll<{
      reference_id: number; section_id: number; title: string | null; context: string | null;
      verse_id_start: number; verse_id_end: number;
    }>(
      `SELECT vl.link_id AS reference_id, vl.source_id AS section_id, bs.title, vl.context,
              vl.verse_id_start, COALESCE(vl.verse_id_end, vl.verse_id_start) AS verse_id_end
       FROM verse_link vl
       JOIN book_section bs ON vl.source_id = bs.section_id
       WHERE vl.source_type = 'book_section' AND ${range.sql}
       ORDER BY vl.source_id`,
      range.params
    );
    return rows.map(mapRangeSectionRefRow);
  }

  getVerseReferencesWithSections(verseId: VerseId): Array<{ referenceId: number; sectionId: number; sectionTitle: string; context?: string }> {
    const range = verseRangeOverlapsRangeNullable('vl.verse_id_start', 'vl.verse_id_end', verseId, verseId);
    const rows = this.sql.queryAll<{ reference_id: number; section_id: number; title: string | null; context: string | null }>(
      `SELECT vl.link_id AS reference_id, vl.source_id AS section_id, bs.title, vl.context
       FROM verse_link vl
       JOIN book_section bs ON vl.source_id = bs.section_id
       WHERE vl.source_type = 'book_section' AND ${range.sql}
       ORDER BY vl.source_id`,
      range.params
    );
    return rows.map(row => ({
      referenceId: row.reference_id,
      sectionId: row.section_id,
      sectionTitle: row.title ?? 'Untitled Section',
      context: row.context ?? undefined
    }));
  }

  /**
   * Get all scripture references for a verse range.
   */
  getScriptureReferencesForRange(startVerseId: VerseId, endVerseId: VerseId): ScriptureReference[] {
    return this.verseLinks
      .getForVerseRange(startVerseId, endVerseId, { sourceType: 'book_section' })
      .map(link => verseLinkToScriptureReference(link));
  }

  // ========================================================================
  // Section Modification (for module creation/import)
  // ========================================================================

  /**
   * Create a new book section
   */
  createSection(section: BookSection): BookSection {
    const result = this.sql.execute(
      `INSERT INTO book_section (
        parent_section_id, section_number, title, content, content_file, word_count, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        section.parentSectionId ?? null,
        section.sectionNumber ?? null,
        section.title,
        section.content,
        section.contentFile ?? null,
        section.wordCount ?? null,
        stringifyJsonField(section.metadata)
      ]
    );

    section.sectionId = result.lastInsertRowId;
    return section;
  }

  /**
   * Update an existing book section
   */
  updateSection(section: BookSection): BookSection {
    if (!section.sectionId) {
      throw new Error('Cannot update book section without ID');
    }

    this.sql.execute(
      `UPDATE book_section SET
        parent_section_id = ?, section_number = ?, title = ?, content = ?,
        content_file = ?, word_count = ?, metadata = ?
      WHERE section_id = ?`,
      [
        section.parentSectionId ?? null,
        section.sectionNumber ?? null,
        section.title,
        section.content,
        section.contentFile ?? null,
        section.wordCount ?? null,
        stringifyJsonField(section.metadata),
        section.sectionId
      ]
    );

    return section;
  }

  /**
   * Delete a book section (and all its children via CASCADE)
   */
  deleteSection(sectionId: number): boolean {
    const result = this.sql.execute(
      'DELETE FROM book_section WHERE section_id = ?',
      [sectionId]
    );
    return result.changes > 0;
  }

  /**
   * Create a scripture reference.
   *
   * Writes to the unified `verse_link` table.
   */
  createScriptureReference(reference: ScriptureReference): ScriptureReference {
    const link = this.verseLinks.create(
      new VerseLinkRecord({
        sourceType: 'book_section',
        sourceId: reference.contentId, // For books, contentId is the section_id
        verseIdStart: reference.verseIdStart,
        verseIdEnd: reference.verseIdEnd,
        linkType: 'reference',
        sortOrder: reference.position ?? 0,
        context: reference.context,
        metadata: reference.metadata
      })
    );
    reference.referenceId = link.linkId;
    return reference;
  }

  /**
   * Delete a scripture reference by `link_id`.
   */
  deleteScriptureReference(referenceId: number): boolean {
    return this.verseLinks.delete(referenceId);
  }

  // ========================================================================
  // Private Mapping Methods
  // ========================================================================

  protected mapRowToModuleInfo(row: ModuleInfoRow): BookModuleInfo {
    return new BookModuleInfo({
      ...mapModuleIdentity(row),
      infoId: row.info_id,
      abbreviation: row.abbreviation,
      fullName: row.full_name,
      author: row.author,
      yearPublished: row.year_published,
      copyright: row.copyright,
      description: row.description,
      languageCode: row.language_code,
      publisher: row.publisher,
      version: row.version,
      createdDate: row.created_date,
      metadata: parseJsonField(row.metadata)
    });
  }

  private mapRowToSection(row: BookSectionRow): BookSection {
    return new BookSection({
      sectionId: row.section_id,
      parentSectionId: row.parent_section_id,
      sectionNumber: row.section_number != null ? String(row.section_number) : undefined,
      title: row.title!,
      content: row.content!,
      contentFile: row.content_file,
      wordCount: row.word_count,
      metadata: parseJsonField(row.metadata)
    });
  }

}

/**
 * Project a unified verse link onto the {@link ScriptureReference} shape the
 * book repository has always returned, so callers are version-agnostic.
 */
function verseLinkToScriptureReference(link: VerseLinkRecord): ScriptureReference {
  return new ScriptureReference({
    referenceId: link.linkId,
    contentId: link.sourceId,
    verseIdStart: link.verseIdStart,
    verseIdEnd: link.verseIdEnd,
    context: link.context,
    position: link.sortOrder,
    metadata: link.metadata
  });
}

/** Row mapper for {@link BookRepository.getVerseReferencesWithSectionsForRange}. */
function mapRangeSectionRefRow(row: {
  reference_id: number; section_id: number; title: string | null; context: string | null;
  verse_id_start: number; verse_id_end: number;
}): { referenceId: number; sectionId: number; sectionTitle: string; context?: string; verseIdStart: VerseId; verseIdEnd: VerseId } {
  return {
    referenceId: row.reference_id,
    sectionId: row.section_id,
    sectionTitle: row.title ?? 'Untitled Section',
    context: row.context ?? undefined,
    verseIdStart: row.verse_id_start,
    verseIdEnd: row.verse_id_end,
  };
}
