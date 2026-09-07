import { ITopicalIndexRepository } from '../../Data/Repositories/ITopicalIndexRepository';
import {
  ITopicAggregationService,
  PrecomputedTopicAncestor,
  PrecomputedTopicEntry,
  PrecomputedTopicalModule,
} from './ITopicAggregationService';
import {
  AggregationModule,
  TopicsByVerse,
  VerseTopicAncestor,
  VerseTopicEntry,
  chapterStart,
  chapterEnd,
} from './types';

/**
 * Default implementation of {@link ITopicAggregationService}.
 *
 * Does the expensive bulk-read + parent-chain + recursive-count pre-computation
 * once per module at construction time. Per-chapter calls are cheap dictionary
 * walks.
 *
 * Use {@link TopicAggregationService.from} to build the service from
 * repositories - this matches the script's `preComputeTopicalData` flow
 * exactly so output is byte-equivalent to the legacy generation path.
 */
export class TopicAggregationService implements ITopicAggregationService {
  private constructor(private readonly modules: PrecomputedTopicalModule[]) {}

  /**
   * Build the service from a list of topical-index repositories. Performs
   * the one-time bulk read and pre-computation per module.
   */
  static from(modules: AggregationModule<ITopicalIndexRepository>[]): TopicAggregationService {
    const precomputed = modules.map(mod => TopicAggregationService.precomputeOne(mod));
    return new TopicAggregationService(precomputed);
  }

  /**
   * Precompute topical data for a single module. Exposed as a static helper
   * so callers (like the cache-generation script) can log progress per module
   * before constructing the full service.
   */
  static precomputeOne(mod: AggregationModule<ITopicalIndexRepository>): PrecomputedTopicalModule {
    const repo = mod.repository;
    const topics = repo.getAllTopicSummaries();
    const links = repo.getAllTopicVerseLinks();

    // Build lookup maps
    const topicById = new Map<number, typeof topics[number]>();
    const childrenOf = new Map<number, number[]>();
    for (const t of topics) {
      topicById.set(t.topicId, t);
      if (t.parentTopicId != null) {
        let kids = childrenOf.get(t.parentTopicId);
        if (!kids) {
          kids = [];
          childrenOf.set(t.parentTopicId, kids);
        }
        kids.push(t.topicId);
      }
    }

    // Direct verse counts per topic, plus the verseToTopics inverse map.
    //
    // Topic-verse links can be either a single verse (start == end) or a range
    // (end > start). We expand ranges verse-by-verse so a chapter-scoped query
    // can return all verses a topic touches, not just the start of the range.
    //
    // Direct count is the sum of range lengths (range-inclusive verse count),
    // matching the repository's `getVerseCount` / `getRecursiveVerseCount`
    // implementations, which use `SUM(end_verse_id - start_verse_id + 1)`.
    const directCount = new Map<number, number>();
    const verseToTopics = new Map<number, number[]>();
    for (const link of links) {
      const span = link.endVerseId - link.startVerseId + 1;
      directCount.set(link.topicId, (directCount.get(link.topicId) || 0) + span);
      for (let v = link.startVerseId; v <= link.endVerseId; v++) {
        let topics = verseToTopics.get(v);
        if (!topics) {
          topics = [];
          verseToTopics.set(v, topics);
        }
        topics.push(link.topicId);
      }
    }

    // Compute recursive verse counts bottom-up via memoization.
    const recursiveCount = new Map<number, number>();
    const computeRecursive = (topicId: number): number => {
      const cached = recursiveCount.get(topicId);
      if (cached !== undefined) return cached;
      let count = directCount.get(topicId) || 0;
      const children = childrenOf.get(topicId);
      if (children) {
        for (const childId of children) {
          count += computeRecursive(childId);
        }
      }
      recursiveCount.set(topicId, count);
      return count;
    };
    for (const t of topics) computeRecursive(t.topicId);

    // Compute ancestor chains (root-first). Ids and counts travel with the
    // names: the consumer renders the chain as breadcrumbs and has to be able
    // to open any link in it, and a name alone cannot identify a topic.
    const ancestorChains = new Map<number, PrecomputedTopicAncestor[]>();
    const getAncestors = (topicId: number): PrecomputedTopicAncestor[] => {
      const cached = ancestorChains.get(topicId);
      if (cached) return cached;
      const topic = topicById.get(topicId);
      if (!topic || topic.parentTopicId == null) {
        ancestorChains.set(topicId, []);
        return [];
      }
      const chain = [...getAncestors(topic.parentTopicId)];
      const parent = topicById.get(topic.parentTopicId);
      if (parent) {
        chain.push({
          topicId: parent.topicId,
          name: parent.name,
          recursiveVerseCount: recursiveCount.get(parent.topicId) || 0,
        });
      }
      ancestorChains.set(topicId, chain);
      return chain;
    };
    for (const t of topics) getAncestors(t.topicId);

    // Build final topic map
    const topicMap = new Map<number, PrecomputedTopicEntry>();
    for (const t of topics) {
      topicMap.set(t.topicId, {
        name: t.name,
        description: t.description,
        ancestors: ancestorChains.get(t.topicId) || [],
        recursiveVerseCount: recursiveCount.get(t.topicId) || 0,
      });
    }

    return {
      abbreviation: mod.abbreviation,
      moduleName: mod.moduleName,
      topicMap,
      verseToTopics,
    };
  }

  /** Read-only access to the per-module pre-computed data (for logging/diagnostics). */
  getPrecomputedModules(): readonly PrecomputedTopicalModule[] {
    return this.modules;
  }

  getChapterTopics(book: number, chapter: number): TopicsByVerse {
    const start = chapterStart(book, chapter);
    const end = chapterEnd(book, chapter);
    const result: TopicsByVerse = {};

    for (const mod of this.modules) {
      for (const [verseId, topicIds] of mod.verseToTopics) {
        if (verseId < start || verseId > end) continue;

        const key = String(verseId);
        let bucket = result[key];
        if (!bucket) {
          bucket = [];
          result[key] = bucket;
        }

        for (const topicId of topicIds) {
          const data = mod.topicMap.get(topicId);
          if (!data) continue;
          const entry: VerseTopicEntry = {
            id: topicId,
            n: data.name,
            // p/a must be omitted (not null) when the topic is at the root
            ...(data.ancestors.length > 0
              ? {
                  p: data.ancestors.map(a => a.name).join(' > '),
                  a: data.ancestors.map(
                    (a): VerseTopicAncestor => [a.topicId, a.name, a.recursiveVerseCount]
                  ),
                }
              : {}),
            vc: data.recursiveVerseCount,
            src: mod.abbreviation,
            sn: mod.moduleName,
            // d must be omitted when description is empty/null
            ...(data.description ? { d: data.description } : {}),
          };
          bucket.push(entry);
        }
      }
    }

    return result;
  }
}
