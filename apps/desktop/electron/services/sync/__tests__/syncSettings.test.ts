// @vitest-environment node
import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSyncSettingsStore, normalizeServerUrl } from '../syncSettings';

describe('normalizeServerUrl', () => {
  it('accepts https and strips trailing slashes', () => {
    expect(normalizeServerUrl('https://sync.example.org')).toBe('https://sync.example.org');
    expect(normalizeServerUrl('  https://sync.example.org/  ')).toBe('https://sync.example.org');
    expect(normalizeServerUrl('https://example.org/kth/')).toBe('https://example.org/kth');
    expect(normalizeServerUrl('https://example.org:8443')).toBe('https://example.org:8443');
    expect(normalizeServerUrl('')).toBe('');
  });
  it('allows http only for loopback hosts', () => {
    expect(normalizeServerUrl('http://localhost:3000/')).toBe('http://localhost:3000');
    expect(normalizeServerUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(normalizeServerUrl('http://[::1]:8080')).toBe('http://[::1]:8080');
    expect(normalizeServerUrl('http://example.org')).toBeNull();
    expect(normalizeServerUrl('http://192.168.1.5')).toBeNull();
  });
  it('rejects credentials, query, fragment and other schemes', () => {
    for (const bad of [
      'https://user:pw@example.org', 'https://user@example.org', 'https://example.org?x=1', 'https://example.org/?',
      'https://example.org#frag', 'ftp://example.org', 'file:///etc/passwd', 'javascript:alert(1)', 'example.org', 'https://',
      'https://' + 'a'.repeat(3000) + '.org',
    ]) expect(normalizeServerUrl(bad), bad).toBeNull();
    expect(normalizeServerUrl(42)).toBeNull();
  });
});

describe('createSyncSettingsStore', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kth-settings-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('creates a device id once, persists it and writes mode 0600', () => {
    const file = join(dir, 'sync', 'accounts.json');
    const a = createSyncSettingsStore(file).get();
    expect(a.deviceId).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toMatchObject({ v: 1, serverUrl: '', askPasswordEachLaunch: false, email: null, signedIn: false });
    expect(createSyncSettingsStore(file).get().deviceId).toBe(a.deviceId);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('updates atomically and survives a reload', () => {
    const file = join(dir, 'accounts.json');
    const s = createSyncSettingsStore(file);
    s.update({ serverUrl: 'https://x.example.org', email: 'a@b.co', signedIn: true });
    expect(createSyncSettingsStore(file).get()).toMatchObject({ serverUrl: 'https://x.example.org', email: 'a@b.co', signedIn: true });
    expect(readFileSync(file, 'utf8')).not.toContain('password');
  });

  it('repairs a damaged or hostile file', () => {
    const file = join(dir, 'accounts.json');
    writeFileSync(file, '{not json');
    const a = createSyncSettingsStore(file).get();
    expect(a.deviceId).toMatch(/^[0-9a-f]{16}$/);
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ serverUrl: 'http://evil.example.com', deviceId: 'zz', signedIn: 'yes', askPasswordEachLaunch: true }));
    const b = createSyncSettingsStore(file).get();
    expect(b).toMatchObject({ serverUrl: '', signedIn: false, askPasswordEachLaunch: true });
    expect(b.deviceId).toMatch(/^[0-9a-f]{16}$/);
  });
});
