/**
 * Desktop secret store for sync (contracts 0063 section 8). Each secret is encrypted with Electron `safeStorage`
 * (Keychain / DPAPI / libsecret or kwallet) and written to `<dir>/sync-<name>.enc` with mode 0600.
 *
 * Never falls back to plaintext: when encryption is unavailable `get`/`set` throw. On Linux without a keyring,
 * safeStorage selects `basic_text`, which is obfuscation only; `weak` is then true and the caller should not rely on
 * this store (ask for the password at each launch instead).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import type { Sync } from '@bible/core';

type SecretName = Sync.SecretName;

/** The subset of Electron's `safeStorage` this store uses. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /** Linux only; absent elsewhere. */
  getSelectedStorageBackend?(): string;
}

const NAMES: readonly SecretName[] = ['sync.unlocked', 'sync.token'];

export class SafeStorageSecretStore implements Sync.ISecretStore {
  constructor(private readonly safeStorage: SafeStorageLike, private readonly dir: string) {}

  get persistence(): 'persistent' | 'memory' {
    return this.safeStorage.isEncryptionAvailable() ? 'persistent' : 'memory';
  }

  /** True when the OS only offers obfuscation (Linux `basic_text`): do not trust this store with the keys. */
  get weak(): boolean {
    try {
      return this.safeStorage.getSelectedStorageBackend?.() === 'basic_text';
    } catch {
      return false;
    }
  }

  private fileFor(name: SecretName): string {
    if (!NAMES.includes(name)) throw new Error('Unknown secret name');
    return join(this.dir, `sync-${name}.enc`);
  }

  private requireEncryption(): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('Secret storage unavailable: the operating system cannot encrypt secrets here');
    }
  }

  async get(name: SecretName): Promise<Uint8Array | null> {
    this.requireEncryption();
    const path = this.fileFor(name);
    if (!existsSync(path)) return null;
    try {
      const b64 = this.safeStorage.decryptString(readFileSync(path));
      return new Uint8Array(Buffer.from(b64, 'base64'));
    } catch {
      throw new Error('Stored secret could not be decrypted');
    }
  }

  async set(name: SecretName, value: Uint8Array): Promise<void> {
    this.requireEncryption();
    const path = this.fileFor(name);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const encrypted = this.safeStorage.encryptString(Buffer.from(value).toString('base64'));
    const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      writeFileSync(tmp, encrypted, { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, path);
    } catch (err) {
      try { unlinkSync(tmp); } catch { /* nothing to clean */ }
      throw err;
    }
  }

  async delete(name: SecretName): Promise<void> {
    try {
      unlinkSync(this.fileFor(name));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
