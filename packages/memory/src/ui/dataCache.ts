/**
 * The Memory UI data cache (design-r2 section 1b): the plan, per-passage verse text and the analytics are
 * loaded once, kept across unmount and remount (one cache per `api`, at module level) and updated in place.
 * Platform-free: no node or electron imports, and the clock is injectable.
 */

import type { MemoryApi } from '../core/api';
import { MIN_VERSES_FOR_REFERENCE_ACTIVITIES } from '../core/ladder';
import { isDue } from '../core/scheduler';
import type { AnalyticsView, PassageView, PlanView, VerseText } from '../core/types';
import type { MemoryData } from './host';

/** `revalidate()` runs at most this often. */
export const REVALIDATE_THROTTLE_MS = 5000;

export interface DataCacheOptions {
  /** Clock for the revalidate throttle; defaults to `Date.now`. */
  now?: () => number;
}

export class MemoryDataCache implements MemoryData {
  private plan: PlanView | null = null;
  private firstLoad: Promise<PlanView> | null = null;
  private inFlight: Promise<PlanView> | null = null;
  private queued: Promise<PlanView> | null = null;
  private lastRevalidateAt = Number.NEGATIVE_INFINITY;
  private readonly text = new Map<number, VerseText[]>();
  private readonly textFailed = new Set<number>();
  private readonly textLoads = new Map<number, Promise<VerseText[] | null>>();
  private analyticsView: AnalyticsView | null = null;
  private analyticsLoad: Promise<AnalyticsView | null> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly clock: () => number;

  constructor(
    private readonly api: MemoryApi,
    options: DataCacheOptions = {},
  ) {
    this.clock = options.now ?? Date.now;
  }

  get(): PlanView | null {
    return this.plan;
  }

  /** First load; every caller shares one promise. Once loaded it resolves with the cached plan. */
  ensure(): Promise<PlanView> {
    if (this.plan) return Promise.resolve(this.plan);
    if (this.inFlight) return this.inFlight;
    if (!this.firstLoad) {
      const load = this.refresh();
      this.firstLoad = load;
      const clear = (): void => {
        if (this.firstLoad === load) this.firstLoad = null;
      };
      load.then(clear, clear);
    }
    return this.firstLoad;
  }

  /** Forced reload, coalesced: one request in flight and at most one queued behind it. */
  refresh(): Promise<PlanView> {
    if (!this.inFlight) {
      this.inFlight = this.fetchPlan();
      return this.inFlight;
    }
    if (!this.queued) {
      this.queued = this.inFlight.then(
        () => this.startQueued(),
        () => this.startQueued(),
      );
    }
    return this.queued;
  }

  private startQueued(): Promise<PlanView> {
    this.queued = null;
    this.inFlight = this.fetchPlan();
    return this.inFlight;
  }

  private fetchPlan(): Promise<PlanView> {
    const run = this.api.getPlan({ scope: { kind: 'all' } }).then((plan) => {
      this.applyPlan(plan);
      this.textFailed.clear();
      return this.plan ?? plan;
    });
    const done = (): void => {
      if (this.inFlight === run) this.inFlight = null;
    };
    run.then(done, done);
    return run;
  }

  /** A throttled background refresh, for mount, window focus and visibility changes. */
  revalidate(): void {
    const t = this.clock();
    if (t - this.lastRevalidateAt < REVALIDATE_THROTTLE_MS) return;
    this.lastRevalidateAt = t;
    this.refresh().catch(() => undefined);
  }

  /** A `planChanged` push: skip only when it is the same instance and not newer than what is held. */
  onPlanChanged(epoch?: string, version?: number): void {
    const cur = this.plan;
    if (
      cur &&
      epoch !== undefined &&
      version !== undefined &&
      cur.epoch === epoch &&
      cur.version !== undefined &&
      version <= cur.version
    ) {
      return;
    }
    this.refresh().catch(() => undefined);
  }

  /** Accept a plan unless it is an older snapshot of the same service instance. */
  applyPlan(plan: PlanView): void {
    const cur = this.plan;
    if (
      cur &&
      cur.epoch !== undefined &&
      plan.epoch !== undefined &&
      cur.epoch === plan.epoch &&
      cur.version !== undefined &&
      plan.version !== undefined &&
      plan.version < cur.version
    ) {
      return;
    }
    if (
      cur &&
      cur.epoch !== undefined &&
      plan.epoch !== undefined &&
      cur.epoch === plan.epoch &&
      cur.version !== undefined &&
      plan.version !== undefined &&
      cur.version === plan.version &&
      JSON.stringify(cur) === JSON.stringify(plan)
    ) {
      return; // identical: keep the same object (the row memo) and do not redraw
    }
    this.plan = plan;
    this.notify();
  }

  patchCardsWaiting(count: number): void {
    if (!this.plan || this.plan.cardsWaiting === count) return;
    this.plan = { ...this.plan, cardsWaiting: count };
    this.notify();
  }

