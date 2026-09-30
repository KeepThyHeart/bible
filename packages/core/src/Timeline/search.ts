import type { ResolvedItem } from './chronology';
import { fold } from './layout';

const titleCache = new WeakMap<ResolvedItem, string>();

function foldedTitle(r: ResolvedItem): string {
  let t = titleCache.get(r);
  if (t === undefined) {
    t = fold(r.item.title);
    titleCache.set(r, t);
  }
  return t;
}

function rank(r: ResolvedItem, q: string): number {
  const title = foldedTitle(r);
  if (title === q) return 0;
  if (title.startsWith(q)) return 1;
  if (title.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q))) return 2;
  if (title.includes(q)) return 3;
  if (fold(r.item.slug).includes(q) || fold(r.item.summary ?? '').includes(q)) return 4;
  return -1;
}

/**
 * Ranked search over resolved items (accent/case-insensitive): exact title,
 * title prefix, word prefix, title substring, then slug/summary substring.
 * Ties by date, then title. Empty query returns [].
 */
export function searchTimelineItems(resolved: ResolvedItem[], query: string, limit = 20): ResolvedItem[] {
  const q = fold(query);
  if (!q || limit <= 0) return [];
  const hits: { r: ResolvedItem; k: number }[] = [];
  for (const r of resolved) {
    const k = rank(r, q);
    if (k >= 0) hits.push({ r, k });
  }
  hits.sort((a, b) => a.k - b.k || a.r.date.start - b.r.date.start || (a.r.item.title < b.r.item.title ? -1 : a.r.item.title > b.r.item.title ? 1 : 0));
  return hits.slice(0, limit).map((h) => h.r);
}
