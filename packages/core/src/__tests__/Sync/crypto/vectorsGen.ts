/**
 * Computes the SyncCrypto golden vectors from fixed inputs and `deterministicRandom`. `vectors.test.ts` compares the
 * result with the committed `vectors.json`, which must never be regenerated once released: any difference means the
 * wire format changed and every existing account would break.
 */
import { deterministicRandom, hexEncode, kdfParamsFromJson } from '../../../Crypto';
import type { RecordPlaintext } from '../../../Sync/types';
import {
  createAccountMaterial, deriveRecordId, derivePasswordKeys, generateRecoveryCode, newRecoveryWrap,
  parseRecoveryCode, rewrapForNewPassword, rotateAccountKey, sealDeviceName,
} from '../../../Sync/crypto/keys';
import type { UnlockedAccount } from '../../../Sync/crypto/keys';
import { createRecordCipher } from '../../../Sync/crypto/RecordCipher';
import { FLOOR, PASSWORD } from './fixtures';

export const VECTOR_INPUTS = {
  password: PASSWORD,
  newPassword: 'néw passphrase 2026',
  kdfCost: FLOOR,
  seeds: { account: 42, record: 7, deviceName: 9, rewrap: 11, newRecovery: 13, rotate: 17, recoveryCode: 19 },
  recordId: '00112233445566778899aabbccddeeff',
  record: {
    t: 'user_note', cv: 1, h: '0192f3a1b2c3:0000:9f3c0a1b2c3d4e5f', dev: '9f3c0a1b2c3d4e5f',
    d: { title: 'Psalm 23', body: 'The LORD is my shepherd; I shall not want.' },
  } satisfies RecordPlaintext,
  derivedId: { scope: 'ext.kv', key: 'com.example/theme' },
  deviceId: 'a1b2c3d4e5f60718',
  deviceName: 'Kitchen tablet',
} as const;

const hexUnlocked = (u: UnlockedAccount) => ({
  accountId: u.accountId,
  accountKey: hexEncode(u.accountKey),
  recordIdKey: hexEncode(u.recordIdKey),
  dataKeys: Object.fromEntries([...u.dataKeys].map(([e, k]) => [String(e), hexEncode(k)])),
  currentEpoch: u.currentEpoch,
});

export async function computeVectors() {
  const I = VECTOR_INPUTS;
  const created = await createAccountMaterial({
    password: I.password, kdfCost: I.kdfCost, random: deterministicRandom(I.seeds.account),
  });
  const pk = await derivePasswordKeys(I.password, kdfParamsFromJson(created.material.kdf));
  const cipher = createRecordCipher(created.unlocked, deterministicRandom(I.seeds.record));
  const blob = await cipher.seal(I.recordId, I.record);
  const derivedRecordId = await deriveRecordId(created.unlocked.recordIdKey, I.derivedId.scope, I.derivedId.key);
  const sealedDeviceName = await sealDeviceName(created.unlocked, I.deviceId, I.deviceName,
    deterministicRandom(I.seeds.deviceName));
  const rewrap = await rewrapForNewPassword(created.unlocked, I.newPassword,
    { random: deterministicRandom(I.seeds.rewrap), kdfCost: I.kdfCost });
  const newRecovery = await newRecoveryWrap(created.unlocked, deterministicRandom(I.seeds.newRecovery));
  const rotated = await rotateAccountKey(created.unlocked, I.password, deterministicRandom(I.seeds.rotate),
    { kdfCost: I.kdfCost });
  const recoveryCode = generateRecoveryCode(deterministicRandom(I.seeds.recoveryCode));

  return {
    inputs: I,
    derivation: { authKey: hexEncode(pk.authKey), kek: hexEncode(pk.kek) },
    account: {
      accountId: created.accountId,
      recoveryCode: created.recoveryCode,
      material: created.material,
      unlocked: hexUnlocked(created.unlocked),
    },
    record: { blob: hexEncode(blob) },
    derivedRecordId,
    sealedDeviceName,
    rewrap,
    newRecovery,
    rotation: { recoveryCode: rotated.recoveryCode, material: rotated.material, unlocked: hexUnlocked(rotated.unlocked) },
    recoveryCode: { code: recoveryCode, bytes: hexEncode(parseRecoveryCode(recoveryCode)) },
  };
}
