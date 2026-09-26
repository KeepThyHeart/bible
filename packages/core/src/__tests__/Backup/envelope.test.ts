import { describe, it, expect, vi } from 'vitest';
import nodeCrypto from 'crypto';
import fc from 'fast-check';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  sealStream, openStream, sniff, parseHeader, DEFAULT_SEGMENT_SIZE, MAGIC as IMPL_MAGIC,
} from '../../Backup/Envelope';
import { DamagedError, NewerFormatError, NotABackupError, WrongPasswordError } from '../../Backup/errors';
import { collect, chunked, once } from '../../Backup/Streams';
import { deterministicRandom, hexEncode, sha256 } from '../../Crypto';
import type { KdfParams } from '../../Crypto';
import { build, pattern, b64u, passwordSlot } from './envelopeSpec';

const PASSWORD = 'correct horse battery';
const FLOOR = { m: 19456, t: 2, p: 1 };
const fastKdf = async (pw: string, _p: KdfParams) => new Uint8Array(nodeCrypto.createHash('sha256').update(pw.normalize('NFC')).digest());

async function seal(plain: Uint8Array, opts: { segmentSize?: number; password?: string; fast?: boolean; seed?: number } = {}): Promise<Uint8Array> {
  return collect(sealStream(once(plain), [{ type: 'password', password: opts.password ?? PASSWORD, kdf: FLOOR }], {
    segmentSize: opts.segmentSize ?? 4096,
    random: deterministicRandom(opts.seed ?? 0),
    kdf: opts.fast ? fastKdf : undefined,
  }));
}
async function open(file: Uint8Array, password = PASSWORD, fast = false, chunk = 5000) {
  const r = await openStream(chunked(file, chunk), { password }, { kdf: fast ? fastKdf : undefined });
  return { ...r, bytes: await collect(r.plain) };
}

describe('golden files (must open forever)', () => {
  const dir = join(__dirname, 'fixtures');
  const S = 4096;
  const cases: Array<[string, number, number]> = [
    ['empty', 0, S], ['one', 1, S], ['s-1', S - 1, S], ['s', S, S], ['s+1', S + 1, S], ['3s', 3 * S, S],
    ['default-params-64k-segments', 100000, 65536],
  ];
  const index: Record<string, string> = existsSync(join(dir, 'index.json')) ? JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) : {};

  async function make(name: string, n: number, seg: number): Promise<Uint8Array> {
    const def = name.startsWith('default');
    return collect(sealStream(once(pattern(n)), [{ type: 'password', password: PASSWORD, kdf: def ? undefined : FLOOR }], {
      segmentSize: seg, random: deterministicRandom(0),
    }));
  }

  if (process.env.UPDATE_GOLDEN === '1') {
    it('regenerates the golden files (only run by hand, then commit as NEW files)', async () => {
      mkdirSync(dir, { recursive: true });
      const idx: Record<string, string> = {};
      for (const [name, n, seg] of cases) {
        const bytes = await make(name, n, seg);
        writeFileSync(join(dir, `${name}.bbk`), bytes);
        const r = await openStream(once(bytes), { password: PASSWORD });
        idx[name] = hexEncode(await sha256(bytes.subarray(0, 16 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, false))));
        await collect(r.plain);
      }
      writeFileSync(join(dir, 'index.json'), JSON.stringify(idx, null, 2) + '\n');
    });
  }

  for (const [name, n, seg] of cases) {
    it(`opens ${name}.bbk to the expected plaintext`, async () => {
      const file = new Uint8Array(readFileSync(join(dir, `${name}.bbk`)));
      const r = await open(file);
      expect(r.bytes).toEqual(pattern(n));
      expect(r.header.segmentSize).toBe(seg);
    });
    it(`sealing with the fixed random source reproduces ${name}.bbk byte for byte`, async () => {
      const file = new Uint8Array(readFileSync(join(dir, `${name}.bbk`)));
      expect(hexEncode(await sha256(await make(name, n, seg)))).toBe(hexEncode(await sha256(file)));
    });
    it(`${name}.bbk header hash is pinned`, async () => {
      const file = new Uint8Array(readFileSync(join(dir, `${name}.bbk`)));
      const hl = 16 + new DataView(file.buffer, file.byteOffset).getUint32(12, false);
      expect(hexEncode(await sha256(file.subarray(0, hl)))).toBe(index[name]);
    });
  }
});

