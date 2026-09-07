import { ISql } from '../Core/ISql';
import { VerseId } from '../Core/Types';
import { CrossReferenceGroup } from '../Models/CrossReference/CrossReferenceGroup';
import { ModuleCrossRefEntry } from '../Models/CrossReference/CrossReferenceEntry';
import { CrossReferenceModuleInfo } from '../Models/CrossReference/CrossReferenceModuleInfo';
import {
  ICrossReferenceRepository,
  CrossReferenceGroupWithEntries,
  ReverseReference,
  RangeReverseReference
} from './ICrossReferenceRepository';
import { BaseModuleRepository, mapModuleIdentity } from './BaseModuleRepository';
import { ModuleInfoRow, CrossReferenceGroupRow } from '../Core/RowTypes';
import { parseJsonField } from '../Core/JsonHelpers';
import { VerseLinkRepository } from './VerseLinkRepository';
import { VerseLinkRecord } from '../Models/Common/VerseLinkRecord';

/**
 * Repository for Cross-Reference module databases (xref_*.db)
 *
 * Handles all operations for a cross-reference database:
 * - Module information
 * - Phrase-grouped and verse-level cross-references
 * - Reverse lookups ("where is this verse referenced?")
 *
 * @example
 * ```typescript
 * const tskDb = new SqliteProvider('data/modules/xref_tsk.db');
 * const repo = new CrossReferenceRepository(tskDb);
 *
 * // Get phrase-grouped cross-refs for a verse
 * const groups = repo.getGroupsWithEntries(43003016); // John 3:16
 * for (const { group, entries } of groups) {
 *   console.log(group.phrase ?? '(General)');
 *   entries.forEach(e => console.log(`  -> ${e.targetVerseId}`));
 * }
 *
 * // Reverse lookup
 * const refs = repo.getReverseReferences(45005008); // Rom 5:8
 * ```
 */
export class CrossReferenceRepository extends BaseModuleRepository<CrossReferenceModuleInfo> implements ICrossReferenceRepository {
  private readonly verseLinks: VerseLinkRepository;

  constructor(sql: ISql) {
    super(sql);
    this.verseLinks = new VerseLinkRepository(sql);
  }

  // ========================================================================
  // Source Anchor Columns
  // ========================================================================

  /**
   * Longest `verse_id_end - verse_id_start` across this module's cross-reference
   * links, used to bound the reverse-lookup scan in {@link getReverseReferences}.
   *
   * Measured from the module rather than assumed: a module with unusually long
   * ranges widens the window and stays correct, where a hardcoded constant would
   * silently start missing references. TSK's longest span is 145. Cached because
   * it is a full scan of `verse_link` (~379k rows in TSK) and cannot change while
   * the module is open - modules are read-only.
   */
  private cachedMaxLinkSpan: number | undefined;

  private maxLinkSpan(): number {
    if (this.cachedMaxLinkSpan === undefined) {
      const row = this.sql.queryOne<{ span: number | null }>(
        `SELECT MAX(verse_id_end - verse_id_start) AS span
         FROM verse_link WHERE source_type = 'cross_reference_group'`
      );
      // NULL when the table is empty; MAX never returns a negative span.
      this.cachedMaxLinkSpan = row?.span ?? 0;
    }
    return this.cachedMaxLinkSpan;
  }

  /**
   * Group SELECT list that aliases the anchor onto the canonical spelling, so
   * {@link CrossReferenceGroupRow} has one shape regardless of module version.
   */
  private groupSelect(): string {
    return `SELECT group_id, verse_id_start AS verse_id_start, verse_id_end AS verse_id_end,
                   phrase, sort_order, metadata
            FROM cross_reference_group`;
  }

  // ========================================================================
  // Verse Link Operations
  // ========================================================================

  /**
   * Target passages of a phrase group, from the unified `verse_link` table
   * (`source_type='cross_reference_group'`, `link_type='cross_reference'`).
   */
  getVerseLinksForGroup(groupId: number): VerseLinkRecord[] {
    return this.verseLinks.getForSource('cross_reference_group', groupId);
  }

  // ========================================================================
  // Group Operations
  // ========================================================================

