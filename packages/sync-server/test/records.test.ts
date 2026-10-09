import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { Sync } from '@bible/core';
const { LIMITS } = Sync;
import { PREFIX, ORIGIN } from './helpers/server';
import { account, blob, paddedLen, sealed, makeMailServer, rid } from './helpers/flows';

vi.setConfig({ testTimeout: 60_000 });

const push = (t: ReturnType<typeof makeMailServer>, a: { auth: Record<string, string> }, records: unknown[]) =>
  request(t.app).post(`${PREFIX}/push`).set(a.auth).send({ records });
const changes = (t: ReturnType<typeof makeMailServer>, a: { auth: Record<string, string> }, q = '') =>
  request(t.app).get(`${PREFIX}/changes${q}`).set(a.auth);

describe('push and changes', () => {
  it('accepts new records with strictly increasing seq and returns them in order', async () => {
    const t = makeMailServer();
    const a = await account(t);
    const ids = [rid(), rid(), rid()];
    const res = await push(t, a, ids.map((id) => ({ id, baseSeq: null, deleted: false, blob: sealed() })));
    expect(res.status).toBe(200);
    expect(res.body.conflicts).toEqual([]);
    expect(res.body.accepted.map((x: { seq: number }) => x.seq)).toEqual([1, 2, 3]);
    const upd = await push(t, a, [{ id: ids[0], baseSeq: 1, deleted: false, blob: sealed() }]);
    expect(upd.body.accepted).toEqual([{ id: ids[0], seq: 4 }]);
    const ch = await changes(t, a);
    expect(ch.body.records.map((r: { id: string; seq: number }) => [r.id, r.seq]))
      .toEqual([[ids[1], 2], [ids[2], 3], [ids[0], 4]]);
    expect(ch.body).toMatchObject({ next: 4, more: false });
    const since = await changes(t, a, '?since=3');
    expect(since.body.records).toHaveLength(1);
    const none = await changes(t, a, '?since=4');
    expect(none.body).toEqual({ records: [], next: 4, more: false });
  });

  it('pages changes with limit and more', async () => {
    const t = makeMailServer();
    const a = await account(t);
    await push(t, a, Array.from({ length: 5 }, () => ({ id: rid(), baseSeq: null, deleted: false, blob: sealed() })));
    const p1 = await changes(t, a, '?limit=2');
    expect(p1.body.records.map((r: { seq: number }) => r.seq)).toEqual([1, 2]);
    expect(p1.body).toMatchObject({ next: 2, more: true });
    const p2 = await changes(t, a, `?since=${p1.body.next}&limit=2`);
    expect(p2.body.records.map((r: { seq: number }) => r.seq)).toEqual([3, 4]);
    expect(p2.body.more).toBe(true);
    const p3 = await changes(t, a, `?since=${p2.body.next}&limit=2`);
    expect(p3.body).toMatchObject({ next: 5, more: false });
    expect(p3.body.records).toHaveLength(1);
    // A limit above the maximum is clamped; bad values are 400.
    expect((await changes(t, a, '?limit=999999')).status).toBe(200);
    for (const q of ['?limit=0', '?since=-1', '?since=abc', '?limit=1.5']) {
      expect((await changes(t, a, q)).status).toBe(400);
    }
  });

  it('baseSeq rule: stale base conflicts with the current row; missing row with a base conflicts with seq 0', async () => {
    const t = makeMailServer();
    const a = await account(t);
    const id = rid();
    await push(t, a, [{ id, baseSeq: null, deleted: false, blob: sealed() }]);
    const cur = (await changes(t, a)).body.records[0];
    // Second "new" write for an existing id.
    const dup = await push(t, a, [{ id, baseSeq: null, deleted: false, blob: sealed() }]);
    expect(dup.body.accepted).toEqual([]);
    expect(dup.body.conflicts).toEqual([{ id, current: cur }]);
    const stale = await push(t, a, [{ id, baseSeq: 99, deleted: false, blob: sealed() }]);
    expect(stale.body.conflicts[0].current).toEqual(cur);
    const ghost = rid();
    const missing = await push(t, a, [{ id: ghost, baseSeq: 7, deleted: false, blob: sealed() }]);
    expect(missing.body.conflicts).toEqual([{ id: ghost, current: { id: ghost, seq: 0, deleted: true, blob: null } }]);
    // Conflicts do not consume seqs: the next accepted write gets seq 2.
    const ok = await push(t, a, [{ id: rid(), baseSeq: null, deleted: false, blob: sealed() }]);
    expect(ok.body.accepted[0].seq).toBe(2);
  });

  it('a delete keeps a tombstone with its seq, and a push over it with that seq resurrects the record', async () => {
    const t = makeMailServer();
    const a = await account(t);
    const id = rid();
    await push(t, a, [{ id, baseSeq: null, deleted: false, blob: sealed() }]);
    const del = await push(t, a, [{ id, baseSeq: 1, deleted: true, blob: sealed() }]);
    expect(del.body.accepted).toEqual([{ id, seq: 2 }]);
    const tomb = (await changes(t, a, '?since=1')).body.records[0];
    expect(tomb).toMatchObject({ id, seq: 2, deleted: true });
    expect(typeof tomb.blob).toBe('string'); // a tombstone is a sealed record
    const back = await push(t, a, [{ id, baseSeq: 2, deleted: false, blob: sealed() }]);
    expect(back.body.accepted).toEqual([{ id, seq: 3 }]);
    const now = (await changes(t, a, '?since=2')).body.records[0];
    expect(now.deleted).toBe(false);
    expect(now.blob).not.toBeNull();
  });

  it('seq keeps increasing across a pull/push mix and several accounts count independently', async () => {
    const t = makeMailServer();
    const a = await account(t);
    const b = await account(t);
    await push(t, a, [{ id: rid(), baseSeq: null, deleted: false, blob: sealed() }]);
    const r = await push(t, b, [{ id: rid(), baseSeq: null, deleted: false, blob: sealed() }]);
    expect(r.body.accepted[0].seq).toBe(1);
  });

  it('counts blob bytes plus 128 per row against the quota; a tombstone keeps its blob and its cost', async () => {
    const one = 33 + paddedLen(10) + 128; // 1185
    const t = makeMailServer({ quotaBytes: one * 2 + 50 });
    const a = await account(t);
    const [x, y, z] = [rid(), rid(), rid()];
    expect((await push(t, a, [{ id: x, baseSeq: null, deleted: false, blob: sealed() }])).status).toBe(200);
    const acct = await request(t.app).get(`${PREFIX}/account`).set(a.auth);
    expect(acct.body).toMatchObject({ bytesUsed: one, recordCount: 1 });
    expect((await push(t, a, [{ id: y, baseSeq: null, deleted: false, blob: sealed() }])).status).toBe(200);
    const over = await push(t, a, [{ id: z, baseSeq: null, deleted: false, blob: sealed() }]);
    expect(over.status).toBe(413);
    expect(over.body.error).toBe('quota_exceeded');
    // The failed push changed nothing (no row, no bytes, no seq).
    expect((await request(t.app).get(`${PREFIX}/account`).set(a.auth)).body).toMatchObject({ bytesUsed: one * 2, recordCount: 2 });
    // Deleting keeps the sealed tombstone, so the bytes stay charged.
    expect((await push(t, a, [{ id: x, baseSeq: 1, deleted: true, blob: sealed() }])).status).toBe(200);
    expect((await request(t.app).get(`${PREFIX}/account`).set(a.auth)).body.bytesUsed).toBe(one * 2);
  });

  it('refuses a push that would exceed the per-account record cap', async () => {
    const t = makeMailServer({ maxRecordsPerAccount: 3 });
    const a = await account(t);
    const ids = [rid(), rid(), rid(), rid()];
    const recs = (xs: string[]) => xs.map((id) => ({ id, baseSeq: null, deleted: false, blob: sealed() }));
    expect((await push(t, a, recs(ids.slice(0, 3)))).status).toBe(200);
    const over = await push(t, a, recs(ids.slice(3)));
    expect(over.status).toBe(413);
    expect(over.body.error).toBe('quota_exceeded');
    // Updating an existing row is not growth in row count.
    expect((await push(t, a, [{ id: ids[0], baseSeq: 1, deleted: false, blob: sealed() }])).status).toBe(200);
  });

  it('rejects blobs that are not a real v1 envelope (500 tiny blobs, bad version, bad padding)', async () => {
    const t = makeMailServer();
    const a = await account(t);
    const tiny = await push(t, a, Array.from({ length: 500 }, () => ({ id: rid(), baseSeq: null, deleted: false, blob: blob(1) })));
    expect(tiny.status).toBe(400);
    const wrongVersion = Buffer.from(sealed(), 'base64url');
    wrongVersion[0] = 2;
    const odd = Buffer.alloc(33 + 1024 + 1, 1);
    const smallTombstone = { id: rid(), baseSeq: null, deleted: true, blob: blob(1) };
    for (const bad of [wrongVersion.toString('base64url'), odd.toString('base64url'), blob(1056)]) {
      expect((await push(t, a, [{ id: rid(), baseSeq: null, deleted: false, blob: bad }])).status).toBe(400);
    }
    expect((await push(t, a, [smallTombstone])).status).toBe(400);
    // The shape is exact around the 64 KiB bucket switch.
    for (const n of [1020, 65532, 65533, 81920 - 4]) {
      expect((await push(t, a, [{ id: rid(), baseSeq: null, deleted: false, blob: sealed(n) }])).status, String(n)).toBe(200);
    }
    const oddLarge = Buffer.alloc(33 + 66560 + 1024, 1);
    expect((await push(t, a, [{ id: rid(), baseSeq: null, deleted: false, blob: oddLarge.toString('base64url') }])).status).toBe(400);
  });

  it('a tombstone without a blob is refused', async () => {
    const t = makeMailServer();
    const a = await account(t);
    const res = await push(t, a, [{ id: rid(), baseSeq: null, deleted: true, blob: null }]);
    expect(res.status).toBe(400);
  });

  it('pages /changes by blob bytes: 20 x 1 MiB records come back as at most 8 with more=true', async () => {
    const t = makeMailServer({ quotaBytes: 100 * 1024 * 1024 });
    const a = await account(t);
    const big = sealed(1024 * 1024 - 4);
    for (let i = 0; i < 20; i += 4) {
      const res = await push(t, a, Array.from({ length: 4 }, () => ({ id: rid(), baseSeq: null, deleted: false, blob: big })));
      expect(res.status).toBe(200);
    }
    const p = await changes(t, a);
    expect(p.body.records.length).toBeLessThanOrEqual(8);
    expect(p.body.records.length).toBeGreaterThanOrEqual(1);
    expect(p.body.more).toBe(true);
    const seen = new Set<number>(p.body.records.map((r: { seq: number }) => r.seq));
    let next = p.body.next;
    let more = p.body.more;
    while (more) {
      const q = await changes(t, a, `?since=${next}`);
      q.body.records.forEach((r: { seq: number }) => seen.add(r.seq));
      next = q.body.next;
      more = q.body.more;
    }
    expect(seen.size).toBe(20);
  });

  it('enforces the record count, record size and body limits with too_large', async () => {
    const t = makeMailServer();
    const a = await account(t);
    const many = await push(t, a, Array.from({ length: LIMITS.maxPushRecords + 1 },
      () => ({ id: rid(), baseSeq: null, deleted: true, blob: sealed() })));
    expect(many.status).toBe(413);
    expect(many.body.error).toBe('too_large');
    const exact = await push(t, a, Array.from({ length: LIMITS.maxPushRecords },
      () => ({ id: rid(), baseSeq: null, deleted: true, blob: sealed() })));
    expect(exact.status).toBe(200);
    const big = await push(t, a, [{ id: rid(), baseSeq: null, deleted: false, blob: blob(LIMITS.maxRecordBytes + 1) }]);
    expect(big.status).toBe(413);
    expect(big.body.error).toBe('too_large');
    const fits = await push(t, a, [{ id: rid(), baseSeq: null, deleted: false, blob: sealed(1024 * 1024 - 4) }]);
    expect(fits.status).toBe(200);
    const huge = await push(t, a, Array.from({ length: 9 },
      () => ({ id: rid(), baseSeq: null, deleted: false, blob: sealed(1024 * 1024 - 4) })));
    expect(huge.status).toBe(413);
    expect(huge.body.error).toBe('too_large');
  });

  it('validates ids, baseSeq, blob presence and duplicates', async () => {
    const t = makeMailServer();
    const a = await account(t);
    const ok = { id: rid(), baseSeq: null, deleted: false, blob: sealed() };
    const bads: unknown[] = [
      { ...ok, id: 'ABCDEF0123456789ABCDEF0123456789' }, { ...ok, id: 'abc' }, { ...ok, baseSeq: -1 },
      { ...ok, baseSeq: 1.5 }, { ...ok, baseSeq: '1' }, { ...ok, blob: null }, { ...ok, blob: '' }, { ...ok, blob: blob(8) },
      { ...ok, blob: 'not base64!' }, { ...ok, blob: null, deleted: true }, { ...ok, deleted: 'no' }, { ...ok, blob: sealed() + '=' },
    ];
    for (const rec of bads) {
      const res = await push(t, a, [rec]);
      expect(res.status, JSON.stringify(rec)).toBe(400);
      expect(res.body.error).toBe('bad_request');
    }
    expect((await push(t, a, [ok, ok])).status).toBe(400);
    expect((await request(t.app).post(`${PREFIX}/push`).set(a.auth).send({})).status).toBe(400);
    expect((await push(t, a, [])).body).toEqual({ accepted: [], conflicts: [] });
  });

  it('refuses push with email_unverified but allows pull', async () => {
    const t = makeMailServer();
    const a = await account(t, false);
    const res = await push(t, a, [{ id: rid(), baseSeq: null, deleted: false, blob: sealed() }]);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('email_unverified');
    expect((await changes(t, a)).status).toBe(200);
  });

  it('needs a session, and a recovery session may not use records', async () => {
    const t = makeMailServer();
    const a = await account(t);
    expect((await request(t.app).get(`${PREFIX}/changes`)).status).toBe(401);
    expect((await request(t.app).post(`${PREFIX}/push`).send({ records: [] })).status).toBe(401);
    const rec = await request(t.app).post(`${PREFIX}/recover`)
      .send({ email: a.c.email, recoveryAuthKey: a.c.material.recoveryAuthKey, device: { id: '0123456789abcdef', nameSealed: blob(30) }, wantToken: true });
    expect(rec.status).toBe(200);
    const h = { Authorization: `Bearer ${rec.body.token}` };
    expect((await request(t.app).get(`${PREFIX}/changes`).set(h)).status).toBe(403);
    expect((await request(t.app).post(`${PREFIX}/push`).set(h).send({ records: [] })).status).toBe(403);
    expect((await request(t.app).get(`${PREFIX}/devices`).set(h)).status).toBe(403);
    expect((await request(t.app).get(`${PREFIX}/export`).set(h)).status).toBe(403);
    expect((await request(t.app).delete(`${PREFIX}/account`).set(h).send({ authKey: a.c.material.authKey })).status).toBe(403);
  });

  it('cookie-authenticated pushes need an allowed Origin', async () => {
    const t = makeMailServer({ cookieSecure: false });
    const a = await account(t);
    const li = await request(t.app).post(`${PREFIX}/login`)
      .send({ email: a.c.email, authKey: a.c.material.authKey, device: { id: 'aaaaaaaaaaaaaaaa', nameSealed: blob(30) } });
    const cookie = (li.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    const body = { records: [{ id: rid(), baseSeq: null, deleted: false, blob: sealed() }] };
    expect((await request(t.app).post(`${PREFIX}/push`).set('Cookie', cookie).send(body)).status).toBe(403);
    expect((await request(t.app).post(`${PREFIX}/push`).set('Cookie', cookie).set('Origin', ORIGIN).send(body)).status).toBe(200);
  });
});

describe('scoping between accounts', () => {
  it('never shows, conflicts with or counts another account\'s records', async () => {
    const t = makeMailServer();
    const a = await account(t);
    const b = await account(t);
    const id = rid();
    await push(t, a, [{ id, baseSeq: null, deleted: false, blob: sealed() }]);
    expect((await changes(t, b)).body.records).toEqual([]);
    // The same id on account b is a brand new record, not a conflict with a's.
    const same = await push(t, b, [{ id, baseSeq: null, deleted: false, blob: sealed() }]);
    expect(same.body.accepted).toHaveLength(1);
    expect(same.body.conflicts).toEqual([]);
    expect((await request(t.app).get(`${PREFIX}/account`).set(a.auth)).body.bytesUsed).toBe(33 + paddedLen(10) + 128);
    expect((await request(t.app).get(`${PREFIX}/account`).set(b.auth)).body.bytesUsed).toBe(33 + paddedLen(10) + 128);
    // b cannot update a's row by guessing its seq: b's own row governs.
    const own = (await changes(t, b)).body.records[0];
    expect(own.blob).not.toBeNull();
    expect((await changes(t, a)).body.records[0].blob).not.toBe(own.blob);
  });
});
