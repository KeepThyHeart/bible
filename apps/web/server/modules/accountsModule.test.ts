import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, rmSync, statSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRequire } from 'module';
import { serverModules } from './serverModules';
import { accountsManifest } from './accounts/manifest';
import { clearRouteRegistry } from '../routes/routeRegistry';
import { validateBuiltinManifest } from '../core';
import { authCookieValue, createPasswordGate, hashPassword } from '../middleware/passwordGate';
import type { AccountsSettings } from '../SiteConfig';
import { loadOrCreateServerSecret, syncStateDir, SECRET_FILE } from './accounts/serverSecret';
import { allowedOriginsFor, buildEmailSender, cookieSecureFor, parsePublicUrl, AccountsConfigError } from './accounts/syncOptions';

// Generous: CI and shared dev machines can be heavily loaded.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SETTINGS: AccountsSettings = {
  publicUrl: 'https://bible.example.org',
  signupOpen: true,
  allowedOrigins: [],
  email: { kind: 'console' },
};

let stateDir: string;
beforeEach(() => {
  clearRouteRegistry();
  vi.resetModules();
  stateDir = mkdtempSync(join(tmpdir(), 'accounts-module-'));
});
afterEach(async () => {
  try {
    (await import('./accounts/routes')).resetAccountsInstance();
  } catch {
    /* never imported */
  }
  rmSync(stateDir, { recursive: true, force: true });
});

async function freshLoad(enabled: boolean) {
  const loader = await import('./loadServerModules');
  const registry = await import('../routes/routeRegistry');
  registry.clearRouteRegistry();
  const modules = serverModules.filter((m) => m.manifest.id === 'accounts');
  const handle = await loader.loadServerModules({
    flags: { isEnabled: (f: string) => (f === 'accounts' ? enabled : false) },
    overrides: () => ({}),
    modules,
  });
  return { loader, registry, handle };
}

/** The pieces of server/index.ts that matter here, in its order: parsers, global parser, gate, routes, unavailable. */
async function buildApp(enabled: boolean, opts: { gate?: boolean; settings?: AccountsSettings } = {}) {
  const { registry } = await freshLoad(enabled);
  const unavailable = await import('./unavailableRoutes');
  const app = express();
  for (const bp of registry.getRegisteredBodyParsers()) app.use(bp.path, express.json({ limit: bp.limit }));
  app.use(express.json({ limit: '100kb' }));
  const hash = hashPassword('site-secret');
  if (opts.gate) app.use(createPasswordGate({ passwordHash: hash }));
  const deps = { db: {} as never, siteSettings: null, extra: { appStateDir: stateDir, accountsSettings: opts.settings ?? SETTINGS } };
  for (const reg of registry.getRegisteredRoutes()) app.use(reg.path, reg.createRoutes(deps));
  app.use(unavailable.createUnavailableRoutes());
  app.post('/api/other', (_req, res) => res.json({ ok: true }));
  app.get('*', (_req, res) => res.status(200).send('spa'));
  return { app, cookie: `bible_auth=${authCookieValue(hash)}`, registry };
}

