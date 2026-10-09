// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

// The coordinator adds `UserRepositories` to the browser barrel; until then (and harmlessly after) supply it directly.
vi.mock('@bible/core/browser', async (orig) => ({
  ...(await orig<object>()),
  UserRepositories: await import('../../../../packages/core/src/Data/Repositories/userRepositories'),
}));

import { createUserDbHandler } from './handler';
import { finishOpen } from './openUserDb';
import type { UserDbEvent } from './protocol';

let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>;
beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
}, 60_000);

function setup() {
  const events: UserDbEvent[] = [];
  let opens = 0;
  const handler = createUserDbHandler({
    open: async () => {
      opens++;
      return finishOpen(new sqlite3.oo1.DB(':memory:'), ':memory:');
    },
    emit: (e) => events.push(e),
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
});
