import { createHash } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { consoleEmailSender, createSmtpEmailSender } from '../src';
import type { MailTransport } from '../src';
import { PREFIX, b64, newCreds, newDevice, signupBody } from './helpers/server';
import { account, blob, sealed, makeMailServer, rid, tokenIn } from './helpers/flows';

vi.setConfig({ testTimeout: 60_000 });

const sha = (b64url: string): string => createHash('sha256').update(Buffer.from(b64url, 'base64url')).digest('hex');
const HOUR = 60 * 60 * 1000;

describe('verify-email', () => {
  it('signup mails a link; the token verifies once, clears deleteAfter and is stored hashed', async () => {
    const t = makeMailServer();
    const a = await account(t, false);
    expect(t.mail.sent).toHaveLength(1);
    const m = t.mail.sent[0];
    expect(m).toMatchObject({ to: a.c.email, subject: 'Confirm your email address' });
    expect(m.text).toContain('https://bible.example/account/verify-email#token=');
    const token = tokenIn(m);
    const row = t.sql.queryOne<{ email_verified: number; delete_after: number | null }>('SELECT * FROM account')!;
    expect(row).toMatchObject({ email_verified: 0 });
    expect(row.delete_after).not.toBeNull();
    const stored = t.sql.queryAll<{ token_hash: Buffer }>('SELECT token_hash FROM email_token');
    expect(stored.map((r) => r.token_hash.toString('hex'))).toEqual([sha(token)]);
    expect(t.sql.db.serialize().includes(Buffer.from(token))).toBe(false);
    expect(t.sql.db.serialize().includes(Buffer.from(token, 'base64url'))).toBe(false);

    const ok = await request(t.app).post(`${PREFIX}/verify-email`).send({ token });
    expect(ok.status).toBe(204);
    expect(t.sql.queryOne<{ email_verified: number; delete_after: number | null }>('SELECT * FROM account'))
      .toMatchObject({ email_verified: 1, delete_after: null });
    expect((await request(t.app).get(`${PREFIX}/account`).set(a.auth)).body.emailVerified).toBe(true);
    const again = await request(t.app).post(`${PREFIX}/verify-email`).send({ token });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('bad_request');
  });

  it('expires after 24 hours, rejects junk, and a verified account survives the purge', async () => {
    const t = makeMailServer();
    const a = await account(t, false);
    const token = tokenIn(t.mail.sent[0]);
    t.clock.advance(24 * HOUR + 1);
    expect((await request(t.app).post(`${PREFIX}/verify-email`).send({ token })).status).toBe(400);
    for (const bad of [undefined, 'short', blob(32).replace(/.$/, '!'), 123, b64(32)]) {
      expect((await request(t.app).post(`${PREFIX}/verify-email`).send({ token: bad })).status).toBe(400);
    }
    expect(a.c.email).toBeTruthy();

    const u = makeMailServer();
    await account(u, false);
    const v = await account(u, true);
    u.clock.advance(8 * 24 * HOUR);
    const purged = await u.server.purgeExpired();
    expect(purged.accounts).toBe(1);
    expect(u.sql.queryAll<{ id: string }>('SELECT id FROM account').map((r) => r.id)).toEqual([v.c.accountId]);
    expect(u.sql.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM email_token')!.n).toBe(0);
  });

  it('a reset token is not accepted for verification and vice versa', async () => {
    const t = makeMailServer();
    const a = await account(t, false);
    const verifyTok = tokenIn(t.mail.sent[0]);
    await request(t.app).post(`${PREFIX}/reset`).send({ email: a.c.email });
    const resetTok = tokenIn(t.mail.sent[1]);
    expect((await request(t.app).post(`${PREFIX}/verify-email`).send({ token: resetTok })).status).toBe(400);
    const c = newCreds();
    expect((await request(t.app).post(`${PREFIX}/reset/confirm`)
      .send({ token: verifyTok, accountId: c.accountId, material: c.material, device: c.device })).status).toBe(400);
  });
});

describe('reset', () => {
  it('always answers 204; mails only an existing account; one token at a time; hashed; rate limited', async () => {
    const t = makeMailServer();
    const a = await account(t);
    const before = t.mail.sent.length;
    const known = await request(t.app).post(`${PREFIX}/reset`).send({ email: a.c.email.toUpperCase() });
    const unknown = await request(t.app).post(`${PREFIX}/reset`).send({ email: 'ghost@example.com' });
    expect(known.status).toBe(204);
    expect(unknown.status).toBe(204);
    expect(known.text).toBe(unknown.text);
    expect(Object.keys(known.headers).sort()).toEqual(Object.keys(unknown.headers).sort());
    expect(t.mail.sent).toHaveLength(before + 1);
    const m = t.mail.sent[before];
    expect(m.to).toBe(a.c.email);
    expect(m.text).toContain('/account/reset-password#token=');
    const tok1 = tokenIn(m);
    // A second request replaces the first token.
    await request(t.app).post(`${PREFIX}/reset`).send({ email: a.c.email });
    const tok2 = tokenIn(t.mail.sent[before + 1]);
    const rows = t.sql.queryAll<{ token_hash: Buffer }>("SELECT token_hash FROM email_token WHERE purpose = 'reset'");
    expect(rows.map((r) => r.token_hash.toString('hex'))).toEqual([sha(tok2)]);
    const c = newCreds();
    expect((await request(t.app).post(`${PREFIX}/reset/confirm`)
      .send({ token: tok1, accountId: c.accountId, material: c.material, device: c.device })).status).toBe(400);
    // Per-address limit applies the same to known and unknown addresses (5 per hour: 2 used for known).
    for (const email of [a.c.email, 'ghost@example.com']) {
      let last = 204;
      for (let i = 0; i < 6; i++) last = (await request(t.app).post(`${PREFIX}/reset`).send({ email })).status;
      expect(last).toBe(429);
    }
    expect(t.mail.sent.length).toBeLessThanOrEqual(before + 5);
    expect((await request(t.app).post(`${PREFIX}/reset`).send({ email: 'bad' })).status).toBe(400);
  });

  it('confirm wipes records, keysets, devices and sessions, installs the new material and signs in', async () => {
    const t = makeMailServer();
    const a = await account(t);
    const other = await account(t);
    const second = await request(t.app).post(`${PREFIX}/login`)
      .send({ email: a.c.email, authKey: a.c.material.authKey, device: newDevice(), wantToken: true });
    const id = rid();
    await request(t.app).post(`${PREFIX}/push`).set(a.auth)
      .send({ records: [{ id, baseSeq: null, deleted: false, blob: sealed() }] });
    await request(t.app).post(`${PREFIX}/push`).set(other.auth)
      .send({ records: [{ id: rid(), baseSeq: null, deleted: false, blob: sealed() }] });
    const rec = await request(t.app).post(`${PREFIX}/recover`).send({
      email: a.c.email, recoveryAuthKey: a.c.material.recoveryAuthKey, device: newDevice(), wantToken: true });
    expect(rec.status).toBe(200);

    await request(t.app).post(`${PREFIX}/reset`).send({ email: a.c.email });
    const token = tokenIn(t.mail.sent[t.mail.sent.length - 1]);
    const n = newCreds();
    n.material = { ...n.material, currentEpoch: 3, keysets: [{ epoch: 3, wrappedDataKey: b64(60) }] };
    const conf = await request(t.app).post(`${PREFIX}/reset/confirm`)
      .send({ token, accountId: n.accountId, material: n.material, device: n.device, wantToken: true });
    expect(conf.status).toBe(200);
    expect(Object.keys(conf.body)).toEqual(['accountId', 'emailVerified', 'wrappedAk', 'wrappedRecordIdKey', 'keysets', 'currentEpoch', 'token']);
    expect(conf.body).toMatchObject({
      accountId: n.accountId, emailVerified: true, wrappedAk: n.material.wrappedAkPassword,
      wrappedRecordIdKey: n.material.wrappedRecordIdKey, keysets: n.material.keysets, currentEpoch: 3,
    });
    const h = { Authorization: `Bearer ${conf.body.token}` };

    // Old sessions are gone; only the new one works.
    for (const old of [a.token, second.body.token, rec.body.token]) {
      expect((await request(t.app).get(`${PREFIX}/account`).set({ Authorization: `Bearer ${old}` })).status).toBe(401);
    }
    expect((await request(t.app).get(`${PREFIX}/account`).set(h)).body).toMatchObject({ bytesUsed: 0, recordCount: 0 });
    expect((await request(t.app).get(`${PREFIX}/changes`).set(h)).body.records).toEqual([]);
    expect((await request(t.app).get(`${PREFIX}/devices`).set(h)).body.devices.map((d: { id: string }) => d.id))
      .toEqual([n.device.id]);
    // Old credentials stop working; new ones and the new prelogin params work.
    const oldLogin = await request(t.app).post(`${PREFIX}/login`).send({ email: a.c.email, authKey: a.c.material.authKey, device: a.c.device });
    expect(oldLogin.status).toBe(401);
    const oldRec = await request(t.app).post(`${PREFIX}/recover`).send({ email: a.c.email, recoveryAuthKey: a.c.material.recoveryAuthKey, device: a.c.device });
    expect(oldRec.status).toBe(401);
    const newLogin = await request(t.app).post(`${PREFIX}/login`).send({ email: a.c.email, authKey: n.material.authKey, device: n.device, wantToken: true });
    expect(newLogin.status).toBe(200);
    expect((await request(t.app).post(`${PREFIX}/prelogin`).send({ email: a.c.email })).body.kdf).toEqual(n.material.kdf);
    expect(t.sql.queryAll('SELECT epoch FROM keyset WHERE account_id = ?', [n.accountId])).toEqual([{ epoch: 3 }]);
    expect(t.sql.queryOne('SELECT id FROM account WHERE id = ?', [a.c.accountId])).toBeUndefined();
    expect(t.sql.queryOne<{ next_seq: number }>('SELECT next_seq FROM account WHERE id = ?', [n.accountId])!.next_seq).toBe(2);
    // Seqs keep increasing after a wipe, and the other account is untouched.
    // (logging in again on the same device replaced the reset session)
    const next = await request(t.app).post(`${PREFIX}/push`).set({ Authorization: `Bearer ${newLogin.body.token}` })
      .send({ records: [{ id, baseSeq: null, deleted: false, blob: sealed() }] });
    expect(next.body.accepted[0].seq).toBeGreaterThan(1);
    expect((await request(t.app).get(`${PREFIX}/changes`).set(other.auth)).body.records).toHaveLength(1);
    // The new id must be free.
    await request(t.app).post(`${PREFIX}/reset`).send({ email: a.c.email });
    const tok3 = tokenIn(t.mail.sent[t.mail.sent.length - 1]);
    const clash = await request(t.app).post(`${PREFIX}/reset/confirm`)
      .send({ token: tok3, accountId: other.c.accountId, material: n.material, device: n.device });
    expect(clash.status).toBe(400);
    const badId = await request(t.app).post(`${PREFIX}/reset/confirm`)
      .send({ token: tok3, accountId: 'nope', material: n.material, device: n.device });
    expect(badId.status).toBe(400);
    // Single use.
    const replay = await request(t.app).post(`${PREFIX}/reset/confirm`).send({ token, accountId: n.accountId, material: n.material, device: n.device });
    expect(replay.status).toBe(400);
  });

  it('confirm: expires after 1 hour, validates before spending the token, verifies an unverified account, sets the cookie', async () => {
    const t = makeMailServer({ cookieSecure: false });
    const a = await account(t, false);
    await request(t.app).post(`${PREFIX}/reset`).send({ email: a.c.email });
    const token = tokenIn(t.mail.sent[t.mail.sent.length - 1]);
    const n = newCreds();
    const badMaterial = await request(t.app).post(`${PREFIX}/reset/confirm`)
      .send({ token, accountId: n.accountId, material: { ...n.material, authKey: 'x' }, device: n.device });
    expect(badMaterial.status).toBe(400);
    const ok = await request(t.app).post(`${PREFIX}/reset/confirm`).send({ token, accountId: n.accountId, material: n.material, device: n.device });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeUndefined();
    expect((ok.headers['set-cookie'] as unknown as string[])[0]).toMatch(/^kth_sync=[A-Za-z0-9_-]{43};.*HttpOnly/);
    expect(ok.body.emailVerified).toBe(true);
    expect(t.sql.queryOne<{ delete_after: number | null }>('SELECT delete_after FROM account')!.delete_after).toBeNull();

    await request(t.app).post(`${PREFIX}/reset`).send({ email: a.c.email });
    const late = tokenIn(t.mail.sent[t.mail.sent.length - 1]);
    t.clock.advance(HOUR + 1);
    const m2 = newCreds();
    expect((await request(t.app).post(`${PREFIX}/reset/confirm`).send({ token: late, accountId: m2.accountId, material: m2.material, device: m2.device })).status).toBe(400);
  });

  it('never logs tokens or keys', async () => {
    const t = makeMailServer();
    const a = await account(t);
    await request(t.app).post(`${PREFIX}/reset`).send({ email: a.c.email });
    const token = tokenIn(t.mail.sent[t.mail.sent.length - 1]);
    const n = newCreds();
    await request(t.app).post(`${PREFIX}/reset/confirm`).send({ token, accountId: n.accountId, material: n.material, device: n.device });
    const text = JSON.stringify(t.logs);
    for (const s of [token, n.material.authKey, a.c.material.authKey]) expect(text).not.toContain(s);
  });
});

describe('signup does not reveal registered addresses', () => {
  async function cookieOrToken(res: request.Response): Promise<string> {
    return res.body.token ?? (res.headers['set-cookie'] as unknown as string[])[0];
  }

  for (const wantToken of [true, false]) {
    it(`identical response shape for a new and a taken address (wantToken=${wantToken})`, async () => {
      const t = makeMailServer({ cookieSecure: false });
      const owner = await account(t, true, 'owner@example.com');
      const fresh = newCreds('fresh@example.com');
      const dupe = newCreds('OWNER@example.com');
      const r1 = await request(t.app).post(`${PREFIX}/signup`).send(signupBody(fresh, wantToken));
      const accountsBefore = t.sql.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM account')!.n;
      const sessionsBefore = t.sql.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM session')!.n;
      const devicesBefore = t.sql.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM device')!.n;
      const r2 = await request(t.app).post(`${PREFIX}/signup`).send(signupBody(dupe, wantToken));
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect(Object.keys(r2.body)).toEqual(Object.keys(r1.body));
      expect(r2.body).toEqual({
        accountId: dupe.accountId, emailVerified: false, wrappedAk: dupe.material.wrappedAkPassword,
        wrappedRecordIdKey: dupe.material.wrappedRecordIdKey, keysets: dupe.material.keysets, currentEpoch: 0,
        ...(wantToken ? { token: r2.body.token } : {}),
      });
      const shape = (s: string) => s.replace(/[A-Za-z0-9_-]{43}/, 'T');
      expect(shape(await cookieOrToken(r2))).toBe(shape(await cookieOrToken(r1)));
      expect(Object.keys(r2.headers).sort()).toEqual(Object.keys(r1.headers).sort());
      // Nothing was created.
      expect(t.sql.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM account')!.n).toBe(accountsBefore);
      expect(t.sql.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM session')!.n).toBe(sessionsBefore);
      expect(t.sql.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM device')!.n).toBe(devicesBefore);
      expect(t.sql.queryOne('SELECT id FROM account WHERE id = ?', [dupe.accountId])).toBeUndefined();
      // The decoy credential is worthless, and the original account still works unchanged.
      const decoy = r2.body.token ?? (r2.headers['set-cookie'] as unknown as string[])[0].split(';')[0].slice('kth_sync='.length);
      expect((await request(t.app).get(`${PREFIX}/account`).set({ Authorization: `Bearer ${decoy}` })).status).toBe(401);
      const li = await request(t.app).post(`${PREFIX}/login`)
        .send({ email: owner.c.email, authKey: owner.c.material.authKey, device: owner.c.device, wantToken: true });
      expect(li.status).toBe(200);
      expect((await request(t.app).post(`${PREFIX}/login`)
        .send({ email: owner.c.email, authKey: dupe.material.authKey, device: dupe.device })).status).toBe(401);
    });
  }

  it('mails the existing owner at most once per hour per address', async () => {
    const t = makeMailServer();
    await account(t, true, 'owner@example.com');
    const base = t.mail.sent.length;
    for (let i = 0; i < 3; i++) {
      const r = await request(t.app).post(`${PREFIX}/signup`).send(signupBody(newCreds('owner@example.com'), true));
      expect(r.status).toBe(201);
    }
    const notices = t.mail.sent.slice(base);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ to: 'owner@example.com', subject: 'Sign-up attempt with your address' });
    expect(notices[0].text).toMatch(/sign in|reset your password/i);
    expect(notices[0].text).not.toMatch(/#token=/);
    t.clock.advance(HOUR + 1);
    await request(t.app).post(`${PREFIX}/signup`).send(signupBody(newCreds('owner@example.com'), true));
    expect(t.mail.sent.slice(base)).toHaveLength(2);
    // Only the owner is mailed, never the would-be registrant's (same address) twice for a new signup.
    expect(t.sql.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM account')!.n).toBe(1);
  });

  it('an expired unverified account frees its address; closed signup is still signup_closed', async () => {
    const t = makeMailServer();
    await account(t, false, 'late@example.com');
    t.clock.advance(8 * 24 * HOUR);
    const c = newCreds('late@example.com');
    const r = await request(t.app).post(`${PREFIX}/signup`).send(signupBody(c, true));
    expect(r.status).toBe(201);
    expect(t.sql.queryOne('SELECT id FROM account WHERE id = ?', [c.accountId])).toBeDefined();
    const closed = makeMailServer({ signupOpen: false });
    expect((await request(closed.app).post(`${PREFIX}/signup`).send(signupBody(newCreds()))).body.error).toBe('signup_closed');
  });
});

describe('email adapters', () => {
  it('console adapter writes the message and nothing else', async () => {
    const lines: string[] = [];
    await consoleEmailSender((l) => lines.push(l)).send({ to: 'a@b.c', subject: 'Hi', text: 'body link' });
    expect(lines.join('\n')).toContain('a@b.c');
    expect(lines.join('\n')).toContain('Hi');
    expect(lines.join('\n')).toContain('body link');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await consoleEmailSender().send({ to: 'a@b.c', subject: 'S', text: 'T' });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('SMTP adapter hands the message to the injected transport', async () => {
    const sent: unknown[] = [];
    let closed = false;
    let opts: unknown;
    const s = createSmtpEmailSender({ host: 'smtp.example', port: 587, user: 'u', pass: 'p', from: 'Bible <no@reply>' }, (o) => {
      opts = o;
      return { sendMail: async (m) => { sent.push(m); }, close: () => { closed = true; } } satisfies MailTransport;
    });
    await s.send({ to: 'a@b.c', subject: 'Subj', text: 'T', html: '<p>T</p>' });
    await s.send({ to: 'a@b.c', subject: 'Plain', text: 'T' });
    expect(sent).toEqual([
      { from: 'Bible <no@reply>', to: 'a@b.c', subject: 'Subj', text: 'T', html: '<p>T</p>' },
      { from: 'Bible <no@reply>', to: 'a@b.c', subject: 'Plain', text: 'T' },
    ]);
    expect(opts).toMatchObject({ host: 'smtp.example', port: 587 });
    await expect(s.send({ to: 'a@b.c\nBcc: x@y.z', subject: 'S', text: 'T' })).rejects.toThrow();
    s.close();
    expect(closed).toBe(true);
  });

  it('SMTP failures surface to the caller; the server logs only the error name and signup still succeeds', async () => {
    const failing = createSmtpEmailSender({ host: 'h', port: 25, from: 'f@x' }, () => ({
      sendMail: async () => { throw Object.assign(new Error('secret-password-in-message'), { name: 'SmtpDown' }); },
    }));
    await expect(failing.send({ to: 'a@b.c', subject: 's', text: 't' })).rejects.toThrow();
    const t = makeMailServer({ email: failing });
    const res = await request(t.app).post(`${PREFIX}/signup`).send(signupBody(newCreds(), true));
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 20));
    expect(JSON.stringify(t.logs)).toContain('SmtpDown');
    expect(JSON.stringify(t.logs)).not.toContain('secret-password');
  });
});

describe('resend-verification and device name', () => {
  it('resend: always 204, mails only an unverified existing account, replaces the old token, shares the bucket', async () => {
    const t = makeMailServer();
    const a = await account(t, false);
    const v = await account(t, true);
    const base = t.mail.sent.length;
    const old = tokenIn(t.mail.sent[0]);
    const r1 = await request(t.app).post(`${PREFIX}/resend-verification`).send({ email: a.c.email });
    const r2 = await request(t.app).post(`${PREFIX}/resend-verification`).send({ email: v.c.email });
    const r3 = await request(t.app).post(`${PREFIX}/resend-verification`).send({ email: 'ghost@example.com' });
    for (const r of [r1, r2, r3]) expect(r.status).toBe(204);
    expect(t.mail.sent).toHaveLength(base + 1);
    expect(t.mail.sent[base]).toMatchObject({ to: a.c.email, subject: 'Confirm your email address' });
    expect((await request(t.app).post(`${PREFIX}/verify-email`).send({ token: old })).status).toBe(400);
    expect((await request(t.app).post(`${PREFIX}/verify-email`).send({ token: tokenIn(t.mail.sent[base]) })).status).toBe(204);
    for (const email of [a.c.email, 'ghost@example.com']) {
      let last = 204;
      for (let i = 0; i < 6; i++) last = (await request(t.app).post(`${PREFIX}/resend-verification`).send({ email })).status;
      expect(last).toBe(429);
    }
    expect((await request(t.app).post(`${PREFIX}/resend-verification`).send({ email: 'bad' })).status).toBe(400);
  });

  it('PUT devices/current renames only the session\'s own device; validates; refuses recovery sessions', async () => {
    const t = makeMailServer();
    const a = await account(t);
    const other = await account(t);
    const name = blob(40);
    const res = await request(t.app).put(`${PREFIX}/devices/current`).set(a.auth).send({ nameSealed: name });
    expect(res.status).toBe(204);
    const devs = (await request(t.app).get(`${PREFIX}/devices`).set(a.auth)).body.devices;
    expect(devs).toHaveLength(1);
    expect(devs[0]).toMatchObject({ id: a.c.device.id, nameSealed: name, current: true });
    expect((await request(t.app).get(`${PREFIX}/devices`).set(other.auth)).body.devices[0].nameSealed)
      .toBe(other.c.device.nameSealed);
    for (const bad of [{}, { nameSealed: '' }, { nameSealed: 'not b64!' }, { nameSealed: 'A'.repeat(2000) }, { nameSealed: 5 }]) {
      expect((await request(t.app).put(`${PREFIX}/devices/current`).set(a.auth).send(bad)).status).toBe(400);
    }
    expect((await request(t.app).put(`${PREFIX}/devices/current`).send({ nameSealed: name })).status).toBe(401);
    const rec = await request(t.app).post(`${PREFIX}/recover`).send({
      email: a.c.email, recoveryAuthKey: a.c.material.recoveryAuthKey, device: newDevice(), wantToken: true });
    expect((await request(t.app).put(`${PREFIX}/devices/current`)
      .set({ Authorization: `Bearer ${rec.body.token}` }).send({ nameSealed: name })).status).toBe(403);
  });
});
