import { ITopicalIndexRepository } from '../../Data/Repositories/ITopicalIndexRepository';
import { AggregationModule, TopicsByVerse } from './types';

/**
 * Aggregates topical-index data across multiple topical modules for a given
 * (book, chapter), pre-computing parent chains and recursive verse counts so
 * the per-chapter call is a hot-loop dictionary lookup rather than a series
 * of CTE queries.
 *
 * For best amortization, instantiate the service **once per generation run**
 * (not once per chapter): `TopicAggregationService.from(modules)` performs the
 * one-time bulk reads and pre-computation, then `getChapterTopics` is cheap.
 */
export interface ITopicAggregationService {
  /**
   * Build the verse-keyed topic dictionary for a single chapter.
   * Modules are visited in array order; output preserves that order.
   */
  getChapterTopics(book: number, chapter: number): TopicsByVerse;
}

/**
 * Per-module pre-computed topical data, ready for chapter slicing.
 * Returned by {@link ITopicAggregationServiceFactory.precompute}.
 */
export interface PrecomputedTopicalModule {
  abbreviation: string;
  moduleName: string;
  topicMap: Map<number, PrecomputedTopicEntry>;
  verseToTopics: Map<number, number[]>;
}

/** One ancestor of a topic, carrying everything needed to link to it. */
export interface PrecomputedTopicAncestor {
  topicId: number;
  name: string;
  /** Verses in this ancestor + all its descendants. */
  recursiveVerseCount: number;
}

export interface PrecomputedTopicEntry {
  name: string;
  description: string | null;
  /**
   * Ancestors from root to direct parent (root-first). Ids are part of the
   * chain because the cache is the only source a client has for opening an
   * ancestor topic - a name is not unique (hundreds of Nave's topics are
   * called "History of").
   */
  ancestors: PrecomputedTopicAncestor[];
  /** Verses in this topic + all descendants. */
  recursiveVerseCount: number;
}

/**
 * Factory shape for the topic aggregation service. Implementations expose a
 * static `from(modules)` constructor that does the bulk read and the
 * recursive-count / parent-chain pre-computation eagerly.
 */
export interface ITopicAggregationServiceFactory {
  precompute(modules: AggregationModule<ITopicalIndexRepository>[]): PrecomputedTopicalModule[];
}
