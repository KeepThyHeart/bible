/**
 * Similar passages (task 0070): combine per-query row hits into one score per passage.
 * Pure and browser-safe. The caller (rankNeighbours) filters and consolidates afterwards.
 */

import type { NeighbourHit, QueryRow, RowHit } from './SimilarTypes';
import { channelOf } from './SimilarWeights';
import type { SimilarRowKind, SimilarWeights } from './SimilarWeights';

type Channel = 'text' | 'meaning';

interface Acc {
  hit: RowHit;
  /** Best weighted pair score per source channel. */
  best: Partial<Record<Channel, number>>;
}

/**
 * Pair weight: (same channel ? channels[ch] (1 in blend, where the mean applies it) : crossChannel) * (either row is a facet ? facetDamping : 1).
 * Pair score: similarity * weight. A passage is keyed by level|start|end.
 *  - 'max': max over its pairs, plus levelBias[level].
 *  - 'blend': per source channel the best pair score; weighted mean by `channels` over the channels the
 *    source has rows in (weight 0 channels skipped); a channel with no hit for the passage uses that
 *    channel's lowest retrieved pair score for the source; plus levelBias.
 * A cross-channel pair counts toward the query's channel. Pairs with weight 0 are dropped.
 */
export function aggregateHits(
  queries: QueryRow[],
  hitsPerQuery: RowHit[][],
  classify: (rowId: string) => SimilarRowKind,
  w: SimilarWeights,
): NeighbourHit[] {
  const acc = new Map<string, Acc>();
  const lowest: Partial<Record<Channel, number>> = {};
  const sourceChannels = new Set<Channel>();

  for (let qi = 0; qi < queries.length; qi++) {
    const q = queries[qi];
    const qCh = channelOf(q.kind);
    sourceChannels.add(qCh);
    for (const h of hitsPerQuery[qi] ?? []) {
      const hKind = classify(h.id);
      const hCh = channelOf(hKind);
      // In 'blend' the channel weight is applied once, in the mean below; here a same-channel pair only needs to be on.
      const same = w.combine === 'blend' ? (w.channels[qCh] > 0 ? 1 : 0) : w.channels[qCh];
      const base = qCh === hCh ? same : w.crossChannel;
      const weight = base * (q.kind === 'facet' || hKind === 'facet' ? w.facetDamping : 1);
      if (!(weight > 0)) continue;
      const score = h.similarity * weight;
      const key = `${h.level}|${h.startVerseId}|${h.endVerseId}`;
      let a = acc.get(key);
      if (!a) {
        a = { hit: h, best: {} };
        acc.set(key, a);
      }
      const prev = a.best[qCh];
      if (prev === undefined || score > prev) a.best[qCh] = score;
      const low = lowest[qCh];
      if (low === undefined || score < low) lowest[qCh] = score;
    }
  }

  const out: NeighbourHit[] = [];
  const channels = [...sourceChannels].filter((c) => w.channels[c] > 0);
  for (const a of acc.values()) {
    let score: number;
    if (w.combine === 'blend') {
      let num = 0;
      let den = 0;
      for (const c of channels) {
        const v = a.best[c] ?? lowest[c];
        if (v === undefined) continue;
        num += w.channels[c] * v;
        den += w.channels[c];
      }
      if (den === 0) continue;
      score = num / den;
    } else {
      const vals = Object.values(a.best) as number[];
      if (vals.length === 0) continue;
      score = Math.max(...vals);
    }
    score += w.levelBias[a.hit.level] ?? 0;
    out.push({
      startVerseId: a.hit.startVerseId,
      endVerseId: a.hit.endVerseId,
      level: a.hit.level,
      score,
    });
  }
  out.sort((x, y) => y.score - x.score);
  return out;
}