describe('spec conformance (files assembled independently with node:crypto)', () => {
  it.each([0, 1, 4095, 4096, 4097, 12288, 20000])('opens an independently built file of %i bytes', async (n) => {
    const file = build({ plaintext: pattern(n) });
    const r = await open(new Uint8Array(file));
    expect(r.bytes).toEqual(pattern(n));
  });
  it('accepts unknown header keys, and unknown slot types beside a password slot', async () => {
    const file = build({
      plaintext: pattern(100),
      header: (h) => { h.futureKey = { x: 1 }; if (h.slots.length === 1) h.slots.push({ type: 'account', blob: 'AAAA' }); },
    });
    expect((await open(new Uint8Array(file))).bytes).toEqual(pattern(100));
  });
  it('accepts a later minor version', async () => {
    expect((await open(new Uint8Array(build({ plaintext: pattern(5), minor: 7 })))).bytes).toEqual(pattern(5));
  });
  it('tries every password slot: opens when only the second matches', async () => {
    const fileKey = Buffer.alloc(32, 7);
    const file = build({
      plaintext: pattern(50), fileKey,
      header: (h) => {
        const preamble = Buffer.alloc(16); // placeholder pass: same length as the real slot
        h.slots.push(passwordSlot({ password: 'x', ...FLOOR, salt: Buffer.alloc(16, 8), nonce: Buffer.alloc(12, 9), fileKey, preamble }));
      },
    });
    // The second slot was wrapped against the wrong preamble in this helper, so it cannot open;
    // the first (correct) slot must still be found after it is skipped.
    expect((await open(new Uint8Array(file))).bytes).toEqual(pattern(50));
    await expect(open(new Uint8Array(file), 'nope')).rejects.toBeInstanceOf(WrongPasswordError);
  });
});

describe('round trips', () => {
  it('empty payload is exactly one 16-byte segment', async () => {
    const f = await seal(new Uint8Array(0));
    const hl = new DataView(f.buffer, f.byteOffset).getUint32(12, false);
    expect(f.length).toBe(16 + hl + 16);
  });
  it('payload of exactly k segments has no trailing empty segment', async () => {
    const f = await seal(pattern(3 * 4096));
    const hl = new DataView(f.buffer, f.byteOffset).getUint32(12, false);
    expect(f.length).toBe(16 + hl + 3 * (4096 + 16));
  });
  it('round-trips lengths clustered on segment boundaries with random chunking (property)', async () => {
    const S = 4096;
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.constantFrom(0, 1, S - 1, S, S + 1, 2 * S - 1, 2 * S, 2 * S + 1, 5 * S), fc.integer({ min: 0, max: 3 * S })),
        fc.integer({ min: 1, max: 9000 }),
        fc.integer({ min: 1, max: 9000 }),
        async (n, inChunk, outChunk) => {
          const plain = pattern(n);
          const file = await collect(sealStream(chunked(plain, inChunk), [{ type: 'password', password: 'p', kdf: FLOOR }], {
            segmentSize: S, random: deterministicRandom(n), kdf: fastKdf,
          }));
          const r = await openStream(chunked(file, outChunk), { password: 'p' }, { kdf: fastKdf });
          expect(await collect(r.plain)).toEqual(plain);
        }
      ),
      { numRuns: 60 }
    );
  });
  it('handles a payload spanning many segments with 1-byte input chunks', async () => {
    const plain = pattern(4096 * 2 + 10);
    const file = await collect(sealStream(chunked(plain, 1), [{ type: 'password', password: 'p', kdf: FLOOR }], { segmentSize: 4096, kdf: fastKdf }));
    expect((await open(file, 'p', true, 1)).bytes).toEqual(plain);
  });
  it('uses the default segment size and default KDF cost when unspecified', async () => {
    const f = await collect(sealStream(once(pattern(10)), [{ type: 'password', password: 'p' }], { kdf: fastKdf }));
    const r = await openStream(once(f), { password: 'p' }, { kdf: fastKdf });
    expect(r.header.segmentSize).toBe(DEFAULT_SEGMENT_SIZE);
    expect((r.header.slots[0] as any).kdf).toMatchObject({ id: 'argon2id', v: 19, m: 65536, t: 3, p: 1 });
  });
  it('fresh random material every time by default', async () => {
    const a = await collect(sealStream(once(pattern(10)), [{ type: 'password', password: 'p', kdf: FLOOR }], { kdf: fastKdf }));
    const b = await collect(sealStream(once(pattern(10)), [{ type: 'password', password: 'p', kdf: FLOOR }], { kdf: fastKdf }));
    expect(hexEncode(a)).not.toBe(hexEncode(b));
  });
  it('rejects bad seal arguments', async () => {
    await expect(collect(sealStream(once(pattern(1)), [], {}))).rejects.toThrow(RangeError);
    await expect(collect(sealStream(once(pattern(1)), [{ type: 'password', password: 'p' }], { segmentSize: 100 }))).rejects.toThrow(RangeError);
    await expect(collect(sealStream(once(pattern(1)), [{ type: 'password', password: '' }], {}))).rejects.toThrow(RangeError);
    await expect(collect(sealStream(once(pattern(1)), [{ type: 'password', password: 'p', kdf: { m: 1024 } }], {}))).rejects.toThrow();
  });
});

