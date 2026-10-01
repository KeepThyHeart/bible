/**
 * The stock plan library. Most stock plans are builder specs, built on first use (deterministic;
 * `stock.test.ts` pins a fingerprint of each, so a change to the builder or a spec that moves any
 * day must bump the plan's version). M'Cheyne's calendar and the chronological order ship as data.
 */
import type { BuilderSpec, PlanDefinition, PlanSummary, ScopeRange } from './types';
import { buildPlanDays, setDefaultChronology } from './builder';
import { booksRange, countVerses } from './versification';
import mcheyneData from './stock/mcheyne.json';
import chronologicalData from './stock/chronological.json';

export const STOCK_PREFIX = 'stock:';

/** The chronological order of the whole Bible (Ussher), as ordered verse ranges. */
export const CHRONOLOGICAL_ORDER: readonly ScopeRange[] = (chronologicalData.order as number[][]).map(([start, end]) => ({ start, end }));
setDefaultChronology(CHRONOLOGICAL_ORDER);

export const CHRONOLOGICAL_BASIS: string = chronologicalData.basis;

interface StockEntry {
  id: string;
  version: number;
  name: string;
  description: string;
  build: () => Pick<PlanDefinition, 'days' | 'tracks'>;
}

function fromSpec(spec: BuilderSpec): () => Pick<PlanDefinition, 'days' | 'tracks'> {
  return () => ({
    days: buildPlanDays(spec),
    tracks: spec.tracks?.map((t) => ({ id: t.id, name: t.name })),
  });
}

const WHOLE_BIBLE = booksRange(1, 66);
const OT = booksRange(1, 39);
const NT = booksRange(40, 66);

const STOCK: StockEntry[] = [
  {
    id: 'canonical-1y',
    version: 1,
    name: 'The Bible in a year',
    description: 'Genesis to Revelation in 365 days, whole chapters.',
    build: fromSpec({ name: 'The Bible in a year', scope: [WHOLE_BIBLE], order: 'canonical', pace: { by: 'days', days: 365 }, split: 'chapter' }),
  },
  {
    id: 'ot-nt-1y',
    version: 1,
    name: 'Old and New Testament together',
    description: 'One reading from each Testament every day for a year.',
    build: fromSpec({
      name: 'Old and New Testament together', scope: [], order: 'canonical', pace: { by: 'days', days: 365 }, split: 'chapter',
      tracks: [{ id: 'ot', name: 'Old Testament', scope: [OT] }, { id: 'nt', name: 'New Testament', scope: [NT] }],
    }),
  },
  {
    id: 'chronological-1y',
    version: 1,
    name: 'Chronological, 1 year',
    description: 'The whole Bible in the order the events happened (after Ussher), in 365 days.',
    build: fromSpec({ name: 'Chronological, 1 year', scope: [WHOLE_BIBLE], order: 'chronological', pace: { by: 'days', days: 365 }, split: 'verse' }),
  },
  {
    id: 'mcheyne',
    version: 1,
    name: "M'Cheyne",
    description: "Robert Murray M'Cheyne's calendar (1842): four readings a day; the Old Testament once and the New Testament and Psalms twice in a year.",
    build: () => ({
      tracks: mcheyneData.tracks.map((t) => ({ id: t.id, name: t.name })),
      days: (mcheyneData.days as number[][][]).map((day) => ({
        readings: day.map(([start, end, t]) => ({ start, end, track: mcheyneData.tracks[t].id })),
      })),
    }),
  },
  {
    id: 'nt-90',
    version: 1,
    name: 'New Testament in 90 days',
    description: 'Matthew to Revelation in three months, about three chapters a day.',
    build: fromSpec({ name: 'New Testament in 90 days', scope: [NT], order: 'canonical', pace: { by: 'days', days: 90 }, split: 'chapter' }),
  },
  {
    id: 'gospels-30',
    version: 1,
    name: 'The Gospels in 30 days',
    description: 'Matthew, Mark, Luke and John in a month.',
    build: fromSpec({ name: 'The Gospels in 30 days', scope: [booksRange(40, 43)], order: 'canonical', pace: { by: 'days', days: 30 }, split: 'chapter' }),
  },
  {
    id: 'psalms-proverbs-31',
    version: 1,
    name: 'Psalms and Proverbs in a month',
    description: 'The Psalms and a chapter of Proverbs every day for 31 days.',
    build: fromSpec({
      name: 'Psalms and Proverbs in a month', scope: [], order: 'canonical', pace: { by: 'days', days: 31 }, split: 'chapter',
      tracks: [{ id: 'psalms', name: 'Psalms', scope: [booksRange(19)] }, { id: 'proverbs', name: 'Proverbs', scope: [booksRange(20)] }],
    }),
  },
];

const cache = new Map<string, PlanDefinition>();

export function stockPlanKey(id: string): string {
  return `${STOCK_PREFIX}${id}`;
}

export function isStockPlanKey(key: string): boolean {
  return key.startsWith(STOCK_PREFIX);
}

/** Ids of the stock plans, in library order. */
export function stockPlanIds(): string[] {
  return STOCK.map((s) => s.id);
}

/** A stock plan by key (`stock:<id>`), built on first use. */
export function getStockPlan(key: string): PlanDefinition | null {
  const hit = cache.get(key);
  if (hit) return hit;
  const entry = STOCK.find((s) => stockPlanKey(s.id) === key);
  if (!entry) return null;
  const built = entry.build();
  const def: PlanDefinition = {
    key, version: entry.version, name: entry.name, description: entry.description, source: 'stock', days: built.days,
    ...(built.tracks ? { tracks: built.tracks } : {}),
  };
  cache.set(key, def);
  return def;
}

export function summarizePlan(def: PlanDefinition): PlanSummary {
  let verseCount = 0;
  for (const d of def.days) for (const r of d.readings) verseCount += countVerses(r.start, r.end);
  return {
    key: def.key, version: def.version, name: def.name, description: def.description, source: def.source,
    dayCount: def.days.length, verseCount, trackCount: def.tracks?.length ?? 1,
  };
}

/** Summaries of every stock plan (builds them on first call). */
export function listStockPlans(): PlanSummary[] {
  return STOCK.map((s) => summarizePlan(getStockPlan(stockPlanKey(s.id))!));
}
