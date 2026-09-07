/**
 * Shared scoring utilities for the search pipeline.
 *
 * These are pure functions with no DB or platform dependencies,
 * used by both the web server (TypeScript) and CLI scripts (CommonJS).
 */

import type { SearchCandidate } from './SearchTypes';
import type { ScoringConfig, TopicSourcesConfig } from './SearchPipelineConfig';

/** Default sub-facet damping factor. */
export const DEFAULT_SUB_FACET_DAMPING = 0.92;

/** Default topic expansion damping factor. */
export const DEFAULT_TOPIC_DAMPING = 0.85;

/** Default topic boost per unit of tag strength. */
export const DEFAULT_TOPIC_BOOST = 0.15;

/** Default minimum topic similarity score for expansion. */
export const DEFAULT_TOPIC_MIN_SCORE = 0.50;

/** Text length threshold to distinguish sub-facets from main facets. */
const SUB_FACET_MAX_LENGTH = 80;

/** Default topic sources config (all enabled). */
export const DEFAULT_TOPIC_SOURCES: Required<TopicSourcesConfig> = {
  naves: true,
  torreys: true,
  customTags: true,
};

/**
 * Resolve topic sources config with defaults (all enabled).
 */
export function resolveTopicSources(config?: TopicSourcesConfig): Required<TopicSourcesConfig> {
  return {
    naves: config?.naves ?? true,
    torreys: config?.torreys ?? true,
    customTags: config?.customTags ?? true,
  };
}

/**
 * Resolve scoring config values with defaults.
 */
export function resolveScoringConfig(config?: ScoringConfig) {
  const facetScoring = config?.facetScoring ?? 'max';
  const subFacetDamping = config?.subFacetDamping ?? DEFAULT_SUB_FACET_DAMPING;
  const topicDamping = config?.topicDamping ?? DEFAULT_TOPIC_DAMPING;
  const topicBoost = config?.topicBoost ?? DEFAULT_TOPIC_BOOST;
  const topicMinScore = config?.topicMinScore ?? DEFAULT_TOPIC_MIN_SCORE;
  const topicSources = resolveTopicSources(config?.topicSources);
  return { facetScoring, subFacetDamping, topicDamping, topicBoost, topicMinScore, topicSources };
}

/**
 * Apply main-facet preference scoring with configurable damping.
 *
 * Groups candidates by verse and blends main vs sub facet scores.
 * Sub-facets are terse 3-5 word phrases - great for exact matches but can
 * mislead on multi-concept queries. Strategy: for each verse, use
 * max(mainScore, subScore * damping). When a sub-facet is genuinely strong
 * (above the damping threshold vs main), it still wins.
 *
 * @param results - Scored candidates, sorted by score descending
 * @param topN - Maximum results to return
 * @param damping - Sub-facet score multiplier (default: 0.92)
 * @returns Re-ranked candidates
 */
export function applyMainFacetPreference(
  results: SearchCandidate[],
  topN: number,
  damping: number = DEFAULT_SUB_FACET_DAMPING,
): SearchCandidate[] {
  const groups = new Map<string, { bestMain: SearchCandidate | null; bestSub: SearchCandidate | null }>();

  for (const r of results) {
    const key = `${r.startVerseId}_${r.endVerseId}`;
    if (!groups.has(key)) groups.set(key, { bestMain: null, bestSub: null });
    const g = groups.get(key)!;

    const isSub = r.text.length < SUB_FACET_MAX_LENGTH;

    if (isSub) {
      if (!g.bestSub || r.score > g.bestSub.score) g.bestSub = r;
    } else {
      if (!g.bestMain || r.score > g.bestMain.score) g.bestMain = r;
    }
  }

  const merged: SearchCandidate[] = [];
  for (const g of groups.values()) {
    if (g.bestMain && g.bestSub) {
      const dampenedSub = g.bestSub.score * damping;
      if (dampenedSub > g.bestMain.score) {
        merged.push({ ...g.bestSub, score: dampenedSub });
      } else {
        merged.push(g.bestMain);
      }
    } else if (g.bestMain) {
      merged.push(g.bestMain);
    } else if (g.bestSub) {
      merged.push({ ...g.bestSub, score: g.bestSub.score * damping });
    }
  }

  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, topN);
}