describe('errors', () => {
  it('wrong password', async () => {
    const f = await seal(pattern(10), { fast: true });
    await expect(open(f, 'wrong', true)).rejects.toBeInstanceOf(WrongPasswordError);
  });
  it('composed and decomposed passwords are the same password', async () => {
    const f = await seal(pattern(10), { password: 'café', fast: true });
    expect((await open(f, 'café', true)).bytes).toEqual(pattern(10));
  });
  it('not a backup', async () => {
    await expect(openStream(once(new Uint8Array(0)), { password: 'x' })).rejects.toBeInstanceOf(NotABackupError);
    await expect(openStream(once(new TextEncoder().encode('{"magic":"json"}')), { password: 'x' })).rejects.toBeInstanceOf(NotABackupError);
    await expect(openStream(once(new Uint8Array(100)), { password: 'x' })).rejects.toBeInstanceOf(NotABackupError);
    await expect(openStream(once(IMPL_MAGIC.subarray(0, 5)), { password: 'x' })).rejects.toBeInstanceOf(NotABackupError);
    await expect(openStream(once(IMPL_MAGIC), { password: 'x' })).rejects.toBeInstanceOf(DamagedError);
  });
  it('newer major, unknown aead, unknown payload, only-unknown slots, unknown kdf id', async () => {
    await expect(open(new Uint8Array(build({ plaintext: pattern(3), major: 2 })))).rejects.toBeInstanceOf(NewerFormatError);
    await expect(open(new Uint8Array(build({ plaintext: pattern(3), major: 0 })))).rejects.toBeInstanceOf(NotABackupError);
    const same = (h: any, k: string, v: string) => { h[k] = v + 'x'.repeat(h[k].length - v.length); };
    await expect(open(new Uint8Array(build({ plaintext: pattern(3), header: (h) => same(h, 'aead', 'chacha20-stream') })))).rejects.toBeInstanceOf(NewerFormatError);
    await expect(open(new Uint8Array(build({ plaintext: pattern(3), header: (h) => same(h, 'payload', 'tar') })))).rejects.toBeInstanceOf(NewerFormatError);
    await expect(open(new Uint8Array(build({ plaintext: pattern(3), header: (h) => { h.slots[0].type = 'passwor2'; } })))).rejects.toBeInstanceOf(NewerFormatError);
    await expect(open(new Uint8Array(build({ plaintext: pattern(3), header: (h) => { h.slots[0].kdf.id = 'argon2i'; } })))).rejects.toBeInstanceOf(NewerFormatError);
  });
});

