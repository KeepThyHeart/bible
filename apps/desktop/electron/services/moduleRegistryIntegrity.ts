/**
 * Start-up integrity repair for the module registry (`main.db module_metadata`).
 *
 * The registry is supposed to hold one row per module file. Two things have
 * broken that in practice:
 *
 * - **Duplicate rows for one file.** `pnpm run setup` (scripts/init) keyed its
 *   upsert on `module_uuid`, so a module file regenerated with a fresh UUID was
 *   registered a second time beside its old row, both pointing at the same
 *   file. Every picker then listed the module twice, and installs of it were
 *   refused as "already installed".
 * - **Back-slashed paths.** `InstallationService` stored `path.relative()`
 *   output, which is `modules\x.db` on Windows, while the registry's convention
 *   (see `toRegistryPath` in moduleDetector.ts) is forward slashes everywhere.
 *   A path in the wrong form never matches its file on a later scan.
 *
 * What this deliberately does NOT repair:
 *
 * - A row whose file is missing. `listInstalledModules` already hides it, and
 *   the file may only be absent for now (an unplugged drive, a reinstall in
 *   progress). Deleting the row would orphan the user's highlights for nothing.
 * - A file with no row. `detectAndRegisterModules` already registers those,
 *   after its own header, UUID and format-version checks.
 * - Two rows that share an abbreviation but point at DIFFERENT files. Two
 *   publishers can legitimately ship "KJV"; that is reported, not "fixed".
 *
 * A duplicate is merged, never uninstalled: `InstallationService.uninstallModule`
 * deletes the module FILE, which the surviving row still points at.
 */

import { existsSync } from 'fs';
import log from 'electron-log';
import type { ISql } from '@bible/core';
import { SqliteProvider } from '../providers/SqliteProvider';
import { ensureStabilityTable, moduleStabilityKey, rememberStableModuleId } from './moduleLinkStability';

/**
 * `module_info.module_uuid` of the module file at `absolutePath`, opened
 * read-only; undefined when the file is missing or has no readable UUID.
 */
