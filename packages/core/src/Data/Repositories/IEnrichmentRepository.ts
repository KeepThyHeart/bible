export interface EnrichmentUnit {
  title: string;
  level: string;
  startVerseId: number;
  endVerseId: number;
}

export interface EnrichmentTagMatch {
  unitId: string;
  strength: number;
}

/**
 * Interface for the enrichment database repository.
 * Provides access to enrichment_units (book topics/section titles)
 * and enrichment_tags (tag-to-verse strength mappings).
 */
export interface IEnrichmentRepository {
  /**
   * Get enrichment units (section topics) for a given book.
   * Returns rows with non-null titles ordered by start_verse_id.
   */
  getBookTopics(bookNumber: number): EnrichmentUnit[];

  /**
   * Look up verses matching a tag name and type, ordered by strength descending.
   */
  getVersesByTag(tag: string, tagType: string, limit: number): EnrichmentTagMatch[];

  /**
   * Look up tag strengths for a specific tag across a set of verse unit IDs.
   * @param tag - The tag name to look up
   * @param types - Array of tag types to match (e.g. ['theme', 'emotion', 'event', 'imagery'])
   * @param unitIds - Array of unit_id strings to filter (e.g. ['v_43003016', 'v_1001001'])
   */
  getTagStrengthsForVerses(tag: string, types: string[], unitIds: string[]): EnrichmentTagMatch[];
}
