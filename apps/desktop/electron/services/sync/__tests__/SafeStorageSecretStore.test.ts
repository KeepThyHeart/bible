import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SafeStorageSecretStore, type SafeStorageLike } from '../SafeStorageSecretStore';

/** Fake safeStorage: reversible "encryption" that makes plaintext visibly absent from the file. */
function fakeSafeStorage(opts: { available?: boolean; backend?: string } = {}): SafeStorageLike {
  const available = opts.available ?? true;
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from('ENC:' + Buffer.from(s, 'utf8').reverse().toString('hex'), 'utf8'),
    decryptString: (b) => {
      const t = b.toString('utf8');
      if (!t.startsWith('ENC:')) throw new Error('bad');
      return Buffer.from(t.slice(4), 'hex').reverse().toString('utf8');
    },
    getSelectedStorageBackend: opts.backend ? () => opts.backend! : undefined,
  };
}

const value = () => Uint8Array.from({ length: 48 }, (_, i) => (i * 5 + 1) & 0xff);
let dir: string;
beforeEach(() => { dir = join(mkdtempSync(join(tmpdir(), 'secretstore-')), 'secrets'); });
afterEach(() => { rmSync(join(dir, '..'), { recursive: true, force: true }); });

describe('SafeStorageSecretStore', () => {
  it('round trips, creating the directory', async () => {
    const s = new SafeStorageSecretStore(fakeSafeStorage(), dir);
    expect(s.persistence).toBe('persistent');
    expect(await s.get('sync.unlocked')).toBeNull();
    await s.set('sync.unlocked', value());
    expect(await s.get('sync.unlocked')).toEqual(value());
    expect(readdirSync(dir)).toEqual(['sync-sync.unlocked.enc']);
  });

  it('writes the file with mode 0600, leaves no temp files, and never stores base64 or raw plaintext', async () => {
    const s = new SafeStorageSecretStore(fakeSafeStorage(), dir);
    await s.set('sync.token', value());
    await s.set('sync.token', value());
    expect(readdirSync(dir)).toEqual(['sync-sync.token.enc']);
    const path = join(dir, 'sync-sync.token.enc');
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
    const onDisk = readFileSync(path).toString('utf8');
    expect(onDisk).not.toContain(Buffer.from(value()).toString('base64'));
  });

  it('delete removes the file and is idempotent', async () => {
    const s = new SafeStorageSecretStore(fakeSafeStorage(), dir);
    await s.set('sync.token', value());
    await s.delete('sync.token');
    expect(readdirSync(dir)).toEqual([]);
    expect(await s.get('sync.token')).toBeNull();
    await expect(s.delete('sync.token')).resolves.toBeUndefined();
  });

  it('throws, and writes nothing, when encryption is unavailable', async () => {
    const s = new SafeStorageSecretStore(fakeSafeStorage({ available: false }), dir);
    expect(s.persistence).toBe('memory');
    await expect(s.set('sync.token', value())).rejects.toThrow(/unavailable/);
    await expect(s.get('sync.token')).rejects.toThrow(/unavailable/);
    expect(() => readdirSync(dir)).toThrow();
  });

  it('reports weak for the basic_text backend only', () => {
    expect(new SafeStorageSecretStore(fakeSafeStorage({ backend: 'basic_text' }), dir).weak).toBe(true);
    expect(new SafeStorageSecretStore(fakeSafeStorage({ backend: 'gnome_libsecret' }), dir).weak).toBe(false);
    expect(new SafeStorageSecretStore(fakeSafeStorage(), dir).weak).toBe(false);
  });

  it('weak backend: reports memory and refuses set() unless allowWeak is passed', async () => {
    const weak = new SafeStorageSecretStore(fakeSafeStorage({ backend: 'basic_text' }), dir);
    expect(weak.persistence).toBe('memory');
    await expect(weak.set('sync.token', value())).rejects.toThrow(/unavailable/);
    expect(() => readdirSync(dir)).toThrow();
    const allowed = new SafeStorageSecretStore(fakeSafeStorage({ backend: 'basic_text' }), dir, { allowWeak: true });
    expect(allowed.persistence).toBe('persistent');
    await allowed.set('sync.token', value());
    expect(await allowed.get('sync.token')).toEqual(value());
  });

  it('fails cleanly on a corrupt file without echoing content', async () => {
    const s = new SafeStorageSecretStore(fakeSafeStorage(), dir);
    await s.set('sync.token', value());
    const { writeFileSync } = await import('fs');
    writeFileSync(join(dir, 'sync-sync.token.enc'), 'garbage');
    await expect(s.get('sync.token')).rejects.toThrow('Stored secret could not be decrypted');
  });
});
