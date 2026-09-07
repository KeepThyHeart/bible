import { Topic } from '../Models/TopicalIndex/Topic';
import { TopicVerse } from '../Models/TopicalIndex/TopicVerse';
import { TopicalIndexModuleInfo } from '../Models/TopicalIndex/TopicalIndexModuleInfo';
import { VerseId } from '../Core/Types';

/**
 * Interface for Topical Index repository
 * Defines all operations for working with topical index databases
 */
export interface ITopicalIndexRepository {
  // Module Info
  getModuleInfo(): TopicalIndexModuleInfo | undefined;

  // Topic Operations
  getTopic(topicId: number): Topic | undefined;
  getTopicsByVerse(verseId: VerseId): Topic[];
  getChildren(parentTopicId: number): Topic[];
  getRootTopics(): Topic[];
  getParentChain(topicId: number): Topic[];
  searchTopics(query: string, options?: { limit?: number; offset?: number }): Topic[];
  getTopicsByName(name: string): Topic[];

  /**
   * One page of topics, ordered by name.
   *
   * `rootsOnly` restricts the page to top-level topics. It applies to plain
   * browsing only: a filtered (FTS) page always spans every level, because a
   * reader who types a subtopic's name is asking for that subtopic. See the
   * implementation for why the top level is the right default for browsing.
   */
  getAllTopicsPaginated(options?: { limit?: number; offset?: number; filter?: string; rootsOnly?: boolean }): Topic[];

  /** Counts what {@link getAllTopicsPaginated} pages through, same options. */
  getTopicCount(filter?: string, options?: { rootsOnly?: boolean }): number;

  /**
   * Direct-child counts for a batch of topics, keyed by topic id.
   *
   * Batched rather than per-topic because the browse list needs it for every
   * row it draws; topics with no children are absent from the map.
   */
  getChildCounts(topicIds: number[]): ReadonlyMap<number, number>;

  // Verse Operations
  getVersesForTopic(topicId: number, options?: { limit?: number; offset?: number }): TopicVerse[];
  getRecursiveVersesForTopic(topicId: number, options?: { limit?: number; offset?: number }): TopicVerse[];
  getVerseCount(topicId: number): number;
  getRecursiveVerseCount(topicId: number): number;

  // Reference counts are the *pagination* unit: one per stored verse link, so
  // `getReferenceCount` is exactly the number of rows `getVersesForTopic` can
  // ever return. `getVerseCount` sums range lengths instead (a Gen 1:1-5 link
  // counts 5), which makes it useful for display but wrong for "is there more
  // to load?" - comparing it against a returned row count leaves a Load More
  // button that never goes away.
  getReferenceCount(topicId: number): number;
  getRecursiveReferenceCount(topicId: number): number;

  // Bulk-read operations for chapter aggregation across many verses.
  // These return flat shapes rather than the higher-level Topic/TopicVerse
  // models, so the ranged-vs-single-verse mismatch in those models doesn't leak
  // into aggregation output. Both the unified `verse_link` table and the legacy
  // `topic_verses` table are read through the same shape.
  getAllTopicSummaries(): TopicSummary[];
  getAllTopicVerseLinks(): TopicVerseLink[];
}

/** Flat shape used by bulk-read methods. */
export interface TopicSummary {
  topicId: number;
  parentTopicId: number | null;
  name: string;
  description: string | null;
}

/**
 * Flat topic<->verse link.
 *
 * `verseIdStart` / `verseIdEnd` are the canonical names (see the range
 * convention in `Core/Types.ts`); the end is always resolved to a concrete verse
 * id, so a single verse has `verseIdEnd === verseIdStart`.
 *
 * `startVerseId` / `endVerseId` are deprecated aliases carrying the same values,
 * retained because consumers across `@bible/web` and the aggregation services
 * read them.
 */
export interface TopicVerseLink {
  topicId: number;
  verseIdStart: number;
  verseIdEnd: number;
  /** @deprecated Use {@link TopicVerseLink.verseIdStart}. */
  startVerseId: number;
  /** @deprecated Use {@link TopicVerseLink.verseIdEnd}. */
  endVerseId: number;
}
