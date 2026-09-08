/**
 * Host-side implementation of `IStorageApi` for one extension worker.
 *
 * The api-impl wraps four loosely related storage tiers behind a single
 * namespace:
 *
 *   - **KV** (`get/set/delete/keys`). Backed by the `extension_storage` SQL
 *     table on the user DB. Default 5 MB quota.
 *   - **Secrets** (`setSecret/getSecret/deleteSecret`). Routes
 *     through the OS keychain via `ISecretsKeychain`. Per-extension service
 *     namespace `bible-app:ext.<id>`. Permission: `storage:secrets`.
 *   - **Settings** (`getSetting`, `onDidChangeSettings`). Read-only
 *     mirror of `contributes.configuration`. Reads `__settings.<key>` rows
 *     populated by `ExtensionHost.setSettings` (which calls
 *     `notifySettingsChanged` on this api-impl after a successful write).
 *   - **`openDatabase`**. Per-extension SQLite file under
 *     `data/extensions/<id>/db/<name>.db` via `ExtensionDatabaseRegistry`.
 *     Reverse-RPC handles dispatch to `db.exec/query/queryOne/run/begin/
 *     commit/rollback/close`. Permission: `storage:database`.
 *   - **`diskUsage`**. Aggregates KV bytes, database file bytes,
 *     and the secrets count for the Extensions UI.
 *
 * Cross-extension reads are impossible by construction - every query filters
 * on the api-impl's owning `extensionId`, the secrets keychain namespaces by
 * extension service name, and the database registry validates the handle's
 * `extensionId` on every call.
 */

import { Extensions, type ISql } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import {
  type ExtensionPermissionGrant,
  hasPermission,
  requirePermission,
} from '../ExtensionPermissionGuard';
import type { ISecretsKeychain } from '../SecretsKeychain';
import type {
  ExtensionDatabaseRegistry,
  OpenExtensionDatabaseOpts,
} from '../ExtensionDatabaseRegistry';

const { ExtensionNotActiveError, QuotaExceededError, RpcProtocolError } = Extensions;

/** Default per-extension KV quota in bytes. */
export const DEFAULT_KV_QUOTA_BYTES = 5 * 1024 * 1024;

/**
 * Reserved key prefixes the extension cannot read or write through the KV
 * tier - `__settings.*` is owned by the settings tier and surfaces via
 * `getSetting` / `setSettings`.
 */
const RESERVED_KEY_PREFIXES = ['__settings.'];
const SETTINGS_PREFIX = '__settings.';

/** Channel name the worker subscribes to via `api.storage.onDidChangeSettings`. */
const SETTINGS_CHANGE_CHANNEL = 'storage.onDidChangeSettings';

export interface StorageApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  /** Encrypted user DB connection (the same one ExtensionHost uses). */
  db: ISql;
  /** Override the default quota. Useful for tests. */
  quotaBytes?: number;
  /**
   * Permission grant for the extension. The KV tier does NOT require any
   * specific permission - every extension may use a small KV
   * automatically. Secrets / settings / `openDatabase` are gated through
   * `requirePermission` calls below.
   */
  grant: ExtensionPermissionGrant;
  /**
   * Optional OS keychain adapter for the secrets tier. Omit in tests that
   * never touch secrets - calling `setSecret` etc. without an adapter will
   * throw `RpcProtocolError`.
   */
  keychain?: ISecretsKeychain;
  /**
   * Optional per-extension SQLite database registry. Omit in tests
   * that never touch `openDatabase` - calling it without a registry throws
   * `RpcProtocolError`.
   */
  databaseRegistry?: ExtensionDatabaseRegistry;
}

