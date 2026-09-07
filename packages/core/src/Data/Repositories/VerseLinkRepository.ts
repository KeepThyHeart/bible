import { ISql, SqlParameter } from '../Core/ISql';
import { VerseLinkRecord } from '../Models/Common/VerseLinkRecord';
import {
  VerseId,
  SourceType,
  LinkType,
  assertSourceType,
  assertLinkType,
  resolveRangeEnd
} from '../Core/Types';
import { VerseLinkRow } from '../Core/RowTypes';
import { parseJsonField, stringifyJsonField } from '../Core/JsonHelpers';
import { verseRangeOverlapsRangeNullable } from '../Core/VerseRangeQuery';
import { IVerseLinkRepository, VerseLinkFilter } from './IVerseLinkRepository';

/** SQLite's default limit on bound parameters is 999; stay well inside it. */
const CHUNK_SIZE = 400;

/**
 * Repository for the unified `verse_link` table.
 *
 * Works against any connection - module database or user database - because the
 * table is identical everywhere.
 *
 * @example
 * ```typescript
 * const links = new VerseLinkRepository(mhcDb);
 * const refs = links.getForSource('commentary_entry', entryId);
 * ```
 */
export class VerseLinkRepository implements IVerseLinkRepository {
  constructor(private readonly sql: ISql) {}

  hasLinksFor(sourceType: SourceType): boolean {
    // `idx_verse_link_source` is (source_type, source_id, sort_order), so this
    // is a keyed probe of the index's leading column - O(1) on a populated
    // table and instant on an empty one.
    const row = this.sql.queryOne<{ present: number }>(
      'SELECT 1 AS present FROM verse_link WHERE source_type = ? LIMIT 1',
      [sourceType]
    );
    return row !== undefined;
  }

  // ==========================================================================
  // Reads
  // ==========================================================================

  getForSource(sourceType: SourceType, sourceId: number): VerseLinkRecord[] {

    const rows = this.sql.queryAll<VerseLinkRow>(
      `SELECT * FROM verse_link
       WHERE source_type = ? AND source_id = ?
       ORDER BY sort_order, verse_id_start, link_id`,
      [sourceType, sourceId]
    );
    return rows.map(row => mapRowToVerseLink(row));
  }

  getForSources(sourceType: SourceType, sourceIds: number[]): Map<number, VerseLinkRecord[]> {
    const result = new Map<number, VerseLinkRecord[]>();
    if (sourceIds.length === 0) return result;

    for (let i = 0; i < sourceIds.length; i += CHUNK_SIZE) {
      const chunk = sourceIds.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.sql.queryAll<VerseLinkRow>(
        `SELECT * FROM verse_link
         WHERE source_type = ? AND source_id IN (${placeholders})
         ORDER BY source_id, sort_order, verse_id_start, link_id`,
        [sourceType, ...chunk]
      );
      for (const row of rows) {
        const bucket = result.get(row.source_id);
        if (bucket) {
          bucket.push(mapRowToVerseLink(row));
        } else {
          result.set(row.source_id, [mapRowToVerseLink(row)]);
        }
      }
    }
    return result;
  }

  getForVerse(verseId: VerseId, filter?: VerseLinkFilter): VerseLinkRecord[] {
    return this.getForVerseRange(verseId, verseId, filter);
  }

  getForVerseRange(
    startVerseId: VerseId,
    endVerseId: VerseId,
    filter?: VerseLinkFilter
  ): VerseLinkRecord[] {

    const range = verseRangeOverlapsRangeNullable(
      'verse_id_start',
      'verse_id_end',
      startVerseId,
      endVerseId
    );
    const params: SqlParameter[] = [...range.params];
    let sql = `SELECT * FROM verse_link WHERE ${range.sql}`;

    if (filter?.sourceType !== undefined) {
      sql += ' AND source_type = ?';
      params.push(filter.sourceType);
    }
    if (filter?.linkType !== undefined) {
      sql += ' AND link_type = ?';
      params.push(filter.linkType);
    }

    sql += ' ORDER BY verse_id_start, sort_order, link_id';

    if (filter?.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(Math.max(0, Math.trunc(filter.limit)));
    }

    return this.sql.queryAll<VerseLinkRow>(sql, params).map(row => mapRowToVerseLink(row));
  }

  getSourceIdsForVerse(sourceType: SourceType, verseId: VerseId): number[] {

    const range = verseRangeOverlapsRangeNullable(
      'verse_id_start',
      'verse_id_end',
      verseId,
      verseId
    );
    const rows = this.sql.queryAll<{ source_id: number }>(
      `SELECT DISTINCT source_id FROM verse_link
       WHERE source_type = ? AND ${range.sql}
       ORDER BY source_id`,
      [sourceType, ...range.params]
    );
    return rows.map(r => r.source_id);
  }

  // ==========================================================================
  // Writes
  // ==========================================================================

  create(link: VerseLinkRecord): VerseLinkRecord {

    const sourceType: SourceType = assertSourceType(link.sourceType);
    const linkType: LinkType = assertLinkType(link.linkType);

    const result = this.sql.execute(
      `INSERT INTO verse_link (
        source_type, source_id, verse_id_start, verse_id_end,
        link_type, sort_order, context, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sourceType,
        link.sourceId,
        link.verseIdStart,
        // R-1: verse_link.verse_id_end is NOT NULL. A single verse is end = start.
        resolveRangeEnd(link.verseIdStart, link.verseIdEnd),
        linkType,
        link.sortOrder,
        link.context ?? null,
        stringifyJsonField(link.metadata)
      ]
    );

    link.linkId = result.lastInsertRowId;
    return link;
  }

  createMany(links: VerseLinkRecord[]): void {
    if (links.length === 0) return;
    this.sql.transaction(() => {
      for (const link of links) {
        this.create(link);
      }
    });
  }

  deleteForSource(sourceType: SourceType, sourceId: number): number {
    const result = this.sql.execute(
      'DELETE FROM verse_link WHERE source_type = ? AND source_id = ?',
      [assertSourceType(sourceType), sourceId]
    );
    return result.changes;
  }

  delete(linkId: number): boolean {
    const result = this.sql.execute('DELETE FROM verse_link WHERE link_id = ?', [linkId]);
    return result.changes > 0;
  }

}

/**
 * Map a `verse_link` row to the model.
 *
 * Exported so repositories that join `verse_link` into their own queries reuse
 * exactly one mapping.
 */
export function mapRowToVerseLink(row: VerseLinkRow): VerseLinkRecord {
  return new VerseLinkRecord({
    linkId: row.link_id,
    // Read leniently: an unrecognised value in shipped data must surface as data,
    // not as an exception. Writes are validated instead (see create()).
    sourceType: row.source_type as SourceType,
    sourceId: row.source_id,
    verseIdStart: row.verse_id_start,
    verseIdEnd: row.verse_id_end ?? undefined,
    linkType: (row.link_type as LinkType) ?? 'reference',
    sortOrder: row.sort_order ?? 0,
    context: row.context ?? undefined,
    metadata: parseJsonField(row.metadata)
  });
}
