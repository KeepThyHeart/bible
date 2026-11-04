/** Security review R1 regressions: M1 signup oracle, M2 limiter, M5 export, L1 deferred mail, L2 lockout, L3, L7, L13. */
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { Crypto } from '@bible/core';
import { createRateLimiter, RATE_LIMITS } from '../src/rateLimit';
import { limiterIp } from '../src/http';
import { normaliseEmail } from '../src/auth/validate';
import { PREFIX, b64, kdf, makeServer, newCreds, signupBody } from './helpers/server';
import { account, makeMailServer, rid, sealed, tokenIn } from './helpers/flows';

vi.setConfig({ testTimeout: 60_000 });

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

describe('M1: signup does not tell taken addresses from free ones', () => {
  it('an attacker-owned accountId gets the identical 400 for a taken and a free address', async () => {
    const t = makeMailServer();
    const victim = await account(t);
    const attacker = await account(t);
    const taken = newCreds(victim.c.email);
    taken.accountId = attacker.c.accountId;
    const free = newCreds();
    free.accountId = attacker.c.accountId;
    const r1 = await request(t.app).post(`${PREFIX}/signup`).send(signupBody(taken));
    const r2 = await request(t.app).post(`${PREFIX}/signup`).send(signupBody(free));
    expect(r1.status).toBe(400);
    expect(r2.status).toBe(400);
    expect(r1.body).toEqual(r2.body);
  });

  it('signup mail work happens after the response, for new and taken addresses', async () => {
    const t = makeMailServer();
    const victim = await account(t);
    await tick();
    const before = t.mail.sent.length;
    let sentAtEnd = -1;
    const app = express();
    app.set('trust proxy', true);
    app.use(PREFIX, (_req, res, next) => {
      const end = res.end.bind(res) as (...a: unknown[]) => unknown;
      (res as unknown as { end: unknown }).end = (...a: unknown[]) => { sentAtEnd = t.mail.sent.length; return end(...a); };
      next();
    }, t.server.router);
    const dup = newCreds(victim.c.email);
    expect((await request(app).post(`${PREFIX}/signup`).send(signupBody(dup))).status).toBe(201);
    expect(sentAtEnd).toBe(before);
    await tick();
    expect(t.mail.sent.length).toBe(before + 1);
    const fresh = newCreds();
    expect((await request(app).post(`${PREFIX}/signup`).send(signupBody(fresh))).status).toBe(201);
    expect(sentAtEnd).toBe(before + 1);
    await tick();
    expect(t.mail.sent.length).toBe(before + 2);
  });
});

describe('M2: limiter bounds', () => {
  it('never holds more windows than its cap, after a million distinct keys', () => {
    const lim = createRateLimiter(() => 1, 100_000);
    let peak = 0;
    for (let i = 0; i < 1_000_000; i++) {
      lim.hit(RATE_LIMITS.ipAll, `ip:${i}`);
      if (i % 50_000 === 0) peak = Math.max(peak, lim.size());
    }
    expect(Math.max(peak, lim.size())).toBeLessThanOrEqual(100_000);
  });

  it('hashes very long keys', () => {
    const lim = createRateLimiter();
    const key = 'x'.repeat(10_000);
    expect(lim.hit(RATE_LIMITS.export, key).ok).toBe(true);
    expect(lim.peek(RATE_LIMITS.export, key).ok).toBe(true);
  });

  it('keys IPv6 by /64 and IPv4-mapped addresses as IPv4', async () => {
    expect(limiterIp('2001:db8:1:2::1')).toBe(limiterIp('2001:0db8:0001:0002:ffff:ffff:ffff:9'));
    expect(limiterIp('2001:db8:1:3::1')).not.toBe(limiterIp('2001:db8:1:2::1'));
    expect(limiterIp('::ffff:203.0.113.5')).toBe('203.0.113.5');
    expect(limiterIp('203.0.113.5')).toBe('203.0.113.5');
    const t = makeServer();
    const send = (ip: string) => request(t.app).post(`${PREFIX}/prelogin`).set('X-Forwarded-For', ip).send({ email: 'a@example.com' });
    for (let i = 0; i < 30; i++) expect((await send(`2001:db8:1:2::${i + 1}`)).status).toBe(200);
    expect((await send('2001:db8:1:2:aaaa::9')).status).toBe(429);
    expect((await send('2001:db8:1:3::1')).status).toBe(200);
  });
});