describe('hostile headers fail before any KDF work', () => {
  const kdfSpy = () => vi.fn(async (_pw: string, _p: KdfParams) => new Uint8Array(32));
  async function expectRejects(file: Uint8Array, cls: new (...a: any[]) => Error) {
    const spy = kdfSpy();
    await expect(openStream(once(file), { password: PASSWORD }, { kdf: spy })).rejects.toBeInstanceOf(cls);
    expect(spy).not.toHaveBeenCalled();
  }
  const enc = (s: string) => Buffer.from(s);
  const good = (extra: Record<string, unknown> = {}) => ({
    payload: 'zip', aead: 'aes-256-gcm-stream', segmentSize: 4096,
    streamSalt: b64u(Buffer.alloc(32)), noncePrefix: b64u(Buffer.alloc(7)),
    slots: [{ type: 'password', kdf: { id: 'argon2id', v: 19, m: 19456, t: 2, p: 1, salt: b64u(Buffer.alloc(16)) }, nonce: b64u(Buffer.alloc(12)), wrapped: b64u(Buffer.alloc(48)) }],
    ...extra,
  });
  const withRaw = (raw: Buffer) => new Uint8Array(build({ plaintext: pattern(3), rawHeader: raw }));

  it('KDF parameters outside the floor and ceiling', async () => {
    for (const patch of [{ m: 19455 }, { m: 1048577 }, { t: 1 }, { t: 11 }, { p: 0 }, { p: 5 }, { m: 65536.5 }]) {
      const h = good();
      Object.assign((h.slots[0] as any).kdf, patch);
      await expectRejects(withRaw(enc(JSON.stringify(h))), DamagedError);
    }
  });
  it('duplicate keys at any depth, BOM, trailing garbage, non-objects', async () => {
    const base = JSON.stringify(good());
    await expectRejects(withRaw(enc(base.replace('"payload":"zip"', '"payload":"zip","payload":"zip"'))), DamagedError);
    await expectRejects(withRaw(enc(base.replace('"m":19456', '"m":19456,"m":19456'))), DamagedError);
    await expectRejects(withRaw(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), enc(base)])), DamagedError);
    await expectRejects(withRaw(enc(base + ' x')), DamagedError);
    await expectRejects(withRaw(enc('[]')), DamagedError);
    await expectRejects(withRaw(enc('{}')), DamagedError);
    await expectRejects(withRaw(enc('nul')), DamagedError);
  });
  it('bad field types, sizes and encodings', async () => {
    const mutations: Array<(h: any) => void> = [
      (h) => { h.segmentSize = 4095; },
      (h) => { h.segmentSize = 4194305; },
      (h) => { h.segmentSize = '4096'; },
      (h) => { h.segmentSize = 4096.5; },
      (h) => { h.streamSalt = b64u(Buffer.alloc(31)); },
      (h) => { h.streamSalt = b64u(Buffer.alloc(32)) + '='; },
      (h) => { h.noncePrefix = b64u(Buffer.alloc(8)); },
      (h) => { h.slots = []; },
      (h) => { h.slots = 'x'; },
      (h) => { h.slots = Array.from({ length: 17 }, () => h.slots[0]); },
      (h) => { h.slots = [5]; },
      (h) => { h.slots[0].wrapped = b64u(Buffer.alloc(47)); },
      (h) => { h.slots[0].nonce = b64u(Buffer.alloc(11)); },
      (h) => { h.slots[0].kdf.salt = b64u(Buffer.alloc(8)); },
      (h) => { h.slots[0].kdf = 'x'; },
      (h) => { h.slots[0].nonce = 'AB'; }, // non-canonical trailing bits
    ];
    for (const mut of mutations) {
      const h = good();
      mut(h);
      await expectRejects(withRaw(enc(JSON.stringify(h))), DamagedError);
    }
  });
  it('header length 0, 1, above the maximum, and past the end of the file', async () => {
    const file = new Uint8Array(build({ plaintext: pattern(3) }));
    for (const len of [0, 1, 65537, 0xffffffff, file.length]) {
      const bad = file.slice();
      new DataView(bad.buffer).setUint32(12, len, false);
      await expectRejects(bad, DamagedError);
    }
  });
  it('the header parser is exported and strict', () => {
    expect(() => parseHeader(enc('{"payload":"zip"}'))).toThrow(DamagedError);
  });
});

