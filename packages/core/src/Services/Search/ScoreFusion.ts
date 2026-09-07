/**
 * Score fusion strategies for combining embedding and reranker scores.
 *
 * Pure functions with no platform dependencies - used by both
 * the web server (TypeScript) and CLI scripts (CommonJS via @bible/core).
 *
 * Two strategies:
 *
 * Linear Blend: fusedScore = alpha * norm(embeddingScore) + (1-alpha) * norm(rerankerScore)
 *   Score-based. Default alpha=0.4 gives slight preference to the reranker
 *   while preserving the embedding model's semantic signal.
 *
 * Reciprocal Rank Fusion (RRF): rrf(d) = 1/(k + rank_emb) + 1/(k + rank_rerank)
 *   Rank-based. Immune to score scale differences. k=60 is the standard constant
 *   from the original RRF paper (Cormack et al. 2009).
 */

/** Minimum interface for a result that can be fused. */
export interface FusableResult {
  embeddingScore: number;
  rerankerScore: number;
}

/** Options for score fusion. */
export interface FuseOptions {
  /** Weight for embedding score in linear blend (1-alpha for reranker). Default: 0.4 */
  alpha?: number;
  /** RRF constant (higher = more weight to lower ranks). Default: 60 */
  k?: number;
}

/**
 * Normalize scores to [0, 1] range using min-max normalization.
 * Handles the case where all scores are identical (returns 1.0 for all).
 */
export function minMaxNormalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 1.0);
  return values.map(v => (v - min) / (max - min));
}

/**
 * Linear blend of embedding and reranker scores.
 *
 * @param results - Results with embeddingScore and rerankerScore
 * @param alpha - Weight for embedding score (1-alpha for reranker). Default: 0.4
 * @returns Results with `fusedScore` added, sorted by fusedScore descending
 */
export function linearBlend<T extends FusableResult>(
  results: T[],
  alpha = 0.4,
): (T & { fusedScore: number })[] {
  if (results.length === 0) return [];

  const embScores = minMaxNormalize(results.map(r => r.embeddingScore));
  const rerankScores = minMaxNormalize(results.map(r => r.rerankerScore));

  const fused = results.map((r, i) => ({
    ...r,
    fusedScore: alpha * embScores[i] + (1 - alpha) * rerankScores[i],
  }));

  fused.sort((a, b) => b.fusedScore - a.fusedScore);
  return fused;
}

/**
 * Reciprocal Rank Fusion.
 *
 * @param results - Results with embeddingScore and rerankerScore
 * @param k - RRF constant (higher = more weight to lower ranks). Default: 60
 * @returns Results with `fusedScore` added, sorted by fusedScore descending
 */
export function reciprocalRankFusion<T extends FusableResult>(
  results: T[],
  k = 60,
): (T & { fusedScore: number })[] {
  if (results.length === 0) return [];

  // Build rank maps (1-based ranks, lower = better)
  const byEmb = [...results].sort((a, b) => b.embeddingScore - a.embeddingScore);
  const byRerank = [...results].sort((a, b) => b.rerankerScore - a.rerankerScore);

  const embRank = new Map<T, number>();
  const rerankRank = new Map<T, number>();
  byEmb.forEach((r, i) => embRank.set(r, i + 1));
  byRerank.forEach((r, i) => rerankRank.set(r, i + 1));

  const fused = results.map(r => ({
    ...r,
    fusedScore: 1 / (k + embRank.get(r)!) + 1 / (k + rerankRank.get(r)!),
  }));

  fused.sort((a, b) => b.fusedScore - a.fusedScore);
  return fused;
}

/**
 * Dispatch to the appropriate fusion strategy.
 *
 * @param results - Must have `embeddingScore` and `rerankerScore` properties
 * @param strategy - 'linear' or 'rrf'
 * @param options - Strategy-specific options
 * @returns Results with `fusedScore`, sorted descending
 */
export function fuse<T extends FusableResult>(
  results: T[],
  strategy: 'linear' | 'rrf' = 'linear',
  options: FuseOptions = {},
): (T & { fusedScore: number })[] {
  switch (strategy) {
    case 'linear':
      return linearBlend(results, options.alpha);
    case 'rrf':
      return reciprocalRankFusion(results, options.k);
    default:
      throw new Error(`Unknown fusion strategy: ${strategy}. Use 'linear' or 'rrf'.`);
  }
}
