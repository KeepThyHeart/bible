/**
 * Behavioural contract of `createMockApi().storage`.
 *
 * These tests exist because the previous mock was *silently* inert: `set`
 * accepted anything, `get` always resolved `undefined`, and
 * `openDatabase(...).transaction(work)` resolved `undefined` **without ever
 * calling `work`**. An extension whose entire job is persistence could
 * therefore be completely broken and still have a green suite - the tests
 * asserted on a mock that never ran the code they were pointed at.
 *
 * So the assertions below are deliberately about *behaviour we would notice
 * losing*, not about the mock's shape.
 */

import { describe, it, expect, vi } from 'vitest';

import { createMockApi } from '../createMockApi';
import type { MockExtensionDatabase } from '../createMockApi';

const openDb = async (api = createMockApi()): Promise<MockExtensionDatabase> =>
  (await api.storage.openDatabase('main')) as MockExtensionDatabase;

describe('createMockApi().storage — KV tier', () => {
  it('round-trips a value through set/get', async () => {
    const api = createMockApi();
    await api.storage.set('lastVerse', 43003016);
    await expect(api.storage.get('lastVerse')).resolves.toBe(43003016);
  });

  it('round-trips structured values', async () => {
    const api = createMockApi();
    const plan = { id: 'p1', days: [{ n: 1, refs: ['gen.1'] }], done: false };
    await api.storage.set('plan', plan);
    await expect(api.storage.get('plan')).resolves.toEqual(plan);
  });

  it('returns undefined for a key that was never written', async () => {
    const api = createMockApi();
    await expect(api.storage.get('nope')).resolves.toBeUndefined();
  });

  it('hands back a copy, not the caller’s object', async () => {
    // The host serializes through JSON on the way to SQLite, so a post-write
    // mutation cannot be visible to a later read. A mock that stored the
    // reference would hide that class of bug entirely.
    const api = createMockApi();
    const value = { count: 1 };
    await api.storage.set('v', value);
    value.count = 99;
    await expect(api.storage.get('v')).resolves.toEqual({ count: 1 });
  });

  it('rejects a value the RPC boundary could not carry', async () => {
    const api = createMockApi();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(api.storage.set('cyclic', cyclic)).rejects.toThrow(/not JSON-serializable/);
    await expect(api.storage.set('undef', undefined)).rejects.toThrow(/not JSON-serializable/);
  });

  it('delete removes the key and keys() lists what is there', async () => {
    const api = createMockApi();
    await api.storage.set('a', 1);
    await api.storage.set('b', 2);
    await expect(api.storage.keys()).resolves.toEqual(['a', 'b']);

    await api.storage.delete('a');
    await expect(api.storage.keys()).resolves.toEqual(['b']);
    await expect(api.storage.get('a')).resolves.toBeUndefined();
  });

  it('gives each api its own store', async () => {
    const a = createMockApi();
    const b = createMockApi();
    await a.storage.set('k', 'from-a');
    await expect(b.storage.get('k')).resolves.toBeUndefined();
  });

  it('still records calls, so existing spy assertions keep working', async () => {
    const api = createMockApi();
    await api.storage.set('k', 'v');
    await api.storage.get('k');
    const setFn = api.storage.set as unknown as { mock: { calls: unknown[][] } };
    const getFn = api.storage.get as unknown as { mock: { calls: unknown[][] } };
    expect(setFn.mock.calls).toEqual([['k', 'v']]);
    expect(getFn.mock.calls).toEqual([['k']]);
  });

  it('lets an override replace the real store, as before', async () => {
    const api = createMockApi({
      storage: { get: vi.fn().mockResolvedValue('overridden') as never },
    });
    await api.storage.set('k', 'real');
    await expect(api.storage.get('k')).resolves.toBe('overridden');
  });

  it('reports a disk usage that moves with the store', async () => {
    const api = createMockApi();
    const empty = await api.storage.diskUsage();
    await api.storage.set('k', 'some value');
    const after = await api.storage.diskUsage();
    expect(after.kv).toBeGreaterThan(empty.kv);
  });
});

describe('createMockApi().storage — secrets tier', () => {
  it('round-trips a secret and deletes it', async () => {
    const api = createMockApi();
    await expect(api.storage.getSecret('token')).resolves.toBeUndefined();
    await api.storage.setSecret('token', 's3cret');
    await expect(api.storage.getSecret('token')).resolves.toBe('s3cret');
    await api.storage.deleteSecret('token');
    await expect(api.storage.getSecret('token')).resolves.toBeUndefined();
  });

  it('keeps secrets out of the KV keys listing', async () => {
    const api = createMockApi();
    await api.storage.setSecret('token', 's3cret');
    await expect(api.storage.keys()).resolves.toEqual([]);
  });
});

