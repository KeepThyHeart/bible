/**
 * Topic expansion for semantic search results.
 *
 * Pure functions with no platform dependencies - used by both
 * the web server (TypeScript) and CLI scripts (CommonJS via @bible/core).
 *
 * When topic-level embeddings (e.g., "forgiveness", "storms") match a query,
 * this module expands them into their constituent verse lists. The caller
 * is responsible for fetching the verse data from whatever DB driver it uses;
 * this module handles the scoring, capping, and merging logic.
 */

import type { ScoringConfig } from './SearchPipelineConfig';
import {
  DEFAULT_TOPIC_DAMPING,
  DEFAULT_TOPIC_BOOST,
  DEFAULT_TOPIC_MIN_SCORE,
} from './ScoringUtils';

/** A topic entry that matched the query. */
export interface TopicMatch {
  /** Unique identifier (e.g., embedding ID) */
  id: string;
  /** Embedding similarity score */
  score: number;
  /** Human-readable tag name */
  tagName: string;
  /** Tag type (e.g., 'theme', 'emotion', 'nave_torrey') */
  tagType: string;
}

/** A verse associated with a topic, with its tag strength. */
export interface TopicVerseData {
  verseId: number;
  strength: number;
}

/** Minimum interface for a non-topic result that can be merged with expanded verses. */
export interface ExpandableResult {
  startVerseId: number;
  endVerseId: number;
  score: number;
  level: string;
  fusedScore?: number;
  rerankerScore?: number;
  text?: string;
  title?: string;
}

/** Input to the topic expansion function. Caller pre-fetches all data. */
export interface TopicExpansionInput<T> {
  /** Topic entries that matched the query (from search results) */
  topicMatches: TopicMatch[];
  /** Pre-fetched verse lists for each topic (keyed by topic match ID) */
  topicVerses: Map<string, TopicVerseData[]>;
  /** Non-topic results to merge with the expanded verses */
  nonTopicResults: T[];
}

/** Options for topic expansion behavior. */
export interface TopicExpansionOptions {
  /** Maximum results to return. Default: unlimited */
  maxResults?: number;
  /** Enable multi-topic intersection bonus. Default: false */
  topicIntersect?: boolean;
  /** Bonus per additional topic match. Default: 0.05 */
  intersectBonus?: number;
}

/** Default intersection bonus per additional topic match. */
export const DEFAULT_INTERSECT_BONUS = 0.05;

/**
 * Get the best score from a result, checking fusedScore -> rerankerScore -> score.
 */
function getScore<T extends ExpandableResult>(r: T): number {
  return r.fusedScore ?? r.rerankerScore ?? r.score;
}

/**
 * Expand topic results into verse lists and merge with non-topic results.
 *
 * Algorithm:
 * 1. Filter topics below topicMinScore threshold
 * 2. For each topic, compute verse scores with damping and boost
 * 3. Apply leapfrog cap: topic verse scores cannot exceed best non-topic score
 * 4. Merge + dedup by verseId (keep highest score)
 * 5. Apply intersection bonus if enabled
 *
 * @param input - Pre-fetched topic data and non-topic results
 * @param scoring - Scoring config (topicDamping, topicBoost, topicMinScore, facetScoring)
 * @param options - Expansion behavior options
 * @returns Merged results sorted by score descending
 */
export function expandTopics<T extends ExpandableResult>(
  input: TopicExpansionInput<T>,
  scoring?: ScoringConfig,
  options: TopicExpansionOptions = {},
): T[] {
  const {
    topicMatches,
    topicVerses,
    nonTopicResults,
  } = input;

  const topicDamping = scoring?.topicDamping ?? DEFAULT_TOPIC_DAMPING;
  const topicBoost = scoring?.topicBoost ?? DEFAULT_TOPIC_BOOST;
  const topicMinScore = scoring?.topicMinScore ?? DEFAULT_TOPIC_MIN_SCORE;
  const facetScoring = scoring?.facetScoring ?? 'max';

  const {
    maxResults,
    topicIntersect = false,
    intersectBonus = DEFAULT_INTERSECT_BONUS,
  } = options;

  // Step 1: Filter topics below minimum similarity threshold
  const filteredTopics = topicMatches.filter(t => t.score >= topicMinScore);

  if (filteredTopics.length === 0) {
    // No qualifying topics - return original results unchanged
    return [...nonTopicResults] as T[];
  }

  // Step 2: Expand each topic into verses with scored entries
  const expandedVerses: (T & { fromTopic?: boolean; topicOverlap?: number })[] = [];
  const verseTopicCount = new Map<number, number>();

  for (const topic of filteredTopics) {
    const verses = topicVerses.get(topic.id) || [];

    // Apply topic damping when main-prefer is active
    const effectiveTopicScore = facetScoring === 'main-prefer'
      ? topic.score * topicDamping
      : topic.score;

    for (const v of verses) {
      const verseScore = effectiveTopicScore + topicBoost * v.strength;

      // Track intersection count
      verseTopicCount.set(v.verseId, (verseTopicCount.get(v.verseId) || 0) + 1);

      expandedVerses.push({
        startVerseId: v.verseId,
        endVerseId: v.verseId,
        score: verseScore,
        level: 'verse',
        text: `[${topic.tagName}]`,
        title: topic.tagName,
        fromTopic: true,
      } as unknown as T & { fromTopic?: boolean });
    }
  }

  // Step 3: Leapfrog cap - topic verse scores cannot exceed best non-topic score
  if (nonTopicResults.length > 0) {
    const bestNonTopicScore = getScore(nonTopicResults[0]);
    for (const ev of expandedVerses) {
      if (ev.score > bestNonTopicScore) {
        ev.score = bestNonTopicScore;
      }
    }
  }

  // Step 4: Merge + dedup by verseId (keep highest score)
  const verseScores = new Map<number, T & { fromTopic?: boolean; topicOverlap?: number }>();

  for (const r of [...nonTopicResults as Array<T & { fromTopic?: boolean; topicOverlap?: number }>, ...expandedVerses]) {
    const vid = r.startVerseId;
    const existing = verseScores.get(vid);
    const rScore = getScore(r);
    const eScore = existing ? getScore(existing) : -Infinity;

    if (!existing || rScore > eScore) {
      verseScores.set(vid, r);
    }

    // Track overlap count on the winning entry
    if (topicIntersect && r.fromTopic) {
      const winner = verseScores.get(vid)!;
      winner.topicOverlap = (winner.topicOverlap || 0) + 1;
    }
  }

  // Step 5: Apply intersection bonus
  if (topicIntersect) {
    for (const r of verseScores.values()) {
      if (r.topicOverlap && r.topicOverlap > 1) {
        const bonus = intersectBonus * (r.topicOverlap - 1);
        r.score = getScore(r) + bonus;
        if (r.fusedScore !== undefined) {
          (r as ExpandableResult).fusedScore = r.fusedScore + bonus;
        }
      }
    }
  }

  // Sort and return
  const merged = Array.from(verseScores.values()) as T[];
  merged.sort((a, b) => getScore(b) - getScore(a));
  return maxResults ? merged.slice(0, maxResults) : merged;
}
