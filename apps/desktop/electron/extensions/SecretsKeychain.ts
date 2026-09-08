/**
 * Per-extension secret store (the `IStorageApi` secrets tier).
 *
 * Each extension's secrets are stored in a per-extension JSON file under `userData/secrets/ext/<extensionId>.json`,
 * where each value is encrypted at rest with Electron `safeStorage` (Keychain
 * on macOS, DPAPI on Windows, libsecret/kwallet on Linux). The per-extension
 * file boundary gives each extension its own audit and revoke boundary.
 */

import { app, safeStorage } from 'electron';
import { join } from 'path';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
} from 'fs';
import log from 'electron-log';

const SERVICE_PREFIX = 'bible-app:';

export function serviceNameForExtension(extensionId: string): string {
  return `${SERVICE_PREFIX}${extensionId}`;
}

export interface ISecretsKeychain {
  setPassword(extensionId: string, key: string, value: string): Promise<void>;
  getPassword(extensionId: string, key: string): Promise<string | undefined>;
  deletePassword(extensionId: string, key: string): Promise<boolean>;
  /** Number of secrets currently stored for the extension. Used by `diskUsage`. */
  countSecrets(extensionId: string): Promise<number>;
  /** Drop every secret owned by the extension. Called from uninstall. */
  deleteAll(extensionId: string): Promise<void>;
}

/**
 * Production secret store backed by Electron `safeStorage` and per-extension
 * JSON files. Replaces the previous keytar-based implementation, removing the
 * native binding dependency.
 */
export class SafeStorageSecretsKeychain implements ISecretsKeychain {
  private secretsDir(): string {
    const dir = join(app.getPath('userData'), 'secrets', 'ext');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    return dir;
  }

  private fileFor(extensionId: string): string {
    // Filename uses the same `bible-app:<id>` namespacing the spec calls for,
    // with `:` swapped for `_` so it is a legal filename on every platform.
    const safe = serviceNameForExtension(extensionId).replace(/:/g, '_');
    return join(this.secretsDir(), `${safe}.json`);
  }

  private load(extensionId: string): Record<string, string> {
    const path = this.fileFor(extensionId);
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>;
    } catch (err) {
      log.warn(`[SecretsKeychain] Failed to read secrets for ${extensionId}, treating as empty:`, err);
      return {};
    }
  }

  private save(extensionId: string, store: Record<string, string>): void {
    writeFileSync(this.fileFor(extensionId), JSON.stringify(store), { mode: 0o600 });
  }

  private requireSafeStorage(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Extension secret storage unavailable: Electron safeStorage cannot encrypt on this system');
    }
  }

  async setPassword(extensionId: string, key: string, value: string): Promise<void> {
    this.requireSafeStorage();
    const store = this.load(extensionId);
    store[key] = safeStorage.encryptString(value).toString('base64');
    this.save(extensionId, store);
  }

  async getPassword(extensionId: string, key: string): Promise<string | undefined> {
    const store = this.load(extensionId);
    const encoded = store[key];
    if (!encoded) return undefined;
    try {
      return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
    } catch (err) {
      log.warn(`[SecretsKeychain] Failed to decrypt secret ${extensionId}/${key}:`, err);
      return undefined;
    }
  }

  async deletePassword(extensionId: string, key: string): Promise<boolean> {
    const store = this.load(extensionId);
    if (!(key in store)) return false;
    delete store[key];
    if (Object.keys(store).length === 0) {
      try { unlinkSync(this.fileFor(extensionId)); } catch { /* already gone */ }
    } else {
      this.save(extensionId, store);
    }
    return true;
  }

  async countSecrets(extensionId: string): Promise<number> {
    return Object.keys(this.load(extensionId)).length;
  }

  async deleteAll(extensionId: string): Promise<void> {
    const path = this.fileFor(extensionId);
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch (err) {
      log.warn(`[SecretsKeychain] deleteAll failed for ${extensionId}:`, err);
    }
  }

  /**
   * Diagnostic helper - list the extension ids that currently have a secret
   * file on disk. Useful for cleanup tooling; not part of the storage api.
   */
  listExtensionsWithSecrets(): string[] {
    const dir = this.secretsDir();
    if (!existsSync(dir)) return [];
    const prefix = SERVICE_PREFIX.replace(/:/g, '_');
    return readdirSync(dir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
      .map(f => f.slice(prefix.length, -'.json'.length));
  }
}

/**
 * In-memory keychain for unit tests. Mirrors the production semantics
 * exactly, including the per-extension namespacing.
 */
export class InMemorySecretsKeychain implements ISecretsKeychain {
  // Map<service, Map<account, value>>
  private readonly store = new Map<string, Map<string, string>>();

  private bucket(extensionId: string, create: boolean): Map<string, string> | undefined {
    const service = serviceNameForExtension(extensionId);
    let m = this.store.get(service);
    if (!m && create) {
      m = new Map();
      this.store.set(service, m);
    }
    return m;
  }

  async setPassword(extensionId: string, key: string, value: string): Promise<void> {
    this.bucket(extensionId, true)!.set(key, value);
  }

  async getPassword(extensionId: string, key: string): Promise<string | undefined> {
    return this.bucket(extensionId, false)?.get(key);
  }

  async deletePassword(extensionId: string, key: string): Promise<boolean> {
    const b = this.bucket(extensionId, false);
    if (!b) return false;
    return b.delete(key);
  }

  async countSecrets(extensionId: string): Promise<number> {
    return this.bucket(extensionId, false)?.size ?? 0;
  }

  async deleteAll(extensionId: string): Promise<void> {
    this.store.delete(serviceNameForExtension(extensionId));
  }
}
