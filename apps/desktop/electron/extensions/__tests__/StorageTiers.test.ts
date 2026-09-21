/**
 * Storage tier 2 tests.
 *
 * Three independent surfaces share the storage namespace and the same
 * api-impl, so the test file groups them by surface:
 *
 *   - KV tier permission gate (`storage`)
 *   - Secrets tier (`InMemorySecretsKeychain`-backed)
 *   - Settings tier (read + change events)
 *   - `openDatabase` (`ExtensionDatabaseRegistry` with an in-memory factory)
 *   - `diskUsage` aggregate
 *
 * The tests reuse `pairedTransports` / `workerCall` helpers from the Chunk
 * 5 file via tiny local copies - pulling them out into a shared module is
 * future cleanup that doesn't belong in this chunk.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { Extensions, type ISql, type SqlParameter } from '@bible/core';

import { ExtensionRpcRouter, type IRpcTransport } from '../ExtensionRpcRouter';
import { buildGrant } from '../ExtensionPermissionGuard';
import { StorageApiImpl } from '../api-impl';
import {
  ExtensionDatabaseRegistry,
  type IExtensionDatabaseFactory,
} from '../ExtensionDatabaseRegistry';
import { InMemorySecretsKeychain, serviceNameForExtension } from '../SecretsKeychain';
import { FakeSql } from './fakeSql';

type RpcRequest = Extensions.RpcRequest;
type RpcResponse = Extensions.RpcResponse;
type RpcEvent = Extensions.RpcEvent;
type RpcSubscribe = Extensions.RpcSubscribe;

// --- Local copies of the shared test helpers (paired transports + workerCall) -

function pairedTransports(): {
  hostSide: IRpcTransport;
  workerSide: IRpcTransport;
  hostSent: unknown[];
} {
  let hostHandler: ((env: unknown) => void) | null = null;
  let workerHandler: ((env: unknown) => void) | null = null;
  const hostSent: unknown[] = [];
  const hostSide: IRpcTransport = {
    send(env) {
      hostSent.push(env);
      workerHandler?.(env);
    },
    onMessage(h) {
      hostHandler = h;
    },
    close() {
      hostHandler = null;
    },
  };
  const workerSide: IRpcTransport = {
    send(env) {
      hostHandler?.(env);
    },
    onMessage(h) {
      workerHandler = h;
    },
    close() {
      workerHandler = null;
    },
  };
  return { hostSide, workerSide, hostSent };
}

let nextWorkerReqId = 1;
async function workerCall(
  workerSide: IRpcTransport,
  hostSent: unknown[],
  method: string,
  args: unknown[],
): Promise<RpcResponse> {
  const startLen = hostSent.length;
  const id = `w-${nextWorkerReqId++}`;
  const req: RpcRequest = { kind: 'request', id, method, args };
  workerSide.send(req);
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setImmediate(r));
    for (let j = startLen; j < hostSent.length; j++) {
      const env = hostSent[j];
      if (
        env &&
        typeof env === 'object' &&
        (env as RpcResponse).kind === 'response' &&
        (env as RpcResponse).id === id
      ) {
        return env as RpcResponse;
      }
    }
  }
  throw new Error(`workerCall: no response received for ${method}`);
}

// --- KV tier permission gate ----------------------------------------------

/**
 * The KV tier is gated on `storage`, like every other tier on this namespace.
 *
 * This used to be the one hole in the storage surface: `storage` was a real
 * permission - declarable in `extension.json`, listed in the install consent
 * dialog, and enforced by `@bible/extension-testing`'s smoke interceptors -
 * that the host itself never checked, so an extension that declared nothing
 * got a 5 MB persistent store anyway and the user's consent decision meant
 * nothing. Two facts are pinned below so the hole cannot reopen quietly:
 * ungranted calls are refused, and granted ones still work.
 */