  getGroupsForVerse(verseId: VerseId): CrossReferenceGroup[] {
    // Containment, section 5: no COALESCE and no "IS NULL" branch - `verse_id_end` is
    // NOT NULL here, and either guard would silently drop single-verse groups.
    const rows = this.sql.queryAll<CrossReferenceGroupRow>(
      `${this.groupSelect()}
       WHERE verse_id_start <= ? AND verse_id_end >= ?
       ORDER BY sort_order`,
      [verseId, verseId]
    );
    return rows.map(row => this.mapRowToGroup(row));
  }

  /**
   * Target passages of a phrase group.
   *
   * Reads the unified `verse_link` table and projects each row onto the
   * `cross_reference_entry` table. Either way the caller receives
   * {@link ModuleCrossRefEntry}.
   */
  getEntriesForGroup(groupId: number): ModuleCrossRefEntry[] {
    return this.verseLinks
      .getForSource('cross_reference_group', groupId)
      .map(link => verseLinkToCrossRefEntry(link));
    
  }

  getGroupsWithEntries(verseId: VerseId): CrossReferenceGroupWithEntries[] {
    const groups = this.getGroupsForVerse(verseId);
    return groups.map(group => ({
      group,
      entries: this.getEntriesForGroup(group.groupId!)
    }));
  }

  getGroupsWithEntriesForRange(
    startVerseId: VerseId,
    endVerseId: VerseId
  ): CrossReferenceGroupWithEntries[] {
    // Range vs. range is an OVERLAP, not containment: a group anchored to a
    // passage that straddles the requested range still belongs in the result.
    const groupRows = this.sql.queryAll<CrossReferenceGroupRow>(
      `${this.groupSelect()}
       WHERE verse_id_start <= ? AND verse_id_end >= ?
       ORDER BY verse_id_start, sort_order`,
      [endVerseId, startVerseId]
    );
    if (groupRows.length === 0) return [];

    const groupIds = groupRows.map(g => g.group_id);

    const linksByGroup = this.verseLinks.getForSources('cross_reference_group', groupIds);
    return groupRows.map(g => ({
      group: this.mapRowToGroup(g),
      entries: (linksByGroup.get(g.group_id) ?? []).map(link => verseLinkToCrossRefEntry(link)),
    }));
    
  }

  // ========================================================================
  // Reverse Lookup
  // ========================================================================

  /** @inheritdoc */
  getReverseReferencesForRange(startVerseId: VerseId, endVerseId: VerseId): RangeReverseReference[] {

    // Same bounded-BETWEEN trick as the single-verse lookup above, widened to
    // the whole range: any link overlapping [startVerseId, endVerseId] starts
    // within `maxLinkSpan()` of `startVerseId`. See getReverseReferences for
    // why the bound (and the unary `+`) are load-bearing.
    const low = startVerseId - this.maxLinkSpan();

    const rows = this.sql.queryAll(
      `SELECT g.verse_id_start AS source_verse_id, g.phrase, vl.context AS note,
              vl.verse_id_start AS target_start,
              COALESCE(vl.verse_id_end, vl.verse_id_start) AS target_end
       FROM verse_link vl
       JOIN cross_reference_group g ON vl.source_id = g.group_id
       WHERE +vl.source_type = 'cross_reference_group'
         AND vl.verse_id_start BETWEEN ? AND ?
         AND COALESCE(vl.verse_id_end, vl.verse_id_start) >= ?`,
      [low, endVerseId, startVerseId]
    );
    return rows.map(mapRangeReverseRow);
    
  }

