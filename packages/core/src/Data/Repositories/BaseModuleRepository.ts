import { ISql, SqlParameter } from '../Core/ISql';
import { ModuleInfoRow } from '../Core/RowTypes';
import { BaseModuleInfo, BaseModuleInfoData } from '../Models/BaseModuleInfo';

/**
 * The identity + provenance fields of {@link BaseModuleInfoData}.
 */
export type ModuleIdentityData = Pick<
  BaseModuleInfoData,
  | 'moduleUuid'
  | 'format'
  | 'formatVersion'
  | 'contentVersion'
  | 'contentSha256'
  | 'licenseSpdx'
  | 'licenseUrl'
  | 'sourceUrl'
  | 'versification'
  | 'isOriginalLanguage'
  | 'rightToLeft'
>;

/**
 * Map the identity + provenance block off a `module_info` row.
 *
 * Spread the result into a module-info constructor so every module type picks up
 * the block with one call:
 *
 * ```typescript
 * return new BibleModuleInfo({ ...mapModuleIdentity(row), abbreviation: row.abbreviation, ... });
 * ```
 *
 * fallbacks inside `BaseModuleInfo` go away.
 */
export function mapModuleIdentity(row: ModuleInfoRow): ModuleIdentityData {
  return {
    moduleUuid: row.module_uuid,
    format: row.format,
    formatVersion: row.format_version,
    contentVersion: row.content_version,
    contentSha256: row.content_sha256,
    licenseSpdx: row.license_spdx,
    licenseUrl: row.license_url,
    sourceUrl: row.source_url,
    versification: row.versification,
    isOriginalLanguage: row.is_original_language === 1,
    rightToLeft: row.right_to_left === 1
  };
}

/**
 * The `module_info` columns written by {@link buildIdentityAssignments}, in
 * write order.
 *
 */
const IDENTITY_COLUMNS: ReadonlyArray<[column: string, read: (i: BaseModuleInfo) => SqlParameter]> = [
  ['version', i => i.version ?? i.contentVersion ?? null],
  ['module_uuid', i => i.moduleUuid ?? null],
  ['format', i => i.format ?? null],
  ['format_version', i => i.formatVersion ?? null],
  ['content_version', i => i.contentVersion ?? null],
  ['content_sha256', i => i.contentSha256 ?? null],
  ['license_spdx', i => i.licenseSpdx ?? null],
  ['license_url', i => i.licenseUrl ?? null],
  ['source_url', i => i.sourceUrl ?? null],
  ['versification', i => i.versification ?? null],
  ['is_original_language', i => (i.isOriginalLanguage ? 1 : 0)],
  ['right_to_left', i => (i.rightToLeft ? 1 : 0)]
];

/**
 * Build the `SET` fragment updating the identity block.
 *
 * ```typescript
 * const identity = buildIdentityAssignments(this.sql, info);
 * this.sql.execute(`UPDATE module_info SET abbreviation = ?${identity.sql} WHERE info_id = 1`,
 *                  [info.abbreviation, ...identity.params]);
 * ```
 *
 * Column names come from the fixed {@link IDENTITY_COLUMNS} list - never from
 * caller input - so interpolating them is safe. All values bind as parameters.
 */
export function buildIdentityAssignments(
  info: BaseModuleInfo
): { sql: string; params: SqlParameter[] } {
  const assignments: string[] = [];
  const params: SqlParameter[] = [];
  for (const [column, read] of IDENTITY_COLUMNS) {
    assignments.push(`${column} = ?`);
    params.push(read(info));
  }

  return {
    sql: `, ${assignments.join(', ')}`,
    params
  };
}

/**
 * Base class for module-specific repositories (Bible, Commentary, Dictionary, etc.).
 *
 * All module databases share the same `module_info` table structure with a single row
 * (info_id = 1). This base class provides the common getModuleInfo() implementation
 * while subclasses define the row-to-entity mapping for their specific ModuleInfo type.
 *
 */
export abstract class BaseModuleRepository<TModuleInfo> {
  constructor(protected sql: ISql) {}

  /**
   * Get module metadata from the module_info table.
   * Every module database has exactly one row in module_info (info_id = 1).
   */
  getModuleInfo(): TModuleInfo | undefined {
    const row = this.sql.queryOne<ModuleInfoRow>('SELECT * FROM module_info WHERE info_id = 1');
    return row ? this.mapRowToModuleInfo(row) : undefined;
  }

  protected abstract mapRowToModuleInfo(row: ModuleInfoRow): TModuleInfo;
}
