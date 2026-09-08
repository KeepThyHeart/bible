/**
 * Highlight <-> module linkage stability.
 *
 * `user_text_markup.module_id` in the user database points at
 * `main.db module_metadata.module_id`, an AUTOINCREMENT id with no cross-database
 * foreign key. Uninstalling a module deletes its `module_metadata` row; re-adding
 * the same module mints a *new* autoincrement id. Highlights still keyed to the
 * old id are then orphaned - they silently vanish from the re-added translation.
 *
 * To keep them, we persist a stable map `module_key -> module_id` in main.db that
 * is **not** deleted on uninstall. On every (re-)registration we look up the
 * module's previous id for its stable key and, if the freshly-minted id differs,
 * remap the user database's markup rows old->new. The result: removing and
 * re-adding a translation preserves its highlights.
 */

import log from 'electron-log';
import type { ISql } from '@bible/core';

/**
 * Build the stable identity key for a module. Keyed on `type:abbreviation` so a
 * module keeps the same id across uninstall/reinstall, while two different module
 * types that happen to share an abbreviation don't collide.
 */
export function moduleStabilityKey(moduleType: string, abbreviation: string | undefined): string {
  return `${moduleType}:${(abbreviation ?? '').trim().toLowerCase()}`;
}

/** Create the stability map table if it does not already exist (idempotent). */
export function ensureStabilityTable(mainDb: ISql): void {
  mainDb.execute(`
    CREATE TABLE IF NOT EXISTS module_link_stability (
      module_key TEXT PRIMARY KEY,
      module_id INTEGER NOT NULL,
      updated_date TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/** Look up the module_id previously recorded for a stable key, if any. */
export function getStableModuleId(mainDb: ISql, key: string): number | undefined {
  const row = mainDb.queryOne<{ module_id: number }>(
    'SELECT module_id FROM module_link_stability WHERE module_key = ?',
    [key]
  );
  return row?.module_id;
}

/** Record (or update) the module_id currently assigned to a stable key. */
export function rememberStableModuleId(mainDb: ISql, key: string, moduleId: number): void {
  mainDb.execute(
    `INSERT INTO module_link_stability (module_key, module_id, updated_date)
     VALUES (?, ?, ?)
     ON CONFLICT(module_key) DO UPDATE SET
       module_id = excluded.module_id,
       updated_date = excluded.updated_date`,
    [key, moduleId, new Date().toISOString()]
  );
}

/**
 * Remap markup rows in the user database from an old module_id to a new one.
 * Returns the number of rows changed. Safe to call when the table is absent
 * (returns 0).
 */
export function remapMarkupModuleId(userDb: ISql, oldId: number, newId: number): number {
  const result = userDb.execute(
    'UPDATE user_text_markup SET module_id = ? WHERE module_id = ?',
    [newId, oldId]
  );
  return result.changes;
}

/**
 * Reconcile a module's stable id after (re-)registration.
 *
 * If the module was registered before under this stable key and now carries a
 * different id, remap its highlights so they follow the module. Then record the
 * current id for next time. `getUserDb` is only invoked when a remap is actually
 * needed, so first-time installs and test contexts never touch the user DB.
 *
 * Never throws - highlight relinkage is best-effort and must not fail an install.
 */
export async function stabilizeModuleLinkage(
  mainDb: ISql,
  getUserDb: () => Promise<ISql>,
  moduleType: string,
  abbreviation: string | undefined,
  newModuleId: number
): Promise<void> {
  try {
    // No stable key without an abbreviation - nothing we can reliably match on.
    if (!abbreviation || abbreviation.trim() === '') return;

    const key = moduleStabilityKey(moduleType, abbreviation);
    ensureStabilityTable(mainDb);

    const previousId = getStableModuleId(mainDb, key);
    if (previousId !== undefined && previousId !== newModuleId) {
      const userDb = await getUserDb();
      const changed = remapMarkupModuleId(userDb, previousId, newModuleId);
      if (changed > 0) {
        log.info(
          `[ModuleLinkStability] Remapped ${changed} highlight(s) from module ` +
            `${previousId} → ${newModuleId} for ${key}`
        );
      }
    }

    rememberStableModuleId(mainDb, key, newModuleId);
  } catch (err) {
    log.warn('[ModuleLinkStability] Failed to stabilize highlight linkage:', err);
  }
}