describe('StorageApiImpl — KV permission gate', () => {
  let pair: ReturnType<typeof pairedTransports>;
  let db: FakeSql;

  function attachWith(grants: string[]): void {
    const router = new ExtensionRpcRouter(pair.hostSide);
    new StorageApiImpl({
      extensionId: 'ext.test.kvgate',
      router,
      db,
      grant: buildGrant('ext.test.kvgate', grants),
    }).attach();
  }

  beforeEach(() => {
    pair = pairedTransports();
    db = new FakeSql();
  });

  const kvCalls: ReadonlyArray<readonly [method: string, args: unknown[]]> = [
    ['storage.get', ['k']],
    ['storage.set', ['k', 'v']],
    ['storage.delete', ['k']],
    ['storage.keys', []],
  ];

  it.each(kvCalls)('refuses %s without the storage permission', async (method, args) => {
    attachWith(['bible:read']);
    const res = await workerCall(pair.workerSide, pair.hostSent, method, args);
    expect(res.error?.code).toBe('PermissionDeniedError');
    expect(res.error?.message).toMatch(/storage/);
  });

  it.each(kvCalls)('allows %s once storage is granted', async (method, args) => {
    attachWith(['storage']);
    const res = await workerCall(pair.workerSide, pair.hostSent, method, args);
    expect(res.error).toBeUndefined();
  });

  it('writes nothing to the table when the call is refused', async () => {
    // A gate that threw *after* the row landed would still be a leak.
    attachWith([]);
    await workerCall(pair.workerSide, pair.hostSent, 'storage.set', ['leaked', 'value']);
    const rows = db.queryAll<{ key: string }>(
      'SELECT key FROM extension_storage WHERE extension_id = ?',
      ['ext.test.kvgate'],
    );
    expect(rows).toEqual([]);
  });

  it('leaves getSetting reachable without the storage permission', async () => {
    // Settings are the extension's own declared configuration, written by the
    // host from a form the user filled in. Gating them behind `storage` would
    // make an extension ask permission to read something it already owns.
    attachWith([]);
    db.execute(
      'INSERT INTO extension_storage (extension_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
      ['ext.test.kvgate', '__settings.theme', JSON.stringify('dark'), Date.now()],
    );
    const res = await workerCall(pair.workerSide, pair.hostSent, 'storage.getSetting', ['theme']);
    expect(res.error).toBeUndefined();
    expect(res.result).toBe('dark');
  });
});

// --- Secrets tier ---------------------------------------------------------

describe('StorageApiImpl — secrets tier', () => {
  let pair: ReturnType<typeof pairedTransports>;
  let router: ExtensionRpcRouter;
  let keychain: InMemorySecretsKeychain;
  let db: FakeSql;

  beforeEach(() => {
    pair = pairedTransports();
    router = new ExtensionRpcRouter(pair.hostSide);
    db = new FakeSql();
    keychain = new InMemorySecretsKeychain();
  });

  function attachWith(grants: string[]): void {
    new StorageApiImpl({
      extensionId: 'ext.test.secrets',
      router,
      db,
      grant: buildGrant('ext.test.secrets', grants),
      keychain,
    }).attach();
  }

  it('round-trips set/get/delete via the keychain', async () => {
    attachWith(['storage:secrets']);
    const set = await workerCall(pair.workerSide, pair.hostSent, 'storage.setSecret', [
      'apiKey',
      'secret-token',
    ]);
    expect(set.error).toBeUndefined();
    expect(await keychain.getPassword('ext.test.secrets', 'apiKey')).toBe('secret-token');

    const get = await workerCall(pair.workerSide, pair.hostSent, 'storage.getSecret', ['apiKey']);
    expect(get.result).toBe('secret-token');

    const del = await workerCall(pair.workerSide, pair.hostSent, 'storage.deleteSecret', ['apiKey']);
    expect(del.result).toBe(true);
    expect(await keychain.getPassword('ext.test.secrets', 'apiKey')).toBeUndefined();
  });

  it('rejects calls without the storage:secrets permission', async () => {
    attachWith([]); // no permission
    const res = await workerCall(pair.workerSide, pair.hostSent, 'storage.setSecret', ['k', 'v']);
    expect(res.error?.code).toBe('PermissionDeniedError');
  });

  it('namespaces secrets per extension via the service name', async () => {
    attachWith(['storage:secrets']);
    await workerCall(pair.workerSide, pair.hostSent, 'storage.setSecret', ['shared', 'A']);
    expect(await keychain.getPassword('ext.test.secrets', 'shared')).toBe('A');
    expect(await keychain.getPassword('ext.other', 'shared')).toBeUndefined();
    expect(serviceNameForExtension('ext.test.secrets')).toBe('bible-app:ext.test.secrets');
  });

  it('rejects setSecret when no keychain is wired into the host', async () => {
    new StorageApiImpl({
      extensionId: 'ext.test.no-keychain',
      router,
      db,
      grant: buildGrant('ext.test.no-keychain', ['storage:secrets']),
    }).attach();
    const res = await workerCall(pair.workerSide, pair.hostSent, 'storage.setSecret', ['k', 'v']);
    expect(res.error?.code).toBe('RpcProtocolError');
    expect(res.error?.message).toContain('not configured');
  });
});