describe('M5: export', () => {
  it('streams many records page by page, equal to /changes, and is limited to 3 per hour', async () => {
    const t = makeMailServer();
    const a = await account(t);
    for (let i = 0; i < 3; i++) {
      const recs = Array.from({ length: 100 }, () => ({ id: rid(), baseSeq: null, deleted: false, blob: sealed() }));
      expect((await request(t.app).post(`${PREFIX}/push`).set(a.auth).send({ records: recs })).status).toBe(200);
    }
    const ex = await request(t.app).get(`${PREFIX}/export`).set(a.auth);
    expect(ex.status).toBe(200);
    expect(Object.keys(ex.body)).toEqual(['format', 'version', 'account', 'devices', 'keysets', 'records']);
    expect(ex.body.records).toHaveLength(300);
    const all: unknown[] = [];
    let since = 0;
    for (;;) {
      const p = await request(t.app).get(`${PREFIX}/changes?since=${since}&limit=100`).set(a.auth);
      all.push(...p.body.records);
      since = p.body.next;
      if (!p.body.more) break;
    }
    expect(ex.body.records).toEqual(all);
    expect((await request(t.app).get(`${PREFIX}/export`).set(a.auth)).status).toBe(200);
    expect((await request(t.app).get(`${PREFIX}/export`).set(a.auth)).status).toBe(200);
    const fourth = await request(t.app).get(`${PREFIX}/export`).set(a.auth);
    expect(fourth.status).toBe(429);
    t.clock.advance(60 * 60_000);
    expect((await request(t.app).get(`${PREFIX}/export`).set(a.auth)).status).toBe(200);
  });
});

describe('L1: reset and resend-verification do their store and mail work after the response', () => {
  it('no token write has happened when the response ends, for known and unknown addresses', async () => {
    const t = makeMailServer();
    const a = await account(t);
    const unv = await account(t, false);
    await tick();
    const count = () => t.sql.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM email_token')!.n;
    let atEnd = -1;
    const app = express();
    app.set('trust proxy', true);
    app.use(PREFIX, (_req, res, next) => {
      const end = res.end.bind(res) as (...x: unknown[]) => unknown;
      (res as unknown as { end: unknown }).end = (...x: unknown[]) => { atEnd = count(); return end(...x); };
      next();
    }, t.server.router);
    const base = count();
    expect((await request(app).post(`${PREFIX}/reset`).send({ email: a.c.email })).status).toBe(204);
    expect(atEnd).toBe(base);
    await tick();
    expect(count()).toBe(base + 1);
    expect((await request(app).post(`${PREFIX}/reset`).send({ email: 'ghost@example.com' })).status).toBe(204);
    expect(atEnd).toBe(base + 1);
    await tick();
    expect(count()).toBe(base + 1);
    t.mail.sent.length = 0;
    expect((await request(app).post(`${PREFIX}/resend-verification`).send({ email: unv.c.email })).status).toBe(204);
    expect(atEnd).toBe(base + 1);
    await tick();
    expect(t.mail.sent.filter((m) => m.to === unv.c.email)).toHaveLength(1);
  });
});

describe('L2: lockout needs failures, per (email, IP)', () => {
  it('junk reset requests from one IP do not block the owner from another IP', async () => {
    const t = makeMailServer();
    const a = await account(t);
    const reset = (ip: string) => request(t.app).post(`${PREFIX}/reset`).set('X-Forwarded-For', ip).send({ email: a.c.email });
    let last = 204;
    for (let i = 0; i < 6; i++) last = (await reset('198.51.100.1')).status;
    expect(last).toBe(429);
    const owner = await reset('198.51.100.2');
    expect(owner.status).toBe(204);
    await tick();
    expect(t.mail.sent.filter((m) => m.to === a.c.email && /Reset/.test(m.subject))).toHaveLength(6);
  });

  it('a correct login never spends the failure budget', async () => {
    const t = makeMailServer();
    const a = await account(t);
    for (let i = 0; i < 15; i++) {
      const r = await request(t.app).post(`${PREFIX}/login`)
        .send({ email: a.c.email, authKey: a.c.material.authKey, device: a.c.device });
      expect(r.status).toBe(200);
    }
  });
});

