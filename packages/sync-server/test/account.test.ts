import { createHash } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  ORIGIN, PREFIX, b64, kdf, makeServer, newCreds, newDevice, signupBody, type Creds, type TestServer,
} from './helpers/server';

// Supertest round-trips are slow when the machine is busy (rate-limit tests make ~30 requests).
vi.setConfig({ testTimeout: 60_000 });

const sha = (b64url: string): Buffer => createHash('sha256').update(Buffer.from(b64url, 'base64url')).digest();

function cookieOf(res: request.Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith('kth_sync='));
}

/** `kth_sync=<token>` for a Cookie header. */
function cookiePair(res: request.Response): string {
  return cookieOf(res)!.split(';')[0];
}

async function signup(t: TestServer, c: Creds = newCreds(), wantToken = true): Promise<{ c: Creds; token: string; res: request.Response }> {
  const res = await request(t.app).post(`${PREFIX}/signup`).send(signupBody(c, wantToken));
  expect(res.status).toBe(201);
  return { c, token: res.body.token, res };
}

function markVerified(t: TestServer, accountId: string): void {
  // Until W2-D's verify-email exists, the test verifies through the store.
  t.sql.execute('UPDATE account SET email_verified = 1, delete_after = NULL WHERE id = ?', [accountId]);
}

async function login(t: TestServer, c: Creds, authKey = c.material.authKey, wantToken = true) {
  return request(t.app).post(`${PREFIX}/login`).send({ email: c.email, authKey, device: c.device, wantToken });
}