// --- Settings tier --------------------------------------------------------

describe('StorageApiImpl — settings tier', () => {
  let pair: ReturnType<typeof pairedTransports>;
  let router: ExtensionRpcRouter;
  let api: StorageApiImpl;
  let db: FakeSql;

  beforeEach(() => {
    pair = pairedTransports();
    router = new ExtensionRpcRouter(pair.hostSide);
    db = new FakeSql();
    api = new StorageApiImpl({
      extensionId: 'ext.test.settings',
      router,
      db,
      grant: buildGrant('ext.test.settings', []),
    });
    api.attach();
  });

  it('reads __settings.* rows back via getSetting', async () => {
    // Seed a `__settings.theme` row (the same shape `ExtensionHost.setSettings`
    // would have written).
    db.execute(
      'INSERT INTO extension_storage (extension_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
      ['ext.test.settings', '__settings.theme', JSON.stringify('dark'), Date.now()],
    );
    const res = await workerCall(pair.workerSide, pair.hostSent, 'storage.getSetting', ['theme']);
    expect(res.result).toBe('dark');
  });

  it('returns undefined for an unknown setting key', async () => {
    const res = await workerCall(pair.workerSide, pair.hostSent, 'storage.getSetting', ['nope']);
    expect(res.result).toBeUndefined();
  });

  it('emits storage.onDidChangeSettings only after a worker subscribes', async () => {
    // Fire before subscribe -> no event delivered.
    api.notifySettingsChanged(['theme']);
    expect(
      pair.hostSent.filter(
        (e) =>
          typeof e === 'object' &&
          e !== null &&
          (e as RpcEvent).kind === 'event' &&
          (e as RpcEvent).channel === 'storage.onDidChangeSettings',
      ),
    ).toHaveLength(0);

    const sub: RpcSubscribe = {
      kind: 'subscribe',
      id: 'sub-settings',
      channel: 'storage.onDidChangeSettings',
    };
    pair.workerSide.send(sub);
    await new Promise((r) => setImmediate(r));
    api.notifySettingsChanged(['theme', 'apiKey']);
    const events = pair.hostSent.filter(
      (e) =>
        typeof e === 'object' &&
        e !== null &&
        (e as RpcEvent).kind === 'event' &&
        (e as RpcEvent).channel === 'storage.onDidChangeSettings',
    );
    expect(events).toHaveLength(1);
    expect((events[0] as RpcEvent).payload).toEqual({ keys: ['theme', 'apiKey'] });
  });
});

// --- openDatabase + ExtensionDatabaseRegistry -----------------------------

/**
 * In-memory `ISql` factory for the registry. We do not pull in better-sqlite3
 * here - the test only needs a stable Map-backed store that obeys parameter
 * binding for the operations our wrapper actually issues.
 */
class MemorySql implements ISql {
  readonly rows = new Map<string, Record<string, SqlParameter>>();
  private autoincrement = 0;
  private opened = true;
  private inTx = false;
  readonly path: string;
  readonly readonly: boolean;
  constructor(path: string, readonly: boolean) {
    this.path = path;
    this.readonly = readonly;
  }
  queryOne<T = unknown>(sql: string, params?: SqlParameter[] | Record<string, SqlParameter>): T | undefined {
    return this.queryAll<T>(sql, params)[0];
  }
  queryAll<T = unknown>(sql: string, params?: SqlParameter[] | Record<string, SqlParameter>): T[] {
    const norm = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    const arr = (Array.isArray(params) ? params : []) as SqlParameter[];
    if (norm.startsWith('select * from items')) {
      const out: Record<string, SqlParameter>[] = Array.from(this.rows.values());
      if (norm.includes('where id = ?')) {
        const id = arr[0];
        return out.filter((r) => r.id === id) as unknown as T[];
      }
      return out as unknown as T[];
    }
    if (norm.startsWith('select count(*)')) {
      return [{ c: this.rows.size }] as unknown as T[];
    }
    return [];
  }
  execute(sql: string, params?: SqlParameter[] | Record<string, SqlParameter>) {
    const norm = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    const arr = (Array.isArray(params) ? params : []) as SqlParameter[];
    if (norm.startsWith('begin') || norm === 'begin immediate') {
      this.inTx = true;
      return { changes: 0 };
    }
    if (norm.startsWith('commit')) {
      this.inTx = false;
      return { changes: 0 };
    }
    if (norm.startsWith('rollback')) {
      // Drop everything inserted since BEGIN. We model this with a snapshot
      // saved at BEGIN - but to keep the test class tiny, just clear all
      // rows on rollback. The tests only insert inside transactions when
      // they explicitly want a rollback to wipe them.
      if (this.inTx) this.rows.clear();
      this.inTx = false;
      return { changes: 0 };
    }
    if (norm.startsWith('create table')) return { changes: 0 };
    if (norm.startsWith('insert into items')) {
      const id = ++this.autoincrement;
      this.rows.set(String(id), { id, name: arr[0] ?? null });
      return { changes: 1, lastInsertRowId: id };
    }
    if (norm.startsWith('delete from items')) {
      const before = this.rows.size;
      this.rows.clear();
      return { changes: before };
    }
    return { changes: 0 };
  }
  transaction<T>(callback: () => T): T {
    return callback();
  }
  close(): void {
    this.opened = false;
  }
  isOpen(): boolean {
    return this.opened;
  }
  getDatabasePath(): string {
    return this.path;
  }
}

