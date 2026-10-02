/**
 * Offline pack planner (task 0075) -> packages/core/src/offline/PackPlanner.ts
 *
 * Pure, deterministic: turns the requested item refs plus the currently offered
 * items into an ordered install plan with sizes and a storage-fit verdict.
 * No I/O, no clocks; the result does not depend on the order of the inputs.
 *
 * Licence: GPL-3.0-or-later.
 */

import { packKey } from './PackTypes';
import type { PackItemRef, PackOffer, PackPlan, PackPlanStep, PlanWarning } from './PackTypes';

export interface PlanPackInput {
  items: readonly PackItemRef[];
  offers: readonly PackOffer[];
  /** Free bytes for downloads, or null when unknown. */
  freeBytes: number | null;
  /** Bytes to keep free on top of the plan (default 0). */
  reserveBytes?: number;
  /** Parallel downloads assumed when sizing in-flight partials (default 2). */
  concurrency?: number;
}

const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Tarjan strongly connected components over `nodes` (sorted) with edges `deps`. */
function components(nodes: string[], deps: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  let counter = 0;
  const visit = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of deps.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      out.push(comp.sort(byKey));
    }
  };
  for (const n of nodes) if (!index.has(n)) visit(n);
  return out;
}

export function planPack(input: PlanPackInput): PackPlan {
  const reserve = input.reserveBytes ?? 0;
  const concurrency = Math.max(1, Math.floor(input.concurrency ?? 2));
  const warnings: PlanWarning[] = [];

  const offers = new Map<string, PackOffer>();
  for (const o of input.offers) {
    const k = o.key.toLowerCase();
    if (!offers.has(k)) offers.set(k, o);
  }

  // Requested keys, deduped case-insensitively, processed in key order.
  const requested = [...new Set(input.items.map(packKey))].sort(byKey);
  const requestedSet = new Set(requested);

  const skipped: string[] = [];
  const present = new Set<string>();
  const planned = new Set<string>();
  const queue: string[] = [];
  const seen = new Set<string>();

  for (const k of requested) {
    if (!offers.has(k)) {
      warnings.push({ code: 'unavailable', key: k });
      skipped.push(k);
      continue;
    }
    seen.add(k);
    queue.push(k);
  }

  const reqKeys = (o: PackOffer): string[] => [...new Set((o.requires ?? []).map(packKey))].sort(byKey);
  const missingSeen = new Set<string>();

  for (let i = 0; i < queue.length; i++) {
    const k = queue[i];
    const offer = offers.get(k)!;
    if (offer.status === 'installed') {
      present.add(k);
      continue;
    }
    planned.add(k);
    for (const dk of reqKeys(offer)) {
      if (!offers.has(dk)) {
        const id = `${k}>${dk}`;
        if (!missingSeen.has(id)) {
          missingSeen.add(id);
          warnings.push({ code: 'missing-dependency', key: k, requires: dk });
        }
        continue;
      }
      if (seen.has(dk)) continue;
      seen.add(dk);
      if (!requestedSet.has(dk) && offers.get(dk)!.status !== 'installed') warnings.push({ code: 'dependency-added', key: dk, for: k });
      queue.push(dk);
    }
  }

  for (const k of requested) {
    const o = offers.get(k);
    if (o && !o.offlineReadable) warnings.push({ code: 'not-readable-offline', key: k });
  }

  // Dependency edges among planned steps.
  const nodes = [...planned].sort(byKey);
  const deps = new Map<string, string[]>();
  for (const k of nodes) deps.set(k, reqKeys(offers.get(k)!).filter((d) => planned.has(d)));

  // Cycles: ignore edges inside a cycle and chain its members in key order instead.
  const compOf = new Map<string, number>();
  const orderDeps = new Map<string, string[]>();
  for (const k of nodes) orderDeps.set(k, []);
  const comps = components(nodes, deps);
  comps.forEach((c, idx) => c.forEach((k) => compOf.set(k, idx)));
  const cyclic = new Set<number>();
  comps.forEach((c, idx) => {
    if (c.length > 1 || (deps.get(c[0]) ?? []).includes(c[0])) cyclic.add(idx);
  });
  [...cyclic]
    .map((idx) => comps[idx])
    .sort((a, b) => byKey(a[0], b[0]))
    .forEach((c) => {
      warnings.push({ code: 'cycle', keys: [...c] });
      for (let i = 1; i < c.length; i++) orderDeps.get(c[i])!.push(c[i - 1]);
    });
  const after = new Map<string, string[]>();
  for (const k of nodes) {
    const cyc = cyclic.has(compOf.get(k)!);
    const real = (deps.get(k) ?? []).filter((d) => !(cyc && compOf.get(d) === compOf.get(k)));
    after.set(k, real);
    orderDeps.get(k)!.push(...real);
  }

  // Topological order: smallest download first among ready steps, ties by key.
  const done = new Set<string>();
  const remaining = new Set(nodes);
  const steps: PackPlanStep[] = [];
  while (remaining.size > 0) {
    let best: string | null = null;
    for (const k of nodes) {
      if (!remaining.has(k)) continue;
      if (!orderDeps.get(k)!.every((d) => done.has(d))) continue;
      if (best === null || offers.get(k)!.downloadBytes < offers.get(best)!.downloadBytes) best = k;
    }
    if (best === null) break; // unreachable: cycles were broken above
    remaining.delete(best);
    done.add(best);
    const offer = offers.get(best)!;
    steps.push({
      key: best,
      offer,
      action: offer.status === 'update-available' ? 'update' : 'install',
      after: [...after.get(best)!].sort(byKey),
    });
  }

  // Bytes.
  let downloadBytes = 0;
  let newStoredBytes = 0;
  let updateStored = 0;
  for (const s of steps) {
    downloadBytes += s.offer.downloadBytes;
    if (s.action === 'install') newStoredBytes += s.offer.storedBytes;
    else {
      newStoredBytes += Math.max(0, s.offer.storedBytes - (s.offer.installedStoredBytes ?? 0));
      updateStored += s.offer.storedBytes;
    }
  }
  const inFlight = steps
    .map((s) => s.offer.downloadBytes)
    .sort((a, b) => b - a)
    .slice(0, concurrency)
    .reduce((a, b) => a + b, 0);
  const peakBytes = newStoredBytes + updateStored + inFlight;

  // Fit.
  let fit: PackPlan['fit'];
  let shortfallBytes = 0;
  const free = input.freeBytes;
  if (free === null) {
    fit = 'unknown';
    warnings.push({ code: 'quota-unknown' });
  } else if (steps.length === 0 || peakBytes + reserve <= free) {
    fit = 'fits';
  } else if (peakBytes <= free) {
    fit = 'tight';
  } else {
    fit = 'no';
    shortfallBytes = peakBytes + reserve - free;
    warnings.push({ code: 'over-quota', shortfallBytes });
  }

  return {
    steps,
    present: [...present].sort(byKey),
    skipped,
    downloadBytes,
    newStoredBytes,
    peakBytes,
    fit,
    shortfallBytes,
    warnings,
  };
}