describe('createMockApi().storage.openDatabase — transactions', () => {
  it('invokes the work function', async () => {
    // The regression this whole file exists for: the old mock resolved
    // `undefined` and never called `work`.
    const db = await openDb();
    const work = vi.fn().mockResolvedValue('done');
    await db.transaction(work);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('propagates the work function’s return value', async () => {
    const db = await openDb();
    await expect(db.transaction(async () => 42)).resolves.toBe(42);
  });

  it('propagates the work function’s exception', async () => {
    const db = await openDb();
    const boom = new Error('constraint failed');
    await expect(db.transaction(async () => { throw boom; })).rejects.toBe(boom);
  });

  it('passes a usable transaction handle to the work function', async () => {
    const db = await openDb();
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO plan (id) VALUES (?)', ['p1']);
    });
    expect(db.statements).toEqual([
      { method: 'run', sql: 'INSERT INTO plan (id) VALUES (?)', params: ['p1'] },
    ]);
  });

  it('commits the statements a successful transaction issued', async () => {
    const db = await openDb();
    await db.transaction(async (tx) => {
      await tx.exec('CREATE TABLE plan (id TEXT)');
      await tx.run('INSERT INTO plan (id) VALUES (?)', ['p1']);
    });
    expect(db.statements).toHaveLength(2);
    expect(db.transactions).toEqual([
      { attempted: db.statements, outcome: 'commit' },
    ]);
  });

  it('rolls back the statements a failed transaction issued', async () => {
    const db = await openDb();
    await db.exec('CREATE TABLE plan (id TEXT)');
    await expect(
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO plan (id) VALUES (?)', ['p1']);
        throw new Error('second write failed');
      }),
    ).rejects.toThrow('second write failed');

    // The durable log keeps only the pre-transaction statement...
    expect(db.statements).toEqual([
      { method: 'exec', sql: 'CREATE TABLE plan (id TEXT)', params: [] },
    ]);
    // ...while the attempt itself stays inspectable.
    expect(db.transactions).toHaveLength(1);
    expect(db.transactions[0]?.outcome).toBe('rollback');
    expect(db.transactions[0]?.attempted).toHaveLength(1);
  });

  it('refuses to nest, as the host registry does', async () => {
    const db = await openDb();
    await expect(
      db.transaction(async (tx) => tx.transaction(async () => 1)),
    ).rejects.toThrow(/nested transactions/);
  });

  it('lets a later transaction run after one rolls back', async () => {
    const db = await openDb();
    await expect(db.transaction(async () => { throw new Error('x'); })).rejects.toThrow('x');
    await expect(db.transaction(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('createMockApi().storage.openDatabase — handle semantics', () => {
  it('returns the same handle for the same name', async () => {
    const api = createMockApi();
    const first = await api.storage.openDatabase('main');
    const second = await api.storage.openDatabase('main');
    expect(second).toBe(first);
  });

  it('returns distinct handles for distinct names', async () => {
    const api = createMockApi();
    const main = await api.storage.openDatabase('main');
    const cache = await api.storage.openDatabase('cache');
    expect(cache).not.toBe(main);
  });

  it('throws on use after close, and re-opens fresh', async () => {
    const api = createMockApi();
    const db = (await api.storage.openDatabase('main')) as MockExtensionDatabase;
    await db.exec('CREATE TABLE t (a)');
    await db.close();
    expect(db.isClosed).toBe(true);
    await expect(db.query('SELECT 1')).rejects.toThrow(/is closed/);

    const reopened = (await api.storage.openDatabase('main')) as MockExtensionDatabase;
    expect(reopened).not.toBe(db);
    expect(reopened.statements).toEqual([]);
  });

  it('records query/queryOne calls without pretending to run them', async () => {
    // Honesty check: the mock has no SQL engine, and the empty results are
    // documented. A test that needs rows must override `openDatabase`.
    const db = await openDb();
    await expect(db.query('SELECT * FROM plan')).resolves.toEqual([]);
    await expect(db.queryOne('SELECT * FROM plan')).resolves.toBeUndefined();
    expect(db.statements.map((s) => s.method)).toEqual(['query', 'queryOne']);
  });
});
