import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import request from 'supertest';
import { SiteConfig, parseTrustProxy } from '../SiteConfig';
import { applyTrustProxy, UNSET_TRUST_PROXY } from '../trustProxy';

// Generous: CI and shared dev machines can be heavily loaded.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function configWith(server: unknown): SiteConfig {
  dir = mkdtempSync(join(tmpdir(), 'trustproxy-'));
  writeFileSync(join(dir, 'site-config.json'), JSON.stringify({ server }));
  return new SiteConfig(dir);
}

async function ipSeenBehind(app: express.Express): Promise<string> {
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  const res = await request(app).get('/ip').set('X-Forwarded-For', '203.0.113.9');
  return res.body.ip as string;
}

describe('server.trustProxy', () => {
  it('is undefined when not configured', () => {
    expect(configWith(undefined).trustProxy).toBeUndefined();
    expect(configWith({}).trustProxy).toBeUndefined();
  });

  it('parses booleans, hop counts, subnet strings and lists; rejects the rest', () => {
    expect(parseTrustProxy(false)).toBe(false);
    expect(parseTrustProxy(true)).toBe(true);
    expect(parseTrustProxy(2)).toBe(2);
    expect(parseTrustProxy(-1)).toBeUndefined();
    expect(parseTrustProxy(1.5)).toBeUndefined();
    expect(parseTrustProxy(' loopback, 10.0.0.0/8 ')).toBe('loopback, 10.0.0.0/8');
    expect(parseTrustProxy(['loopback', ' 10.0.0.0/8'])).toEqual(['loopback', '10.0.0.0/8']);
    expect(parseTrustProxy([])).toBeUndefined();
    expect(parseTrustProxy([1])).toBeUndefined();
    expect(parseTrustProxy('')).toBeUndefined();
    expect(parseTrustProxy({})).toBeUndefined();
  });

  it('configured false: express ignores X-Forwarded-For (req.ip is the socket address)', async () => {
    const app = express();
    expect(applyTrustProxy(app, configWith({ trustProxy: false }).trustProxy)).toBe(false);
    expect(app.get('trust proxy')).toBe(false);
    expect(await ipSeenBehind(app)).not.toBe('203.0.113.9');
  });

  it('configured true / hop count / subnet list reaches express and req.ip is the forwarded address', async () => {
    for (const value of [true, 1, 'loopback', ['loopback', '10.0.0.0/8']] as const) {
      const app = express();
      applyTrustProxy(app, configWith({ trustProxy: value }).trustProxy);
      expect(app.get('trust proxy')).toEqual(value);
      expect(await ipSeenBehind(app)).toBe('203.0.113.9');
    }
  });

  it('a subnet list that does not include the caller leaves the header ignored', async () => {
    const app = express();
    applyTrustProxy(app, configWith({ trustProxy: '10.0.0.0/8' }).trustProxy);
    expect(await ipSeenBehind(app)).not.toBe('203.0.113.9');
  });

  it('unset keeps the legacy default (a single constant, UNSET_TRUST_PROXY)', () => {
    const app = express();
    expect(applyTrustProxy(app, undefined)).toBe(UNSET_TRUST_PROXY);
    expect(app.get('trust proxy')).toBe(UNSET_TRUST_PROXY);
  });
});

describe('accounts settings', () => {
  it('defaults: console email, signup open, no overrides', () => {
    expect(configWith({}).accounts).toEqual({
      publicUrl: '', signupOpen: true, quotaBytes: undefined, minAge: undefined, termsUrl: undefined,
      privacyUrl: undefined, allowedOrigins: [], email: { kind: 'console', host: undefined, port: undefined, secure: undefined, user: undefined, pass: undefined, from: undefined },
    });
  });

  it('reads the accounts block', () => {
    dir = mkdtempSync(join(tmpdir(), 'accounts-cfg-'));
    writeFileSync(join(dir, 'site-config.json'), JSON.stringify({
      accounts: {
        publicUrl: 'https://b.example.org', signupOpen: false, quotaMB: 10, minAge: 13, termsUrl: 'https://t', privacyUrl: 'https://p',
        allowedOrigins: ['https://www.example.org'],
        email: { kind: 'smtp', host: 'h', port: 587, secure: false, user: 'u', pass: 'p', from: 'f@example.org' },
      },
    }));
    const a = new SiteConfig(dir).accounts;
    expect(a).toMatchObject({ publicUrl: 'https://b.example.org', signupOpen: false, quotaBytes: 10 * 1024 * 1024, minAge: 13, allowedOrigins: ['https://www.example.org'] });
    expect(a.email).toEqual({ kind: 'smtp', host: 'h', port: 587, secure: false, user: 'u', pass: 'p', from: 'f@example.org' });
  });

  it('the client config never carries the accounts block', () => {
    dir = mkdtempSync(join(tmpdir(), 'accounts-cfg-'));
    writeFileSync(join(dir, 'site-config.json'), JSON.stringify({ accounts: { publicUrl: 'https://x', email: { kind: 'smtp', pass: 'topsecret' } } }));
    expect(JSON.stringify(new SiteConfig(dir).getClientConfig())).not.toContain('topsecret');
  });
});

describe('acceptableTrustProxy (accounts module)', () => {
  it('refuses true and unset; accepts false, hop counts and subnet lists', async () => {
    const { acceptableTrustProxy } = await import('../trustProxy');
    expect(acceptableTrustProxy(true)).toBe(false);
    expect(acceptableTrustProxy(undefined)).toBe(false);
    expect(acceptableTrustProxy(false)).toBe(true);
    expect(acceptableTrustProxy(1)).toBe(true);
    expect(acceptableTrustProxy('loopback')).toBe(true);
    expect(acceptableTrustProxy(['10.0.0.0/8'])).toBe(true);
  });
});
