import { ISql } from '../Core/ISql';
import { IUserTextMarkupRepository } from './IUserTextMarkupRepository';
import { UserTextMarkup } from '../Models/User/UserTextMarkup';
import { VerseId, HighlightColor, resolveRangeEnd } from '../Core/Types';
import { normalizeMarkupColor, markupColorName } from '../Core/Colors';
import { UserTextMarkupRow } from '../Core/RowTypes';
import { parseJsonField, stringifyJsonField } from '../Core/JsonHelpers';
import { verseRangeContainsPoint } from '../Core/VerseRangeQuery';

export class UserTextMarkupRepository implements IUserTextMarkupRepository {
  constructor(private sql: ISql) {}

  async create(markup: UserTextMarkup): Promise<UserTextMarkup> {
    // Insert new markup directly without removing overlaps
    // Multiple highlights on the same verse/text are allowed
    const result = this.sql.execute(
      `INSERT INTO user_text_markup (
        module_id, verse_id_start, verse_id_end,
        text_start, text_end, color, note_id, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        markup.moduleId,
        markup.verseIdStart,
        // R-1: user_text_markup.verse_id_end is NOT NULL (its start always is too).
        resolveRangeEnd(markup.verseIdStart, markup.verseIdEnd),
        markup.textStart ?? null,
        markup.textEnd ?? null,
        // writes always emit canonical hex, even when the caller supplied
        // a palette name.
        normalizeMarkupColor(markup.color),
        markup.noteId ?? null,
        stringifyJsonField(markup.metadata)
      ]
    );

    markup.markupId = result.lastInsertRowId;
    return markup;
  }

  async update(markup: UserTextMarkup): Promise<void> {
    if (!markup.markupId) {
      throw new Error('Cannot update markup without ID');
    }

    this.sql.execute(
      `UPDATE user_text_markup SET
        module_id = ?,
        verse_id_start = ?,
        verse_id_end = ?,
        text_start = ?,
        text_end = ?,
        color = ?,
        note_id = ?,
        metadata = ?
      WHERE markup_id = ?`,
      [
        markup.moduleId,
        markup.verseIdStart,
        // R-1: user_text_markup.verse_id_end is NOT NULL (its start always is too).
        resolveRangeEnd(markup.verseIdStart, markup.verseIdEnd),
        markup.textStart ?? null,
        markup.textEnd ?? null,
        normalizeMarkupColor(markup.color),
        markup.noteId ?? null,
        stringifyJsonField(markup.metadata),
        markup.markupId
      ]
    );
  }

  async delete(markupId: number): Promise<void> {
    this.sql.execute(
      'DELETE FROM user_text_markup WHERE markup_id = ?',
      [markupId]
    );
  }

  async getById(markupId: number): Promise<UserTextMarkup | null> {
    const row = this.sql.queryOne<UserTextMarkupRow>(
      'SELECT * FROM user_text_markup WHERE markup_id = ?',
      [markupId]
    );

    return row ? this.mapRowToMarkup(row) : null;
  }

  async getForVerse(verseId: VerseId, moduleId: number): Promise<UserTextMarkup[]> {
    const range = verseRangeContainsPoint('verse_id_start', 'verse_id_end', verseId);
    const rows = this.sql.queryAll<UserTextMarkupRow>(
      `SELECT * FROM user_text_markup
       WHERE module_id = ?
         AND ${range.sql}
       ORDER BY verse_id_start, text_start`,
      [moduleId, ...range.params]
    );

    return rows.map(row => this.mapRowToMarkup(row));
  }

  async getForVerseRange(
    startVerseId: VerseId,
    endVerseId: VerseId,
    moduleId: number
  ): Promise<UserTextMarkup[]> {
    const rows = this.sql.queryAll<UserTextMarkupRow>(
      `SELECT * FROM user_text_markup
       WHERE module_id = ?
         AND verse_id_start <= ?
         AND (verse_id_end IS NULL OR verse_id_end >= ?)
       ORDER BY verse_id_start, text_start`,
      [moduleId, endVerseId, startVerseId]
    );

    return rows.map(row => this.mapRowToMarkup(row));
  }

  async getForModule(moduleId: number): Promise<UserTextMarkup[]> {
    const rows = this.sql.queryAll<UserTextMarkupRow>(
      `SELECT * FROM user_text_markup
       WHERE module_id = ?
       ORDER BY verse_id_start, text_start`,
      [moduleId]
    );

    return rows.map(row => this.mapRowToMarkup(row));
  }

  /**
   * Find markup by colour.
   *
   * Matches BOTH encodings - the canonical hex and the legacy
   * palette name - because live user data holds a mixture until a user-database
   * migration rewrites it. The palette name is derived from the *resolved*
   * colour, so callers get the same rows whether they pass `'yellow'` or
   * `'#FFF3A3'`. match on hex alone.
   */
  async getByColor(color: HighlightColor | string, moduleId?: number): Promise<UserTextMarkup[]> {
    const hex = normalizeMarkupColor(color);
    // '' for a custom colour: no palette name exists, so the legacy branch
    // simply never matches (colours are never stored empty).
    const legacyName = markupColorName(color) ?? '';

    const query = moduleId
      ? 'SELECT * FROM user_text_markup WHERE (UPPER(color) = ? OR LOWER(color) = ?) AND module_id = ? ORDER BY verse_id_start'
      : 'SELECT * FROM user_text_markup WHERE (UPPER(color) = ? OR LOWER(color) = ?) ORDER BY verse_id_start';

    const params = moduleId ? [hex, legacyName, moduleId] : [hex, legacyName];
    const rows = this.sql.queryAll<UserTextMarkupRow>(query, params);

    return rows.map(row => this.mapRowToMarkup(row));
  }

  async getByNote(noteId: number): Promise<UserTextMarkup[]> {
    const rows = this.sql.queryAll<UserTextMarkupRow>(
      'SELECT * FROM user_text_markup WHERE note_id = ? ORDER BY verse_id_start',
      [noteId]
    );

    return rows.map(row => this.mapRowToMarkup(row));
  }

  async deleteForVerse(verseId: VerseId, moduleId: number): Promise<void> {
    const range = verseRangeContainsPoint('verse_id_start', 'verse_id_end', verseId);
    this.sql.execute(
      `DELETE FROM user_text_markup
       WHERE module_id = ?
         AND ${range.sql}`,
      [moduleId, ...range.params]
    );
  }

  async deleteForVerseRange(
    startVerseId: VerseId,
    endVerseId: VerseId,
    moduleId: number
  ): Promise<void> {
    this.sql.execute(
      `DELETE FROM user_text_markup
       WHERE module_id = ?
         AND verse_id_start <= ?
         AND (verse_id_end IS NULL OR verse_id_end >= ?)`,
      [moduleId, endVerseId, startVerseId]
    );
  }

  async countForModule(moduleId: number): Promise<number> {
    const row = this.sql.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM user_text_markup WHERE module_id = ?',
      [moduleId]
    );

    return row ? row.count : 0;
  }

  async findOverlapping(
    verseIdStart: VerseId,
    verseIdEnd: VerseId | null,
    moduleId: number
  ): Promise<UserTextMarkup[]> {
    const endId = verseIdEnd || verseIdStart;

    const rows = this.sql.queryAll<UserTextMarkupRow>(
      `SELECT * FROM user_text_markup
       WHERE module_id = ?
         AND NOT (
           (verse_id_end IS NOT NULL AND verse_id_end < ?)
           OR verse_id_start > ?
         )`,
      [moduleId, verseIdStart, endId]
    );

    return rows.map(row => this.mapRowToMarkup(row));
  }

  /**
   * Map database row to UserTextMarkup model
   */
  private mapRowToMarkup(row: UserTextMarkupRow): UserTextMarkup {
    return new UserTextMarkup({
      markupId: row.markup_id,
      moduleId: row.module_id!,
      verseIdStart: row.verse_id_start,
      verseIdEnd: row.verse_id_end,
      textStart: row.text_start,
      textEnd: row.text_end,
      // Stored value may be hex or a palette name; the model accepts both
      // and exposes getColorHex() / getColorName().
      color: row.color,
      noteId: row.note_id,
      createdDate: row.created_date,
      metadata: parseJsonField(row.metadata)
    });
  }
}
