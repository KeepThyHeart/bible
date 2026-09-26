/**
 * An independent, from-the-spec builder for backup envelopes, written with
 * node:crypto only (no shared code with the implementation under test). It is
 * used to check that the implementation reads what the written spec says, and to
 * craft hostile or unusual files (extra slots, unknown slot types, odd headers).
 */
import nodeCrypto from 'crypto';

export const MAGIC = Buffer.from([0x89, 0x4b, 0x54, 0x48, 0x42, 0x0d, 0x0a, 0x1a]);
export const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');

export interface BuildOptions {
  password?: string;
  m?: number; t?: number; p?: number;
  segmentSize?: number;
  plaintext: Uint8Array;
  fileKey?: Buffer;
  streamSalt?: Buffer;
  noncePrefix?: Buffer;
  kdfSalt?: Buffer;
  slotNonce?: Buffer;
  major?: number;
  minor?: number;
  /** Mutate the header object before it is serialised (slots already filled in). */
  header?: (h: any) => void;
  /** Replace the serialised header bytes entirely (length in the preamble follows). */
  rawHeader?: Buffer;
  /** Called with the assembled pieces so a test can corrupt them. */
  fastKdf?: (pw: string) => Buffer;
}

export function masterSecret(password: string, m: number, t: number, p: number, salt: Buffer): Buffer {
  // node:crypto.argon2Sync needs Node 24.7+; @types/node 20 does not declare it.
  return (nodeCrypto as any).argon2Sync('argon2id', {
    message: Buffer.from(password.normalize('NFC')), nonce: salt, parallelism: p, tagLength: 32, memory: m, passes: t,
  });
}

function hkdf(ikm: Buffer, salt: Buffer, info: string): Buffer {
  return Buffer.from(nodeCrypto.hkdfSync('sha256', ikm, salt, Buffer.from(info), 32));
}

function gcm(key: Buffer, nonce: Buffer, pt: Buffer, aad: Buffer): Buffer {
  const c = nodeCrypto.createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(aad);
  return Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
}

const sha = (...parts: Buffer[]) => nodeCrypto.createHash('sha256').update(Buffer.concat(parts)).digest();

export function passwordSlot(o: { password: string; m: number; t: number; p: number; salt: Buffer; nonce: Buffer; fileKey: Buffer; preamble: Buffer; fastKdf?: (pw: string) => Buffer }) {
  const master = o.fastKdf ? o.fastKdf(o.password) : masterSecret(o.password, o.m, o.t, o.p, o.salt);
  const kek = hkdf(master, Buffer.alloc(0), 'kth-backup-kek-v1');
  const wrapped = gcm(kek, o.nonce, o.fileKey, Buffer.concat([Buffer.from('kth-backup-slot-v1'), sha(o.preamble)]));
  return {
    type: 'password',
    kdf: { id: 'argon2id', v: 19, m: o.m, t: o.t, p: o.p, salt: b64u(o.salt) },
    nonce: b64u(o.nonce),
    wrapped: b64u(wrapped),
  };
}

export function build(o: BuildOptions): Buffer {
  const password = o.password ?? 'correct horse battery';
  const m = o.m ?? 19456, t = o.t ?? 2, p = o.p ?? 1;
  const S = o.segmentSize ?? 4096;
  const fileKey = o.fileKey ?? Buffer.alloc(32, 7);
  const streamSalt = o.streamSalt ?? Buffer.alloc(32, 9);
  const noncePrefix = o.noncePrefix ?? Buffer.from([1, 2, 3, 4, 5, 6, 7]);
  const kdfSalt = o.kdfSalt ?? Buffer.alloc(16, 3);
  const slotNonce = o.slotNonce ?? Buffer.alloc(12, 5);

  // The wrapped key has a fixed length, so the header length is known before wrapping.
  const mk = (slot0: any) => {
    const h: any = {
      payload: 'zip', aead: 'aes-256-gcm-stream', segmentSize: S,
      streamSalt: b64u(streamSalt), noncePrefix: b64u(noncePrefix), keyCheck: b64u(hkdf(fileKey, streamSalt, 'kth-backup-commit-v1')),
      slots: [slot0],
    };
    o.header?.(h);
    return h;
  };
  const shell = { type: 'password', kdf: { id: 'argon2id', v: 19, m, t, p, salt: b64u(kdfSalt) }, nonce: b64u(slotNonce), wrapped: 'A'.repeat(64) };
  const len = (o.rawHeader ?? Buffer.from(JSON.stringify(mk(shell)))).length;
  const preamble = Buffer.alloc(16);
  MAGIC.copy(preamble, 0);
  preamble.writeUInt16BE(o.major ?? 1, 8);
  preamble.writeUInt16BE(o.minor ?? 0, 10);
  preamble.writeUInt32BE(len, 12);

  let headerBytes: Buffer;
  if (o.rawHeader) {
    headerBytes = o.rawHeader;
  } else {
    const real = passwordSlot({ password, m, t, p, salt: kdfSalt, nonce: slotNonce, fileKey, preamble, fastKdf: o.fastKdf });
    headerBytes = Buffer.from(JSON.stringify(mk(real)));
    if (headerBytes.length !== len) throw new Error(`header length changed (${headerBytes.length} vs ${len}); hooks must not change the length`);
  }

  const sk = hkdf(fileKey, streamSalt, 'kth-backup-stream-v1');
  const aad = sha(preamble, headerBytes);
  const pt = Buffer.from(o.plaintext);
  const segs: Buffer[] = [];
  let off = 0, i = 0;
  for (;;) {
    const rest = pt.length - off;
    const last = rest <= S;
    const block = pt.subarray(off, off + Math.min(S, rest));
    const nonce = Buffer.alloc(12);
    noncePrefix.copy(nonce, 0);
    nonce.writeUInt32BE(i, 7);
    nonce[11] = last ? 1 : 0;
    segs.push(gcm(sk, nonce, block, aad));
    off += block.length;
    i++;
    if (last) break;
  }
  return Buffer.concat([preamble, headerBytes, ...segs]);
}

/** Deterministic test plaintext of a given length. */
export function pattern(n: number): Uint8Array {
  return Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);
}
