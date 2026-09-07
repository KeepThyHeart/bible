import type { RerankResult } from '@bible/core';

type Scored = RerankResult & { fusedScore?: number };

/**
 * Consolidate semantic search results by deduplicating facets, absorbing
 * lower-scoring single-verse hits into containing passages, and merging
 * consecutive single-verse results into ranges.
 *
 * This is a presentation-layer consolidation that runs *after* the core
 * search pipeline's `consolidate()` (which clusters overlapping ranges).
 * It further collapses the output for cleaner UI display.
 */
export function consolidateResults(results: RerankResult[], maxResults: number): RerankResult[] {
  if (results.length === 0) return [];

  const scored = results as Scored[];

  // Step 0: Deduplicate by startVerseId+endVerseId, keeping best score.
  // This collapses multiple facets per verse/passage into a single entry.
  const dedupKey = (r: Scored) => `${r.startVerseId}_${r.endVerseId}`;
  const dedupMap = new Map<string, Scored>();
  for (const r of scored) {
    const key = dedupKey(r);
    const existing = dedupMap.get(key);
    const rScore = r.fusedScore ?? r.rerankerScore;
    const eScore = existing ? (existing.fusedScore ?? existing.rerankerScore) : -Infinity;
    if (!existing || rScore > eScore) {
      dedupMap.set(key, r);
    }
  }
  const deduped = Array.from(dedupMap.values());

  const passages: Scored[] = [];
  const singles: Scored[] = [];
  for (const r of deduped) {
    if (r.startVerseId !== r.endVerseId) {
      passages.push(r);
    } else {
      singles.push(r);
    }
  }

  // Step 2: For each passage, absorb contained verses that score LOWER.
  // Verses that score HIGHER keep their own slot (only the best one per passage).
  const absorbedVerseIds = new Set<number>();
  for (const passage of passages) {
    const passageScore = passage.fusedScore ?? passage.rerankerScore;
    let bestHigherVerse: Scored | null = null;
    let bestHigherScore = -Infinity;

    for (const single of singles) {
      if (single.startVerseId >= passage.startVerseId && single.startVerseId <= passage.endVerseId) {
        const singleScore = single.fusedScore ?? single.rerankerScore;
        if (singleScore <= passageScore) {
          absorbedVerseIds.add(single.startVerseId);
        } else {
          if (singleScore > bestHigherScore) {
            if (bestHigherVerse) absorbedVerseIds.add(bestHigherVerse.startVerseId);
            bestHigherVerse = single;
            bestHigherScore = singleScore;
          } else {
            absorbedVerseIds.add(single.startVerseId);
          }
        }
      }
    }
  }

  const remaining = singles.filter(s => !absorbedVerseIds.has(s.startVerseId));
  const all = [...passages, ...remaining];

  // Dedup passages by startVerseId (multiple passage facets may exist)
  const byStartVerse = new Map<number, Scored>();
  for (const r of all) {
    const existing = byStartVerse.get(r.startVerseId);
    const rScore = r.fusedScore ?? r.rerankerScore;
    const eScore = existing ? (existing.fusedScore ?? existing.rerankerScore) : -Infinity;
    if (!existing || rScore > eScore) {
      byStartVerse.set(r.startVerseId, r);
    }
  }

  let sorted = Array.from(byStartVerse.values())
    .sort((a, b) => (b.fusedScore ?? b.rerankerScore) - (a.fusedScore ?? a.rerankerScore))
    .slice(0, maxResults * 2);

  const merged: Scored[] = [];
  const used = new Set<number>();

  for (const r of sorted) {
    if (used.has(r.startVerseId)) continue;

    if (r.startVerseId !== r.endVerseId) {
      merged.push(r);
      used.add(r.startVerseId);
      continue;
    }

    const bookChapter = Math.floor(r.startVerseId / 1000) * 1000;
    const startVerse = r.startVerseId;
    let endVerse = r.startVerseId;
    let bestScore = r.fusedScore ?? r.rerankerScore;
    let bestResult = r;

    for (const other of sorted) {
      if (used.has(other.startVerseId)) continue;
      if (other.startVerseId === other.endVerseId &&
          Math.floor(other.startVerseId / 1000) * 1000 === bookChapter &&
          other.startVerseId > startVerse &&
          other.startVerseId <= endVerse + 1) {
        endVerse = other.startVerseId;
        const otherScore = other.fusedScore ?? other.rerankerScore;
        if (otherScore > bestScore) {
          bestScore = otherScore;
          bestResult = other;
        }
      }
    }

    for (let v = startVerse; v <= endVerse; v++) {
      used.add(v);
    }

    if (endVerse > startVerse) {
      merged.push({
        ...bestResult,
        startVerseId: startVerse,
        endVerseId: endVerse,
        fusedScore: bestScore,
        level: 'paragraph',
      });
    } else {
      merged.push(r);
      used.add(r.startVerseId);
    }
  }

  return merged
    .sort((a, b) => ((b as Scored).fusedScore ?? b.rerankerScore) - ((a as Scored).fusedScore ?? a.rerankerScore))
    .slice(0, maxResults);
}
