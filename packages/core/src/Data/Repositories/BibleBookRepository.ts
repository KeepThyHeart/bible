import { ISql } from '../Core/ISql';
import { RepositoryQueryOptions } from '../Core/IRepository';
import { BibleBook } from '../Models/Main/BibleBook';
import { ChapterInfo } from '../Models/Main/ChapterInfo';
import { Testament } from '../Core/Types';
import { IBibleBookRepository } from './IBibleBookRepository';
import { BibleBookRow, ChapterInfoRow } from '../Core/RowTypes';
import { parseJsonField, stringifyJsonField } from '../Core/JsonHelpers';
import { buildSafeOrderBy, buildPagination } from '../Core/SafeQuery';

/**
 * Repository for Bible book entities
 * Provides CRUD operations and queries for Bible books
 */
export class BibleBookRepository implements IBibleBookRepository {
  constructor(private sql: ISql) {}

  /**
   * Get a Bible book by ID
   */
  getById(id: number): BibleBook | undefined {
    const row = this.sql.queryOne<BibleBookRow>(
      'SELECT * FROM bible_book WHERE book_id = ?',
      [id]
    );

    return row ? this.mapRowToEntity(row) : undefined;
  }

  /**
   * Get a Bible book by book number (1-66)
   */
  getByBookNumber(bookNumber: number): BibleBook | undefined {
    const row = this.sql.queryOne<BibleBookRow>(
      'SELECT * FROM bible_book WHERE book_number = ?',
      [bookNumber]
    );

    return row ? this.mapRowToEntity(row) : undefined;
  }

  /**
   * Get a Bible book by name
   */
  getByName(name: string): BibleBook | undefined {
    const row = this.sql.queryOne<BibleBookRow>(
      'SELECT * FROM bible_book WHERE book_name = ? OR book_abbreviation = ?',
      [name, name]
    );

    return row ? this.mapRowToEntity(row) : undefined;
  }

  /**
   * Get all Bible books
   */
  getAll(options?: RepositoryQueryOptions): BibleBook[] {
    let sql = 'SELECT * FROM bible_book';
    const ALLOWED_COLUMNS = new Set(['book_number', 'book_name', 'testament']);

    sql += buildSafeOrderBy(options?.orderBy, options?.orderDirection, ALLOWED_COLUMNS, { column: 'book_number', direction: 'ASC' });

    sql += buildPagination(options?.limit, options?.offset);

    const rows = this.sql.queryAll<BibleBookRow>(sql);
    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Get books by testament
   */
  getByTestament(testament: Testament): BibleBook[] {
    const rows = this.sql.queryAll<BibleBookRow>(
      'SELECT * FROM bible_book WHERE testament = ? ORDER BY book_number',
      [testament]
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Get books by book group
   */
  getByBookGroup(bookGroup: string): BibleBook[] {
    const rows = this.sql.queryAll<BibleBookRow>(
      'SELECT * FROM bible_book WHERE book_group = ? ORDER BY book_number',
      [bookGroup]
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Create a new Bible book
   */
  create(entity: BibleBook): BibleBook {
    const result = this.sql.execute(
      `INSERT INTO bible_book (
        book_number, book_name, book_abbreviation, testament, book_group,
        chapter_count, verse_count, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entity.bookNumber,
        entity.bookName,
        entity.bookAbbreviation ?? null,
        entity.testament,
        entity.bookGroup ?? null,
        entity.chapterCount,
        entity.verseCount,
        stringifyJsonField(entity.metadata)
      ]
    );

    entity.bookId = result.lastInsertRowId;
    return entity;
  }

  /**
   * Update an existing Bible book
   */
  update(entity: BibleBook): BibleBook {
    if (!entity.bookId) {
      throw new Error('Cannot update Bible book without ID');
    }

    this.sql.execute(
      `UPDATE bible_book SET
        book_number = ?, book_name = ?, book_abbreviation = ?, testament = ?,
        book_group = ?, chapter_count = ?, verse_count = ?,
        metadata = ?
      WHERE book_id = ?`,
      [
        entity.bookNumber,
        entity.bookName,
        entity.bookAbbreviation ?? null,
        entity.testament,
        entity.bookGroup ?? null,
        entity.chapterCount,
        entity.verseCount,
        stringifyJsonField(entity.metadata),
        entity.bookId
      ]
    );

    return entity;
  }

  /**
   * Delete a Bible book
   */
  delete(id: number): boolean {
    const result = this.sql.execute('DELETE FROM bible_book WHERE book_id = ?', [id]);
    return result.changes > 0;
  }

  /**
   * Get total verse count for all books
   */
  getTotalVerseCount(): number {
    const row = this.sql.queryOne<{ total: number }>(
      'SELECT SUM(verse_count) as total FROM bible_book'
    );
    return row?.total ?? 0;
  }

  /**
   * Search books by name or abbreviation
   */
  search(query: string): BibleBook[] {
    const searchTerm = `%${query}%`;
    const rows = this.sql.queryAll<BibleBookRow>(
      `SELECT * FROM bible_book
       WHERE book_name LIKE ? OR book_abbreviation LIKE ?
       ORDER BY book_number`,
      [searchTerm, searchTerm]
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  // ========================================================================
  // Chapter Info Operations
  // ========================================================================

  /**
   * Get chapter information for a specific book and chapter
   * Used for verse distance calculations in proximity search
   */
  getChapterInfo(bookId: number, chapter: number): ChapterInfo | undefined {
    const row = this.sql.queryOne<ChapterInfoRow>(
      'SELECT * FROM chapter_info WHERE book_id = ? AND chapter = ?',
      [bookId, chapter]
    );

    return row ? this.mapRowToChapterInfo(row) : undefined;
  }

  /**
   * Get all chapter information for a book
   * Used for verse distance calculations across chapters
   */
  getBookChapterInfo(bookId: number): ChapterInfo[] {
    const rows = this.sql.queryAll<ChapterInfoRow>(
      'SELECT * FROM chapter_info WHERE book_id = ? ORDER BY chapter',
      [bookId]
    );

    return rows.map(row => this.mapRowToChapterInfo(row));
  }

  /**
   * Get chapter information by book number (helper for verse distance)
   */
  getChapterInfoByBookNumber(bookNumber: number): ChapterInfo[] {
    const book = this.getByBookNumber(bookNumber);
    if (!book || !book.bookId) {
      return [];
    }
    return this.getBookChapterInfo(book.bookId);
  }

  /**
   * Map database row to BibleBook entity
   */
  private mapRowToEntity(row: BibleBookRow): BibleBook {
    return new BibleBook({
      bookId: row.book_id,
      bookNumber: row.book_number,
      bookName: row.book_name,
      bookAbbreviation: row.book_abbreviation,
      testament: row.testament as Testament,
      bookGroup: row.book_group,
      chapterCount: row.chapter_count,
      verseCount: row.verse_count ?? 0,
      metadata: parseJsonField(row.metadata)
    });
  }

  /**
   * Map database row to ChapterInfo entity
   */
  private mapRowToChapterInfo(row: ChapterInfoRow): ChapterInfo {
    return new ChapterInfo({
      chapterInfoId: row.chapter_info_id,
      bookId: row.book_id,
      chapter: row.chapter,
      verseCount: row.verse_count,
      firstAbsoluteId: row.first_absolute_id ?? 0,
      lastAbsoluteId: row.last_absolute_id ?? 0,
      metadata: parseJsonField(row.metadata)
    });
  }
}
