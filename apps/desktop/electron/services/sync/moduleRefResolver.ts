/**
 * Portable module references for sync (task 0150 M3). A Bible module travels between devices by its ABBREVIATION on
 * every platform (the web has no module uuid), so this resolver maps the local install id to the abbreviation and back.
 * `toLocal` is a case-insensitive lookup. The table is cached; a lookup that misses reloads it once (a module installed
 * since), and `invalidate()` forces a reload on the next call.
 */
import type { Sync } from '@bible/core';

export interface ModuleMetadataSource {
  getAll(): Array<{ moduleId?: number; abbreviation?: string }>;
}

export interface InvalidatableModuleResolver extends Sync.ModuleRefResolver {
  invalidate(): void;
}

export function createModuleRefResolver(source: ModuleMetadataSource): InvalidatableModuleResolver {
  let byId: Map<number, string> | null = null;
  let byAbbr: Map<string, number> | null = null;

  const load = (): void => {
    const ids = new Map<number, string>();
    const abbrs = new Map<string, number>();
    let rows: ReturnType<ModuleMetadataSource['getAll']> = [];
    try { rows = source.getAll(); } catch { rows = []; }
    for (const m of rows) {
      if (typeof m.moduleId !== 'number' || !m.abbreviation) continue;
      ids.set(m.moduleId, m.abbreviation);
      const key = m.abbreviation.toLowerCase();
      if (!abbrs.has(key)) abbrs.set(key, m.moduleId);
    }
    byId = ids;
    byAbbr = abbrs;
  };

  return {
    toPortable(localModuleId) {
      const id = Number(localModuleId);
      if (!Number.isInteger(id)) return null;
      if (!byId) load();
      let hit = byId!.get(id);
      if (hit === undefined) { load(); hit = byId!.get(id); }
      return hit ?? null;
    },
    toLocal(portable) {
      if (typeof portable !== 'string' || portable === '') return null;
      if (!byAbbr) load();
      const key = portable.toLowerCase();
      let hit = byAbbr!.get(key);
      if (hit === undefined) { load(); hit = byAbbr!.get(key); }
      return hit ?? null;
    },
    invalidate() { byId = null; byAbbr = null; },
  };
}
