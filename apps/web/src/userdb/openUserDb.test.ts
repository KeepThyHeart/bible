// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { createUserDbHandler } from './handler';
import { openUserDb, resetSahPoolForTests, type SahPool } from './openUserDb';

let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>;
beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
}, 60_000);
beforeEach(() => resetSahPoolForTests());

function fakePool(): SahPool & { wiped: number } {
  const pool = {
    wiped: 0,
    OpfsSAHPoolDb: class { constructor(_f: string) { return new sqlite3.oo1.DB(':memory:'); } } as unknown as SahPool['OpfsSAHPoolDb'],
    async wipeFiles() { pool.wiped++; },
  };
  return pool;
}

describe('openUserDb pool memoisation', () => {
  it('initialises once; open -> wipe -> open reuses the same pool', async () => {
    const pool = fakePool();
    const init = vi.fn(async () => pool);
    const first = await openUserDb(init);
    await first.wipe();
    const second = await openUserDb(init);
    expect(init).toHaveBeenCalledTimes(1);
    expect(pool.wiped).toBe(1);
    expect(second.sql.queryOne<{ n: number }>('SELECT 1 AS n')?.n).toBe(1);
  });

  it('a wipe through the handler reopens a fresh database and writes the import marker', async () => {
    const pool = fakePool();
    const init = vi.fn(async () => pool);
    const handler = createUserDbHandler({ open: () => openUserDb(init), emit: () => undefined });
    await handler.handle({ op: 'open' });
    await handler.handle({ op: 'wipe' });
    await handler.handle({ op: 'open' });
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('a failed init is not remembered, so a retry can succeed', async () => {
    const pool = fakePool();
    const init = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(pool);
    await expect(openUserDb(init)).rejects.toThrow('boom');
    await expect(openUserDb(init)).resolves.toBeTruthy();
    expect(init).toHaveBeenCalledTimes(2);
  });
});
