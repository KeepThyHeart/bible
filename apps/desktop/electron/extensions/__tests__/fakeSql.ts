/**
 * Tiny in-memory ISql for tests that exercise the extension registry without
 * pulling in better-sqlite3 (which is compiled for Electron's Node ABI and
 * does not load under vitest's system Node).
 *
 * The fake records every execute() call and stores rows for the two tables
 * the registry touches: `extensions` and `extension_storage`. SQL parsing is
 * intentional minimal - just enough to detect intent - so tests stay close
 * to the real schema without dragging in a full SQL engine.
 */

import type { ISql, SqlParameter, SqlResult, SqlRow } from '@bible/core';
// (ISql, SqlParameter, etc. live at the package root, not under Extensions.)

interface ExtensionsRow {
  id: string;
  version: string;
  install_path: string;
  enabled: number;
  granted_permissions: string;
  installed_at: number;
  updated_at: number;
  last_error: string | null;
  crash_count_session: number;
  signature_status: string | null;
  signature_key: string | null;
  dev_mode: number;
  source_catalog_url: string | null;
}

interface StorageRow {
  extension_id: string;
  key: string;
  value: string;
  updated_at: number;
}

/** One row of `extension_catalog_source`. */
interface CatalogSourceRow {
  url: string;
  label: string | null;
  added_at: number;
  risk_acknowledged_at: number | null;
  last_fetched_at: number | null;
  last_error: string | null;
  cached_document: string | null;
}

/** One row of `extension_blocklist`. */
interface BlocklistRow {
  extension_id: string;
  versions: string | null;
  reason: string;
  url: string | null;
  source_url: string;
  fetched_at: number;
}

export class FakeSql implements ISql {
  readonly extensions = new Map<string, ExtensionsRow>();
  readonly storage = new Map<string, StorageRow>();
  readonly catalogSources = new Map<string, CatalogSourceRow>();
  readonly blocklist: BlocklistRow[] = [];
  readonly executedStatements: string[] = [];

  // --- ISql --------------------------------------------------------------

  queryOne<T = SqlRow>(sql: string, params?: SqlParameter[] | Record<string, SqlParameter>): T | undefined {
    const all = this.queryAll<T>(sql, params);
    return all[0];
  }

  queryAll<T = SqlRow>(sql: string, params?: SqlParameter[] | Record<string, SqlParameter>): T[] {
    const norm = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (norm.startsWith('select') && norm.includes('from extensions')) {
      return Array.from(this.extensions.values()) as unknown as T[];
    }
    if (norm.startsWith('select') && norm.includes('from extension_storage')) {
      const arr = Array.isArray(params) ? params : [];
      const extId = arr[0] as string | undefined;
      // Detect a `WHERE extension_id = ? AND key = ?` shape - the second
      // bound param is the key. Used by `storage.get` and the byte-budget
      // helper in storageApiImpl.
      const wantsKeyMatch = norm.includes('and key = ?');
      const wantedKey = wantsKeyMatch ? (arr[1] as string | undefined) : undefined;
      const matches: StorageRow[] = [];
      for (const row of this.storage.values()) {
        if (extId !== undefined && row.extension_id !== extId) continue;
        if (wantsKeyMatch && row.key !== wantedKey) continue;
        if (norm.includes("key like '__settings.%'") && !row.key.startsWith('__settings.')) continue;
        matches.push(row);
      }
      return matches as unknown as T[];
    }
    // -- extension_catalog_source -------------------------------------
    if (norm.startsWith('select') && norm.includes('from extension_catalog_source')) {
      const arr = Array.isArray(params) ? params : [];
      if (norm.includes('where url = ?')) {
        const row = this.catalogSources.get(arr[0] as string);
        return (row ? [row] : []) as unknown as T[];
      }
      return Array.from(this.catalogSources.values()).sort(
        (a, b) => a.added_at - b.added_at,
      ) as unknown as T[];
    }
    // -- extension_blocklist ------------------------------------------
    if (norm.startsWith('select') && norm.includes('from extension_blocklist')) {
      const arr = Array.isArray(params) ? params : [];
      if (norm.includes('where extension_id = ?')) {
        const id = arr[0] as string;
        return this.blocklist.filter((r) => r.extension_id === id) as unknown as T[];
      }
      return [...this.blocklist] as unknown as T[];
    }
    return [];
  }