describe('accounts server module', () => {
  it('manifest validates, is flagged and is in the table', () => {
    expect(validateBuiltinManifest(accountsManifest)).toEqual([]);
    expect(accountsManifest.flag).toBe('accounts');
    expect(serverModules.map((m) => m.manifest.id)).toContain('accounts');
    expect(accountsManifest.contributes.serverRoutes).toEqual([{ id: 'sync-api', path: '/api/sync' }]);
  });

  it('mounts at the core SYNC_API_PREFIX', async () => {
    const { SYNC_PREFIX, PUSH_PATH } = await import('./accounts/routes');
    const core = createRequire(import.meta.url)('@bible/core') as { Sync: { SYNC_API_PREFIX: string } };
    expect(SYNC_PREFIX).toBe(core.Sync.SYNC_API_PREFIX);
    expect(PUSH_PATH).toBe(`${core.Sync.SYNC_API_PREFIX}/push`);
  });

  it('disabled: the route file is never imported and /api/sync answers the standard 404', async () => {
    const imported = vi.fn();
    vi.doMock('./accounts/routes', () => { imported(); return {}; });
    const { app } = await buildApp(false);
    expect(imported).not.toHaveBeenCalled();
    const json = await request(app).get('/api/sync/v1/info').set('Accept', 'application/json');
    expect(json.status).toBe(404);
    expect(json.body.error).toMatchObject({ code: 'FEATURE_UNAVAILABLE', feature: 'accounts' });
    const html = await request(app).get('/api/sync/v1/info').set('Accept', 'text/html');
    expect(html.status).toBe(404);
    expect(html.text).toContain('not available');
    expect(existsSync(syncStateDir(stateDir))).toBe(false);
    vi.doUnmock('./accounts/routes');
  });

  it('enabled: info works behind the password gate, and not without the site cookie', async () => {
    const { app, cookie, registry } = await buildApp(true, { gate: true });
    expect(registry.listRoutes('accounts').map((r) => r.path)).toEqual(['/api/sync/v1']);

    const blocked = await request(app).get('/api/sync/v1/info').set('Accept', 'application/json');
    expect(blocked.status).toBe(401);

    const res = await request(app).get('/api/sync/v1/info').set('Cookie', cookie).set('Accept', 'application/json');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ apiVersion: 1, signupOpen: true });
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('enabled over http://localhost: no HSTS', async () => {
    const { app } = await buildApp(true, { settings: { ...SETTINGS, publicUrl: 'http://localhost:3100' } });
    const res = await request(app).get('/api/sync/v1/info');
    expect(res.status).toBe(200);
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('enabled: reaches the sync server for the allowed origin only (cookie CSRF check)', async () => {
    const { app } = await buildApp(true);
    const bad = await request(app).post('/api/sync/v1/prelogin').set('Origin', 'https://evil.example').send({ email: 'a@b.co' });
    expect(bad.status).toBe(403);
    const ok = await request(app).post('/api/sync/v1/prelogin').set('Origin', 'https://bible.example.org').send({ email: 'a@b.co' });
    expect(ok.status).toBe(200);
  });

  it('enabled but misconfigured: the site stays up and the API answers 503', async () => {
    const { app } = await buildApp(true, { settings: { ...SETTINGS, publicUrl: '' } });
    const res = await request(app).get('/api/sync/v1/info');
    expect(res.status).toBe(503);
    expect(res.body.message).toContain('accounts.publicUrl');
    expect(res.text).not.toContain(stateDir);
  });

  it('accepts an 8 MB push body while other routes keep the 100 kB limit', async () => {
    const { app } = await buildApp(true);
    // 7.5 MB of JSON: far above 100 kB, below the 8 MiB push limit. No session, so the sync API answers 401
    // *after* parsing; a 413 would mean the body was refused by a size limit.
    const body = JSON.stringify({ records: [], pad: 'a'.repeat(7_500_000) });
    const push = await request(app).post('/api/sync/v1/push').set('Content-Type', 'application/json').send(body);
    expect(push.status).toBe(401);

    const other = await request(app).post('/api/other').set('Content-Type', 'application/json').send(JSON.stringify({ pad: 'a'.repeat(200_000) }));
    expect(other.status).toBe(413);
    // Other sync routes keep a small limit too.
    const small = await request(app).post('/api/sync/v1/prelogin').set('Content-Type', 'application/json').send(JSON.stringify({ pad: 'a'.repeat(200_000) }));
    expect(small.status).toBe(413);
  });

  it('without the registered parser the same push is refused by the 100 kB parser (control)', async () => {
    const { registry } = await buildApp(true);
    expect(registry.getRegisteredBodyParsers().map((b) => [b.path, b.limit, b.moduleId])).toEqual([
      ['/api/sync/v1/push', '9mb', 'accounts'],
    ]);
    const app = express();
    app.use(express.json({ limit: '100kb' }));
    app.post('/api/sync/v1/push', (_req, res) => res.sendStatus(200));
    const res = await request(app).post('/api/sync/v1/push').set('Content-Type', 'application/json').send(JSON.stringify({ pad: 'a'.repeat(200_000) }));
    expect(res.status).toBe(413);
  });

  it('keeps the sync database (WAL) and the secret under plugin-data/sync, secret mode 0600, stable across restarts', async () => {
    const first = await buildApp(true);
    await request(first.app).get('/api/sync/v1/info');
    const dir = syncStateDir(stateDir);
    expect(dir).toBe(join(stateDir, 'plugin-data', 'sync'));
    expect(existsSync(join(dir, 'sync.db'))).toBe(true);
    const secretFile = join(dir, SECRET_FILE);
    expect(statSync(secretFile).mode & 0o777).toBe(0o600);
    const secret1 = readFileSync(secretFile);
    expect(secret1.length).toBe(32);

    // Restart: a fresh module graph and a new app over the same state directory.
    (await import('./accounts/routes')).resetAccountsInstance();
    vi.resetModules();
    clearRouteRegistry();
    const second = await buildApp(true);
    const res = await request(second.app).get('/api/sync/v1/info');
    expect(res.status).toBe(200);
    expect(readFileSync(secretFile).equals(secret1)).toBe(true);
  });
});

describe('server secret', () => {
  it('is generated once with mode 0600 and read back unchanged', () => {
    const dir = join(stateDir, 'x');
    const a = loadOrCreateServerSecret(dir);
    const b = loadOrCreateServerSecret(dir);
    expect(a.length).toBe(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(statSync(join(dir, SECRET_FILE)).mode & 0o777).toBe(0o600);
  });

  it('refuses a truncated file instead of regenerating it, without printing the content', async () => {
    const { writeFileSync, mkdirSync } = await import('fs');
    const dir = join(stateDir, 'y');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, SECRET_FILE), 'short');
    expect(() => loadOrCreateServerSecret(dir)).toThrow(/shorter than 32 bytes/);
    try { loadOrCreateServerSecret(dir); } catch (e) { expect(String(e)).not.toContain('short\n'); }
  });
});

describe('purge timer', () => {
  it('purges on the interval and stops on close', async () => {
    const { createAccounts } = await import('./accounts/createAccounts');
    const inst = createAccounts({ settings: SETTINGS, appStateDir: stateDir, purgeIntervalMs: 20 });
    const spy = vi.spyOn(inst.server, 'purgeExpired');
    await new Promise((r) => setTimeout(r, 90));
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    inst.close();
    const n = spy.mock.calls.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(spy.mock.calls.length).toBe(n);
    inst.close(); // idempotent
  });
});

describe('option building', () => {
  it('cookies are Secure except on plain-http loopback', () => {
    expect(cookieSecureFor(new URL('https://bible.example.org'))).toBe(true);
    expect(cookieSecureFor(new URL('http://bible.example.org'))).toBe(true);
    expect(cookieSecureFor(new URL('http://localhost:3100'))).toBe(false);
    expect(cookieSecureFor(new URL('http://127.0.0.1:3100'))).toBe(false);
    expect(cookieSecureFor(new URL('http://dev.localhost'))).toBe(false);
    expect(cookieSecureFor(new URL('https://localhost'))).toBe(true);
  });

  it('allowed origins derive from publicUrl plus explicit extras only', () => {
    const url = parsePublicUrl('https://bible.example.org/app/');
    expect(allowedOriginsFor({ allowedOrigins: [] }, url)).toEqual(['https://bible.example.org']);
    expect(allowedOriginsFor({ allowedOrigins: ['https://www.example.org/x'] }, url)).toEqual(['https://bible.example.org', 'https://www.example.org']);
    expect(() => allowedOriginsFor({ allowedOrigins: ['nope'] }, url)).toThrow(AccountsConfigError);
  });

  it('rejects a missing or non-http publicUrl', () => {
    expect(() => parsePublicUrl('')).toThrow(/not set/);
    expect(() => parsePublicUrl('ftp://x')).toThrow(/http/);
    expect(() => parsePublicUrl('not a url')).toThrow(/valid/);
  });

  it('builds the email sender from the settings', () => {
    const console_ = vi.fn(() => ({ send: async () => {} }));
    const smtp = vi.fn(() => ({ send: async () => {} }));
    buildEmailSender({ kind: 'console' }, { console: console_, smtp });
    expect(console_).toHaveBeenCalled();
    buildEmailSender({ kind: 'smtp', host: 'mail.example.org', secure: true, user: 'u', pass: 'p', from: 'Bible <n@example.org>' }, { console: console_, smtp });
    expect(smtp).toHaveBeenCalledWith({ host: 'mail.example.org', port: 465, secure: true, user: 'u', pass: 'p', from: 'Bible <n@example.org>' });
    expect(() => buildEmailSender({ kind: 'smtp', from: 'x' }, { console: console_, smtp })).toThrow(/host/);
    expect(() => buildEmailSender({ kind: 'smtp', host: 'h' }, { console: console_, smtp })).toThrow(/from/);
  });
});