  patchPassage(pv: PassageView): void {
    if (!this.plan) return;
    const id = pv.passage.id;
    const has = this.plan.passages.some((p) => p.passage.id === id);
    const passages = has
      ? this.plan.passages.map((p) => (p.passage.id === id ? pv : p))
      : [...this.plan.passages, pv];
    this.plan = { ...this.plan, passages, totalDue: sumDue(passages) };
    this.notify();
  }

  dropPassage(id: number): void {
    if (!this.plan) return;
    const passages = this.plan.passages.filter((p) => p.passage.id !== id);
    if (passages.length === this.plan.passages.length) return;
    this.plan = { ...this.plan, passages, totalDue: sumDue(passages) };
    this.text.delete(id);
    this.notify();
  }

  verseText(id: number): VerseText[] | undefined {
    return this.text.get(id);
  }

  /** True when the last attempt to load this passage's text failed (cleared on a later plan fetch). */
  verseTextFailed(id: number): boolean {
    return this.textFailed.has(id);
  }

  /** The passage's own verses, fetched once per passage (`getContext`) and kept. `null` when it failed. */
  loadVerseText(id: number): Promise<VerseText[] | null> {
    const have = this.text.get(id);
    if (have) return Promise.resolve(have);
    const pending = this.textLoads.get(id);
    if (pending) return pending;
    const load = this.api
      .getContext({ passageId: id })
      .then((ctx) => {
        this.text.set(id, ctx.verses);
        this.textFailed.delete(id);
        this.notify();
        return ctx.verses;
      })
      .catch(() => {
        this.textFailed.add(id);
        this.notify();
        return null;
      })
      .finally(() => {
        this.textLoads.delete(id);
      });
    this.textLoads.set(id, load);
    return load;
  }

  analytics(): AnalyticsView | null {
    return this.analyticsView;
  }

  /** Fetch the analytics; the previous value stays readable while this runs (and if it fails). */
  loadAnalytics(): Promise<AnalyticsView | null> {
    if (this.analyticsLoad) return this.analyticsLoad;
    const load = this.api
      .getAnalytics()
      .then((a) => {
        this.analyticsView = a;
        this.notify();
        return a;
      })
      .catch(() => this.analyticsView)
      .finally(() => {
        this.analyticsLoad = null;
      });
    this.analyticsLoad = load;
    return load;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const l of [...this.listeners]) l();
  }
}

const caches = new WeakMap<MemoryApi, MemoryDataCache>();

/** The one cache for this `api`; it outlives a mount. `options` only apply when the cache is created. */
export function getDataCache(api: MemoryApi, options?: DataCacheOptions): MemoryDataCache {
  let cache = caches.get(api);
  if (!cache) {
    cache = new MemoryDataCache(api, options);
    caches.set(api, cache);
  }
  return cache;
}

function sumDue(passages: readonly PassageView[]): number {
  return passages.reduce((n, p) => n + p.dueCount, 0);
}

/**
 * The cached all-lists plan, filtered to `scope` and recomputed against the client's `now`, so a day
 * rollover is right without a refetch. Recomputed: per-passage `dueCount`, `totalDue`, `scopeVerseCount`,
 * `referenceActivitiesUnlocked`, `collectionId`/`collectionName`, `reciteDueCount`.
 */
export function scopedView(all: PlanView, scope: 'all' | number, now: number): PlanView {
  const inScope = scope === 'all' ? all.passages : all.passages.filter((p) => p.passage.collectionId === scope);
  const passages = inScope.map((pv) => {
    const dueCount = pv.rungs.reduce(
      (n, r) => (r.applicable && !r.optional && r.rung !== 'recite' && isDue(r.dueAt, now) ? n + 1 : n),
      0,
    );
    return dueCount === pv.dueCount ? pv : { ...pv, dueCount };
  });

  const perList = new Map<number, number>();
  let scopeVerseCount = 0;
  let reciteDueCount = 0;
  for (const pv of passages) {
    const v = pv.passage.verseCount;
    scopeVerseCount += v;
    perList.set(pv.passage.collectionId, (perList.get(pv.passage.collectionId) ?? 0) + v);
    // The store's rule: the recite rung is due, or untried (`dueAt` null) on a passage switched on.
    const recite = pv.rungs.find((r) => r.rung === 'recite');
    if (recite && ((recite.dueAt !== null && recite.dueAt <= now) || (recite.dueAt === null && pv.passage.reciteOn))) {
      reciteDueCount += 1;
    }
  }

  const list = scope === 'all' ? undefined : all.lists.find((l) => l.id === scope);
  const base = scope === 'all' ? all : { ...all, collectionId: list ? list.id : scope };
  return {
    ...base,
    scope,
    collectionName: scope === 'all' ? all.collectionName : (list?.name ?? all.collectionName),
    passages,
    totalDue: sumDue(passages),
    scopeVerseCount,
    referenceActivitiesUnlocked: [...perList.values()].some((n) => n >= MIN_VERSES_FOR_REFERENCE_ACTIVITIES),
    reciteDueCount,
  };
}
