// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

// The coordinator adds `UserRepositories` to the browser barrel; until then (and harmlessly after) supply it directly.
vi.mock('@bible/core/browser', async (orig) => ({
  ...(await orig<object>()),
  UserRepositories: await import('../../../../packages/core/src/Data/Repositories/userRepositories'),
}));

// Stands in for a repo that cannot be built (repos are lazy: only its own calls may fail).
vi.mock('./annotationsRepo', () => ({ createAnnotationsRepo: () => { throw new Error('annotations unavailable'); } }));

import { createUserDbHandler, type ExtCtx, type UserDbHandlerOptions } from './handler';
import { finishOpen } from './openUserDb';
import type { UserDbEvent } from './protocol';

let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>;
beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
}, 60_000);

function setup(extra: Partial<UserDbHandlerOptions> = {}) {
  const events: UserDbEvent[] = [];
  let opens = 0;
  const handler = createUserDbHandler({
    open: async () => {
      opens++;
      return finishOpen(new sqlite3.oo1.DB(':memory:'), ':memory:');
    },
    emit: (e) => events.push(e),
    ...extra,
  });
  return { handler, events, opens: () => opens };
}

describe('user-DB handler', () => {
  it('opens once, runs repository calls through the wasm ISql, and emits changed for writes only', async () => {
    const { handler, events, opens } = setup();
    await handler.handle({ op: 'open' });
    await handler.handle({ op: 'open' });
    expect(opens()).toBe(1);
    const item = { ownerUuid: 'app:test', collection: 'c', itemKey: 'k', value: '"v"', valueType: 'json', sortOrder: 0 };
    expect(events).toEqual([]);
    await handler.handle({ op: 'call', repo: 'userData', method: 'put', args: [item] });
    expect(events).toEqual([{ event: 'changed', tables: ['user_data_item', 'verse_link'] }]);
    const got = (await handler.handle({ op: 'call', repo: 'userData', method: 'get', args: ['app:test', 'c', 'k'] })) as { value: string };
    expect(got.value).toBe('"v"');
    const listed = (await handler.handle({ op: 'call', repo: 'userData', method: 'list', args: ['app:test', 'c'] })) as unknown[];
    expect(listed).toHaveLength(1);
    expect(events).toHaveLength(1); // reads raised nothing
  }, 60_000);

  it('answers unknown repos / methods / unimplemented ops with coded errors', async () => {
    const { handler } = setup();
    const code = async (p: Promise<unknown>) => handler.fail(await p.then(() => null, (e) => e)).code;
    expect(await code(handler.handle({ op: 'call', repo: 'prayer', method: 'x', args: [] }))).toBe('unknown_repo');
    expect(await code(handler.handle({ op: 'call', repo: 'notes', method: 'nope', args: [] }))).toBe('unknown_method');
    expect(await code(handler.handle({ op: 'call', repo: 'notes', method: '_private', args: [] }))).toBe('unknown_method');
    expect(await code(handler.handle({ op: 'sync', action: 'syncNow' }))).toBe('not_implemented');
  }, 60_000);

  it('wipe closes the db and the next call reopens a fresh one', async () => {
    const { handler, events, opens } = setup();
    await handler.handle({ op: 'open' });
    await handler.handle({ op: 'wipe' });
    expect(events[0]).toMatchObject({ event: 'changed' });
    await handler.handle({ op: 'open' });
    expect(opens()).toBe(2);
  }, 60_000);

  it('wipe is a barrier: a request issued mid-wipe waits and runs against the fresh db, never the old handle', async () => {
    const dbs: Array<ReturnType<typeof finishOpen>> = [];
    let releaseWipe!: () => void;
    const wipeGate = new Promise<void>((r) => (releaseWipe = r));
    let wipeStarted!: () => void;
    const started = new Promise<void>((r) => (wipeStarted = r));
    const handler = createUserDbHandler({
      open: async () => {
        const idx = dbs.length;
        const db = finishOpen(new sqlite3.oo1.DB(':memory:'), ':memory:', idx === 0 ? async () => { wipeStarted(); await wipeGate; } : undefined);
        dbs.push(db);
        return db;
      },
      emit: () => {},
    });
    await handler.handle({ op: 'open' });
    const old = dbs[0];
    const oldQueries: string[] = [];
    const origQ = old.sql.queryAll.bind(old.sql);
    old.sql.queryAll = ((q: string, p?: never) => { oldQueries.push(q); return origQ(q, p); }) as typeof old.sql.queryAll;
    const wiping = handler.handle({ op: 'wipe' });
    await started;
    const during = handler.handle({ op: 'call', repo: 'notes', method: 'getAll', args: [] });
    await new Promise((r) => setTimeout(r, 20));
    expect(dbs).toHaveLength(1); // no second open while the old files are being wiped
    releaseWipe();
    await wiping;
    expect(await during).toEqual([]);
    expect(dbs).toHaveLength(2);
    expect(oldQueries).toEqual([]);
    // the marker is in the fresh db
    expect(dbs[1].sql.queryOne("SELECT value FROM setting WHERE category = 'web' AND key = 'userData.importedFromIdb'")).toBeTruthy();
  }, 60_000);

  it('a request whose first open is still in flight when a wipe starts ends on the fresh db (no repos on the wiped handle)', async () => {
    const dbs: Array<ReturnType<typeof finishOpen>> = [];
    let releaseOpen!: () => void;
    const openGate = new Promise<void>((r) => (releaseOpen = r));
    const handler = createUserDbHandler({
      open: async () => {
        const idx = dbs.length;
        const db = finishOpen(new sqlite3.oo1.DB(':memory:'), ':memory:');
        dbs.push(db);
        if (idx === 0) await openGate;
        return db;
      },
      emit: () => {},
    });
    const first = handler.handle({ op: 'call', repo: 'notes', method: 'getAll', args: [] });
    await new Promise((r) => setTimeout(r, 10));
    const wiping = handler.handle({ op: 'wipe' });
    releaseOpen();
    await wiping;
    expect(await first).toEqual([]);
    const oldQueries: string[] = [];
    const origQ = dbs[0].sql.queryAll.bind(dbs[0].sql);
    dbs[0].sql.queryAll = ((q: string, p?: never) => { oldQueries.push(q); return origQ(q, p); }) as typeof origQ;
    expect(await handler.handle({ op: 'call', repo: 'notes', method: 'getAll', args: [] })).toEqual([]);
    expect(oldQueries).toEqual([]);
    expect(dbs).toHaveLength(2);
  }, 60_000);

  it('a request whose in-flight open fails while a wipe replaces it retries on the fresh db (R3 L-1)', async () => {
    let n = 0;
    let failOpen!: (e: Error) => void;
    const handler = createUserDbHandler({
      open: async () => {
        if (n++ === 0) await new Promise<never>((_r, rej) => (failOpen = rej));
        return finishOpen(new sqlite3.oo1.DB(':memory:'), ':memory:');
      },
      emit: () => {},
    });
    const first = handler.handle({ op: 'call', repo: 'notes', method: 'getAll', args: [] });
    await new Promise((r) => setTimeout(r, 10));
    const wiping = handler.handle({ op: 'wipe' });
    failOpen(new Error('stale open failed'));
    await wiping;
    expect(await first).toEqual([]);
    expect(n).toBe(2);
  }, 60_000);

  it('a failed open with no wipe is reported to the caller once, not retried in a loop; the next request retries', async () => {
    let n = 0;
    const handler = createUserDbHandler({
      open: async () => {
        if (n++ === 0) throw new Error('access handle busy');
        return finishOpen(new sqlite3.oo1.DB(':memory:'), ':memory:');
      },
      emit: () => {},
    });
    await expect(handler.handle({ op: 'call', repo: 'notes', method: 'getAll', args: [] })).rejects.toThrow(/access handle busy/);
    expect(n).toBe(1);
    expect(await handler.handle({ op: 'call', repo: 'notes', method: 'getAll', args: [] })).toEqual([]);
    expect(n).toBe(2);
  }, 60_000);

  it('reports writes to onLocalWrite (not reads, not reserveIds-style change-free calls)', async () => {
    const writes: string[][] = [];
    const { handler } = setup({ onLocalWrite: (t) => writes.push(t) });
    const item = { ownerUuid: 'app:test', collection: 'c', itemKey: 'k', value: '1', valueType: 'json', sortOrder: 0 };
    await handler.handle({ op: 'call', repo: 'userData', method: 'put', args: [item] });
    await handler.handle({ op: 'call', repo: 'userData', method: 'get', args: ['app:test', 'c', 'k'] });
    expect(writes).toEqual([['user_data_item', 'verse_link']]);
  }, 60_000);

  it('builds repos lazily: a repo that cannot be built fails only its own calls', async () => {
    const { handler } = setup();
    await expect(handler.handle({ op: 'call', repo: 'annotations', method: 'getChapter', args: [1, 1, 2] })).rejects.toThrow(/annotations unavailable/);
    expect(await handler.handle({ op: 'call', repo: 'notes', method: 'getAll', args: [] })).toEqual([]);
    const code = async (p: Promise<unknown>) => handler.fail(await p.then(() => null, (e) => e)).code;
    expect(await code(handler.handle({ op: 'call', repo: 'notes', method: 'toString', args: [] }))).toBe('unknown_method');
    expect(await code(handler.handle({ op: 'call', repo: 'toString' as never, method: 'x', args: [] }))).toBe('unknown_repo');
  }, 60_000);

  it('gives extensions an ExtCtx whose wipe deletes the db, runs onWipe and emits changed', async () => {
    const onWipe = vi.fn(async () => undefined);
    let ctxSeen: ExtCtx | undefined;
    const { handler, events, opens } = setup({
      onWipe,
      extensions: { sync: async (_r, ctx) => { ctxSeen = ctx; await ctx.wipe(); return 'wiped'; } },
    });
    expect(await handler.handle({ op: 'sync', action: 'status' })).toBe('wiped');
    expect(typeof ctxSeen?.sql.execute).toBe('function');
    expect(onWipe).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({ event: 'changed' });
    await handler.handle({ op: 'open' });
    expect(opens()).toBe(2);
    await handler.handle({ op: 'wipe' });
    expect(onWipe).toHaveBeenCalledTimes(2);
  }, 60_000);

  it('hostCall emits an event and resolves on hostReply; late replies are ignored', async () => {
    const { handler, events } = setup({
      extensions: { sync: async (_r, ctx) => ctx.hostCall('memory.bible', 'listBooks', ['KJV']) },
    });
    const pending = handler.handle({ op: 'sync', action: 'status' });
    await vi.waitFor(() => expect(events.some((e) => e.event === 'hostCall')).toBe(true));
    const call = events.find((e) => e.event === 'hostCall') as Extract<UserDbEvent, { event: 'hostCall' }>;
    expect(call).toMatchObject({ api: 'memory.bible', method: 'listBooks', args: ['KJV'] });
    await handler.handle({ op: 'hostReply', callId: call.callId, ok: true, value: [1, 2] });
    expect(await pending).toEqual([1, 2]);
    expect(await handler.handle({ op: 'hostReply', callId: call.callId, ok: true, value: 'late' })).toBeNull();
  }, 60_000);
});
