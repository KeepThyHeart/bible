import { ISql } from '../Core/ISql';
import { VerseId, resolveRangeEnd } from '../Core/Types';
import { Topic } from '../Models/TopicalIndex/Topic';
import { TopicVerse } from '../Models/TopicalIndex/TopicVerse';
import { TopicalIndexModuleInfo } from '../Models/TopicalIndex/TopicalIndexModuleInfo';
import { VerseLinkRecord } from '../Models/Common/VerseLinkRecord';
import { ITopicalIndexRepository, TopicSummary, TopicVerseLink } from './ITopicalIndexRepository';
import { BaseModuleRepository, mapModuleIdentity } from './BaseModuleRepository';
import { ModuleInfoRow, TopicRow } from '../Core/RowTypes';
import { parseJsonField } from '../Core/JsonHelpers';
import { VerseLinkRepository } from './VerseLinkRepository';
import { escapeFts5Term } from '../../Services/FtsQuery';

/**
 * Repository for Topical Index module databases (topical_*.db)
 *
 * Handles all operations for a topical index database:
 * - Module information
 * - Topic hierarchy (parent/child, breadcrumbs)
 * - Topic-verse associations
 * - Full-text search via FTS5
 *
 * Topic->verse associations are read from the unified
 * `verse_link` table (`source_type='topic'`) when it exists, and from the legacy
 * `topic_verses` table otherwise. Table and column names are resolved once per
 * connection. Every fallback below is a
 *
 * @example
 * ```typescript
 * const navesDb = new SqliteProvider('data/modules/topical_nave.db');
 * const repo = new TopicalIndexRepository(navesDb);
 *
 * // Get topics for a verse
 * const topics = repo.getTopicsByVerse(43003016); // John 3:16
 *
 * // Browse hierarchy
 * const children = repo.getChildren(topicId);
 * const breadcrumb = repo.getParentChain(topicId);
 *
 * // Search
 * const results = repo.searchTopics('love');
 * ```
 */
export class TopicalIndexRepository extends BaseModuleRepository<TopicalIndexModuleInfo> implements ITopicalIndexRepository {
  /**
   * SQL predicate for "this topic sits at the top level".
   *
   * Shared by {@link getRootTopics} and the `rootsOnly` branch of
   * {@link getAllTopicsPaginated} so the two can never disagree about what a
   * root is. A fixed literal, never caller input, so it is safe to interpolate.
   */
  private static readonly ROOT_PREDICATE = 'parent_topic_id IS NULL';

  private readonly verseLinks: VerseLinkRepository;

  constructor(sql: ISql) {
    super(sql);
    this.verseLinks = new VerseLinkRepository(sql);
  }


  // ========================================================================
  // Topic Operations
  // ========================================================================

  getTopic(topicId: number): Topic | undefined {
    const row = this.sql.queryOne<TopicRow>(
      `SELECT * FROM topic WHERE topic_id = ?`,
      [topicId]
    );
    return row ? this.mapRowToTopic(row) : undefined;
  }

  getTopicsByVerse(verseId: VerseId): Topic[] {

    const topicIds = this.verseLinks.getSourceIdsForVerse('topic', verseId);
    return this.getTopicsByIds(topicIds);
    
  }

  /** Load topics by id, preserving ascending name order. */
  private getTopicsByIds(topicIds: number[]): Topic[] {
    if (topicIds.length === 0) return [];
    const placeholders = topicIds.map(() => '?').join(',');
    const rows = this.sql.queryAll<TopicRow>(
      `SELECT * FROM topic WHERE topic_id IN (${placeholders}) ORDER BY name`,
      topicIds
    );
    return rows.map(row => this.mapRowToTopic(row));
  }

  getChildren(parentTopicId: number): Topic[] {
    const rows = this.sql.queryAll<TopicRow>(
      `SELECT * FROM topic WHERE parent_topic_id = ? ORDER BY sort_order, name`,
      [parentTopicId]
    );
    return rows.map(row => this.mapRowToTopic(row));
  }