describe('L3: fake prelogin uses the advertised default cost', () => {
  it('defaults to DEFAULT_KDF and follows the defaultKdf option', async () => {
    const t = makeServer();
    const pre = await request(t.app).post(`${PREFIX}/prelogin`).send({ email: 'nobody@example.com' });
    const { m, t: tt, p } = Crypto.DEFAULT_KDF;
    expect(pre.body.kdf).toMatchObject({ m, t: tt, p });
    const t2 = makeServer({ defaultKdf: { m: 32768, t: 4, p: 2 } });
    const pre2 = await request(t2.app).post(`${PREFIX}/prelogin`).send({ email: 'nobody@example.com' });
    expect(pre2.body.kdf).toMatchObject({ m: 32768, t: 4, p: 2 });
    void kdf;
  });
});

describe('L7: email validation', () => {
  it('rejects markup, separators, whitespace and dotless domains', () => {
    for (const bad of ['a@b', 'a b@c.de', 'a<b@c.de', 'a@c.de>', 'a"b@c.de', 'a,b@c.de', 'a;b@c.de', 'a(b)@c.de',
      'a[b]@c.de', 'a\\b@c.de', 'a@@c.de', 'a@.c.de', 'a@c..de', 'a@c.de.', '@c.de', 'a@c:d.de', `${'x'.repeat(65)}@c.de`,
      `a@${'x'.repeat(250)}.de`, 'a\u0000@c.de']) {
      expect(normaliseEmail(bad), JSON.stringify(bad)).toBeUndefined();
    }
    for (const good of ['a@c.de', 'First.Last+tag@Sub.Example.COM', 'o\'brien@example.co.uk']) {
      expect(normaliseEmail(good), good).toBeDefined();
    }
  });
});

describe('L13: security notification mails', () => {
  it('mails the owner after a password change, recovery regeneration and a reset, without secrets', async () => {
    const t = makeMailServer();
    const a = await account(t);
    await tick();
    t.mail.sent.length = 0;
    const put = (body: object) => request(t.app).put(`${PREFIX}/keys`).set(a.auth).send(body);
    const newKey = b64(32);
    expect((await put({ kind: 'password', currentAuthKey: a.c.material.authKey, kdf: kdf(), authKey: newKey,
      wrappedAkPassword: b64(60), signOutOthers: false })).status).toBe(204);
    expect((await put({ kind: 'recovery', currentAuthKey: newKey, recoveryAuthKey: b64(32), wrappedAkRecovery: b64(60) })).status).toBe(204);
    await tick();
    expect(t.mail.sent.map((m) => m.subject)).toEqual(['Your password was changed', 'Your recovery code was regenerated']);
    for (const m of t.mail.sent) {
      expect(m.to).toBe(a.c.email);
      expect(m.text).not.toMatch(/#token=/);
      expect(m.text).not.toContain(newKey);
    }
    t.mail.sent.length = 0;
    await request(t.app).post(`${PREFIX}/reset`).send({ email: a.c.email });
    await tick();
    const token = tokenIn(t.mail.sent[0]);
    const n = newCreds();
    expect((await request(t.app).post(`${PREFIX}/reset/confirm`)
      .send({ token, accountId: n.accountId, material: n.material, device: n.device })).status).toBe(200);
    await tick();
    expect(t.mail.sent.map((m) => m.subject)).toEqual(['Reset your password', 'Your password was reset']);
  });

  it('mails after a key rotation', async () => {
    const t = makeMailServer();
    const a = await account(t);
    await tick();
    t.mail.sent.length = 0;
    const m = newCreds().material;
    m.currentEpoch = 1;
    m.keysets = [{ epoch: 0, wrappedDataKey: a.c.material.keysets[0].wrappedDataKey }, { epoch: 1, wrappedDataKey: b64(60) }];
    const r = await request(t.app).put(`${PREFIX}/keys`).set(a.auth).send({ kind: 'rotate', currentAuthKey: a.c.material.authKey, material: m });
    expect(r.status).toBe(204);
    await tick();
    expect(t.mail.sent.map((x) => x.subject)).toEqual(['Your encryption keys were rotated']);
  });
});
