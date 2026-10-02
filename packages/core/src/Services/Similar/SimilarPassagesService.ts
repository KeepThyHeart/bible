/**
 * Similar passages (task 0070): picks a source (precomputed neighbour table or a live
 * scan of the semantic index), runs the ranking policy and keeps a small LRU of results.
 *
 * The dependencies are getter functions rather than instances so a pack install/remove, or a
 * table that arrives later, is picked up on the next call. Browser-safe: no Node imports.
 */

import { aggregateHits } from './aggregateHits';
import { rankNeighbours, resolveSimilarOptions } from './rankNeighbours';
import { compileKindClassifier, resolveSimilarWeights } from './SimilarWeights';
import type { SimilarRowKind, SimilarWeights } from './SimilarWeights';
import type {
  INeighbourTable,
  IPassageVectorSource,
  NeighbourHit,
  PassageRange,
  QueryRow,
  ResolvedSimilarOptions,
  SimilarOptions,
  SimilarResult,
} from './SimilarTypes';

export interface SimilarPassagesDeps {
  live?: () => IPassageVectorSource | null;
  table?: () => INeighbourTable | null;
  /** Known cross-references of the source, for flagging/hiding. May be async. */
  crossRefsFor?: (r: PassageRange) => PassageRange[] | Promise<PassageRange[]>;
  weights?: SimilarWeights;
  /** LRU size; default 200. */
  cacheSize?: number;
}

const DEFAULT_CACHE_SIZE = 200;

/** Live scans run on the caller's thread; use at most this many query vectors. */
const LIVE_MAX_QUERY_VECTORS = 8;

/** JSON with sorted object keys, for cache keys. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .filter(k => obj[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * At most `max` rows, the ones closest to the centroid of all rows, but always at least
 * one row per kind present so a facet-only or text-only channel is not dropped.
 */
