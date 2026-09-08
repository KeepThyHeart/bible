/**
 * Per-extension SQLite database registry backing `IStorageApi.openDatabase`.
 *
 * Each extension that holds the `storage:database` permission can open one or more dedicated SQLite files
 * under `data/extensions/<id>/db/<name>.db`. The host opens the file with
 * WAL + foreign keys (the same pragmas the user DB uses), runs no migrations
 * - schema is the extension's responsibility - and tracks the open handle so
 * `deactivate` and `uninstall` can close + (for uninstall) wipe the file.
 *
 * The registry knows nothing about the worker process or the RPC router.
 * It exposes a small synchronous-ish surface that the storage api-impl wraps
 * in async RPC handlers. Tests inject a `factory` that returns a fake `ISql`
 * so the registry stays unit-testable without `better-sqlite3`.
 */

import { existsSync, mkdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import log from 'electron-log';

import type { ISql, SqlParameter } from '@bible/core';
import { Extensions } from '@bible/core';

import { assertExtensionSqlAllowed } from './ExtensionSqlGuard';

const { RpcProtocolError } = Extensions;

/** Options accepted by `openDatabase` (mirrors `OpenDatabaseOpts`). */
export interface OpenExtensionDatabaseOpts {
  ephemeral?: boolean;
  readonly?: boolean;
}

/** Factory the registry uses to materialise an `ISql` from a file path. */
export interface IExtensionDatabaseFactory {
  open(filePath: string, opts: { readonly: boolean }): ISql;
}

interface OpenEntry {
  handle: string;
  extensionId: string;
  name: string;
  filePath: string;
  ephemeral: boolean;
  readonly: boolean;
  sql: ISql;
  /** True iff a `BEGIN` has been issued and not yet committed/rolled back. */
  inTransaction: boolean;
}

export interface ExtensionDatabaseRegistryOptions {
  /** Absolute path to `data/extensions/`. */
  extensionsRoot: string;
  /** Factory for opening the underlying SQLite file. */
  factory: IExtensionDatabaseFactory;
}

/** Maximum length of an extension-supplied database name (ASCII safety). */
const MAX_NAME_LEN = 64;
const VALID_NAME_RE = /^[a-zA-Z0-9_\-]+$/;

export class ExtensionDatabaseRegistry {
  private readonly extensionsRoot: string;
  private readonly factory: IExtensionDatabaseFactory;
  /** Map<handle, entry>. */
  private readonly entries = new Map<string, OpenEntry>();
  /** Index for `closeAll(extensionId)` and quota checks. */
  private readonly byExtension = new Map<string, Set<string>>();
  private nextHandleId = 1;

  constructor(opts: ExtensionDatabaseRegistryOptions) {
    this.extensionsRoot = opts.extensionsRoot;
    this.factory = opts.factory;
  }

  /**
   * Open (or create) `data/extensions/<id>/db/<name>.db` and return an opaque
   * handle the api-impl can use to route follow-up calls. Reopening the same
   * `(extensionId, name)` returns a fresh handle - the host does not pool by
   * name because two opens of the same DB from the same extension are rare
   * and pooling would surprise the extension when one close kills the other.
   */
  open(extensionId: string, name: string, opts: OpenExtensionDatabaseOpts = {}): string {
    if (typeof name !== 'string' || name.length === 0 || name.length > MAX_NAME_LEN) {
      throw new RpcProtocolError(
        `storage.openDatabase: name must be 1..${MAX_NAME_LEN} characters`,
      );
    }
    if (!VALID_NAME_RE.test(name)) {
      throw new RpcProtocolError(
        `storage.openDatabase: name '${name}' must match ${VALID_NAME_RE.source}`,
      );
    }

    const dbDir = join(this.extensionsRoot, extensionId, 'db');
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
    const filePath = join(dbDir, `${name}.db`);
    const readonly = opts.readonly === true;
    const sql = this.factory.open(filePath, { readonly });

    const handle = `db-${this.nextHandleId++}`;
    const entry: OpenEntry = {
      handle,
      extensionId,
      name,
      filePath,
      ephemeral: opts.ephemeral === true,
      readonly,
      sql,
      inTransaction: false,
    };
    this.entries.set(handle, entry);
    let set = this.byExtension.get(extensionId);
    if (!set) {
      set = new Set();
      this.byExtension.set(extensionId, set);
    }
    set.add(handle);

    return handle;
  }

  /**
   * Resolve a handle, asserting it belongs to `extensionId`. Throws
   * `RpcProtocolError` on a bad/foreign handle so we never let one extension
   * touch another extension's connection.
   */
  private resolve(extensionId: string, handle: unknown): OpenEntry {
    if (typeof handle !== 'string' || handle.length === 0) {
      throw new RpcProtocolError('storage.db*: handle must be a non-empty string');
    }
    const entry = this.entries.get(handle);
    if (!entry || entry.extensionId !== extensionId) {
      throw new RpcProtocolError(`storage.db*: unknown database handle '${handle}'`);
    }
    return entry;
  }

  exec(extensionId: string, handle: unknown, sql: unknown): void {
    const entry = this.resolve(extensionId, handle);
    if (typeof sql !== 'string' || sql.length === 0) {
      throw new RpcProtocolError('storage.db.exec: sql must be a non-empty string');
    }
    assertExtensionSqlAllowed(sql, 'storage.db.exec');
    entry.sql.execute(sql);
  }

  query<T = unknown>(extensionId: string, handle: unknown, sql: unknown, params: unknown): T[] {
    const entry = this.resolve(extensionId, handle);
    const stmt = requireString(sql, 'storage.db.query: sql');
    assertExtensionSqlAllowed(stmt, 'storage.db.query');
    return entry.sql.queryAll<T>(stmt, normalizeParams(params));
  }

  queryOne<T = unknown>(
    extensionId: string,
    handle: unknown,
    sql: unknown,
    params: unknown,
  ): T | undefined {
    const entry = this.resolve(extensionId, handle);
    const stmt = requireString(sql, 'storage.db.queryOne: sql');
    assertExtensionSqlAllowed(stmt, 'storage.db.queryOne');
    return entry.sql.queryOne<T>(stmt, normalizeParams(params));
  }

  run(
    extensionId: string,
    handle: unknown,
    sql: unknown,
    params: unknown,
  ): { changes: number; lastInsertRowid: number | string } {
    const entry = this.resolve(extensionId, handle);
    const stmt = requireString(sql, 'storage.db.run: sql');
    assertExtensionSqlAllowed(stmt, 'storage.db.run');
    const result = entry.sql.execute(stmt, normalizeParams(params));
    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowId ?? 0,
    };
  }

  beginTransaction(extensionId: string, handle: unknown): string {
    const entry = this.resolve(extensionId, handle);
    if (entry.inTransaction) {
      throw new RpcProtocolError('storage.db.transaction: nested transactions are not supported');
    }
    entry.sql.execute('BEGIN IMMEDIATE');
    entry.inTransaction = true;
    return entry.handle;
  }

  commitTransaction(extensionId: string, handle: unknown): void {
    const entry = this.resolve(extensionId, handle);
    if (!entry.inTransaction) {
      throw new RpcProtocolError('storage.db.transaction: no transaction to commit');
    }
    entry.sql.execute('COMMIT');
    entry.inTransaction = false;
  }

  rollbackTransaction(extensionId: string, handle: unknown): void {
    const entry = this.resolve(extensionId, handle);
    if (!entry.inTransaction) return;
    try {
      entry.sql.execute('ROLLBACK');
    } finally {
      entry.inTransaction = false;
    }
  }

  close(extensionId: string, handle: unknown): void {
    const entry = this.resolve(extensionId, handle);
    this.closeEntry(entry);
  }

  /**
   * Close every database currently open for the extension. Called from
   * `ExtensionHost.deactivate` so a worker tear-down does not leave dangling
   * file descriptors.
   */
  closeAll(extensionId: string): void {
    const handles = this.byExtension.get(extensionId);
    if (!handles) return;
    for (const handle of Array.from(handles)) {
      const entry = this.entries.get(handle);
      if (entry) this.closeEntry(entry);
    }
  }

  /**
   * Drop every database file owned by the extension. Called from
   * `ExtensionHost.uninstallExtension` after `closeAll`.
   */
  removeAll(extensionId: string): void {
    this.closeAll(extensionId);
    const dir = join(this.extensionsRoot, extensionId, 'db');
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch (err) {
        log.warn(`[ExtensionDatabaseRegistry] removeAll(${extensionId}) failed:`, err);
      }
    }
  }

  /** True iff the extension has any open database handles. Test helper. */
  hasOpen(extensionId: string): boolean {
    return (this.byExtension.get(extensionId)?.size ?? 0) > 0;
  }

  /**
   * Approximate on-disk usage (bytes) of every database file the extension
   * owns. Used by `storage.diskUsage`. The walk happens at call time so a
   * background `VACUUM` or external rebuild is reflected immediately.
   */
  diskUsage(extensionId: string): { bytes: number; ephemeralBytes: number } {
    const dir = join(this.extensionsRoot, extensionId, 'db');
    if (!existsSync(dir)) return { bytes: 0, ephemeralBytes: 0 };

    // Track which files are flagged ephemeral so the caller can split the
    // total for backup purposes (ephemeral databases skip backup).
    const ephemeralByFile = new Set<string>();
    for (const handle of this.byExtension.get(extensionId) ?? []) {
      const entry = this.entries.get(handle);
      if (entry?.ephemeral) ephemeralByFile.add(entry.filePath);
    }

    let total = 0;
    let ephemeral = 0;
    const walk = (path: string): void => {
      try {
        const stat = statSync(path);
        if (stat.isFile()) {
          total += stat.size;
          if (ephemeralByFile.has(path)) ephemeral += stat.size;
        } else if (stat.isDirectory()) {
          // Walk shallow - we don't expect nested dirs but be safe.
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { readdirSync } = require('fs') as typeof import('fs');
          for (const child of readdirSync(path)) walk(join(path, child));
        }
      } catch {
        /* ignore broken entries */
      }
    };
    walk(dir);
    return { bytes: total, ephemeralBytes: ephemeral };
  }

  // --- Internal ----------------------------------------------------------

  private closeEntry(entry: OpenEntry): void {
    if (entry.inTransaction) {
      try {
        entry.sql.execute('ROLLBACK');
      } catch {
        /* swallow - close still proceeds */
      }
      entry.inTransaction = false;
    }
    try {
      entry.sql.close();
    } catch (err) {
      log.warn(
        `[ExtensionDatabaseRegistry] close(${entry.extensionId}/${entry.name}) failed:`,
        err,
      );
    }
    this.entries.delete(entry.handle);
    const set = this.byExtension.get(entry.extensionId);
    if (set) {
      set.delete(entry.handle);
      if (set.size === 0) this.byExtension.delete(entry.extensionId);
    }
  }
}

// --- Helpers -----------------------------------------------------------------

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RpcProtocolError(`${label} must be a non-empty string`);
  }
  return value;
}

function normalizeParams(value: unknown): SqlParameter[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new RpcProtocolError('storage.db.*: params must be an array');
  }
  // Every value must be something `ISql` can bind. BLOBs are included: the
  // realm boundary carries `Uint8Array`/`ArrayBuffer` intact (see
  // `extension-runtime/binaryCodec.ts`) and `SqlParameter` accepts them, so
  // this is deliberately not restricted to primitives.
  //
  // Anything else is still refused rather than passed through: an arbitrary
  // object reaching the driver gets coerced into a value nobody intended, and
  // a silently wrong BLOB is worse than a rejected call.
  return value.map((v): SqlParameter => {
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      return v;
    }
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    throw new RpcProtocolError(
      'storage.db.*: params must contain only string, number, boolean, null, ' +
        'Uint8Array, or ArrayBuffer',
    );
  });
}