/**
 * Plain-object version of applyMainFacetPreference for use by CLI scripts
 * that don't use the SearchCandidate interface.
 *
 * Identifies sub-facets by the _s\d suffix on the `id` field.
 *
 * @param scored - Results with { id, start_verse_id, end_verse_id, score, ... }
 * @param topN - Maximum results to return (0 = unlimited)
 * @param damping - Sub-facet score multiplier
 * @returns Re-ranked results
 */
export function applyMainFacetPreferencePlain<T extends { id: string; start_verse_id: number; end_verse_id: number; score: number }>(
  scored: T[],
  topN?: number,
  damping: number = DEFAULT_SUB_FACET_DAMPING,
): T[] {
  const groups = new Map<string, { bestMain: T | null; bestSub: T | null }>();

  for (const r of scored) {
    const key = `${r.start_verse_id}_${r.end_verse_id}`;
    if (!groups.has(key)) groups.set(key, { bestMain: null, bestSub: null });
    const g = groups.get(key)!;

    const isSub = /_s\d$/.test(r.id);

    if (isSub) {
      if (!g.bestSub || r.score > g.bestSub.score) g.bestSub = r;
    } else {
      if (!g.bestMain || r.score > g.bestMain.score) g.bestMain = r;
    }
  }

  const merged: T[] = [];
  for (const g of groups.values()) {
    if (g.bestMain && g.bestSub) {
      const dampenedSub = g.bestSub.score * damping;
      if (dampenedSub > g.bestMain.score) {
        merged.push({ ...g.bestSub, score: dampenedSub });
      } else {
        merged.push(g.bestMain);
      }
    } else if (g.bestMain) {
      merged.push(g.bestMain);
    } else if (g.bestSub) {
      merged.push({ ...g.bestSub, score: g.bestSub.score * damping });
    }
  }

  merged.sort((a, b) => b.score - a.score);
  return topN ? merged.slice(0, topN) : merged;
}

/**
 * Minimal shape of a topic entry for filtering purposes.
 * Matches the TopicEntry interface in the web package without creating a hard dependency.
 */
export interface TopicEntryLike {
  tagType: string;
  naveTopicId: number | null;
  torreyTopicId: number | null;
}

/**
 * Filter a map of topic entries based on the topic sources configuration.
 *
 * - Nave's entries: tagType === 'nave_torrey' AND naveTopicId is set
 * - Torrey's entries: tagType === 'nave_torrey' AND torreyTopicId is set (but not naveTopicId)
 * - Custom tags: tagType !== 'nave_torrey' (theme, emotion, event, imagery, etc.)
 *
 * Returns a new Map containing only the entries that match enabled sources.
 * If all sources are enabled, returns the original map (no copy).
 */
export function filterTopicEntries<T extends TopicEntryLike>(
  entries: Map<string, T>,
  sources: Required<TopicSourcesConfig>,
): Map<string, T> {
  // Fast path: all enabled -> no filtering needed
  if (sources.naves && sources.torreys && sources.customTags) {
    return entries;
  }

  // Fast path: all disabled -> empty map
  if (!sources.naves && !sources.torreys && !sources.customTags) {
    return new Map();
  }

  const filtered = new Map<string, T>();
  for (const [key, entry] of entries) {
    if (entry.tagType === 'nave_torrey') {
      // Nave's: has naveTopicId
      if (entry.naveTopicId && sources.naves) {
        filtered.set(key, entry);
      // Torrey's: has torreyTopicId but not naveTopicId
      } else if (entry.torreyTopicId && !entry.naveTopicId && sources.torreys) {
        filtered.set(key, entry);
      // Some entries may have both - include if either source is enabled
      } else if (entry.naveTopicId && entry.torreyTopicId && (sources.naves || sources.torreys)) {
        filtered.set(key, entry);
      }
    } else {
      // Custom enrichment tags
      if (sources.customTags) {
        filtered.set(key, entry);
      }
    }
  }
  return filtered;
}
