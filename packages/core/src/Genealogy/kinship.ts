import type { GenealogyGraph } from './GenealogyGraph';
import type { Sex } from './types';

/** BFS distances (generations) from `id` following `next`, excluding `id` itself. Cycle-safe. */
function distances(id: string, next: (x: string) => string[]): Map<string, number> {
  const dist = new Map<string, number>([[id, 0]]);
  let frontier = [id];
  while (frontier.length) {
    const nf: string[] = [];
    for (const x of frontier) {
      for (const y of next(x)) {
        if (!dist.has(y)) { dist.set(y, dist.get(x)! + 1); nf.push(y); }
      }
    }
    frontier = nf;
  }
  dist.delete(id);
  return dist;
}

function gendered(sex: Sex | undefined, male: string, female: string, neutral: string): string {
  return sex === 'male' ? male : sex === 'female' ? female : neutral;
}

function greats(n: number): string { return n > 0 ? 'great-'.repeat(n) : ''; }

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
function ordinal(n: number): string {
  if (n < ORDINALS.length) return ORDINALS[n];
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}
function removed(n: number): string {
  return n === 1 ? 'once removed' : n === 2 ? 'twice removed' : `${n} times removed`;
}

/** Ancestors/descendants beyond this many "great-" prefixes are just 'ancestor'/'descendant'. */
const MAX_GREATS = 6;

/**
 * What `b` is to `a` ("b is a's <label>"), in English, using b's sex where known and
 * neutral wording otherwise. Possible results: 'self', 'father'/'mother'/'parent',
 * 'son'/'daughter'/'child', 'husband'/'wife'/'spouse', 'brother'/'sister'/'sibling',
 * 'grandfather'/'great-grandfather'..., 'grandson'/'great-grandson'..., 'ancestor' and
 * 'descendant' beyond 6 "great-" prefixes, 'uncle'/'aunt' ('uncle or aunt' if sex unknown, with
 * great- prefixes), 'nephew'/'niece' likewise, 'first cousin', 'first cousin once removed',
 * 'second cousin', ..., 'relative' (connected by parent/child links but no common ancestor
 * found, e.g. only by marriage) and 'unrelated' (no link at all or unknown ids).
 * Cousins are computed from the nearest common ancestor (fewest total generations).
 */
export function kinshipLabel(g: GenealogyGraph, a: string, b: string): string {
  if (!g.has(a) || !g.has(b)) return 'unrelated';
  if (a === b) return 'self';
  const sex = g.person(b)?.sex;
  if (g.spouseIds(a).includes(b)) return gendered(sex, 'husband', 'wife', 'spouse');

  const up = distances(a, x => g.parentIds(x));
  const down = distances(a, x => g.childIds(x));
  const ua = up.get(b);
  if (ua !== undefined) {
    if (ua === 1) return gendered(sex, 'father', 'mother', 'parent');
    if (ua - 2 > MAX_GREATS) return 'ancestor';
    return greats(ua - 2) + gendered(sex, 'grandfather', 'grandmother', 'grandparent');
  }
  const da = down.get(b);
  if (da !== undefined) {
    if (da === 1) return gendered(sex, 'son', 'daughter', 'child');
    if (da - 2 > MAX_GREATS) return 'descendant';
    return greats(da - 2) + gendered(sex, 'grandson', 'granddaughter', 'grandchild');
  }

  const upA = up;
  const upB = distances(b, x => g.parentIds(x));
  let best: { da: number; db: number } | null = null;
  for (const [anc, dA] of upA) {
    const dB = upB.get(anc);
    if (dB === undefined) continue;
    if (!best || dA + dB < best.da + best.db) best = { da: dA, db: dB };
  }
  if (!best) return pathExists(g, a, b) ? 'relative' : 'unrelated';

  const m = Math.min(best.da, best.db);
  const n = Math.abs(best.da - best.db);
  if (m === 1) {
    if (n === 0) return gendered(sex, 'brother', 'sister', 'sibling');
    if (best.da < best.db) return greats(n - 1) + gendered(sex, 'nephew', 'niece', 'nephew or niece');
    return greats(n - 1) + gendered(sex, 'uncle', 'aunt', 'uncle or aunt');
  }
  const base = `${ordinal(m - 1)} cousin`;
  return n === 0 ? base : `${base} ${removed(n)}`;
}

function pathExists(g: GenealogyGraph, a: string, b: string): boolean {
  const seen = new Set([a]);
  let frontier = [a];
  while (frontier.length) {
    const nf: string[] = [];
    for (const x of frontier) {
      for (const y of [...g.parentIds(x), ...g.childIds(x)]) {
        if (y === b) return true;
        if (!seen.has(y)) { seen.add(y); nf.push(y); }
      }
    }
    frontier = nf;
  }
  return false;
}
