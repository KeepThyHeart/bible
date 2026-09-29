import type { TimelineDataset, TimelineDateDto, TimelineItemDto } from './types';

/** An item with the concrete date to draw under the active chronology. */
export interface ResolvedItem {
  item: TimelineItemDto;
  date: TimelineDateDto;
  /** Chronology the date actually came from (differs from the active one on fallback). */
  chronologyId: string;
  viaFallback: boolean;
}

/** The chain of chronology ids to try: the given one, then its fallbacks. Cycle-safe. */
export function chronologyChain(dataset: Pick<TimelineDataset, 'chronologies'>, chronologyId: string): string[] {
  const byId = new Map(dataset.chronologies.map((c) => [c.id, c]));
  const chain: string[] = [];
  let cur: string | undefined = chronologyId;
  while (cur && !chain.includes(cur)) {
    chain.push(cur);
    cur = byId.get(cur)?.fallbackId;
  }
  return chain;
}

/** The default chronology id (flagged default, else the first by sort order). */
export function defaultChronologyId(dataset: Pick<TimelineDataset, 'chronologies'>): string | undefined {
  const sorted = [...dataset.chronologies].sort((a, b) => a.sortOrder - b.sortOrder);
  return (sorted.find((c) => c.isDefault) ?? sorted[0])?.id;
}

export function resolveItem(chain: readonly string[], item: TimelineItemDto): ResolvedItem | null {
  for (let i = 0; i < chain.length; i++) {
    const date = item.dates[chain[i]];
    if (date) return { item, date, chronologyId: chain[i], viaFallback: i > 0 };
  }
  return null;
}

/** Items that have a date under the chronology (or its fallbacks); undated ones are dropped. */
export function resolveItems(dataset: TimelineDataset, chronologyId: string): ResolvedItem[] {
  const chain = chronologyChain(dataset, chronologyId);
  const out: ResolvedItem[] = [];
  for (const item of dataset.items) {
    const r = resolveItem(chain, item);
    if (r) out.push(r);
  }
  return out;
}