  getRootTopics(): Topic[] {
    const rows = this.sql.queryAll<TopicRow>(
      `SELECT * FROM topic
       WHERE ${TopicalIndexRepository.ROOT_PREDICATE}
       ORDER BY sort_order, name`
    );
    return rows.map(row => this.mapRowToTopic(row));
  }

  /**
   * Number of direct children for each of `topicIds`, in one grouped query.
   *
   * The browse list needs this for every row it draws, and the top level of
   * Nave's alone is 5,320 rows - one `getChildren` call per row would be a
   * query per row per page. Topics with no children are absent from the map
   * rather than present with a zero.
   */
  getChildCounts(topicIds: number[]): ReadonlyMap<number, number> {
    if (topicIds.length === 0) return new Map();
    const placeholders = topicIds.map(() => '?').join(',');
    const rows = this.sql.queryAll<{ parent_topic_id: number; count: number }>(
      `SELECT parent_topic_id, COUNT(*) AS count FROM topic
       WHERE parent_topic_id IN (${placeholders})
       GROUP BY parent_topic_id`,
      topicIds
    );
    return new Map(rows.map(r => [r.parent_topic_id, r.count]));
  }

  /**
   * Get the parent chain from a topic up to the root (breadcrumb).
   * Returns array from root to the topic's direct parent.
   */
  getParentChain(topicId: number): Topic[] {
    const rows = this.sql.queryAll<TopicRow>(
      `WITH RECURSIVE ancestors AS (
        SELECT t.* FROM topic t WHERE t.topic_id = (
          SELECT parent_topic_id FROM topic WHERE topic_id = ?
        )
        UNION ALL
        SELECT t.* FROM topic t
        JOIN ancestors a ON t.topic_id = a.parent_topic_id
      )
      SELECT * FROM ancestors`,
      [topicId]
    );
    // CTE returns from direct parent up to root; reverse to get root-first order
    return rows.map(row => this.mapRowToTopic(row)).reverse();
  }

  searchTopics(query: string, options?: { limit?: number; offset?: number }): Topic[] {
    const match = toTopicFtsQuery(query);
    if (match === '') return [];
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const rows = this.sql.queryAll<TopicRow>(
      `SELECT t.* FROM topic t
       JOIN topic_fts fts ON t.topic_id = fts.rowid
       WHERE topic_fts MATCH ?
       ORDER BY rank
       LIMIT ? OFFSET ?`,
      [match, limit, offset]
    );
    return rows.map(row => this.mapRowToTopic(row));
  }

  getTopicsByName(name: string): Topic[] {
    const rows = this.sql.queryAll<TopicRow>(
      `SELECT * FROM topic WHERE LOWER(name) = LOWER(?)`,
      [name]
    );
    return rows.map(row => this.mapRowToTopic(row));
  }