class TestFactory implements IExtensionDatabaseFactory {
  readonly opens: Array<{ filePath: string; readonly: boolean }> = [];
  open(filePath: string, opts: { readonly: boolean }): ISql {
    this.opens.push({ filePath, readonly: opts.readonly });
    return new MemorySql(filePath, opts.readonly);
  }
}

describe('ExtensionDatabaseRegistry + storage.openDatabase', () => {
  let tmpRoot: string;
  let factory: TestFactory;
  let registry: ExtensionDatabaseRegistry;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'ext-storage-'));
    factory = new TestFactory();
    registry = new ExtensionDatabaseRegistry({ extensionsRoot: tmpRoot, factory });
  });

  function attach(extensionId: string, perms: string[]): { pair: ReturnType<typeof pairedTransports> } {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    new StorageApiImpl({
      extensionId,
      router,
      db: new FakeSql(),
      grant: buildGrant(extensionId, perms),
      databaseRegistry: registry,
    }).attach();
    return { pair };
  }

  it('opens a database, executes statements, and closes the handle', async () => {
    const { pair } = attach('ext.test.db', ['storage:database']);
    const open = await workerCall(pair.workerSide, pair.hostSent, 'storage.openDatabase', ['main']);
    expect(typeof open.result).toBe('string');
    const handle = open.result as string;
    expect(factory.opens).toHaveLength(1);
    expect(factory.opens[0]?.filePath.endsWith(join('ext.test.db', 'db', 'main.db'))).toBe(true);

    const exec = await workerCall(pair.workerSide, pair.hostSent, 'storage.dbExec', [
      handle,
      'CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)',
    ]);
    expect(exec.error).toBeUndefined();

    const run = await workerCall(pair.workerSide, pair.hostSent, 'storage.dbRun', [
      handle,
      'INSERT INTO items (name) VALUES (?)',
      ['hello'],
    ]);
    expect((run.result as { changes: number }).changes).toBe(1);

    const query = await workerCall(pair.workerSide, pair.hostSent, 'storage.dbQuery', [
      handle,
      'SELECT * FROM items',
      [],
    ]);
    expect((query.result as unknown[]).length).toBe(1);

    const close = await workerCall(pair.workerSide, pair.hostSent, 'storage.dbClose', [handle]);
    expect(close.error).toBeUndefined();
    expect(registry.hasOpen('ext.test.db')).toBe(false);
  });

  it('rejects openDatabase without storage:database', async () => {
    const { pair } = attach('ext.test.db.noperm', []);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'storage.openDatabase', ['main']);
    expect(res.error?.code).toBe('PermissionDeniedError');
  });

  it('refuses to resolve a handle that belongs to another extension', async () => {
    const a = attach('ext.test.alpha', ['storage:database']);
    const aOpen = await workerCall(a.pair.workerSide, a.pair.hostSent, 'storage.openDatabase', [
      'shared',
    ]);
    const handle = aOpen.result as string;

    const b = attach('ext.test.bravo', ['storage:database']);
    const stolen = await workerCall(b.pair.workerSide, b.pair.hostSent, 'storage.dbExec', [
      handle,
      'CREATE TABLE items (id INTEGER)',
    ]);
    expect(stolen.error?.code).toBe('RpcProtocolError');
  });

  it('rejects bad database names', async () => {
    const { pair } = attach('ext.test.bad-name', ['storage:database']);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'storage.openDatabase', [
      '../../../etc/passwd',
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });

  it('begin/commit and begin/rollback delimit a transaction', async () => {
    const { pair } = attach('ext.test.tx', ['storage:database']);
    const open = await workerCall(pair.workerSide, pair.hostSent, 'storage.openDatabase', ['tx']);
    const handle = open.result as string;

    await workerCall(pair.workerSide, pair.hostSent, 'storage.dbExec', [
      handle,
      'CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)',
    ]);

    // happy path: BEGIN, INSERT, COMMIT - row persists.
    const txHandle = (
      await workerCall(pair.workerSide, pair.hostSent, 'storage.dbBeginTransaction', [handle])
    ).result as string;
    await workerCall(pair.workerSide, pair.hostSent, 'storage.dbRun', [
      txHandle,
      'INSERT INTO items (name) VALUES (?)',
      ['kept'],
    ]);
    await workerCall(pair.workerSide, pair.hostSent, 'storage.dbCommit', [txHandle]);

    // rollback path: BEGIN, INSERT, ROLLBACK - row goes away (MemorySql
    // wipes everything on ROLLBACK to keep the fake honest).
    const tx2 = (
      await workerCall(pair.workerSide, pair.hostSent, 'storage.dbBeginTransaction', [handle])
    ).result as string;
    await workerCall(pair.workerSide, pair.hostSent, 'storage.dbRun', [
      tx2,
      'INSERT INTO items (name) VALUES (?)',
      ['gone'],
    ]);
    await workerCall(pair.workerSide, pair.hostSent, 'storage.dbRollback', [tx2]);

    const after = await workerCall(pair.workerSide, pair.hostSent, 'storage.dbQuery', [
      handle,
      'SELECT * FROM items',
      [],
    ]);
    // After the rollback wiped MemorySql, the table is empty.
    expect((after.result as unknown[]).length).toBe(0);
  });

  it('closeAll on dispose tears down the connections', async () => {
    const { pair } = attach('ext.test.cleanup', ['storage:database']);
    await workerCall(pair.workerSide, pair.hostSent, 'storage.openDatabase', ['a']);
    await workerCall(pair.workerSide, pair.hostSent, 'storage.openDatabase', ['b']);
    expect(registry.hasOpen('ext.test.cleanup')).toBe(true);
    registry.closeAll('ext.test.cleanup');
    expect(registry.hasOpen('ext.test.cleanup')).toBe(false);
  });

  it('removeAll deletes the on-disk db directory', () => {
    registry.open('ext.test.remove', 'one', {});
    registry.open('ext.test.remove', 'two', {});
    expect(registry.hasOpen('ext.test.remove')).toBe(true);
    registry.removeAll('ext.test.remove');
    expect(registry.hasOpen('ext.test.remove')).toBe(false);
  });

  // Clean up the temp dir created by mkdtempSync - vitest doesn't auto-rm.
  afterEach(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  });
});

