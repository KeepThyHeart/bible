/**
 * Edge weight, 0..1, the one number every view uses to cap, sort and draw widths (task 0068).
 *
 *   weight = clamp01( sum_source trust[s] * base_s ) * reciprocity * agreement
 *   base(ranked) = 1 / (1 + 0.15 * rank)      TSK lists the closest parallels first
 *   base(votes)  = votes <= 0 ? drop : log1p(votes) / log1p(maxVotes)
 *   base(user)   = 1
 *   reciprocity  = 1.25 when A cites B and B cites A
 *   agreement    = 1.2 when two or more sources contain the pair
 *
 * The result is clamped to 1 at the end so the two boosts cannot push it over.
 */
import type { EdgeEvidence, EdgeEvidenceItem } from './types';

export const RANK_DECAY = 0.15;
export const RECIPROCITY_BOOST = 1.25;
export const AGREEMENT_BOOST = 1.2;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Base weight of one piece of evidence; 0 means "drop this link" (non-positive votes). */
export function baseWeight(item: EdgeEvidenceItem): number {
  switch (item.kind) {
    case 'user':
      return 1;
    case 'votes': {
      const votes = item.votes ?? 0;
      if (votes <= 0) return 0;
      const max = Math.max(item.maxVotes ?? votes, votes);
      return Math.log1p(votes) / Math.log1p(max);
    }
    default:
      return 1 / (1 + RANK_DECAY * Math.max(0, item.rank ?? 0));
  }
}

export function edgeWeight(input: EdgeEvidence): number {
  if (input.items.length === 0) return 0;
  let sum = 0;
  const sources = new Set<string>();
  for (const item of input.items) {
    const base = baseWeight(item);
    if (base <= 0) continue;
    sum += (input.trust?.[item.source] ?? 1) * base;
    sources.add(item.source);
  }
  if (sum <= 0) return 0;
  let w = clamp01(sum);
  if (input.reciprocal) w *= RECIPROCITY_BOOST;
  if (sources.size >= 2) w *= AGREEMENT_BOOST;
  return clamp01(w);
}

/** Display steps 1..5 (dots, stroke width). */
export function weightStep(weight: number): 1 | 2 | 3 | 4 | 5 {
  const s = Math.ceil(clamp01(weight) * 5);
  return (s < 1 ? 1 : s > 5 ? 5 : s) as 1 | 2 | 3 | 4 | 5;
}
