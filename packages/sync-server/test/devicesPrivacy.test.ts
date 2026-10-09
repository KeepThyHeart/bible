import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { ORIGIN, PREFIX } from './helpers/server';
import { account, blob, makeMailServer, rid } from './helpers/flows';

vi.setConfig({ testTimeout: 60_000 });

const dev2 = { id: 'bbbbbbbbbbbbbbbb', nameSealed: blob(30) };

async function secondSession(t: ReturnType<typeof makeMailServer>, a: Awaited<ReturnType<typeof account>>) {
  const res = await request(t.app).post(`${PREFIX}/login`)
    .set('User-Agent', 'TestAgent/2').send({ email: a.c.email, authKey: a.c.material.authKey, device: dev2, wantToken: true });
  expect(res.status).toBe(200);
  return { Authorization: `Bearer ${res.body.token}` };
}

describe('devices', () => {
  it('lists devices with current, user agent and last seen; scoped to the account', async () => {
    const t = makeMailServer();
    const a = await account(t);
    const other = await account(t);
    const h2 = await secondSession(t, a);
    t.clock.advance(120_000);
    await request(t.app).get(`${PREFIX}/account`).set(h2); // touches the session
    const l1 = await request(t.app).get(`${PREFIX}/devices`).set(a.auth);
    expect(l1.status).toBe(200);
    expect(l1.body.devices).toHaveLength(2);
    const mine = l1.body.devices.find((d: { id: string }) => d.id === a.c.device.id);
    const second = l1.body.devices.find((d: { id: string }) => d.id === dev2.id);
    expect(mine).toMatchObject({ current: true, nameSealed: a.c.device.nameSealed });
    expect(second).toMatchObject({ current: false, userAgent: 'TestAgent/2' });
    expect(new Date(second.lastSeenAt).getTime()).toBeGreaterThan(new Date(second.createdAt).getTime());
    const l2 = await request(t.app).get(`${PREFIX}/devices`).set(h2);
    expect(l2.body.devices.find((d: { id: string }) => d.id === dev2.id).current).toBe(true);
    expect((await request(t.app).get(`${PREFIX}/devices`).set(other.auth)).body.devices).toHaveLength(1);
  });

  it('DELETE removes the device and its sessions; unknown, foreign or malformed ids are refused', async () => {
    const t = makeMailServer();
    const a = await account(t);
    const other = await account(t);
    const h2 = await secondSession(t, a);
    // Another account's device id is "not found" for this account and stays intact.
    const foreign = await request(t.app).delete(`${PREFIX}/devices/${other.c.device.id}`).set(a.auth);
    expect(foreign.status).toBe(404);
    expect((await request(t.app).get(`${PREFIX}/devices`).set(other.auth)).body.devices).toHaveLength(1);
    expect((await request(t.app).delete(`${PREFIX}/devices/zz`).set(a.auth)).status).toBe(400);
    expect((await request(t.app).delete(`${PREFIX}/devices/cccccccccccccccc`).set(a.auth)).status).toBe(404);
    const del = await request(t.app).delete(`${PREFIX}/devices/${dev2.id}`).set(a.auth);
    expect(del.status).toBe(204);
    expect((await request(t.app).get(`${PREFIX}/account`).set(h2)).status).toBe(401);
    expect((await request(t.app).get(`${PREFIX}/devices`).set(a.auth)).body.devices).toHaveLength(1);
    expect(t.sql.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM session WHERE device_id = ?', [dev2.id])!.n).toBe(0);
    // Signing out the current device clears the cookie.
    const cookieT = makeMailServer({ cookieSecure: false });
    const c = await account(cookieT);
    const li = await request(cookieT.app).post(`${PREFIX}/login`)
      .send({ email: c.c.email, authKey: c.c.material.authKey, device: dev2 });
    const cookie = (li.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    const self = await request(cookieT.app).delete(`${PREFIX}/devices/${dev2.id}`).set('Cookie', cookie).set('Origin', ORIGIN);
    expect(self.status).toBe(204);
    expect((self.headers['set-cookie'] as unknown as string[])[0]).toMatch(/Max-Age=0/);
  });
});

describe('export', () => {
  it('contains everything the server holds for the account, including tombstones, and nothing of others', async () => {
    const t = makeMailServer();
    const a = await account(t);
    const other = await account(t);
    const [x, y] = [rid(), rid()];
    await request(t.app).post(`${PREFIX}/push`).set(a.auth).send({ records: [
      { id: x, baseSeq: null, deleted: false, blob: blob(40) }, { id: y, baseSeq: null, deleted: false, blob: blob(30) }] });
    await request(t.app).post(`${PREFIX}/push`).set(a.auth).send({ records: [{ id: y, baseSeq: 2, deleted: true, blob: null }] });
    await request(t.app).post(`${PREFIX}/push`).set(other.auth).send({ records: [{ id: rid(), baseSeq: null, deleted: false, blob: blob(5) }] });
    const res = await request(t.app).get(`${PREFIX}/export`).set(a.auth);
    expect(res.status).toBe(200);
    const pulled = await request(t.app).get(`${PREFIX}/changes`).set(a.auth);
    const acct = await request(t.app).get(`${PREFIX}/account`).set(a.auth);
    const devs = await request(t.app).get(`${PREFIX}/devices`).set(a.auth);
    expect(res.body).toEqual({
      format: 'kth-sync-export', version: 1,
      account: { ...acct.body, accountId: a.c.accountId, kdf: a.c.material.kdf },
      devices: devs.body.devices, keysets: a.c.material.keysets, records: pulled.body.records,
    });
    expect(res.body.records).toHaveLength(2);
    expect(res.body.records.some((r: { deleted: boolean }) => r.deleted)).toBe(true);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(a.c.material.authKey);
    expect(text).not.toContain(a.c.material.recoveryAuthKey);
    expect(text).not.toContain(a.token);
    expect((await request(t.app).get(`${PREFIX}/export`)).status).toBe(401);
  });
});

describe('delete account', () => {
  it('needs a valid auth key, then removes every row of that account only', async () => {
    const t = makeMailServer();
    const a = await account(t);
    const other = await account(t);
    await request(t.app).post(`${PREFIX}/push`).set(a.auth).send({ records: [{ id: rid(), baseSeq: null, deleted: false, blob: blob(40) }] });
    await request(t.app).post(`${PREFIX}/push`).set(other.auth).send({ records: [{ id: rid(), baseSeq: null, deleted: false, blob: blob(40) }] });
    await secondSession(t, a);
    const none = await request(t.app).delete(`${PREFIX}/account`).set(a.auth);
    expect(none.status).toBe(403);
    const wrong = await request(t.app).delete(`${PREFIX}/account`).set(a.auth).send({ authKey: blob(32) });
    expect(wrong.status).toBe(403);
    expect((await request(t.app).get(`${PREFIX}/account`).set(a.auth)).status).toBe(200);
    // The recovery key is not the auth key.
    const rk = await request(t.app).delete(`${PREFIX}/account`).set(a.auth).send({ authKey: a.c.material.recoveryAuthKey });
    expect(rk.status).toBe(403);
    // Another account's key does not work either.
    const foreign = await request(t.app).delete(`${PREFIX}/account`).set(a.auth).send({ authKey: other.c.material.authKey });
    expect(foreign.status).toBe(403);
    const ok = await request(t.app).delete(`${PREFIX}/account`).set(a.auth).send({ authKey: a.c.material.authKey });
    expect(ok.status).toBe(204);
    for (const tbl of ['account', 'record', 'keyset', 'device', 'session', 'email_token']) {
      const col = tbl === 'account' ? 'id' : 'account_id';
      expect(t.sql.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM ${tbl} WHERE ${col} = ?`, [a.c.accountId])!.n, tbl).toBe(0);
    }
    expect((await request(t.app).get(`${PREFIX}/account`).set(a.auth)).status).toBe(401);
    expect((await request(t.app).post(`${PREFIX}/login`).send({ email: a.c.email, authKey: a.c.material.authKey, device: a.c.device })).status).toBe(401);
    expect((await request(t.app).get(`${PREFIX}/changes`).set(other.auth)).body.records).toHaveLength(1);
    // The address can be registered again.
    const again = await request(t.app).post(`${PREFIX}/signup`).send({
      email: a.c.email, accountId: rid(), material: a.c.material, device: a.c.device, consent: { terms: true, ageConfirmed: true } });
    expect(again.status).toBe(201);
  });
});
