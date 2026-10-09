import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSqliteSyncStore } from '../src/store/SqliteSyncStore';
import { SCHEMA_VERSION } from '../src/store/schema';
import { createRateLimiter } from '../src/rateLimit';
import { TestSql } from './helpers/sql';
import { b64, kdf } from './helpers/server';

function setup() {
  const sql = new TestSql();
  const store = createSqliteSyncStore(sql);
  store.migrate();
  const mk = (id = randomBytes(16).toString('hex'), deleteAfter: number | null = null) => {
    store.accounts.create({
      id, email: `${id}@example.com`, emailVerified: false, kdf: kdf(), authHash: new Uint8Array(32).fill(1),
      recoveryAuthHash: new Uint8Array(32).fill(2), wrappedAkPassword: b64(60), wrappedAkRecovery: b64(60),
      wrappedIdk: b64(60), currentEpoch: 0, quotaBytes: null, createdAt: 1000, deleteAfter,
    });
    return id;
  };
  return { sql, store, mk };
}

const blob = (n: number) => randomBytes(n).toString('base64url');

describe('SqliteSyncStore', () => {
  it('migrates once via user_version and refuses a newer schema', () => {
    const { sql, store } = setup();
    expect(sql.queryOne<{ user_version: number }>('PRAGMA user_version')!.user_version).toBe(SCHEMA_VERSION);
    store.migrate();
    sql.execute(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    expect(() => store.migrate()).toThrow(/newer/);
  });

  it('round-trips accounts and applies partial updates', () => {
    const { store, mk } = setup();
    const id = mk();
    const a = store.accounts.byId(id)!;
    expect(a).toMatchObject({ emailVerified: false, nextSeq: 1, bytesUsed: 0, quotaBytes: null });
    expect(a.authHash).toEqual(new Uint8Array(32).fill(1));
    store.accounts.update(id, { emailVerified: true, deleteAfter: null, currentEpoch: 2 });
    expect(store.accounts.byEmail(a.email)).toMatchObject({ emailVerified: true, currentEpoch: 2, kdf: a.kdf });
  });

  it('push: seq rule, conflicts, tombstones, quota, all scoped by account', () => {
    const { store, mk } = setup();
    const A = mk();
    const B = mk();
    const r1 = 'a'.repeat(32);
    const first = store.records.push(A, [{ id: r1, baseSeq: null, deleted: false, blob: blob(10) }], 1000);
    expect(first).toEqual({ accepted: [{ id: r1, seq: 1 }], conflicts: [] });
    // Stale base and "new" for an existing row conflict.
    const stale = store.records.push(A, [{ id: r1, baseSeq: null, deleted: false, blob: blob(5) }], 1000);
    expect(stale).toMatchObject({ accepted: [], conflicts: [{ id: r1, current: { seq: 1, deleted: false } }] });
    const del = store.records.push(A, [{ id: r1, baseSeq: 1, deleted: true, blob: null }], 1000);
    expect(del).toEqual({ accepted: [{ id: r1, seq: 2 }], conflicts: [] });
    expect(store.records.changes(A, 0, 10)).toEqual([{ id: r1, seq: 2, deleted: true, blob: null }]);
    expect(store.accounts.byId(A)!.bytesUsed).toBe(0);
    // B shares nothing with A, and its seqs start at 1.
    expect(store.records.changes(B, 0, 10)).toEqual([]);
    expect(store.records.push(B, [{ id: r1, baseSeq: null, deleted: false, blob: blob(4) }], 1000))
      .toEqual({ accepted: [{ id: r1, seq: 1 }], conflicts: [] });
    expect(store.records.count(A)).toBe(1);
    expect(store.records.count(B)).toBe(1);
    // Quota: the whole batch rolls back.
    const over = store.records.push(A, [
      { id: 'b'.repeat(32), baseSeq: null, deleted: false, blob: blob(600) },
      { id: 'c'.repeat(32), baseSeq: null, deleted: false, blob: blob(600) },
    ], 1000);
    expect(over).toEqual({ error: 'quota_exceeded' });
    expect(store.records.count(A)).toBe(1);
    expect(store.accounts.byId(A)!.nextSeq).toBe(3);
    // Wipe keeps next_seq increasing.
    store.records.wipe(A);
    expect(store.records.count(A)).toBe(0);
    expect(store.records.push(A, [{ id: r1, baseSeq: null, deleted: false, blob: blob(1) }], 1000))
      .toEqual({ accepted: [{ id: r1, seq: 3 }], conflicts: [] });
  });

  it('sessions, devices, keysets, email tokens and purge', () => {
    const { store, mk } = setup();
    const A = mk();
    const B = mk(undefined, 500);
    const h = (n: number) => new Uint8Array(32).fill(n);
    const sess = (hash: Uint8Array, accountId: string, deviceId: string, expiresAt = 10_000) => store.sessions.create({
      tokenHash: hash, accountId, deviceId, kind: 'normal', createdAt: 0, lastSeenAt: 0, expiresAt, userAgent: null });
    sess(h(1), A, 'd1');
    sess(h(2), A, 'd2');
    sess(h(3), A, 'd3', 100);
    sess(h(4), B, 'd1');
    store.sessions.touch(h(1), 50);
    expect(store.sessions.byTokenHash(h(1))).toMatchObject({ accountId: A, lastSeenAt: 50 });
    store.sessions.deleteForDevice(B, 'd2'); // other account: no effect on A
    expect(store.sessions.byTokenHash(h(2))).toBeDefined();
    store.sessions.deleteAllExcept(A, h(1));
    expect(store.sessions.byTokenHash(h(1))).toBeDefined();
    expect(store.sessions.byTokenHash(h(2))).toBeUndefined();
    expect(store.sessions.byTokenHash(h(4))).toBeDefined();

    store.devices.upsert({ id: 'd1', accountId: A, nameSealed: 'x', createdAt: 1 });
    store.devices.upsert({ id: 'd1', accountId: A, nameSealed: 'y', createdAt: 9 });
    store.devices.upsert({ id: 'd1', accountId: B, nameSealed: 'z', createdAt: 1 });
    expect(store.devices.list(A)).toEqual([{ id: 'd1', accountId: A, nameSealed: 'y', createdAt: 1 }]);
    store.devices.delete(A, 'd1');
    expect(store.devices.list(A)).toEqual([]);
    expect(store.sessions.byTokenHash(h(1))).toBeUndefined();
    expect(store.devices.list(B)).toHaveLength(1);

    store.keysets.replaceAll(A, [{ epoch: 1, wrappedDataKey: 'k1' }, { epoch: 0, wrappedDataKey: 'k0' }]);
    expect(store.keysets.list(A)).toEqual([{ epoch: 0, wrappedDataKey: 'k0' }, { epoch: 1, wrappedDataKey: 'k1' }]);
    expect(store.keysets.list(B)).toEqual([]);

    store.emailTokens.create({ tokenHash: h(7), accountId: A, purpose: 'verify', expiresAt: 200 });
    expect(store.emailTokens.consume(h(7), 'reset', 100)).toBeUndefined();
    expect(store.emailTokens.consume(h(7), 'verify', 100)).toMatchObject({ accountId: A, purpose: 'verify' });
    expect(store.emailTokens.consume(h(7), 'verify', 100)).toBeUndefined(); // single use
    store.emailTokens.create({ tokenHash: h(8), accountId: A, purpose: 'reset', expiresAt: 200 });
    store.emailTokens.create({ tokenHash: h(9), accountId: A, purpose: 'reset', expiresAt: 5000 });
    expect(store.emailTokens.consume(h(8), 'reset', 300)).toBeUndefined(); // expired, and removed

    sess(h(5), A, 'd5', 100);
    expect(store.purgeExpired(1000)).toEqual({ accounts: 1, tokens: 0, sessions: 1 });
    expect(store.accounts.byId(B)).toBeUndefined();
    expect(store.sessions.byTokenHash(h(4))).toBeUndefined();
    expect(store.accounts.byId(A)).toBeDefined();
    expect(store.purgeExpired(6000)).toEqual({ accounts: 0, tokens: 1, sessions: 0 });
  });

  it('account delete removes all of its data only', () => {
    const { sql, store, mk } = setup();
    const A = mk();
    const B = mk();
    store.records.push(A, [{ id: 'a'.repeat(32), baseSeq: null, deleted: false, blob: blob(3) }], 1000);
    store.records.push(B, [{ id: 'a'.repeat(32), baseSeq: null, deleted: false, blob: blob(3) }], 1000);
    store.keysets.replaceAll(A, [{ epoch: 0, wrappedDataKey: 'k' }]);
    store.accounts.delete(A);
    for (const t of ['record', 'keyset', 'session', 'device', 'email_token']) {
      expect(sql.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE account_id = ?`, [A])!.n).toBe(0);
    }
    expect(store.records.count(B)).toBe(1);
  });
});

describe('rate limiter', () => {
  it('fixed window with injectable now', () => {
    let t = 0;
    const rl = createRateLimiter(() => t);
    const rule = { windowMs: 1000, max: 2 };
    expect(rl.hit(rule, 'k').ok).toBe(true);
    expect(rl.hit(rule, 'k').ok).toBe(true);
    t = 400;
    expect(rl.hit(rule, 'k')).toEqual({ ok: false, retryAfterSec: 1 });
    expect(rl.hit(rule, 'other').ok).toBe(true);
    t = 1000;
    expect(rl.hit(rule, 'k').ok).toBe(true);
  });
});