  execute(sql: string, params?: SqlParameter[] | Record<string, SqlParameter>): SqlResult {
    this.executedStatements.push(sql.replace(/\s+/g, ' ').trim());
    const norm = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    const arr = (Array.isArray(params) ? params : []) as SqlParameter[];

    if (norm.startsWith('create')) return { changes: 0 };

    // -- extensions table ---------------------------------------------
    if (norm.startsWith('insert into extensions')) {
      const row: ExtensionsRow = {
        id: arr[0] as string,
        version: arr[1] as string,
        install_path: arr[2] as string,
        enabled: arr[3] as number,
        granted_permissions: arr[4] as string,
        installed_at: arr[5] as number,
        updated_at: arr[6] as number,
        last_error: null,
        crash_count_session: 0,
        // Trailing columns, in the order `ExtensionRegistry.insert` binds them.
        signature_status: (arr[7] as string | null) ?? null,
        signature_key: (arr[8] as string | null) ?? null,
        dev_mode: (arr[9] as number | undefined) ?? 0,
        source_catalog_url: (arr[10] as string | null) ?? null,
      };
      this.extensions.set(row.id, row);
      return { changes: 1 };
    }

    if (norm.startsWith('update extensions')) {
      // Last param is always the id (`WHERE id = ?`).
      const id = arr[arr.length - 1] as string;
      const row = this.extensions.get(id);
      if (!row) return { changes: 0 };

      // Distinguish among the registry's UPDATE shapes by which columns
      // appear in the SET clause. Order in registry code matches the
      // params, so we can pull values positionally.
      if (norm.includes('set version = ?')) {
        row.version = arr[0] as string;
        row.install_path = arr[1] as string;
        row.enabled = arr[2] as number;
        row.granted_permissions = arr[3] as string;
        row.updated_at = arr[4] as number;
        row.last_error = null;
        row.signature_status = (arr[5] as string | null) ?? null;
        row.signature_key = (arr[6] as string | null) ?? null;
        row.dev_mode = (arr[7] as number | undefined) ?? row.dev_mode;
        row.source_catalog_url = (arr[8] as string | null) ?? null;
      } else if (norm.includes('set enabled = ?')) {
        row.enabled = arr[0] as number;
        row.updated_at = arr[1] as number;
      } else if (norm.includes('set last_error = ?')) {
        row.last_error = arr[0] as string | null;
      } else if (norm.includes('set last_error = null')) {
        row.last_error = null;
      } else if (norm.includes('set crash_count_session = ?')) {
        row.crash_count_session = arr[0] as number;
      } else if (norm.includes('set crash_count_session = 0')) {
        row.crash_count_session = 0;
        row.last_error = null;
      } else if (norm.includes('set granted_permissions = ?')) {
        row.granted_permissions = arr[0] as string;
        row.updated_at = arr[1] as number;
      }
      return { changes: 1 };
    }

    if (norm.startsWith('delete from extensions')) {
      const id = arr[0] as string;
      const had = this.extensions.delete(id);
      return { changes: had ? 1 : 0 };
    }

    // -- extension_storage table --------------------------------------
    // Per-key DELETE comes first because it is the more specific shape;
    // the bulk-by-extension DELETE below would otherwise match it.
    if (
      norm.startsWith('delete from extension_storage') &&
      norm.includes('and key = ?')
    ) {
      const extId = arr[0] as string;
      const key = arr[1] as string;
      const had = this.storage.delete(`${extId}::${key}`);
      return { changes: had ? 1 : 0 };
    }
    if (norm.startsWith('delete from extension_storage')) {
      const extId = arr[0] as string;
      let removed = 0;
      for (const [k, row] of this.storage) {
        if (row.extension_id !== extId) continue;
        if (norm.includes("key like '__settings.%'") && !row.key.startsWith('__settings.')) continue;
        this.storage.delete(k);
        removed++;
      }
      return { changes: removed };
    }

    if (norm.startsWith('insert into extension_storage')) {
      // Both plain INSERT and INSERT...ON CONFLICT...UPDATE land here. The
      // ON CONFLICT clause's `excluded.value`/`excluded.updated_at` map to
      // the freshly-supplied values, so the upsert collapses to "replace".
      const row: StorageRow = {
        extension_id: arr[0] as string,
        key: arr[1] as string,
        value: arr[2] as string,
        updated_at: arr[3] as number,
      };
      this.storage.set(`${row.extension_id}::${row.key}`, row);
      return { changes: 1 };
    }

    // -- extension_catalog_source ------------------------------------
    if (norm.startsWith('insert into extension_catalog_source')) {
      const row: CatalogSourceRow = {
        url: arr[0] as string,
        label: (arr[1] as string | null) ?? null,
        added_at: arr[2] as number,
        risk_acknowledged_at: (arr[3] as number | null) ?? null,
        last_fetched_at: null,
        last_error: null,
        cached_document: null,
      };
      this.catalogSources.set(row.url, row);
      return { changes: 1 };
    }
    if (norm.startsWith('update extension_catalog_source')) {
      // Every shape ends with `WHERE url = ?`.
      const row = this.catalogSources.get(arr[arr.length - 1] as string);
      if (!row) return { changes: 0 };
      if (norm.includes('set risk_acknowledged_at = ?')) {
        row.risk_acknowledged_at = arr[0] as number;
      } else if (norm.includes('set last_fetched_at = ?')) {
        row.last_fetched_at = arr[0] as number;
        row.last_error = null;
        row.cached_document = arr[1] as string;
        // Mirrors `label = COALESCE(label, ?)` - the catalog's own name only
        // fills in when the user did not supply one.
        row.label = row.label ?? (arr[2] as string | null) ?? null;
      } else if (norm.includes('set last_error = ?')) {
        row.last_error = arr[0] as string | null;
      }
      return { changes: 1 };
    }
    if (norm.startsWith('delete from extension_catalog_source')) {
      const had = this.catalogSources.delete(arr[0] as string);
      return { changes: had ? 1 : 0 };
    }

    // -- extension_blocklist -----------------------------------------
    if (norm.startsWith('insert into extension_blocklist')) {
      this.blocklist.push({
        extension_id: arr[0] as string,
        versions: (arr[1] as string | null) ?? null,
        reason: arr[2] as string,
        url: (arr[3] as string | null) ?? null,
        source_url: arr[4] as string,
        fetched_at: arr[5] as number,
      });
      return { changes: 1 };
    }
    if (norm.startsWith('delete from extension_blocklist')) {
      const before = this.blocklist.length;
      if (norm.includes('where source_url = ?')) {
        const sourceUrl = arr[0] as string;
        for (let i = this.blocklist.length - 1; i >= 0; i--) {
          if (this.blocklist[i]!.source_url === sourceUrl) this.blocklist.splice(i, 1);
        }
      } else {
        this.blocklist.length = 0;
      }
      return { changes: before - this.blocklist.length };
    }

    return { changes: 0 };
  }

  transaction<T>(callback: () => T): T {
    return callback();
  }

  close(): void {
    /* no-op */
  }

  isOpen(): boolean {
    return true;
  }

  getDatabasePath(): string {
    return ':fake:';
  }
}