export class StorageApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly db: ISql;
  private readonly quotaBytes: number;
  private readonly grant: ExtensionPermissionGrant;
  private readonly keychain: ISecretsKeychain | undefined;
  private readonly databaseRegistry: ExtensionDatabaseRegistry | undefined;
  private disposed = false;

  constructor(opts: StorageApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.db = opts.db;
    this.quotaBytes = opts.quotaBytes ?? DEFAULT_KV_QUOTA_BYTES;
    this.grant = opts.grant;
    this.keychain = opts.keychain;
    this.databaseRegistry = opts.databaseRegistry;
  }

  attach(): void {
    this.router.registerNamespace('storage', {
      // KV tier
      get: (args) => this.handleGet(args),
      set: (args) => this.handleSet(args),
      delete: (args) => this.handleDelete(args),
      keys: () => this.handleKeys(),

      // Secrets tier
      setSecret: (args) => this.handleSetSecret(args),
      getSecret: (args) => this.handleGetSecret(args),
      deleteSecret: (args) => this.handleDeleteSecret(args),

      // Settings tier
      getSetting: (args) => this.handleGetSetting(args),

      // openDatabase + reverse-RPC handles
      openDatabase: (args) => this.handleOpenDatabase(args),
      dbExec: (args) => this.handleDbExec(args),
      dbQuery: (args) => this.handleDbQuery(args),
      dbQueryOne: (args) => this.handleDbQueryOne(args),
      dbRun: (args) => this.handleDbRun(args),
      dbBeginTransaction: (args) => this.handleDbBegin(args),
      dbCommit: (args) => this.handleDbCommit(args),
      dbRollback: (args) => this.handleDbRollback(args),
      dbClose: (args) => this.handleDbClose(args),

      // Disk usage
      diskUsage: () => this.handleDiskUsage(),
    });
  }

  dispose(): void {
    // KV state lives in SQLite - nothing to release at the api-impl level.
    // (Per-extension data is dropped on `uninstallExtension`, not on
    // deactivate, so disabling an extension does NOT delete its KV.)
    // Per-extension SQLite handles, on the other hand, MUST be released on
    // deactivate so the file descriptor isn't held by a dead worker. The
    // ExtensionHost owns the registry across the lifetime of the host, so we
    // close *this extension's* handles only.
    if (!this.disposed && this.databaseRegistry) {
      try {
        this.databaseRegistry.closeAll(this.extensionId);
      } catch {
        /* swallow - best-effort cleanup */
      }
    }
    this.disposed = true;
  }

  // --- Settings change emit (called from ExtensionHost.setSettings) ------

  /**
   * Push a `storage.onDidChangeSettings` event to the worker. The host calls
   * this after writing new settings via `setSettings`. The router silently
   * drops the emit if the worker has not subscribed.
   */
  notifySettingsChanged(keys: string[]): void {
    if (this.disposed) return;
    this.router.emitEvent(SETTINGS_CHANGE_CHANNEL, { keys });
  }

  // --- KV tier -----------------------------------------------------------

  private async handleGet(args: unknown[]): Promise<unknown> {
    this.assertActive();
    const key = this.requireKey(args[0], 'storage.get');
    const row = this.db.queryOne<{ value: string }>(
      'SELECT value FROM extension_storage WHERE extension_id = ? AND key = ?',
      [this.extensionId, key],
    );
    if (!row) return undefined;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }

  private async handleSet(args: unknown[]): Promise<void> {
    this.assertActive();
    const key = this.requireKey(args[0], 'storage.set');
    if (args.length < 2) {
      throw new RpcProtocolError('storage.set: value is required');
    }
    const value = args[1];
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch (err) {
      throw new RpcProtocolError(
        `storage.set: value is not JSON-serializable: ${(err as Error).message}`,
      );
    }
    if (serialized === undefined) {
      throw new RpcProtocolError('storage.set: value is not JSON-serializable');
    }

    const newValueBytes = byteLength(serialized);
    const existingBytes = this.getRowBytesForKey(key);
    const currentTotal = this.computeBytesUsed();
    const projectedTotal = currentTotal - existingBytes + newValueBytes + byteLength(key);

    if (projectedTotal > this.quotaBytes) {
      throw new QuotaExceededError(
        `Extension '${this.extensionId}' KV would exceed ${this.quotaBytes} bytes (need ${projectedTotal}).`,
        {
          extensionId: this.extensionId,
          quotaBytes: this.quotaBytes,
          projectedBytes: projectedTotal,
        },
      );
    }

    const now = Date.now();
    this.db.execute(
      `INSERT INTO extension_storage (extension_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(extension_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [this.extensionId, key, serialized, now],
    );
  }

  private async handleDelete(args: unknown[]): Promise<void> {
    this.assertActive();
    const key = this.requireKey(args[0], 'storage.delete');
    this.db.execute(
      'DELETE FROM extension_storage WHERE extension_id = ? AND key = ?',
      [this.extensionId, key],
    );
  }

  private async handleKeys(): Promise<string[]> {
    this.assertActive();
    const rows = this.db.queryAll<{ key: string }>(
      'SELECT key FROM extension_storage WHERE extension_id = ?',
      [this.extensionId],
    );
    return rows.map((r) => r.key).filter((k) => !isReservedKey(k));
  }

  // --- Secrets tier ------------------------------------------------------

  private async handleSetSecret(args: unknown[]): Promise<void> {
    this.assertActive();
    requirePermission(this.grant, 'storage:secrets');
    const keychain = this.requireKeychain('storage.setSecret');
    const key = this.requireSecretKey(args[0], 'storage.setSecret');
    if (typeof args[1] !== 'string') {
      throw new RpcProtocolError('storage.setSecret: value must be a string');
    }
    await keychain.setPassword(this.extensionId, key, args[1]);
  }

  private async handleGetSecret(args: unknown[]): Promise<string | undefined> {
    this.assertActive();
    requirePermission(this.grant, 'storage:secrets');
    const keychain = this.requireKeychain('storage.getSecret');
    const key = this.requireSecretKey(args[0], 'storage.getSecret');
    return keychain.getPassword(this.extensionId, key);
  }

  private async handleDeleteSecret(args: unknown[]): Promise<boolean> {
    this.assertActive();
    requirePermission(this.grant, 'storage:secrets');
    const keychain = this.requireKeychain('storage.deleteSecret');
    const key = this.requireSecretKey(args[0], 'storage.deleteSecret');
    return keychain.deletePassword(this.extensionId, key);
  }

  // --- Settings tier -----------------------------------------------------

  private async handleGetSetting(args: unknown[]): Promise<unknown> {
    this.assertActive();
    if (typeof args[0] !== 'string' || args[0].length === 0) {
      throw new RpcProtocolError('storage.getSetting: key must be a non-empty string');
    }
    const settingKey = args[0];
    const row = this.db.queryOne<{ value: string }>(
      'SELECT value FROM extension_storage WHERE extension_id = ? AND key = ?',
      [this.extensionId, `${SETTINGS_PREFIX}${settingKey}`],
    );
    if (!row) return undefined;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }

  // --- openDatabase tier -------------------------------------------------

  private async handleOpenDatabase(args: unknown[]): Promise<string> {
    this.assertActive();
    requirePermission(this.grant, 'storage:database');
    const registry = this.requireDbRegistry('storage.openDatabase');
    if (typeof args[0] !== 'string') {
      throw new RpcProtocolError('storage.openDatabase: name must be a string');
    }
    const opts = this.parseOpenDbOpts(args[1]);
    return registry.open(this.extensionId, args[0], opts);
  }

  private parseOpenDbOpts(raw: unknown): OpenExtensionDatabaseOpts {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== 'object') {
      throw new RpcProtocolError('storage.openDatabase: opts must be an object');
    }
    const out: OpenExtensionDatabaseOpts = {};
    const o = raw as Record<string, unknown>;
    if (typeof o.ephemeral === 'boolean') out.ephemeral = o.ephemeral;
    if (typeof o.readonly === 'boolean') out.readonly = o.readonly;
    return out;
  }

  private async handleDbExec(args: unknown[]): Promise<void> {
    this.assertActive();
    requirePermission(this.grant, 'storage:database');
    const registry = this.requireDbRegistry('storage.dbExec');
    registry.exec(this.extensionId, args[0], args[1]);
  }

  private async handleDbQuery(args: unknown[]): Promise<unknown[]> {
    this.assertActive();
    requirePermission(this.grant, 'storage:database');
    const registry = this.requireDbRegistry('storage.dbQuery');
    return registry.query(this.extensionId, args[0], args[1], args[2]);
  }

  private async handleDbQueryOne(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'storage:database');
    const registry = this.requireDbRegistry('storage.dbQueryOne');
    return registry.queryOne(this.extensionId, args[0], args[1], args[2]);
  }

  private async handleDbRun(args: unknown[]): Promise<{ changes: number; lastInsertRowid: number | string }> {
    this.assertActive();
    requirePermission(this.grant, 'storage:database');
    const registry = this.requireDbRegistry('storage.dbRun');
    return registry.run(this.extensionId, args[0], args[1], args[2]);
  }

  private async handleDbBegin(args: unknown[]): Promise<string> {
    this.assertActive();
    requirePermission(this.grant, 'storage:database');
    const registry = this.requireDbRegistry('storage.dbBeginTransaction');
    return registry.beginTransaction(this.extensionId, args[0]);
  }

  private async handleDbCommit(args: unknown[]): Promise<void> {
    this.assertActive();
    requirePermission(this.grant, 'storage:database');
    const registry = this.requireDbRegistry('storage.dbCommit');
    registry.commitTransaction(this.extensionId, args[0]);
  }

  private async handleDbRollback(args: unknown[]): Promise<void> {
    this.assertActive();
    requirePermission(this.grant, 'storage:database');
    const registry = this.requireDbRegistry('storage.dbRollback');
    registry.rollbackTransaction(this.extensionId, args[0]);
  }

  private async handleDbClose(args: unknown[]): Promise<void> {
    this.assertActive();
    requirePermission(this.grant, 'storage:database');
    const registry = this.requireDbRegistry('storage.dbClose');
    registry.close(this.extensionId, args[0]);
  }

  // --- Disk usage --------------------------------------------------------

  private async handleDiskUsage(): Promise<{
    kv: number;
    databases: number;
    secretsCount: number;
  }> {
    this.assertActive();
    const kv = this.computeBytesUsedIncludingSettings();
    const databases = this.databaseRegistry?.diskUsage(this.extensionId).bytes ?? 0;
    let secretsCount = 0;
    if (this.keychain && hasPermission(this.grant, 'storage:secrets')) {
      try {
        secretsCount = await this.keychain.countSecrets(this.extensionId);
      } catch {
        secretsCount = 0;
      }
    }
    return { kv, databases, secretsCount };
  }

  // --- Helpers -----------------------------------------------------------

  private assertActive(): void {
    if (this.disposed) {
      throw new ExtensionNotActiveError(`storageApiImpl for ${this.extensionId} is disposed`);
    }
    // The grant reference is kept so a future change can gate writes on a
    // permission. Touching it here keeps the field used during strict
    // unused-locals checking.
    void hasPermission(this.grant, 'storage');
  }

  private requireKey(raw: unknown, methodName: string): string {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new RpcProtocolError(`${methodName}: key must be a non-empty string`);
    }
    if (isReservedKey(raw)) {
      throw new RpcProtocolError(
        `${methodName}: key '${raw}' uses a reserved prefix (${RESERVED_KEY_PREFIXES.join(', ')})`,
      );
    }
    return raw;
  }

  private requireSecretKey(raw: unknown, methodName: string): string {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new RpcProtocolError(`${methodName}: key must be a non-empty string`);
    }
    return raw;
  }

  private requireKeychain(methodName: string): ISecretsKeychain {
    if (!this.keychain) {
      throw new RpcProtocolError(
        `${methodName}: secrets tier is not configured on this host`,
      );
    }
    return this.keychain;
  }

  private requireDbRegistry(methodName: string): ExtensionDatabaseRegistry {
    if (!this.databaseRegistry) {
      throw new RpcProtocolError(
        `${methodName}: per-extension database tier is not configured on this host`,
      );
    }
    return this.databaseRegistry;
  }

  private getRowBytesForKey(key: string): number {
    const row = this.db.queryOne<{ value: string }>(
      'SELECT value FROM extension_storage WHERE extension_id = ? AND key = ?',
      [this.extensionId, key],
    );
    if (!row) return 0;
    return byteLength(row.value) + byteLength(key);
  }

  private computeBytesUsed(): number {
    const rows = this.db.queryAll<{ key: string; value: string }>(
      'SELECT key, value FROM extension_storage WHERE extension_id = ?',
      [this.extensionId],
    );
    let total = 0;
    for (const row of rows) {
      if (isReservedKey(row.key)) continue;
      total += byteLength(row.key) + byteLength(row.value);
    }
    return total;
  }

  /**
   * Bytes used by every row owned by this extension, including the
   * `__settings.*` rows. `diskUsage` reports the *total* user-visible KV
   * footprint, while quota enforcement (`computeBytesUsed`) excludes the
   * settings rows so a large schema does not eat into the extension's quota.
   */
  private computeBytesUsedIncludingSettings(): number {
    const rows = this.db.queryAll<{ key: string; value: string }>(
      'SELECT key, value FROM extension_storage WHERE extension_id = ?',
      [this.extensionId],
    );
    let total = 0;
    for (const row of rows) {
      total += byteLength(row.key) + byteLength(row.value);
    }
    return total;
  }
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function isReservedKey(key: string): boolean {
  return RESERVED_KEY_PREFIXES.some((p) => key.startsWith(p));
}
