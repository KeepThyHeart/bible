/**
 * A short fuzz run over the readers: whatever bytes a hostile or damaged file
 * holds, opening it may only fail with one of the typed errors (never a generic
 * TypeError or RangeError, never a hang), and a mutated file must never open to
 * different content than the original.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'fs';
import { join } from 'path';
import { openStream } from '../../Backup/Envelope';
import { readBackupFile } from '../../Backup/BackupFile';
import { readBackupPayload, parseManifest, decodeNdjson, createBackupPayload } from '../../Backup/Payload';
import { BackupError } from '../../Backup/errors';
import { collect, chunked, once } from '../../Backup/Streams';
import { parseStrictJson, StrictJsonError } from '../../Backup/StrictJson';
import { ZipError } from '../../Backup/Zip';
import { newUserDb, wopts } from './restoreHelpers';
import { seedRich } from './seed';
import { pattern } from './envelopeSpec';

const fast = async (pw: string) => new Uint8Array(32).fill(pw.length);
const isTyped = (e: unknown) => e instanceof BackupError || e instanceof ZipError || e instanceof StrictJsonError;
const RUNS = Number(process.env.FC_RUNS ?? 150);

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));

describe('fuzzing the encrypted container', () => {
  const S = 4096;
  it('a mutated golden file is either rejected with a typed error or opens to the original plaintext', async () => {
    const original = fixture('3s.bbk');
    const plain = pattern(3 * S);
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.integer({ min: 0, max: original.length - 1 }), fc.integer({ min: 0, max: 255 })), { minLength: 1, maxLength: 4 }),
        fc.option(fc.integer({ min: 0, max: original.length }), { nil: undefined }),
        fc.integer({ min: 1, max: 9000 }),
        async (edits, cut, chunk) => {
          let bytes = original.slice();
          for (const [pos, value] of edits) bytes[pos] = value;
          if (cut !== undefined) bytes = bytes.slice(0, cut);
          const same = bytes.length === original.length && bytes.every((b, i) => b === original[i]);
          try {
            // The golden files use the real Argon2id; a wrong-password stand-in is enough to prove the parsing paths.
            const r = await openStream(chunked(bytes, chunk), { password: 'correct horse battery' });
            const out = await collect(r.plain);
            expect(same, 'a changed file opened').toBe(true);
            expect(out).toEqual(plain);
          } catch (e) {
            expect(isTyped(e), `untyped error: ${e instanceof Error ? e.stack : String(e)}`).toBe(true);
          }
        }
      ),
      { numRuns: Math.min(RUNS, 40) }
    );
  }, 120000);

  it('random bytes and random headers are rejected with typed errors', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 300 }), async (junk) => {
        try {
          await openStream(once(junk), { password: 'x' }, { kdf: fast });
          throw new Error('opened random bytes');
        } catch (e) {
          expect(isTyped(e), String(e)).toBe(true);
        }
      }),
      { numRuns: RUNS }
    );
    // Valid preamble, random header bytes of the declared length.
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 2, maxLength: 200 }), async (header) => {
        const file = new Uint8Array(16 + header.length + 32);
        file.set([0x89, 0x4b, 0x54, 0x48, 0x42, 0x0d, 0x0a, 0x1a, 0, 1, 0, 0], 0);
        new DataView(file.buffer).setUint32(12, header.length, false);
        file.set(header, 16);
        try {
          await openStream(once(file), { password: 'x' }, { kdf: fast });
          throw new Error('opened a random header');
        } catch (e) {
          expect(isTyped(e), String(e)).toBe(true);
        }
      }),
      { numRuns: RUNS }
    );
  });
});

describe('fuzzing the payload readers', () => {
  it('parsers only fail with typed errors', () => {
    fc.assert(fc.property(fc.string({ maxLength: 200 }), (s) => {
      try { parseStrictJson(s); } catch (e) { expect(e instanceof StrictJsonError, String(e)).toBe(true); }
      try { parseManifest(new TextEncoder().encode(s)); } catch (e) { expect(isTyped(e), String(e)).toBe(true); }
      try { decodeNdjson(new TextEncoder().encode(s)); } catch (e) { expect(isTyped(e), String(e)).toBe(true); }
    }), { numRuns: RUNS * 4 });
  });

  it('JSON that names __proto__, constructor or prototype does not pollute anything', () => {
    for (const s of ['{"__proto__":{"polluted":1}}', '{"a":{"__proto__":{"polluted":1}}}']) {
      try { parseStrictJson(s); } catch { /* fine */ }
    }
    expect(() => decodeNdjson(new TextEncoder().encode('{"__proto__":1,"x":2}\n'))).toThrow(/Malformed row/);
    expect(() => decodeNdjson(new TextEncoder().encode('{"__proto__":{"$b64":"AAAA"}}\n'))).toThrow(/Malformed row/);
    const rows = decodeNdjson(new TextEncoder().encode('{"constructor":2,"prototype":3}\n'));
    expect(Object.getPrototypeOf(rows[0])).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('a mutated ZIP payload is rejected with a typed error, or restores to identical entries', async () => {
    const a = newUserDb();
    seedRich(a);
    const { zip } = await createBackupPayload({ sql: a }, wopts());
    const good = await readBackupPayload(once(zip));
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.integer({ min: 0, max: zip.length - 1 }), fc.integer({ min: 0, max: 255 })), { minLength: 1, maxLength: 3 }),
        fc.integer({ min: 1, max: 4000 }),
        async (edits, chunk) => {
          const bytes = zip.slice();
          for (const [pos, value] of edits) bytes[pos] = value;
          try {
            const r = await readBackupFile(chunked(bytes, chunk));
            // Accepted: every entry is verified against the manifest's checksums, so the data must be the original.
            expect([...r.entries.keys()].sort()).toEqual([...good.entries.keys()].sort());
            for (const [k, v] of r.entries) expect(v).toEqual(good.entries.get(k));
          } catch (e) {
            expect(isTyped(e), `untyped error: ${e instanceof Error ? e.stack : String(e)}`).toBe(true);
          }
        }
      ),
      { numRuns: Math.min(RUNS, 80) }
    );
  }, 120000);
});
