/**
 * Tag-based reranking for semantic search results.
 *
 * Pure functions with no platform dependencies - used by both
 * the web server (TypeScript) and CLI scripts (CommonJS via @bible/core).
 *
 * When a query matches a known topic tag, this module boosts results
 * where the concept is central (high tag strength) above results where
 * it's only incidentally mentioned. The caller pre-fetches tag strengths
 * from the enrichments database.
 */

/** Minimum interface for a result that can be tag-reranked. */
export interface TagRerankableResult {
  startVerseId: number;
  score: number;
  level: string;
  fusedScore?: number;
  rerankerScore?: number;
  text?: string;
  title?: string;
}

/** Options for tag reranking. */
export interface TagRerankOptions {
  /** Score boost per unit of tag strength. Default: 0.10 */
  boost?: number;
}

/** Default tag rerank boost factor. */
export const DEFAULT_TAG_RERANK_BOOST = 0.10;

/**
 * Get the best score from a result, checking fusedScore -> rerankerScore -> score.
 */
function getScore<T extends TagRerankableResult>(r: T): number {
  return r.fusedScore ?? r.rerankerScore ?? r.score;
}

/**
 * Re-rank results using pre-fetched enrichment tag strengths.
 *
 * For each result verse, if it has a tag strength entry, adds
 * `boost * strength` to its score. Verses without the tag are unchanged.
 * Results are re-sorted after boosting.
 *
 * @param results - Ranked results to re-rank
 * @param tagStrengths - Map of verseId -> tag strength (pre-fetched by caller)
 * @param options - Reranking options
 * @returns Results re-sorted by updated scores (mutates in place and returns)
 */
export function tagRerank<T extends TagRerankableResult>(
  results: T[],
  tagStrengths: Map<number, number>,
  options: TagRerankOptions = {},
): T[] {
  if (tagStrengths.size === 0) return results;

  const boost = options.boost ?? DEFAULT_TAG_RERANK_BOOST;

  for (const r of results) {
    if (r.level === 'topic') continue;
    const strength = tagStrengths.get(r.startVerseId);
    if (strength !== undefined) {
      const delta = boost * strength;
      r.score = getScore(r) + delta;
      if (r.fusedScore !== undefined) {
        (r as TagRerankableResult).fusedScore = r.fusedScore + delta;
      }
    }
  }

  // Re-sort by best available score
  results.sort((a, b) => getScore(b) - getScore(a));
  return results;
}
