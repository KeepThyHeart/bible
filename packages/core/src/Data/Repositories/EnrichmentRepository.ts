import { ISql } from '../Core/ISql';
import { IEnrichmentRepository, EnrichmentUnit, EnrichmentTagMatch } from './IEnrichmentRepository';

/**
 * Repository for the enrichments database (enrichments_*.db).
 * Provides access to AI-generated enrichment units (section topics)
 * and enrichment tags (tag-to-verse strength mappings).
 */
export class EnrichmentRepository implements IEnrichmentRepository {
  constructor(private sql: ISql) {}

  getBookTopics(bookNumber: number): EnrichmentUnit[] {
    const bookStart = bookNumber * 1000000;
    const bookEnd = (bookNumber + 1) * 1000000;

    return this.sql.queryAll<{
      title: string;
      level: string;
      start_verse_id: number;
      end_verse_id: number;
    }>(
      `SELECT title, level, start_verse_id, end_verse_id
       FROM enrichment_units
       WHERE title IS NOT NULL
         AND start_verse_id >= ? AND start_verse_id < ?
       ORDER BY start_verse_id`,
      [bookStart, bookEnd]
    ).map(row => ({
      title: row.title,
      level: row.level,
      startVerseId: row.start_verse_id,
      endVerseId: row.end_verse_id,
    }));
  }

  getVersesByTag(tag: string, tagType: string, limit: number): EnrichmentTagMatch[] {
    return this.sql.queryAll<{ unit_id: string; strength: number }>(
      'SELECT unit_id, strength FROM enrichment_tags WHERE tag = ? AND type = ? ORDER BY strength DESC LIMIT ?',
      [tag, tagType, limit]
    ).map(row => ({
      unitId: row.unit_id,
      strength: row.strength,
    }));
  }

  getTagStrengthsForVerses(tag: string, types: string[], unitIds: string[]): EnrichmentTagMatch[] {
    if (unitIds.length === 0 || types.length === 0) return [];

    const typePlaceholders = types.map(() => '?').join(',');
    const unitPlaceholders = unitIds.map(() => '?').join(',');

    return this.sql.queryAll<{ unit_id: string; strength: number }>(
      `SELECT unit_id, strength FROM enrichment_tags WHERE tag = ? AND type IN (${typePlaceholders}) AND unit_id IN (${unitPlaceholders})`,
      [tag, ...types, ...unitIds]
    ).map(row => ({
      unitId: row.unit_id,
      strength: row.strength,
    }));
  }
}