export function pickQueryRows(rows: QueryRow[], max: number): QueryRow[] {
  const limit = Math.max(1, Math.floor(max));
  if (rows.length <= limit) return rows;

  const dims = rows[0].vector.length;
  const centroid = new Float32Array(dims);
  for (const row of rows) for (let i = 0; i < dims; i++) centroid[i] += row.vector[i];

  const scored = rows.map((row, index) => ({ row, index, score: dot(row.vector, centroid) }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  const chosen = new Set<number>();
  const seenKinds = new Set<SimilarRowKind>();
  for (const s of scored) {
    if (!seenKinds.has(s.row.kind)) {
      seenKinds.add(s.row.kind);
      chosen.add(s.index);
    }
  }
  for (const s of scored) {
    if (chosen.size >= limit) break;
    chosen.add(s.index);
  }
  return rows.filter((_, index) => chosen.has(index));
}

type Plan =
  | { via: 'live'; live: IPassageVectorSource }
  | { via: 'table'; table: INeighbourTable; hits: NeighbourHit[]; approximate: boolean }
  | { via: 'none'; reason: 'no-data' | 'range-needs-live'; floor: number };

export class SimilarPassagesService {
  private readonly cache = new Map<string, SimilarResult>();
  private readonly weights: SimilarWeights;
  private readonly cacheSize: number;

  constructor(private readonly deps: SimilarPassagesDeps = {}) {
    this.weights = deps.weights ?? resolveSimilarWeights();
    this.cacheSize = Math.max(0, deps.cacheSize ?? DEFAULT_CACHE_SIZE);
  }

  /** Drop every cached result (call after a pack or table change). */
  reset(): void {
    this.cache.clear();
  }

  async findSimilar(r: PassageRange, options?: SimilarOptions): Promise<SimilarResult> {
    const o = resolveSimilarOptions(options);
    const source: PassageRange = { startVerseId: r.startVerseId, endVerseId: r.endVerseId };
    const plan = this.plan(source, o);

    if (plan.via === 'none') {
      return { source, passages: [], via: 'none', approximate: false, reason: plan.reason, floor: plan.floor };
    }

    const key = `${source.startVerseId}-${source.endVerseId}|${stableJson(o)}|${plan.via}`;
    const cached = this.cache.get(key);
    if (cached) {
      // Refresh recency.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }

    const result = plan.via === 'table' ? await this.fromTable(source, o, plan) : await this.fromLive(source, o, plan.live);
    // A live scan that found no rows says nothing durable; do not cache 'none'.
    if (result.via !== 'none' && this.cacheSize > 0) {
      this.cache.set(key, result);
      while (this.cache.size > this.cacheSize) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
    }
    return result;
  }

  // --- Source selection ---------------------------------------------------------

  private plan(r: PassageRange, o: ResolvedSimilarOptions): Plan {
    const live = this.deps.live?.() ?? null;
    const table = this.deps.table?.() ?? null;
    const floor = (table ?? live)?.neighbourFloor() ?? 0;
    const multi = r.endVerseId !== r.startVerseId;

    if (o.source === 'live') {
      return live ? { via: 'live', live } : { via: 'none', reason: 'no-data', floor };
    }

    if (o.source === 'table') {
      if (!table) return { via: 'none', reason: 'no-data', floor };
      const hits = table.lookup(r);
      return hits
        ? { via: 'table', table, hits, approximate: false }
        : { via: 'none', reason: 'range-needs-live', floor };
    }

    // auto: the table answers what it was built for; a live scan handles the rest.
    const tableCoversLevels = !!table && o.levels.every(level => table.meta.levels.includes(level));
    if (live && !tableCoversLevels) return { via: 'live', live };

    if (table) {
      const exact = table.lookup(r);
      if (exact) return { via: 'table', table, hits: exact, approximate: false };
      if (live) return { via: 'live', live };
      if (multi) {
        const union = table.lookupUnion(r);
        if (union) return { via: 'table', table, hits: union, approximate: true };
        return { via: 'none', reason: 'range-needs-live', floor };
      }
      return { via: 'none', reason: 'no-data', floor };
    }

    if (live) return { via: 'live', live };
    return { via: 'none', reason: 'no-data', floor };
  }

  // --- Paths -------------------------------------------------------------------

  private async crossRefs(r: PassageRange): Promise<PassageRange[]> {
    if (!this.deps.crossRefsFor) return [];
    try {
      return (await this.deps.crossRefsFor(r)) ?? [];
    } catch {
      // Cross-reference flags are decoration; a failing provider must not lose the list.
      return [];
    }
  }

  private async fromTable(
    source: PassageRange,
    o: ResolvedSimilarOptions,
    plan: Extract<Plan, { via: 'table' }>
  ): Promise<SimilarResult> {
    const floor = plan.table.neighbourFloor();
    const cands = plan.hits.filter(h => o.levels.includes(h.level));
    const passages = rankNeighbours(source, cands, o, { crossRefs: await this.crossRefs(source), floor, via: 'table' });
    return {
      source,
      passages,
      via: 'table',
      approximate: plan.approximate,
      floor: o.minSimilarity ?? floor,
    };
  }

  private async fromLive(
    source: PassageRange,
    o: ResolvedSimilarOptions,
    live: IPassageVectorSource
  ): Promise<SimilarResult> {
    const floor = live.neighbourFloor();
    // Classify query rows with the same rules as the hits below, whatever the source used.
    const classify = compileKindClassifier(this.weights);
    const rows = live.getPassageRows(source, o.levels).map(r => ({ ...r, kind: classify(r.id) }));
    if (rows.length === 0) {
      return { source, passages: [], via: 'none', approximate: false, reason: 'no-data', floor };
    }

    const queries = pickQueryRows(rows, Math.min(this.weights.maxQueryVectors, LIVE_MAX_QUERY_VECTORS));
    const hitsPerQuery = live.searchRows(
      queries.map(q => q.vector),
      { levels: o.levels, topK: this.weights.perQueryTopK }
    );
    const cands = aggregateHits(queries, hitsPerQuery, classify, this.weights);
    const passages = rankNeighbours(source, cands, o, { crossRefs: await this.crossRefs(source), floor, via: 'live' });
    return { source, passages, via: 'live', approximate: false, floor: o.minSimilarity ?? floor };
  }
}