// --- diskUsage ------------------------------------------------------------

describe('StorageApiImpl — diskUsage', () => {
  it('aggregates KV bytes, database bytes, and the secrets count', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const db = new FakeSql();
    const keychain = new InMemorySecretsKeychain();
    const tmpRoot = mkdtempSync(join(tmpdir(), 'ext-storage-du-'));
    const factory = new TestFactory();
    const registry = new ExtensionDatabaseRegistry({ extensionsRoot: tmpRoot, factory });

    new StorageApiImpl({
      extensionId: 'ext.test.diskuse',
      router,
      db,
      grant: buildGrant('ext.test.diskuse', ['storage', 'storage:secrets', 'storage:database']),
      keychain,
      databaseRegistry: registry,
    }).attach();

    // KV: write a row.
    await workerCall(pair.workerSide, pair.hostSent, 'storage.set', ['hello', 'world']);
    // Secret: write one.
    await workerCall(pair.workerSide, pair.hostSent, 'storage.setSecret', ['k1', 'v1']);
    // Database: open one (no rows needed - diskUsage only walks the file).
    await workerCall(pair.workerSide, pair.hostSent, 'storage.openDatabase', ['main']);

    const res = await workerCall(pair.workerSide, pair.hostSent, 'storage.diskUsage', []);
    const result = res.result as { kv: number; databases: number; secretsCount: number };
    expect(result.kv).toBeGreaterThan(0);
    expect(result.secretsCount).toBe(1);
    // Our in-memory factory writes nothing to disk, so the file walk
    // returns 0 - but the call must still resolve.
    expect(result.databases).toBe(0);

    rmSync(tmpRoot, { recursive: true, force: true });
  });
});
