/**
 * SyncCrypto golden vectors. `vectors.json` is committed and must never be regenerated: a mismatch means the key
 * hierarchy or the record envelope changed on the wire. Besides re-deriving everything, the record blob is opened
 * with Node's own AES-GCM and a hand-built AAD so the layout is checked independently of the implementation.
 */
import nodeCrypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { concatBytes, hexDecode, utf8Encode } from '../../../Crypto';
import {
  openDeviceName, parseRecoveryCode, unlockWithPassword, unlockWithRecoveryCode,
} from '../../../Sync/crypto/keys';
import { createRecordCipher } from '../../../Sync/crypto/RecordCipher';
import vectors from './vectors.json';
import { computeVectors } from './vectorsGen';

const u32 = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);

describe('SyncCrypto golden vectors', () => {
  it('reproduces vectors.json exactly (derivation, every wrap, record blob, recovery code)', async () => {
    const v = JSON.parse(JSON.stringify(await computeVectors()));
    expect(v).toEqual(vectors);
  }, 60000);

  it('opens the committed material and blob', async () => {
    const a = vectors.account;
    const m = a.material;
    const kek = hexDecode(vectors.derivation.kek);
    const viaPw = await unlockWithPassword(a.accountId, kek, m.wrappedAkPassword, m.wrappedRecordIdKey, m.keysets, m.currentEpoch);
    const viaRc = await unlockWithRecoveryCode(a.accountId, a.recoveryCode, m.wrappedAkRecovery, m.wrappedRecordIdKey, m.keysets, m.currentEpoch);
    for (const u of [viaPw, viaRc]) {
      expect(Buffer.from(u.accountKey).toString('hex')).toBe(a.unlocked.accountKey);
      expect(Buffer.from(u.recordIdKey).toString('hex')).toBe(a.unlocked.recordIdKey);
      expect(Buffer.from(u.dataKeys.get(0)!).toString('hex')).toBe(a.unlocked.dataKeys['0']);
    }
    const pt = await createRecordCipher(viaPw).open(vectors.inputs.recordId, hexDecode(vectors.record.blob));
    expect(pt).toEqual(vectors.inputs.record);
    expect(await openDeviceName(viaPw, vectors.inputs.deviceId, vectors.sealedDeviceName)).toBe(vectors.inputs.deviceName);
  });

  it('record blob layout matches the documented envelope (independent AES-GCM)', () => {
    const blob = hexDecode(vectors.record.blob);
    expect(blob[0]).toBe(1);
    const epoch = new DataView(blob.buffer, blob.byteOffset).getUint32(1);
    expect(epoch).toBe(0);
    const nonce = blob.subarray(5, 17);
    const ct = blob.subarray(17, blob.length - 16);
    const tag = blob.subarray(blob.length - 16);
    const aad = concatBytes(utf8Encode('kth-rec-v1'), Uint8Array.of(1), hexDecode(vectors.account.accountId),
      hexDecode(vectors.inputs.recordId), u32(epoch));
    const d = nodeCrypto.createDecipheriv('aes-256-gcm', hexDecode(vectors.account.unlocked.dataKeys['0']), nonce);
    d.setAAD(aad);
    d.setAuthTag(tag);
    const padded = Buffer.concat([d.update(ct), d.final()]);
    expect(padded.length).toBe(1024);
    const len = padded.readUInt32BE(0);
    expect(JSON.parse(padded.subarray(4, 4 + len).toString('utf8'))).toEqual(vectors.inputs.record);
    expect(padded.subarray(4 + len).every((b) => b === 0)).toBe(true);
  });

  it('recovery code vector decodes to its bytes', () => {
    expect(vectors.recoveryCode.code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(Buffer.from(parseRecoveryCode(vectors.recoveryCode.code)).toString('hex')).toBe(vectors.recoveryCode.bytes);
  });

  it('rotation vector keeps the record id key and re-wraps every epoch', () => {
    expect(vectors.rotation.unlocked.recordIdKey).toBe(vectors.account.unlocked.recordIdKey);
    expect(vectors.rotation.unlocked.accountKey).not.toBe(vectors.account.unlocked.accountKey);
    expect(vectors.rotation.material.keysets.map((k) => k.epoch)).toEqual([0, 1]);
    expect(vectors.rotation.material.currentEpoch).toBe(1);
  });
});
