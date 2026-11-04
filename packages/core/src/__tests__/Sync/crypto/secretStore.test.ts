/** serializeUnlocked / deserializeUnlocked and MemorySecretStore (contracts 0063 §8, W1-B part). */
import { describe, expect, it } from 'vitest';
import { defaultRandom, hexEncode } from '../../../Crypto';
import type { UnlockedAccount } from '../../../Sync/crypto/keys';
import { MemorySecretStore, deserializeUnlocked, serializeUnlocked } from '../../../Sync/engine/ISecretStore';

const u = (): UnlockedAccount => ({
  accountId: hexEncode(defaultRandom.bytes(16)),
  accountKey: defaultRandom.bytes(32),
  recordIdKey: defaultRandom.bytes(32),
  dataKeys: new Map([[3, defaultRandom.bytes(32)], [0, defaultRandom.bytes(32)], [0xffffffff, defaultRandom.bytes(32)]]),
  currentEpoch: 3,
});

describe('serializeUnlocked', () => {
  it('round-trips with a leading version byte', () => {
    const a = u();
    const b = serializeUnlocked(a);
    expect(b[0]).toBe(1);
    expect(b.length).toBe(1 + 16 + 32 + 32 + 4 + 4 + 3 * 36);
    const back = deserializeUnlocked(b);
    expect(back).toEqual(a);
    expect([...back.dataKeys.keys()]).toEqual([0, 3, 0xffffffff]);
    // copies, not views of the input
    b.fill(0);
    expect(back.accountKey).toEqual(a.accountKey);
  });

  it('rejects unknown versions, truncation, trailing bytes, duplicate epochs and a missing current epoch', () => {
    const b = serializeUnlocked(u());
    const v2 = b.slice();
    v2[0] = 2;
    expect(() => deserializeUnlocked(v2)).toThrow(RangeError);
    expect(() => deserializeUnlocked(b.slice(0, b.length - 1))).toThrow(RangeError);
    expect(() => deserializeUnlocked(new Uint8Array([...b, 0]))).toThrow(RangeError);
    expect(() => deserializeUnlocked(new Uint8Array(10))).toThrow(RangeError);
    const dup = b.slice();
    dup.set(dup.subarray(89, 93), 89 + 36); // second entry's epoch = first entry's epoch
    expect(() => deserializeUnlocked(dup)).toThrow(RangeError);
    const noCur = b.slice();
    noCur.set([0, 0, 0, 9], 81);
    expect(() => deserializeUnlocked(noCur)).toThrow(RangeError);
    expect(() => serializeUnlocked({ ...u(), currentEpoch: 7 })).toThrow(RangeError);
  });
});

describe('MemorySecretStore', () => {
  it('stores copies, deletes, and reports memory persistence', async () => {
    const s = new MemorySecretStore();
    expect(s.persistence).toBe('memory');
    expect(await s.get('sync.unlocked')).toBeNull();
    const v = Uint8Array.of(1, 2, 3);
    await s.set('sync.unlocked', v);
    v.fill(0);
    const got = await s.get('sync.unlocked');
    expect(got).toEqual(Uint8Array.of(1, 2, 3));
    got!.fill(9);
    expect(await s.get('sync.unlocked')).toEqual(Uint8Array.of(1, 2, 3));
    expect(await s.get('sync.token')).toBeNull();
    await s.delete('sync.unlocked');
    expect(await s.get('sync.unlocked')).toBeNull();
    await s.delete('sync.token');
  });
});