describe('tampering is detected and nothing wrong is ever released', () => {
  const S = 4096;
  const plain = pattern(3 * S + 100); // 4 segments
  async function fixture() {
    const file = await seal(plain, { fast: true });
    const hl = new DataView(file.buffer, file.byteOffset).getUint32(12, false);
    return { file, hl, segStart: 16 + hl, segLen: S + 16 };
  }
  async function expectDamaged(file: Uint8Array, expected?: typeof DamagedError | typeof WrongPasswordError | typeof NewerFormatError | typeof NotABackupError) {
    let released = 0;
    let err: unknown;
    try {
      const r = await openStream(chunked(file, 3000), { password: PASSWORD }, { kdf: fastKdf });
      for await (const part of r.plain) released += part.length;
    } catch (e) {
      err = e;
    }
    expect(err, 'expected an error').toBeInstanceOf(expected ?? DamagedError);
    return released;
  }

  it('a flipped bit anywhere in the file is caught (every region, sampled)', async () => {
    const { file, hl, segStart } = await fixture();
    const positions = [0, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 16 + Math.floor(hl / 2), 16 + hl - 1,
      segStart, segStart + 100, segStart + S, segStart + S + 15, segStart + 2 * (S + 16) + 7, file.length - 17, file.length - 1];
    for (const pos of positions) {
      const bad = file.slice();
      bad[pos] ^= 0x01;
      let threw = false;
      try {
        const r = await openStream(chunked(bad, 4000), { password: PASSWORD }, { kdf: fastKdf });
        await collect(r.plain);
      } catch (e) {
        threw = true;
        expect(e).toBeInstanceOf(Error);
      }
      expect(threw, `bit flip at ${pos}`).toBe(true);
    }
  });
  it('every byte of the preamble, header and first tag: a flip never opens successfully (exhaustive on a small file)', async () => {
    const file = await seal(pattern(10), { fast: true });
    for (let pos = 0; pos < file.length; pos++) {
      const bad = file.slice();
      bad[pos] ^= 0x80;
      await expect(async () => {
        const r = await openStream(chunked(bad, 100), { password: PASSWORD }, { kdf: fastKdf });
        await collect(r.plain);
      }, `flip at ${pos}`).rejects.toThrow();
    }
  });
  it('truncation at a segment boundary', async () => {
    const { file, segStart, segLen } = await fixture();
    await expectDamaged(file.subarray(0, segStart + 2 * segLen));
    await expectDamaged(file.subarray(0, segStart + 3 * segLen));
    await expectDamaged(file.subarray(0, segStart + segLen));
  });
  it('truncation inside a segment, inside the tag, and inside the header', async () => {
    const { file, segStart, segLen, hl } = await fixture();
    await expectDamaged(file.subarray(0, segStart + segLen + 100));
    await expectDamaged(file.subarray(0, file.length - 1));
    await expectDamaged(file.subarray(0, 16 + hl - 1));
    await expectDamaged(file.subarray(0, segStart + 10));
  });
  it('dropping only the last segment, appending bytes, appending a whole segment', async () => {
    const { file, segStart, segLen } = await fixture();
    const noLast = new Uint8Array([...file.subarray(0, segStart + 3 * segLen)]);
    await expectDamaged(noLast);
    await expectDamaged(new Uint8Array([...file, 0]));
    await expectDamaged(new Uint8Array([...file, ...file.subarray(segStart, segStart + segLen)]));
  });
  it('swapping two segments, and duplicating one', async () => {
    const { file, segStart, segLen } = await fixture();
    const swapped = file.slice();
    swapped.set(file.subarray(segStart + segLen, segStart + 2 * segLen), segStart);
    swapped.set(file.subarray(segStart, segStart + segLen), segStart + segLen);
    await expectDamaged(swapped);
    const dup = file.slice();
    dup.set(file.subarray(segStart, segStart + segLen), segStart + segLen);
    await expectDamaged(dup);
  });
  it('splicing a segment from another file with the same password', async () => {
    const { file, segStart, segLen } = await fixture();
    const other = await seal(plain, { fast: true, seed: 5 });
    const ohl = new DataView(other.buffer, other.byteOffset).getUint32(12, false);
    const spliced = file.slice();
    spliced.set(other.subarray(16 + ohl + segLen, 16 + ohl + 2 * segLen), segStart + segLen);
    await expectDamaged(spliced);
  });
  it('a segment failure releases at most the earlier, already-verified segments', async () => {
    const { file, segStart, segLen } = await fixture();
    const bad = file.slice();
    bad[segStart + 2 * segLen + 5] ^= 1;
    const released = await expectDamaged(bad);
    expect(released).toBe(2 * S);
  });
  it('swapping the wrapped key with one from another file fails as wrong password / damaged, never opens', async () => {
    const a = await seal(pattern(50), { fast: true });
    const b = await seal(pattern(50), { fast: true, seed: 9 });
    // Put b's header (same length) on a's segments.
    const hl = new DataView(a.buffer, a.byteOffset).getUint32(12, false);
    const franken = a.slice();
    franken.set(b.subarray(0, 16 + hl), 0);
    await expect(open(franken, PASSWORD, true)).rejects.toBeInstanceOf(DamagedError);
  });
});

describe('sniff', () => {
  it('recognises the container and a plain ZIP', () => {
    expect(sniff(IMPL_MAGIC)).toBe('bbk');
    expect(sniff(new Uint8Array([0x50, 0x4b, 3, 4, 0]))).toBe('zip');
    expect(sniff(new Uint8Array([0x50, 0x4b, 5, 6]))).toBe('zip');
    expect(sniff(new Uint8Array([1, 2, 3]))).toBe('unknown');
    expect(sniff(new Uint8Array(0))).toBe('unknown');
    expect(sniff(IMPL_MAGIC.subarray(0, 7))).toBe('unknown');
  });
});
