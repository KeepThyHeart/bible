/**
 * Portable module references for web sync (task 0150 M3, design §0.6 / §6). On the web the only numeric module id is the
 * server catalog `ModuleInfo.module_id`, which user rows store; the portable ref is the module ABBREVIATION on both
 * platforms. The main thread sends the catalog as `ModuleRef[]` with `configure`; the worker persists it so a new
 * leader resolves before the catalog is re-sent.
 *
 * If the server re-imports its modules and renumbers them, rows keyed by the old catalog id would point at another
 * module: `planModuleRemap` + `remapModuleIds` move those rows to the new id of the same abbreviation (design §10).
 * Worker code; no side effects at module load.
 */
import { Sync } from '@bible/core/browser';
import type { ModuleRef } from '../protocol';

/** A resolver whose table can be replaced in place (the engine keeps the same object). */
export interface WebModuleResolver extends Sync.ModuleRefResolver {
  update(refs: readonly ModuleRef[]): void;
  refs(): ModuleRef[];
}

/** Keeps only well-formed refs (integer id, non-empty abbreviation); the first ref for an id wins. */
export function cleanModuleRefs(input: unknown): ModuleRef[] {
  if (!Array.isArray(input)) return [];
  const out: ModuleRef[] = [];
  const seen = new Set<number>();
  for (const r of input) {
    if (typeof r !== 'object' || r === null) continue;
    const { id, abbr } = r as { id?: unknown; abbr?: unknown };
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || typeof abbr !== 'string') continue;
    const a = abbr.trim();
    if (a === '' || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, abbr: a });
  }
  return out;
}

/** `toPortable(id)` = abbreviation; `toLocal(abbr)` = catalog id, compared case-insensitively (first ref wins). */
export function createModuleResolver(refs: readonly ModuleRef[]): WebModuleResolver {
  let byId = new Map<number, string>();
  let byAbbr = new Map<string, number>();
  let current: ModuleRef[] = [];
  const load = (list: readonly ModuleRef[]): void => {
    current = cleanModuleRefs(list);
    byId = new Map();
    byAbbr = new Map();
    for (const r of current) {
      byId.set(r.id, r.abbr);
      const key = r.abbr.toLowerCase();
      if (!byAbbr.has(key)) byAbbr.set(key, r.id);
    }
  };
  load(refs);
  return {
    toPortable(localModuleId) {
      const id = typeof localModuleId === 'number' ? localModuleId : Number(localModuleId);
      if (!Number.isSafeInteger(id)) return null;
      return byId.get(id) ?? null;
    },
    toLocal(portable) {
      if (typeof portable !== 'string' || portable === '') return null;
      return byAbbr.get(portable.toLowerCase()) ?? null;
    },
    update(next) { load(next); },
    refs() { return current.map((r) => ({ ...r })); },
  };
}

/**
 * Id moves between two catalogs: for each abbreviation present in both (case-insensitive) whose id changed,
 * `[oldId, newId]`. Empty when either catalog is empty (not loaded yet).
 */
export function planModuleRemap(previous: readonly ModuleRef[], next: readonly ModuleRef[]): Array<[number, number]> {
  if (previous.length === 0 || next.length === 0) return [];
  const nextByAbbr = new Map<string, number>();
  for (const r of next) {
    const k = r.abbr.toLowerCase();
    if (!nextByAbbr.has(k)) nextByAbbr.set(k, r.id);
  }
  const out: Array<[number, number]> = [];
  const seen = new Set<number>();
  for (const r of previous) {
    const to = nextByAbbr.get(r.abbr.toLowerCase());
    if (to === undefined || to === r.id || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push([r.id, to]);
  }
  return out;
}

/** User tables holding a catalog module id (mirrors core `MODULE_COLUMNS`). */
export const MODULE_ID_TABLES: readonly string[] = ['user_text_markup', 'pinned_item'];

/**
 * Applies `pairs` to every module-id column, in two phases through negative ids so swaps (A 1->2, B 2->1) work.
 * When the sync tracker's tables exist the update runs with the triggers off (the portable content is unchanged, so
 * nothing needs re-uploading). Returns the number of rows moved.
 */
export function remapModuleIds(sql: Sync.ISql, pairs: ReadonlyArray<[number, number]>): number {
  if (pairs.length === 0) return 0;
  let moved = 0;
  const run = (): void => {
    for (const table of MODULE_ID_TABLES) {
      if (!tableExists(sql, table)) continue;
      for (const [from, to] of pairs) {
        moved += sql.execute(`UPDATE ${table} SET module_id = ? WHERE module_id = ?`, [-to - 1, from]).changes;
      }
      sql.execute(`UPDATE ${table} SET module_id = -module_id - 1 WHERE module_id < 0`);
    }
  };
  if (tableExists(sql, 'sync_state')) Sync.createChangeTracker(sql).applyRemote(run);
  else sql.transaction(run);
  return moved;
}

function tableExists(sql: Sync.ISql, name: string): boolean {
  return (sql.queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?", [name])?.n ?? 0) > 0;
}
