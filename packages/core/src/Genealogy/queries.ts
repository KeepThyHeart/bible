import type { GenealogyGraph } from './GenealogyGraph';

export { kinshipLabel } from './kinship';

export interface LineToChristPath {
  lineageId: string;
  /** Person ids from Adam to Jesus in order (each consecutive pair is a stated link or a lineage step). */
  path: string[];
}

function walk(start: string, next: (x: string) => string[], depth: number): string[] {
  const seen = new Set<string>([start]);
  const out: string[] = [];
  let frontier = [start];
  for (let d = 0; d < depth && frontier.length; d++) {
    const nf: string[] = [];
    for (const x of frontier) {
      for (const y of next(x)) {
        if (!seen.has(y)) { seen.add(y); out.push(y); nf.push(y); }
      }
    }
    frontier = nf;
  }
  return out;
}

/** Ancestor ids by BFS over parent edges, nearest first, no duplicates, cycle-safe. `depth` = max generations (default unlimited). */
export function ancestors(g: GenealogyGraph, id: string, depth: number = Infinity): string[] {
  return g.has(id) ? walk(id, x => g.parentIds(x), depth) : [];
}

/** Descendant ids by BFS over child edges, nearest first, no duplicates, cycle-safe. */
export function descendants(g: GenealogyGraph, id: string, depth: number = Infinity): string[] {
  return g.has(id) ? walk(id, x => g.childIds(x), depth) : [];
}

/** Shortest path along parent/child links (either direction), endpoints included; null if none or unknown ids. */
export function pathBetween(g: GenealogyGraph, from: string, to: string): string[] | null {
  if (!g.has(from) || !g.has(to)) return null;
  if (from === to) return [from];
  const prev = new Map<string, string>([[from, from]]);
  let frontier = [from];
  while (frontier.length) {
    const nf: string[] = [];
    for (const x of frontier) {
      for (const y of [...g.parentIds(x), ...g.childIds(x)]) {
        if (prev.has(y)) continue;
        prev.set(y, x);
        if (y === to) {
          const path = [to];
          for (let c = to; c !== from;) { c = prev.get(c)!; path.push(c); }
          return path.reverse();
        }
        nf.push(y);
      }
    }
    frontier = nf;
  }
  return null;
}

/** Father chain from `id` up to the root, returned root first, `id` last. Cycle-safe. */
function fatherChain(g: GenealogyGraph, id: string): string[] {
  const chain = [id];
  const seen = new Set(chain);
  for (let f = g.fatherId(id); f !== undefined && !seen.has(f); f = g.fatherId(f)) {
    seen.add(f);
    chain.push(f);
  }
  return chain.reverse();
}

/**
 * The line(s) from Adam to `id` (default 'jesus').
 * For each of the lineages `matthew_1` and `luke_3` present in `g.lineages()` (with `id` among
 * their steps) returns `{ lineageId, path }`, `path` being person ids ordered from the oldest
 * (Adam) to `id`. Steps are in text order; an 'ascending' lineage (Luke) is reversed. The
 * lineage's oldest person is preceded by his father chain (fatherId links) up to the root, so
 * Matthew (which begins at Abraham) is extended back to Adam by the dataset's own edges; nobody
 * is invented. The path stops at `id` (later steps are dropped). If neither lineage is usable,
 * falls back to a single entry `{ lineageId: 'parents', path }` walking fatherId from `id` to the root.
 */
export function lineToChrist(g: GenealogyGraph, id: string = 'jesus'): LineToChristPath[] {
  const out: LineToChristPath[] = [];
  for (const lid of ['matthew_1', 'luke_3']) {
    const l = g.lineage(lid);
    if (!l) continue;
    let ids = l.steps.map(s => s.personId).filter(p => g.has(p));
    if (l.direction === 'ascending') ids = ids.reverse();
    const at = ids.indexOf(id);
    if (at < 0) continue;
    ids = ids.slice(0, at + 1);
    const head = fatherChain(g, ids[0]).slice(0, -1);
    const path: string[] = [];
    for (const p of [...head, ...ids]) if (!path.includes(p)) path.push(p);
    out.push({ lineageId: lid, path });
  }
  if (out.length) return out;
  return g.has(id) ? [{ lineageId: 'parents', path: fatherChain(g, id) }] : [];
}
