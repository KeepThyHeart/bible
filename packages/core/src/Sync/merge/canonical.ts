/**
 * Canonical JSON for merge decisions (task 0150, W2-B). Internal to `Sync/merge`.
 *
 * Merge policies must decide the same way on every device, so value equality and the last-resort tie-break use
 * one representation that does not depend on key insertion order. Browser-safe and side-effect free.
 */

/** JSON text with object keys sorted at every level; `undefined` properties are left out (as JSON.stringify does). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? 'undefined';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortKeys(src[k]);
    return out;
  }
  return value;
}

/** Deep equality of JSON-safe values; a missing key equals `undefined`. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return canonicalJson(a) === canonicalJson(b);
}

/** Plain string order (code units), the order every device agrees on. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
