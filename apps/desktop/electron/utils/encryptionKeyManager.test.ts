import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const state = vi.hoisted(() => ({
  userData: '',
  decrypt: (_b: Buffer): string => {
    throw new Error('not set');
  },
}));

vi.mock('electron', () => ({
  app: { getPath: () => state.userData, isPackaged: true },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => state.decrypt(b),
  },
}));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('encryptionKeyManager', () => {
  let keyFile: string;

  beforeEach(() => {
    vi.resetModules();
    state.userData = mkdtempSync(join(tmpdir(), 'bible-keymgr-'));
    mkdirSync(join(state.userData, 'secrets'), { recursive: true });
    keyFile = join(state.userData, 'secrets', 'encryption-key.enc');
  });

  afterEach(() => {
    rmSync(state.userData, { recursive: true, force: true });
  });

  it('K1: never overwrites an existing key file it cannot decrypt', async () => {
    const original = Buffer.from([1, 2, 3, 4, 5]);
    writeFileSync(keyFile, original);
    state.decrypt = () => {
      throw new Error('User denied keychain access');
    };
    const { getOrCreateEncryptionKey, EncryptionKeyUnreadableError } = await import('./encryptionKeyManager');

    await expect(getOrCreateEncryptionKey()).rejects.toBeInstanceOf(EncryptionKeyUnreadableError);

    expect(readFileSync(keyFile).equals(original)).toBe(true);
  });

  it('returns the stored key when the file decrypts', async () => {
    writeFileSync(keyFile, Buffer.from('blob'));
    state.decrypt = () => 'a'.repeat(64);
    const { getOrCreateEncryptionKey } = await import('./encryptionKeyManager');
    await expect(getOrCreateEncryptionKey()).resolves.toBe('a'.repeat(64));
  });

  it('creates and stores a new key only when no key file exists', async () => {
    expect(existsSync(keyFile)).toBe(false);
    const { getOrCreateEncryptionKey } = await import('./encryptionKeyManager');
    const key = await getOrCreateEncryptionKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(keyFile)).toBe(true);
  });
});