  getAllTopicsPaginated(options?: { limit?: number; offset?: number; filter?: string; rootsOnly?: boolean }): Topic[] {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    if (options?.filter) {
      // `rootsOnly` deliberately does NOT apply to a filtered query. It exists
      // to keep plain browsing readable - Nave's has 17,206 topics of which
      // only 5,320 sit at the top level, and a gloss subtopic like
      // "(A penalty)" is meaningless away from its parent "Fine". But someone
      // who types "(A penalty)" is asking for exactly that subtopic, so a
      // search spans every level of the hierarchy.
      const rows = this.sql.queryAll<TopicRow>(
        `SELECT t.* FROM topic t
         JOIN topic_fts fts ON t.topic_id = fts.rowid
         WHERE topic_fts MATCH ?
         ORDER BY t.name
         LIMIT ? OFFSET ?`,
        [options.filter, limit, offset]
      );
      return rows.map(row => this.mapRowToTopic(row));
    }

    const rows = this.sql.queryAll<TopicRow>(
      `SELECT * FROM topic
       ${options?.rootsOnly ? `WHERE ${TopicalIndexRepository.ROOT_PREDICATE}` : ''}
       ORDER BY name LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return rows.map(row => this.mapRowToTopic(row));
  }

  getTopicCount(filter?: string, options?: { rootsOnly?: boolean }): number {
    if (filter) {
      // See `getAllTopicsPaginated`: a filtered count spans every level too,
      // so that it stays the count of what a filtered page actually returns.
      const row = this.sql.queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM topic t
         JOIN topic_fts fts ON t.topic_id = fts.rowid
         WHERE topic_fts MATCH ?`,
        [filter]
      );
      return row?.count ?? 0;
    }
    const row = this.sql.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM topic
       ${options?.rootsOnly ? `WHERE ${TopicalIndexRepository.ROOT_PREDICATE}` : ''}`
    );
    return row?.count ?? 0;
  }

  // ========================================================================
  // Verse Operations
  // ========================================================================

  getVersesForTopic(topicId: number, options?: { limit?: number; offset?: number }): TopicVerse[] {

    return paginate(
      this.verseLinks.getForSource('topic', topicId).map(link => verseLinkToTopicVerse(link)),
      options
    );
    
  }

  getRecursiveVersesForTopic(topicId: number, options?: { limit?: number; offset?: number }): TopicVerse[] {
    const descendants = this.getDescendantTopicIds(topicId);
    if (descendants.length === 0) return [];

    const byTopic = this.verseLinks.getForSources('topic', descendants);
    const all: TopicVerse[] = [];
    for (const links of byTopic.values()) {
      for (const link of links) all.push(verseLinkToTopicVerse(link));
    }
    all.sort((a, b) => a.verseIdStart - b.verseIdStart);
    return paginate(all, options);
    
  }

  /** Topic ids of `topicId` and every descendant, via a recursive CTE. */
  private getDescendantTopicIds(topicId: number): number[] {
    const rows = this.sql.queryAll<{ topic_id: number }>(
      `WITH RECURSIVE descendants AS (
        SELECT topic_id FROM topic WHERE topic_id = ?
        UNION ALL
        SELECT t.topic_id FROM topic t
        JOIN descendants d ON t.parent_topic_id = d.topic_id
      )
      SELECT topic_id FROM descendants`,
      [topicId]
    );
    return rows.map(r => r.topic_id);
  }

  getVerseCount(topicId: number): number {

    // Sum range lengths so a (start=X, end=X+4) link counts as 5 verses.
    return this.verseLinks
      .getForSource('topic', topicId)
      .reduce((sum, link) => sum + link.verseCount(), 0);
    
  }

  /**
   * Number of verse *links* stored for a topic - the unit `getVersesForTopic`
   * paginates in. Unlike {@link getVerseCount} this does not expand ranges, so
   * it is the only count that can safely be compared against a loaded row count
   * to decide whether more pages exist.
   */
  getReferenceCount(topicId: number): number {

    return this.verseLinks.getForSource('topic', topicId).length;
    
  }

  /** {@link getReferenceCount} across a topic and all its descendants. */
  getRecursiveReferenceCount(topicId: number): number {
    const descendants = this.getDescendantTopicIds(topicId);
    if (descendants.length === 0) return 0;

    let total = 0;
    for (const links of this.verseLinks.getForSources('topic', descendants).values()) {
      total += links.length;
    }
    return total;
    
  }

  // ========================================================================
  // Bulk-Read Operations (for chapter aggregation)
  // ========================================================================

  /**
   * Bulk-read all topics as flat summary rows. Used by aggregation services
   * that pre-compute parent chains and recursive counts in JS rather than
   * via per-topic CTE queries.
   *
   * Result order matches sqlite's natural row order (no ORDER BY) so output
   * is reproducible per-DB without sorting overhead.
   */
  getAllTopicSummaries(): TopicSummary[] {
    const rows = this.sql.queryAll<{
      topic_id: number;
      parent_topic_id: number | null;
      name: string;
      description: string | null;
    }>(
      `SELECT topic_id, parent_topic_id, name, description FROM topic`
    );
    return rows.map(r => ({
      topicId: r.topic_id,
      parentTopicId: r.parent_topic_id,
      name: r.name,
      description: r.description,
    }));
  }

  /**
   * Bulk-read every topic<->verse link.
   *
   * Rows where the start equals the end represent a single verse; otherwise the
   * range is inclusive on both ends. Callers that need a flat per-verse map
   * should expand by walking `[verseIdStart, verseIdEnd]` inclusive.
   */
  getAllTopicVerseLinks(): TopicVerseLink[] {

    const rows = this.sql.queryAll<{ source_id: number; verse_id_start: number; verse_id_end: number | null }>(
      `SELECT source_id, verse_id_start, verse_id_end FROM verse_link WHERE source_type = 'topic'`
    );
    return rows.map(r => toTopicVerseLink(r.source_id, r.verse_id_start, r.verse_id_end));
    
  }

  getRecursiveVerseCount(topicId: number): number {
    const descendants = this.getDescendantTopicIds(topicId);
    if (descendants.length === 0) return 0;

    let total = 0;
    for (const links of this.verseLinks.getForSources('topic', descendants).values()) {
      for (const link of links) total += link.verseCount();
    }
    return total;
    
  }

  // ========================================================================
  // Private Mapping Methods
  // ========================================================================

  protected mapRowToModuleInfo(row: ModuleInfoRow): TopicalIndexModuleInfo {
    return new TopicalIndexModuleInfo({
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

  private mapRowToTopic(row: TopicRow): Topic {
    return new Topic({
      topicId: row.topic_id,
      parentTopicId: row.parent_topic_id ?? undefined,
      name: row.name,
      description: row.description ?? undefined,
      content: row.content ?? undefined,
      contentFile: row.content_file ?? undefined,
      wordCount: row.word_count ?? undefined,
      sortOrder: row.sort_order ?? undefined,
      metadata: parseJsonField(row.metadata)
    });
  }

  /**
   * Map a legacy `topic_verses` row, accepting either column spelling.
   */
}

/**
 * Build the FTS5 MATCH expression for a user-typed topic query.
 *
 * Two things have to happen to raw input before it reaches FTS5. It has to be
 * escaped - an apostrophe, a hyphen or the bare word "not" is query syntax, and
 * SQLite raises a *syntax error* rather than returning nothing, so a topic like
 * "(A penalty)" typed verbatim used to make the search throw. And the final
 * term gets a `*`, because the search box is a typeahead: without prefix
 * matching, "jeri" matches no token at all and the box reads as broken until a
 * whole word has been typed.
 *
 * Returns an empty string when no usable term is left, which callers treat as
 * "no query" rather than passing on to MATCH.
 */
function toTopicFtsQuery(query: string): string {
  const terms = query.trim().split(/\s+/).filter(term => term.length > 0);
  if (terms.length === 0) return '';
  // Strip a `*` the user typed themselves: `escapeFts5Term` would quote it as
  // literal text and we would then append a second one.
  const last = terms[terms.length - 1].replace(/\*+$/, '');
  const parts = terms.slice(0, -1).map(escapeFts5Term);
  if (last.length > 0) parts.push(`${escapeFts5Term(last)}*`);
  return parts.join(' ');
}

/** Project a unified verse link onto the topical model. */
function verseLinkToTopicVerse(link: VerseLinkRecord): TopicVerse {
  return new TopicVerse({
    topicId: link.sourceId,
    verseIdStart: link.verseIdStart,
    verseIdEnd: link.effectiveEnd(),
    context: link.context,
    sortOrder: link.sortOrder
  });
}

/** Build a flat link, normalising the nullable range end. */
function toTopicVerseLink(topicId: number, start: number, end: number | null): TopicVerseLink {
  const resolvedEnd = resolveRangeEnd(start, end);
  return {
    topicId,
    verseIdStart: start,
    verseIdEnd: resolvedEnd,
    startVerseId: start,
    endVerseId: resolvedEnd
  };
}

/** Apply limit/offset in memory for the `verse_link`-backed paths. */
function paginate<T>(items: T[], options?: { limit?: number; offset?: number }): T[] {
  const offset = options?.offset ?? 0;
  const limit = options?.limit;
  return limit === undefined ? items.slice(offset) : items.slice(offset, offset + limit);
}
