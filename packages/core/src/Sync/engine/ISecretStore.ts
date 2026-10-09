/** Secret store contract (contracts 0063 §8). W1-B implements the serialisers and `MemorySecretStore`. */
import type { UnlockedAccount } from '../crypto/keys';
import { notImplemented } from '../notImplemented';

export interface ISecretStore {
  get(name: SecretName): Promise<Uint8Array | null>;
  set(name: SecretName, value: Uint8Array): Promise<void>;
  delete(name: SecretName): Promise<void>;
  /** 'persistent' = survives restart; 'memory' = web "remember this device" off. */
  readonly persistence: 'persistent' | 'memory';
}
export type SecretName = 'sync.unlocked' | 'sync.token';   // 'sync.unlocked' = serialised UnlockedAccount

/** Versioned binary, W1-B. */
export function serializeUnlocked(u: UnlockedAccount): Uint8Array {
  throw notImplemented(u);
}
export function deserializeUnlocked(b: Uint8Array): UnlockedAccount {
  throw notImplemented(b);
}

/** Tests + web "don't remember". */
export class MemorySecretStore implements ISecretStore {
  readonly persistence = 'memory' as const;
  get(name: SecretName): Promise<Uint8Array | null> {
    throw notImplemented(name);
  }
  set(name: SecretName, value: Uint8Array): Promise<void> {
    throw notImplemented(name, value);
  }
  delete(name: SecretName): Promise<void> {
    throw notImplemented(name);
  }
}
