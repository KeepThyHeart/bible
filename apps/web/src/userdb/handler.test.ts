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
