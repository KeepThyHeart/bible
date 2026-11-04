/** Secret store contract (contracts 0063 §8). W1-B implements the serialisers and `MemorySecretStore`. */
import { hexEncode } from '../../Crypto';
import type { UnlockedAccount } from '../crypto/keys';
import { KEY_LEN, id16, readU32be, u32be } from '../crypto/internal';

export interface ISecretStore {
  get(name: SecretName): Promise<Uint8Array | null>;
  set(name: SecretName, value: Uint8Array): Promise<void>;
  delete(name: SecretName): Promise<void>;
  /** 'persistent' = survives restart; 'memory' = web "remember this device" off. */
  readonly persistence: 'persistent' | 'memory';
}
export type SecretName = 'sync.unlocked' | 'sync.token';   // 'sync.unlocked' = serialised UnlockedAccount

const UNLOCKED_FORMAT_V1 = 1;
/** version 1 | accountId 16 | accountKey 32 | recordIdKey 32 | u32 currentEpoch | u32 count */
const FIXED_LEN = 1 + 16 + KEY_LEN + KEY_LEN + 4 + 4;
/** per data key: u32 epoch | key 32 */
const ENTRY_LEN = 4 + KEY_LEN;

/**
 * Versioned binary:
 * `0x01 | accountId(16) | accountKey(32) | recordIdKey(32) | u32be(currentEpoch) | u32be(n) | n x (u32be(epoch) | key(32))`,
 * data keys in ascending epoch order. Holds raw keys: only ever hand the result to an ISecretStore.
 */
export function serializeUnlocked(u: UnlockedAccount): Uint8Array {
  const acct = id16(u.accountId, 'account id');
  if (u.accountKey.length !== KEY_LEN || u.recordIdKey.length !== KEY_LEN) throw new RangeError('Keys must be 32 bytes');
  if (!u.dataKeys.has(u.currentEpoch)) throw new RangeError('Current epoch has no data key');
  const epochs = [...u.dataKeys.keys()].sort((a, b) => a - b);
  const out = new Uint8Array(FIXED_LEN + epochs.length * ENTRY_LEN);
  out[0] = UNLOCKED_FORMAT_V1;
  out.set(acct, 1);
  out.set(u.accountKey, 17);
  out.set(u.recordIdKey, 49);
  out.set(u32be(u.currentEpoch), 81);
  out.set(u32be(epochs.length), 85);
  let o = FIXED_LEN;
  for (const e of epochs) {
    const k = u.dataKeys.get(e)!;
    if (k.length !== KEY_LEN) throw new RangeError('Keys must be 32 bytes');
    out.set(u32be(e), o);
    out.set(k, o + 4);
    o += ENTRY_LEN;
  }
  return out;
}

/** Inverse of serializeUnlocked. Throws RangeError (never echoing content) on any malformed or unknown version. */
export function deserializeUnlocked(b: Uint8Array): UnlockedAccount {
  if (!(b instanceof Uint8Array) || b.length < FIXED_LEN) throw new RangeError('Malformed unlocked account');
  if (b[0] !== UNLOCKED_FORMAT_V1) throw new RangeError('Unsupported unlocked account format');
  const n = readU32be(b, 85);
  if (b.length !== FIXED_LEN + n * ENTRY_LEN) throw new RangeError('Malformed unlocked account');
  const currentEpoch = readU32be(b, 81);
  const dataKeys = new Map<number, Uint8Array>();
  for (let i = 0, o = FIXED_LEN; i < n; i++, o += ENTRY_LEN) {
    const e = readU32be(b, o);
    if (dataKeys.has(e)) throw new RangeError('Malformed unlocked account');
    dataKeys.set(e, b.slice(o + 4, o + ENTRY_LEN));
  }
  if (!dataKeys.has(currentEpoch)) throw new RangeError('Malformed unlocked account');
  return {
    accountId: hexEncode(b.subarray(1, 17)),
    accountKey: b.slice(17, 49),
    recordIdKey: b.slice(49, 81),
    dataKeys,
    currentEpoch,
  };
}

/** Tests + web "don't remember". Stores copies, so callers may wipe their buffers after `set`. */
export class MemorySecretStore implements ISecretStore {
  readonly persistence = 'memory' as const;
  private readonly values = new Map<SecretName, Uint8Array>();

  async get(name: SecretName): Promise<Uint8Array | null> {
    const v = this.values.get(name);
    return v ? v.slice() : null;
  }
  async set(name: SecretName, value: Uint8Array): Promise<void> {
    this.values.get(name)?.fill(0);
    this.values.set(name, value.slice());
  }
  async delete(name: SecretName): Promise<void> {
    this.values.get(name)?.fill(0);
    this.values.delete(name);
  }
}
