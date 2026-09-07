/**
 * Passage-level consolidation for semantic search results.
 *
 * Pure functions with no platform dependencies - used by both
 * the web server (TypeScript) and CLI scripts (CommonJS via @bible/core).
 *
 * When results contain overlapping verse ranges (e.g., a verse-level hit
 * for John 3:16, a paragraph-level hit for John 3:14-18, and a chapter-level
 * hit for John 3:1-36), consolidate them into a single result to avoid
 * wasting result slots on redundant overlapping entries.
 *
 * Strategy: Two-pass approach.
 * 1. Group all results that overlap into clusters.
 * 2. For each cluster, pick the best representative (preferring paragraph/chapter
 *    level when scores are close), and boost its score based on cluster size.
 *    This means a passage with many matching verses rises above a single
 *    unrelated high-scoring hit.
 *
 * Cluster boost: representative.score * (1 + boostRate * (clusterSize - 1))
 * E.g., 5 hits from Isaiah 53 -> the best one gets a 1.08x boost.
 */

/** Minimum interface for a result that can be consolidated. */
export interface ConsolidatableResult {
  startVerseId: number;
  endVerseId: number;
  score: number;
  level: string;
  fusedScore?: number;
  rerankerScore?: number;
  text?: string;
  title?: string;
}

/** Fields added by consolidation. */
export interface ConsolidatedFields {
  consolidatedScore: number;
  clusterSize: number;
  absorbed: Array<{ level: string; startVerseId: number; endVerseId: number; score: number }>;
}

/** Check if two verse ranges overlap. */
export function rangesOverlap(
  a: { startVerseId: number; endVerseId: number },
  b: { startVerseId: number; endVerseId: number },
): boolean {
  return a.startVerseId <= b.endVerseId && b.startVerseId <= a.endVerseId;
}

/**
 * Level preference for picking cluster representative.
 * Prefer paragraph > chapter > verse when scores are close,
 * since paragraph-level gives the best contextual unit.
 */
const LEVEL_PREFERENCE: Record<string, number> = { paragraph: 2, chapter: 1, verse: 0 };

/**
 * Get the best score from a result, checking fusedScore -> rerankerScore -> score.
 */
function getScore<T extends ConsolidatableResult>(r: T): number {
  return r.fusedScore ?? r.rerankerScore ?? r.score;
}

/**
 * Pick the best representative from a cluster of overlapping results.
 *
 * If a broader entry (paragraph/chapter) scores within 5% of the best
 * verse-level score, prefer the broader entry as the representative.
 */
function pickRepresentative<T extends ConsolidatableResult>(cluster: T[]): T {
  // Sort by score descending
  const sorted = [...cluster].sort((a, b) => getScore(b) - getScore(a));
  const bestScore = getScore(sorted[0]);

  // Among entries within 5% of the best score, prefer broader levels
  const threshold = bestScore * 0.95;
  const candidates = sorted.filter(r => getScore(r) >= threshold);

  candidates.sort((a, b) => {
    const prefDiff = (LEVEL_PREFERENCE[b.level] || 0) - (LEVEL_PREFERENCE[a.level] || 0);
    if (prefDiff !== 0) return prefDiff;
    return getScore(b) - getScore(a);
  });

  return candidates[0];
}

/**
 * Consolidate overlapping results into non-overlapping groups.
 *
 * @param results - Sorted by score descending
 * @param topN - Maximum results to return after consolidation. Default: 12
 * @param clusterBoostRate - Score boost per additional cluster member. Default: 0.02
 * @returns Consolidated results with `consolidatedScore`, `clusterSize`, and `absorbed` fields
 */
export function consolidate<T extends ConsolidatableResult>(
  results: T[],
  topN = 12,
  clusterBoostRate = 0.02,
): (T & ConsolidatedFields)[] {
  if (results.length === 0) return [];

  // Build clusters: greedy assignment - each result joins the first cluster it overlaps with
  const clusters: T[][] = [];

  for (const r of results) {
    let assigned = false;
    for (const cluster of clusters) {
      if (cluster.some(m => rangesOverlap(m, r))) {
        cluster.push(r);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      clusters.push([r]);
    }
  }

  // For each cluster, pick representative and compute boosted score
  const consolidated = clusters.map(cluster => {
    const rep = pickRepresentative(cluster);
    const others = cluster.filter(r => r !== rep);
    const boostMultiplier = 1 + clusterBoostRate * (cluster.length - 1);
    const consolidatedScore = getScore(rep) * boostMultiplier;

    return {
      ...rep,
      consolidatedScore,
      clusterSize: cluster.length,
      absorbed: others.map(r => ({
        level: r.level,
        startVerseId: r.startVerseId,
        endVerseId: r.endVerseId,
        score: r.rerankerScore ?? r.score,
      })),
    };
  });

  // Re-sort by consolidated score
  consolidated.sort((a, b) => b.consolidatedScore - a.consolidatedScore);
  return consolidated.slice(0, topN);
}
