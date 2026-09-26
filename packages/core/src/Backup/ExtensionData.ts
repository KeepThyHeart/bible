import type { ExtensionUserDataConfig } from '../Extensions/ExtensionManifest';

/** What one installed extension wants backed up, resolved from its manifest `userData` block. */
export interface ExtensionBackupDecl {
  /** Extension id, e.g. `ext.publisher.name`. */
  id: string;
  /** Include its key-value store. */
  backupKv: boolean;
  /** Names (as passed to `openDatabase()`) of databases to include. */
  databases: string[];
}

/**
 * Apply the defaults: the key-value store is included unless `backup` is false;
 * a database is included only when its entry says `"backup": true`.
 */
export function resolveExtensionBackup(id: string, userData?: ExtensionUserDataConfig): ExtensionBackupDecl {
  const databases = Object.entries(userData?.databases ?? {})
    .filter(([, decl]) => decl.backup === true)
    .map(([name]) => name)
    .sort();
  return { id, backupKv: userData?.backup !== false, databases };
}

/** Extension ids and database names become path segments and SQL parameters; keep them boring. */
export const EXTENSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const EXTENSION_DB_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