export function readModuleFileUuid(absolutePath: string): string | undefined {
  if (!existsSync(absolutePath)) return undefined;
  let db: SqliteProvider | undefined;
  try {
    db = new SqliteProvider(absolutePath, { readonly: true });
    const row = db.queryOne<{ module_uuid: string | null }>('SELECT module_uuid FROM module_info LIMIT 1');
    return row?.module_uuid ? String(row.module_uuid) : undefined;
  } catch {
    return undefined;
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

/**
 * User-database tables whose `module_id` column holds a `main.db`
 * `module_metadata.module_id` (see packages/core/sql/schemas/initial/UserDatabase.sql).
 * `module_display_option` has UNIQUE(module_id, option_key) - see `remapUserReferences`.
 */
export const USER_TABLES_REFERENCING_MODULE_ID = [
  'user_text_markup',
  'pinned_item',
  'user_search_history',
  'navigation_history',
  'module_display_option',
] as const;

interface RegistryRow {
  module_id: number;
  module_type: string;
  abbreviation: string | null;
  module_uuid: string | null;
  database_path: string;
}

/** One file's rows: the row kept and the rows folded into it. */
export interface DuplicateRegistration {
  databasePath: string;
  moduleType: string;
  abbreviation: string | null;
  keep: number;
  remove: number[];
  /** The UUID the file itself carries, when it could be read. */
  fileUuid?: string;
}

export interface RegistryRepairResult {
  /** Files that had more than one row. */
  duplicateFiles: number;
  /** Rows deleted as duplicates. */
  rowsRemoved: number;
  /** User-database rows moved from a removed id to the kept one. */
  userReferencesRemapped: number;
  /** Rows whose database_path was rewritten to forward slashes. */
  pathsNormalized: number;
  /** Abbreviations registered more than once for different files (reported only). */
  sharedAbbreviations: string[];
}

export interface RegistryRepairDeps {
  /**
   * `module_info.module_uuid` of the module file at a registry path, or
   * undefined when the file is missing or unreadable. Decides which duplicate
   * row survives.
   */
  readFileUuid: (databasePath: string) => string | undefined;
  /** Opened only when there is something to remap. */
  getUserDb: () => Promise<ISql>;
  /** Compare paths case-insensitively (Windows, default macOS volumes). */
  caseInsensitivePaths?: boolean;
}

/** Forward slashes, no leading `./` - the registry's stored form. */
export function normalizeRegistryPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

function pathKey(p: string, caseInsensitive: boolean): string {
  const normalized = normalizeRegistryPath(p);
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

function readRegistry(mainDb: ISql): RegistryRow[] {
  return mainDb.queryAll<RegistryRow>(
    `SELECT module_id, module_type, abbreviation, module_uuid, database_path
       FROM module_metadata
      ORDER BY module_id`
  );
}

/**
 * Group registry rows by the file they point at and choose a survivor for each
 * file with more than one row: the row whose UUID matches the file's own, or
 * failing that the most recently registered row (the highest id), which is the
 * one written from the file as it is now.
 */
export function findDuplicateRegistrations(
  mainDb: ISql,
  readFileUuid: RegistryRepairDeps['readFileUuid'],
  caseInsensitivePaths = process.platform === 'win32' || process.platform === 'darwin'
): DuplicateRegistration[] {
  const byFile = new Map<string, RegistryRow[]>();
  for (const row of readRegistry(mainDb)) {
    if (!row.database_path) continue;
    const key = pathKey(row.database_path, caseInsensitivePaths);
    const group = byFile.get(key);
    if (group) group.push(row);
    else byFile.set(key, [row]);
  }

  const duplicates: DuplicateRegistration[] = [];
  for (const rows of byFile.values()) {
    if (rows.length < 2) continue;
    let fileUuid: string | undefined;
    try {
      fileUuid = readFileUuid(rows[0].database_path) || undefined;
    } catch {
      fileUuid = undefined;
    }
    const keep = (fileUuid && rows.find((r) => r.module_uuid === fileUuid)) || rows[rows.length - 1];
    duplicates.push({
      databasePath: normalizeRegistryPath(keep.database_path),
      moduleType: keep.module_type,
      abbreviation: keep.abbreviation,
      keep: keep.module_id,
      remove: rows.filter((r) => r !== keep).map((r) => r.module_id),
      fileUuid,
    });
  }
  return duplicates;
}

function existingTables(db: ISql, names: readonly string[]): string[] {
  const present = new Set(
    db
      .queryAll<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .map((r) => r.name)
  );
  return names.filter((n) => present.has(n));
}

/**
 * Point every user-database reference to a removed id at the kept one.
 * `module_display_option` is UNIQUE(module_id, option_key): where the kept
 * module already has the same option, the kept module's value wins and the
 * duplicate's copy is dropped. Every other table moves its rows wholesale.
 */
function remapUserReferences(userDb: ISql, duplicates: DuplicateRegistration[]): number {
  const tables = existingTables(userDb, USER_TABLES_REFERENCING_MODULE_ID);
  let changed = 0;
  userDb.transaction(() => {
    for (const dup of duplicates) {
      for (const oldId of dup.remove) {
        for (const table of tables) {
          if (table === 'module_display_option') {
            changed += userDb.execute(
              'UPDATE OR IGNORE module_display_option SET module_id = ? WHERE module_id = ?',
              [dup.keep, oldId]
            ).changes;
            userDb.execute('DELETE FROM module_display_option WHERE module_id = ?', [oldId]);
          } else {
            changed += userDb.execute(`UPDATE ${table} SET module_id = ? WHERE module_id = ?`, [dup.keep, oldId]).changes;
          }
        }
      }
    }
  });
  return changed;
}

function removeDuplicateRows(mainDb: ISql, duplicates: DuplicateRegistration[]): number {
  let removed = 0;
  const hasUpdateTable = existingTables(mainDb, ['module_update']).length > 0;
  ensureStabilityTable(mainDb);
  mainDb.transaction(() => {
    for (const dup of duplicates) {
      for (const oldId of dup.remove) {
        if (hasUpdateTable) mainDb.execute('DELETE FROM module_update WHERE module_id = ?', [oldId]);
        removed += mainDb.execute('DELETE FROM module_metadata WHERE module_id = ?', [oldId]).changes;
        mainDb.execute('UPDATE module_link_stability SET module_id = ? WHERE module_id = ?', [dup.keep, oldId]);
      }

      // The survivor takes the file's own UUID when it carries a stale one,
      // unless some other row already holds it (module_uuid is UNIQUE).
      if (dup.fileUuid) {
        const holder = mainDb.queryOne<{ module_id: number }>(
          'SELECT module_id FROM module_metadata WHERE module_uuid = ?',
          [dup.fileUuid]
        );
        if (!holder) {
          mainDb.execute('UPDATE module_metadata SET module_uuid = ? WHERE module_id = ?', [dup.fileUuid, dup.keep]);
        }
      }

      if (dup.abbreviation) {
        rememberStableModuleId(mainDb, moduleStabilityKey(dup.moduleType, dup.abbreviation), dup.keep);
      }
    }
  });
  return removed;
}

function normalizeStoredPaths(mainDb: ISql): number {
  return mainDb.execute(
    `UPDATE module_metadata SET database_path = REPLACE(database_path, '\\', '/')
      WHERE database_path LIKE '%\\%'`
  ).changes;
}

function findSharedAbbreviations(mainDb: ISql): string[] {
  return mainDb
    .queryAll<{ module_type: string; abbreviation: string }>(
      `SELECT module_type, abbreviation FROM module_metadata
        WHERE abbreviation IS NOT NULL AND abbreviation <> ''
        GROUP BY module_type, abbreviation HAVING COUNT(*) > 1`
    )
    .map((r) => `${r.module_type}:${r.abbreviation}`);
}

/**
 * Check the registry and repair what can be repaired safely. Never throws:
 * each step is its own transaction, so a failure leaves that step undone and
 * start-up continues.
 *
 * The user database is updated BEFORE any registry row is deleted, so a
 * failure part-way can only leave references pointing at a row that still
 * exists. If the user database cannot be opened, duplicates are left alone.
 */
export async function repairModuleRegistry(mainDb: ISql, deps: RegistryRepairDeps): Promise<RegistryRepairResult> {
  const result: RegistryRepairResult = {
    duplicateFiles: 0,
    rowsRemoved: 0,
    userReferencesRemapped: 0,
    pathsNormalized: 0,
    sharedAbbreviations: [],
  };

  try {
    const duplicates = findDuplicateRegistrations(mainDb, deps.readFileUuid, deps.caseInsensitivePaths);
    result.duplicateFiles = duplicates.length;

    if (duplicates.length > 0) {
      for (const dup of duplicates) {
        log.warn(
          `[ModuleRegistry] ${dup.databasePath} is registered ${dup.remove.length + 1} times ` +
            `(ids ${[dup.keep, ...dup.remove].join(', ')}); keeping ${dup.keep}`
        );
      }

      let userDb: ISql | undefined;
      try {
        userDb = await deps.getUserDb();
      } catch (error) {
        log.error('[ModuleRegistry] Could not open the user database; duplicate registrations left in place:', error);
      }

      if (userDb) {
        result.userReferencesRemapped = remapUserReferences(userDb, duplicates);
        result.rowsRemoved = removeDuplicateRows(mainDb, duplicates);
      }
    }

    result.pathsNormalized = normalizeStoredPaths(mainDb);
    result.sharedAbbreviations = findSharedAbbreviations(mainDb);
    for (const shared of result.sharedAbbreviations) {
      log.warn(`[ModuleRegistry] ${shared} is registered for more than one file; left as is`);
    }

    if (result.rowsRemoved > 0 || result.pathsNormalized > 0) {
      log.info(
        `[ModuleRegistry] Repaired: ${result.rowsRemoved} duplicate row(s) removed across ` +
          `${result.duplicateFiles} file(s), ${result.userReferencesRemapped} user reference(s) remapped, ` +
          `${result.pathsNormalized} path(s) normalized`
      );
    }
  } catch (error) {
    log.error('[ModuleRegistry] Integrity check failed; registry left unchanged:', error);
  }

  return result;
}