describe('info and prelogin', () => {
  it('GET info reports the server settings', async () => {
    const t = makeServer({ signupOpen: false, quotaBytes: 5000, minAge: 13, termsUrl: 'https://x/terms' });
    const res = await request(t.app).get(`${PREFIX}/info`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ apiVersion: 1, signupOpen: false, quotaBytes: 5000, minKdf: { m: 19456, t: 2 },
      minAge: 13, termsUrl: 'https://x/terms' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('unknown email: identical fake params twice, same shape as a real account', async () => {
    const t = makeServer();
    const { c } = await signup(t);
    const real = await request(t.app).post(`${PREFIX}/prelogin`).send({ email: c.email });
    const f1 = await request(t.app).post(`${PREFIX}/prelogin`).send({ email: 'nobody@example.com' });
    const f2 = await request(t.app).post(`${PREFIX}/prelogin`).send({ email: ' NoBody@Example.com ' });
    expect(real.status).toBe(200);
    expect(real.body).toEqual({ kdf: c.material.kdf });
    expect(f1.status).toBe(200);
    expect(f2.body).toEqual(f1.body);
    expect(Object.keys(f1.body)).toEqual(Object.keys(real.body));
    expect(Object.keys(f1.body.kdf)).toEqual(Object.keys(real.body.kdf));
    expect(Buffer.from(f1.body.kdf.salt, 'base64url')).toHaveLength(16);
    expect(f1.body.kdf).toMatchObject({ id: 'argon2id', v: 19, m: 65536, t: 3, p: 1 });
    const other = await request(t.app).post(`${PREFIX}/prelogin`).send({ email: 'other@example.com' });
    expect(other.body.kdf.salt).not.toBe(f1.body.kdf.salt);
    // A different server secret gives a different (but again stable) salt.
    const t2 = makeServer({ serverSecret: new Uint8Array(32).fill(9) });
    const g = await request(t2.app).post(`${PREFIX}/prelogin`).send({ email: 'nobody@example.com' });
    expect(g.body.kdf.salt).not.toBe(f1.body.kdf.salt);
  });

  it('rejects a malformed email and malformed JSON with bad_request', async () => {
    const t = makeServer();
    const a = await request(t.app).post(`${PREFIX}/prelogin`).send({ email: 'not-an-email' });
    expect(a.status).toBe(400);
    expect(a.body.error).toBe('bad_request');
    const b = await request(t.app).post(`${PREFIX}/prelogin`).set('Content-Type', 'application/json').send('{"email":');
    expect(b.status).toBe(400);
    expect(b.body.error).toBe('bad_request');
  });

  it('unknown routes are JSON 404s', async () => {
    const t = makeServer();
    const res = await request(t.app).get(`${PREFIX}/nope`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });
});

describe('signup, login, logout', () => {
  it('signup -> login -> account -> logout (web cookie)', async () => {
    // The agent's cookie jar only sends Secure cookies over https; supertest speaks http.
    const t = makeServer({ cookieSecure: false });
    const c = newCreds('Reader@Example.com');
    const agent = t.agent();
    const su = await agent.post(`${PREFIX}/signup`).set('Origin', ORIGIN).send(signupBody(c));
    expect(su.status).toBe(201);
    expect(su.body).toEqual({
      accountId: c.accountId, emailVerified: false, wrappedAk: c.material.wrappedAkPassword,
      wrappedRecordIdKey: c.material.wrappedRecordIdKey, keysets: c.material.keysets, currentEpoch: 0,
    });
    expect(su.body.token).toBeUndefined();
    expect(cookieOf(su)).toBeDefined();
    markVerified(t, c.accountId);

    const li = await agent.post(`${PREFIX}/login`).set('Origin', ORIGIN)
      .send({ email: 'reader@example.com', authKey: c.material.authKey, device: c.device });
    expect(li.status).toBe(200);
    expect(li.body.emailVerified).toBe(true);
    expect(li.body.wrappedAk).toBe(c.material.wrappedAkPassword);

    const acct = await agent.get(`${PREFIX}/account`);
    expect(acct.status).toBe(200);
    expect(acct.body).toEqual({ email: 'reader@example.com', emailVerified: true, bytesUsed: 0,
      quotaBytes: 100 * 1024 * 1024, createdAt: new Date(t.clock.t).toISOString(), recordCount: 0 });

    const lo = await agent.post(`${PREFIX}/logout`).set('Origin', ORIGIN);
    expect(lo.status).toBe(204);
    expect(cookieOf(lo)).toMatch(/^kth_sync=;.*Max-Age=0/);
    const after = await agent.get(`${PREFIX}/account`);
    expect(after.status).toBe(401);
    expect(after.body.error).toBe('unauthorized');
  });

  it('a second sign-in on the same device replaces its session', async () => {
    const t = makeServer();
    const { c, token } = await signup(t);
    const li = await login(t, c);
    expect(li.status).toBe(200);
    expect((await request(t.app).get(`${PREFIX}/account`).set('Authorization', `Bearer ${token}`)).status).toBe(401);
    expect((await request(t.app).get(`${PREFIX}/account`).set('Authorization', `Bearer ${li.body.token}`)).status).toBe(200);
  });

  it('a taken email is conflict_email with a neutral message; closed signup is signup_closed', async () => {
    const t = makeServer();
    const { c } = await signup(t);
    const dup = await request(t.app).post(`${PREFIX}/signup`).send(signupBody({ ...newCreds(), email: c.email.toUpperCase() }));
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('conflict_email');
    expect(dup.body.message).not.toMatch(/exist|registered|taken/i);
    const closed = makeServer({ signupOpen: false });
    const res = await request(closed.app).post(`${PREFIX}/signup`).send(signupBody(newCreds()));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('signup_closed');
  });

  it('signup validates consent, key material and kdf floor', async () => {
    const t = makeServer();
    const c = newCreds();
    const noConsent = await request(t.app).post(`${PREFIX}/signup`)
      .send({ ...signupBody(c), consent: { terms: true, ageConfirmed: false } });
    expect(noConsent.status).toBe(400);
    const weak = await request(t.app).post(`${PREFIX}/signup`)
      .send(signupBody({ ...c, material: { ...c.material, kdf: { ...kdf(), m: 1024 } } }));
    expect(weak.status).toBe(400);
    const shortKey = await request(t.app).post(`${PREFIX}/signup`)
      .send(signupBody({ ...c, material: { ...c.material, authKey: b64(16) } }));
    expect(shortKey.status).toBe(400);
    const noEpoch = await request(t.app).post(`${PREFIX}/signup`)
      .send(signupBody({ ...c, material: { ...c.material, currentEpoch: 3 } }));
    expect(noEpoch.status).toBe(400);
    expect(t.sql.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM account')!.n).toBe(0);
  });

  it('wrong auth key and unknown email both give the same 401', async () => {
    const t = makeServer();
    const { c } = await signup(t);
    const wrong = await login(t, c, b64(32));
    const unknown = await login(t, { ...c, email: 'ghost@example.com' });
    const malformed = await login(t, c, 'x');
    for (const r of [wrong, unknown, malformed]) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual(wrong.body);
    }
    expect(wrong.body.error).toBe('unauthorized');
  });

  it('the database holds only hashes of tokens and auth keys', async () => {
    const t = makeServer();
    const { c, token } = await signup(t);
    const web = await request(t.app).post(`${PREFIX}/login`)
      .send({ email: c.email, authKey: c.material.authKey, device: newDevice() });
    const cookieToken = cookiePair(web).slice('kth_sync='.length);
    const rows = t.sql.queryAll<{ token_hash: Buffer }>('SELECT token_hash FROM session');
    expect(rows).toHaveLength(2);
    const hashes = rows.map((r) => Buffer.from(r.token_hash).toString('hex')).sort();
    expect(hashes).toEqual([sha(token).toString('hex'), sha(cookieToken).toString('hex')].sort());
    const acct = t.sql.queryOne<{ auth_hash: Buffer; recovery_auth_hash: Buffer }>('SELECT * FROM account')!;
    expect(Buffer.from(acct.auth_hash).equals(sha(c.material.authKey))).toBe(true);
    expect(Buffer.from(acct.recovery_auth_hash).equals(sha(c.material.recoveryAuthKey))).toBe(true);
    // No secret appears anywhere in the database, as text or as raw bytes.
    const dump = t.sql.db.serialize();
    for (const secret of [token, cookieToken, c.material.authKey, c.material.recoveryAuthKey]) {
      expect(dump.includes(Buffer.from(secret))).toBe(false);
      expect(dump.includes(Buffer.from(secret, 'base64url'))).toBe(false);
    }
  });

  it('never logs secrets', async () => {
    const t = makeServer();
    const { c, token } = await signup(t);
    await login(t, c, b64(32));
    const text = JSON.stringify(t.logs);
    for (const s of [token, c.material.authKey, c.material.recoveryAuthKey, c.material.wrappedAkPassword]) {
      expect(text).not.toContain(s);
    }
  });
});

describe('cookie, origin and bearer', () => {
  it('sets kth_sync HttpOnly; SameSite=Lax; Path=/api/sync/v1; Secure', async () => {
    const t = makeServer();
    const res = await request(t.app).post(`${PREFIX}/signup`).set('Origin', ORIGIN).send(signupBody(newCreds()));
    const ck = cookieOf(res)!;
    expect(ck).toMatch(/^kth_sync=[A-Za-z0-9_-]{43};/);
    expect(ck).toContain('HttpOnly');
    expect(ck).toContain('SameSite=Lax');
    expect(ck).toContain('Path=/api/sync/v1');
    expect(ck).toContain('Secure');
    expect(ck).toMatch(/Max-Age=7776000/);
    const dev = makeServer({ cookieSecure: false });
    const r2 = await request(dev.app).post(`${PREFIX}/signup`).send(signupBody(newCreds()));
    expect(cookieOf(r2)).not.toContain('Secure');
  });

  it('cookie-authenticated writes need an allowed Origin', async () => {
    const t = makeServer();
    const c = newCreds();
    const su = await request(t.app).post(`${PREFIX}/signup`).set('Origin', ORIGIN).send(signupBody(c));
    const cookie = cookiePair(su);
    const body = { kind: 'recovery', currentAuthKey: c.material.authKey, recoveryAuthKey: b64(32), wrappedAkRecovery: b64(60) };
    const none = await request(t.app).put(`${PREFIX}/keys`).set('Cookie', cookie).send(body);
    expect(none.status).toBe(403);
    expect(none.body.error).toBe('forbidden');
    const evil = await request(t.app).put(`${PREFIX}/keys`).set('Cookie', cookie).set('Origin', 'https://evil.example').send(body);
    expect(evil.status).toBe(403);
    const logout = await request(t.app).post(`${PREFIX}/logout`).set('Cookie', cookie);
    expect(logout.status).toBe(403);
    // Reads with the cookie need no Origin; a write from the allowed origin passes.
    expect((await request(t.app).get(`${PREFIX}/account`).set('Cookie', cookie)).status).toBe(200);
    const ok = await request(t.app).put(`${PREFIX}/keys`).set('Cookie', cookie).set('Origin', ORIGIN).send(body);
    expect(ok.status).toBe(204);
    // A cross-site login attempt (login CSRF) is refused before any work.
    const csrf = await request(t.app).post(`${PREFIX}/login`).set('Origin', 'https://evil.example')
      .send({ email: c.email, authKey: c.material.authKey, device: c.device });
    expect(csrf.status).toBe(403);
  });

  it('bearer tokens work without Origin and ignore a stray cookie', async () => {
    const t = makeServer();
    const { c, token } = await signup(t);
    const acct = await request(t.app).get(`${PREFIX}/account`).set('Authorization', `Bearer ${token}`);
    expect(acct.status).toBe(200);
    expect(acct.body.email).toBe(c.email);
    const put = await request(t.app).put(`${PREFIX}/keys`).set('Authorization', `Bearer ${token}`)
      .set('Cookie', 'kth_sync=garbage')
      .send({ kind: 'recovery', currentAuthKey: c.material.authKey, recoveryAuthKey: b64(32), wrappedAkRecovery: b64(60) });
    expect(put.status).toBe(204);
    const bad = await request(t.app).get(`${PREFIX}/account`).set('Authorization', `Bearer ${b64(32)}`);
    expect(bad.status).toBe(401);
  });

  it('expired sessions are refused and purged', async () => {
    const t = makeServer();
    const { token } = await signup(t);
    t.clock.advance(91 * 24 * 3600 * 1000);
    expect((await request(t.app).get(`${PREFIX}/account`).set('Authorization', `Bearer ${token}`)).status).toBe(401);
    const purged = await t.server.purgeExpired();
    // The unverified account itself is past its 7-day grace too.
    expect(purged).toEqual({ accounts: 1, tokens: 0, sessions: 0 });
    expect(t.sql.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM session')!.n).toBe(0);
  });
});

describe('recovery and PUT keys', () => {
  it('recover gives a recovery session limited to PUT keys password', async () => {
    const t = makeServer();
    const { c, token: normal } = await signup(t);
    const wrong = await request(t.app).post(`${PREFIX}/recover`)
      .send({ email: c.email, recoveryAuthKey: c.material.authKey, device: c.device, wantToken: true });
    expect(wrong.status).toBe(401);
    const dev2 = newDevice();
    const rc = await request(t.app).post(`${PREFIX}/recover`)
      .send({ email: c.email, recoveryAuthKey: c.material.recoveryAuthKey, device: dev2, wantToken: true });
    expect(rc.status).toBe(200);
    expect(rc.body.wrappedAk).toBe(c.material.wrappedAkRecovery);
    const auth = { Authorization: `Bearer ${rc.body.token}` };

    expect((await request(t.app).get(`${PREFIX}/account`).set(auth)).status).toBe(403);
    const rec = await request(t.app).put(`${PREFIX}/keys`).set(auth)
      .send({ kind: 'recovery', currentAuthKey: c.material.authKey, recoveryAuthKey: b64(32), wrappedAkRecovery: b64(60) });
    expect(rec.status).toBe(403);
    const rot = await request(t.app).put(`${PREFIX}/keys`).set(auth)
      .send({ kind: 'rotate', currentAuthKey: c.material.authKey, material: { ...c.material, currentEpoch: 1 } });
    expect(rot.status).toBe(403);

    const newKey = b64(32);
    const newWrap = b64(60);
    const pw = await request(t.app).put(`${PREFIX}/keys`).set(auth)
      .send({ kind: 'password', currentAuthKey: '', kdf: kdf(), authKey: newKey, wrappedAkPassword: newWrap, signOutOthers: false });
    expect(pw.status).toBe(204);
    // Single use; the other device's session is kept (signOutOthers false).
    expect((await request(t.app).put(`${PREFIX}/keys`).set(auth).send({})).status).toBe(401);
    expect((await request(t.app).get(`${PREFIX}/account`).set('Authorization', `Bearer ${normal}`)).status).toBe(200);
    expect((await login(t, c)).status).toBe(401);
    const li = await login(t, c, newKey);
    expect(li.status).toBe(200);
    expect(li.body.wrappedAk).toBe(newWrap);
  });

  it('password: needs the current key; signOutOthers revokes other sessions', async () => {
    const t = makeServer();
    const { c, token: a } = await signup(t);
    const b = (await request(t.app).post(`${PREFIX}/login`)
      .send({ email: c.email, authKey: c.material.authKey, device: newDevice(), wantToken: true })).body.token as string;
    const newKey = b64(32);
    const body = { kind: 'password', currentAuthKey: b64(32), kdf: kdf(), authKey: newKey, wrappedAkPassword: b64(60), signOutOthers: true };
    const wrongCurrent = await request(t.app).put(`${PREFIX}/keys`).set('Authorization', `Bearer ${a}`).send(body);
    expect(wrongCurrent.status).toBe(403);
    const ok = await request(t.app).put(`${PREFIX}/keys`).set('Authorization', `Bearer ${a}`)
      .send({ ...body, currentAuthKey: c.material.authKey });
    expect(ok.status).toBe(204);
    expect((await request(t.app).get(`${PREFIX}/account`).set('Authorization', `Bearer ${a}`)).status).toBe(200);
    expect((await request(t.app).get(`${PREFIX}/account`).set('Authorization', `Bearer ${b}`)).status).toBe(401);
    const pre = await request(t.app).post(`${PREFIX}/prelogin`).send({ email: c.email });
    expect(pre.body.kdf).toEqual(body.kdf);
    expect((await login(t, c, newKey)).status).toBe(200);
  });

  it('recovery: replaces the recovery key and wrap', async () => {
    const t = makeServer();
    const { c, token } = await signup(t);
    const rk = b64(32);
    const wrap = b64(60);
    const res = await request(t.app).put(`${PREFIX}/keys`).set('Authorization', `Bearer ${token}`)
      .send({ kind: 'recovery', currentAuthKey: c.material.authKey, recoveryAuthKey: rk, wrappedAkRecovery: wrap });
    expect(res.status).toBe(204);
    const old = await request(t.app).post(`${PREFIX}/recover`)
      .send({ email: c.email, recoveryAuthKey: c.material.recoveryAuthKey, device: c.device, wantToken: true });
    expect(old.status).toBe(401);
    const neu = await request(t.app).post(`${PREFIX}/recover`)
      .send({ email: c.email, recoveryAuthKey: rk, device: c.device, wantToken: true });
    expect(neu.status).toBe(200);
    expect(neu.body.wrappedAk).toBe(wrap);
  });

  it('rotate: replaces all keys, advances the epoch and revokes every other session', async () => {
    const t = makeServer();
    const { c, token: a } = await signup(t);
    const b = (await request(t.app).post(`${PREFIX}/login`)
      .send({ email: c.email, authKey: c.material.authKey, device: newDevice(), wantToken: true })).body.token as string;
    const fresh = newCreds(c.email).material;
    const material = { ...fresh, currentEpoch: 1, keysets: [{ epoch: 0, wrappedDataKey: b64(60) }, { epoch: 1, wrappedDataKey: b64(60) }] };
    const auth = { Authorization: `Bearer ${a}` };
    const stale = await request(t.app).put(`${PREFIX}/keys`).set(auth)
      .send({ kind: 'rotate', currentAuthKey: c.material.authKey, material: { ...material, currentEpoch: 0, keysets: [material.keysets[0]] } });
    expect(stale.status).toBe(400);
    const dropped = await request(t.app).put(`${PREFIX}/keys`).set(auth)
      .send({ kind: 'rotate', currentAuthKey: c.material.authKey, material: { ...material, keysets: [material.keysets[1]] } });
    expect(dropped.status).toBe(400);
    const ok = await request(t.app).put(`${PREFIX}/keys`).set(auth)
      .send({ kind: 'rotate', currentAuthKey: c.material.authKey, material });
    expect(ok.status).toBe(204);
    expect((await request(t.app).get(`${PREFIX}/account`).set('Authorization', `Bearer ${b}`)).status).toBe(401);
    expect((await request(t.app).get(`${PREFIX}/account`).set(auth)).status).toBe(200);
    expect((await login(t, c)).status).toBe(401);
    const li = await login(t, c, material.authKey);
    expect(li.status).toBe(200);
    expect(li.body).toMatchObject({ currentEpoch: 1, keysets: material.keysets, wrappedAk: material.wrappedAkPassword,
      wrappedRecordIdKey: material.wrappedRecordIdKey });
    const rc = await request(t.app).post(`${PREFIX}/recover`)
      .send({ email: c.email, recoveryAuthKey: material.recoveryAuthKey, device: c.device, wantToken: true });
    expect(rc.status).toBe(200);
  });
});

describe('rate limits', () => {
  it('per IP: 429 rate_limited with retryAfterSec, reset after the window', async () => {
    const t = makeServer();
    const send = () => request(t.app).post(`${PREFIX}/prelogin`).set('X-Forwarded-For', '203.0.113.5')
      .send({ email: 'a@example.com' });
    for (let i = 0; i < 30; i++) expect((await send()).status).toBe(200);
    const res = await send();
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('rate_limited');
    expect(res.body.retryAfterSec).toBe(600);
    expect(res.headers['retry-after']).toBe('600');
    // Another IP is unaffected.
    expect((await request(t.app).post(`${PREFIX}/prelogin`).set('X-Forwarded-For', '203.0.113.6')
      .send({ email: 'a@example.com' })).status).toBe(200);
    t.clock.advance(10 * 60_000);
    expect((await send()).status).toBe(200);
  });

  it('per email: 429 across many IPs', async () => {
    const t = makeServer();
    const { c } = await signup(t);
    let last: request.Response | undefined;
    for (let i = 0; i < 11; i++) {
      last = await request(t.app).post(`${PREFIX}/login`).set('X-Forwarded-For', `198.51.100.${i + 1}`)
        .send({ email: c.email.toUpperCase(), authKey: b64(32), device: c.device, wantToken: true });
    }
    expect(last!.status).toBe(429);
    expect(last!.body.error).toBe('rate_limited');
    expect(last!.body.retryAfterSec).toBeGreaterThan(0);
    // Even the right key is refused until the window passes.
    const right = await request(t.app).post(`${PREFIX}/login`).set('X-Forwarded-For', '198.51.100.99')
      .send({ email: c.email, authKey: c.material.authKey, device: c.device, wantToken: true });
    expect(right.status).toBe(429);
    t.clock.advance(15 * 60_000);
    const later = await request(t.app).post(`${PREFIX}/login`).set('X-Forwarded-For', '198.51.100.99')
      .send({ email: c.email, authKey: c.material.authKey, device: c.device, wantToken: true });
    expect(later.status).toBe(200);
  });
});

describe('account scoping', () => {
  it("a session of account A never sees account B's data", async () => {
    const t = makeServer();
    const A = await signup(t);
    const B = await signup(t);
    // Give B some records directly through the store-level SQL.
    t.sql.execute('INSERT INTO record (account_id, id, seq, deleted, blob, size) VALUES (?, ?, 1, 0, ?, 3)',
      [B.c.accountId, 'b'.repeat(32), Buffer.from([1, 2, 3])]);
    t.sql.execute('UPDATE account SET bytes_used = 3, next_seq = 2 WHERE id = ?', [B.c.accountId]);
    const a = await request(t.app).get(`${PREFIX}/account`).set('Authorization', `Bearer ${A.token}`);
    expect(a.body).toMatchObject({ email: A.c.email, recordCount: 0, bytesUsed: 0 });
    const b = await request(t.app).get(`${PREFIX}/account`).set('Authorization', `Bearer ${B.token}`);
    expect(b.body).toMatchObject({ email: B.c.email, recordCount: 1, bytesUsed: 3 });
    // A changing keys touches only A.
    await request(t.app).put(`${PREFIX}/keys`).set('Authorization', `Bearer ${A.token}`)
      .send({ kind: 'password', currentAuthKey: A.c.material.authKey, kdf: kdf(), authKey: b64(32), wrappedAkPassword: b64(60), signOutOthers: true });
    expect((await request(t.app).get(`${PREFIX}/account`).set('Authorization', `Bearer ${B.token}`)).status).toBe(200);
    expect((await login(t, B.c)).status).toBe(200);
    // A's login with B's key fails.
    expect((await login(t, A.c, B.c.material.authKey)).status).toBe(401);
  });
});