  getReverseReferences(verseId: VerseId): ReverseReference[] {

    // Containment, not equality: a link's *target* is an inclusive range, and
    // 11.6% of TSK's 379k links span more than one verse. Matching only
    // `verse_id_start = ?` silently dropped every verse that fell inside a
    // range without starting it - Prov 8:23 returned 12 sources instead of 29.
    //
    // The bounded `BETWEEN` is what keeps that affordable. A bare
    // `verse_id_start <= ?` is an open-ended scan, so SQLite abandons the range
    // index and drives off `source_type` - which matches every row in the table
    // - at ~84 ms per lookup. Widening the low end by no more than the longest
    // range actually present makes it a keyed scan at ~1 ms, and cannot change
    // the result set: any link containing `verseId` starts within `maxSpan` of it.
    //
    // The unary `+` is load-bearing. It stops SQLite treating the
    // match-everything `source_type` equality as an indexable term; without it
    // the planner still prefers that index and the BETWEEN buys nothing. `+` is
    // used rather than `INDEXED BY` so this degrades to a slower-but-correct
    // plan on a module built without the range index instead of failing to prepare.
    const rows = this.sql.queryAll(
      `SELECT g.verse_id_start AS source_verse_id, g.phrase, vl.context AS note
       FROM verse_link vl
       JOIN cross_reference_group g ON vl.source_id = g.group_id
       WHERE +vl.source_type = 'cross_reference_group'
         AND vl.verse_id_start BETWEEN ? AND ?
         AND vl.verse_id_end >= ?`,
      [verseId - this.maxLinkSpan(), verseId, verseId]
    );
    return rows.map((row) => ({
      sourceVerseId: row.source_verse_id as VerseId,
      phrase: (row.phrase as string | undefined) ?? undefined,
      note: (row.note as string | undefined) ?? undefined
    }));
    
  }

  // ========================================================================
  // Counts
  // ========================================================================

  getEntryCount(verseId: VerseId): number {
    // The matching groups are selected in a subquery rather than joined. With a
    // range predicate the planner stops believing the group side is selective
    // and drives the join from the link table instead, scanning every link in
    // the module (~30x slower on TSK). A LIST SUBQUERY keeps the group index
    // scan first and the link lookup keyed.
    const groupIds = `SELECT group_id FROM cross_reference_group WHERE verse_id_start <= ? AND verse_id_end >= ?`;

    const row = this.sql.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM verse_link vl
       WHERE vl.source_type = 'cross_reference_group' AND vl.source_id IN (${groupIds})`,
      [verseId, verseId]
    );
    return row?.count ?? 0;
    
  }

  // ========================================================================
  // Private Mapping Methods
  // ========================================================================

  protected mapRowToModuleInfo(row: ModuleInfoRow): CrossReferenceModuleInfo {
    return new CrossReferenceModuleInfo({
      ...mapModuleIdentity(row),
      infoId: row.info_id,
      abbreviation: row.abbreviation,
      fullName: row.full_name,
      author: row.author,
      yearPublished: row.year_published,
      copyright: row.copyright,
      description: row.description,
      languageCode: row.language_code,
      version: row.version,
      createdDate: row.created_date,
      metadata: parseJsonField(row.metadata)
    });
  }

  private mapRowToGroup(row: CrossReferenceGroupRow): CrossReferenceGroup {
    return new CrossReferenceGroup({
      groupId: row.group_id,
      verseId: row.verse_id_start,
      verseIdEnd: row.verse_id_end,
      phrase: row.phrase ?? undefined,
      sortOrder: row.sort_order ?? undefined,
      metadata: parseJsonField(row.metadata)
    });
  }

}

/**
 * Project a unified verse link onto the {@link ModuleCrossRefEntry} shape this
 * repository has always returned, so callers are version-agnostic.
 *
 * The legacy `note` column maps to `verse_link.context`.
 */
function verseLinkToCrossRefEntry(link: VerseLinkRecord): ModuleCrossRefEntry {
  return new ModuleCrossRefEntry({
    entryId: link.linkId,
    groupId: link.sourceId,
    targetVerseId: link.verseIdStart,
    targetVerseEndId: link.verseIdEnd,
    note: link.context,
    sortOrder: link.sortOrder,
    metadata: link.metadata
  });
}

/**
 * Row mapper for
 * {@link CrossReferenceRepository.getReverseReferencesForRange}.
 */
function mapRangeReverseRow(row: Record<string, unknown>): RangeReverseReference {
  return {
    sourceVerseId: row.source_verse_id as VerseId,
    phrase: (row.phrase as string | undefined) ?? undefined,
    note: (row.note as string | undefined) ?? undefined,
    targetVerseIdStart: row.target_start as VerseId,
    targetVerseIdEnd: row.target_end as VerseId,
  };
}
