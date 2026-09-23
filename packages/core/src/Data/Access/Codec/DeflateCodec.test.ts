/**
 * The raw-vs-wrapped DEFLATE distinction (task 0027 F4).
 *
 * `module_info.compression = 'deflate'` means RAW DEFLATE - RFC 1951, nothing
 * around it. Three different things in `node:zlib` produce a `Buffer` from a
 * `Buffer` and all three are called "deflate" in conversation:
 *
 *   | call              | format   | wrapper                              |
 *   |-------------------|----------|--------------------------------------|
 *   | `deflateRawSync`  | RFC 1951 | none - THIS is `'deflate'`           |
 *   | `deflateSync`     | RFC 1950 | 2-byte CMF/FLG + 4-byte Adler-32     |
 *   | `gzipSync`        | RFC 1952 | 10+ byte header + CRC32 + length     |
 *
 * Nothing in a type system separates them, every real module ships
 * `compression = 'none'` today so no existing test would notice, and a
 * publisher that picked the wrong one would bake the mistake into every
 * module it ever built. Hence this file: the distinction is pinned to real
 * bytes and real failures, not to a comment.
 */

import { describe, it, expect } from 'vitest';
import * as zlib from 'node:zlib';
import { DeflateCodec } from './DeflateCodec';
import { CODEC_CORPUS, TEST_DICTIONARY } from '../../../__tests__/helpers/codecFixtures';

const TEXT = CODEC_CORPUS.repetitive;
const BYTES = Buffer.from(TEXT, 'utf8');

describe('DeflateCodec: raw DEFLATE, not zlib-wrapped, not gzip', () => {
  describe('what it writes', () => {
    it('emits exactly what zlib.deflateRawSync emits', () => {
      const encoded = new DeflateCodec().encode(TEXT);
      const raw = zlib.deflateRawSync(BYTES, { level: 9 });

      expect(Buffer.from(encoded)).toEqual(raw);
    });

    it('emits a frame with no wrapper bytes at all', () => {
      const encoded = Buffer.from(new DeflateCodec().encode(TEXT));
      const wrapped = zlib.deflateSync(BYTES, { level: 9 });
      const gzipped = zlib.gzipSync(BYTES, { level: 9 });

      // A zlib stream's CMF byte is 0x78 for the 32 KiB window every
      // implementation uses (FLEVEL, the low bits of FLG, varies with the
      // level: 0x9c at 6, 0xda at 9). gzip starts 1f 8b. Raw starts with the
      // first DEFLATE block header, whatever that happens to be.
      expect(wrapped.subarray(0, 2).toString('hex')).toBe('78da');
      expect(gzipped.subarray(0, 2).toString('hex')).toBe('1f8b');
      expect(encoded[0]).not.toBe(0x78);
      expect(encoded.subarray(0, 2).toString('hex')).not.toBe('1f8b');

      // And it is exactly the 6 wrapper bytes shorter than the zlib form:
      // the 2-byte header and the 4-byte Adler-32 trailer, nothing else.
      expect(encoded.length).toBe(wrapped.length - 6);
      expect(wrapped.subarray(2, wrapped.length - 4)).toEqual(encoded);
    });

    it('is readable by a plain raw inflate, with no knowledge of this project', () => {
      // The interoperability claim the whole design rests on: any runtime
      // with raw inflate - Node, a browser's DecompressionStream('deflate-raw'),
      // pako - reads a cell straight out of the file.
      const encoded = new DeflateCodec().encode(TEXT);
      expect(zlib.inflateRawSync(Buffer.from(encoded)).toString('utf8')).toBe(TEXT);
    });
  });

  describe('what it refuses to read', () => {
    // THE test. A wrapped frame reaching a raw decoder must not produce
    // plausible-looking text. It must fail, loudly, every time.
    it('does not decode a zlib-WRAPPED deflate frame as if it were raw', () => {
      const wrapped = zlib.deflateSync(BYTES, { level: 9 });
      const codec = new DeflateCodec();

      expect(() => codec.decode(wrapped)).toThrow();
      // Named, so a future change that turned this into some other failure
      // (or into success) is visible in the diff.
      expect(() => codec.decode(wrapped)).toThrow(/Z_DATA_ERROR|incorrect header|invalid/i);
    });

    it('does not decode a gzip frame as if it were raw', () => {
      expect(() => new DeflateCodec().decode(zlib.gzipSync(BYTES, { level: 9 }))).toThrow();
    });

    it('produces bytes a WRAPPED inflate cannot read either - the mistake is symmetric', () => {
      // The publisher-side half of the same confusion: a reader that used
      // inflateSync against frames this codec wrote would fail just as hard,
      // which is why neither side can drift unnoticed.
      const encoded = Buffer.from(new DeflateCodec().encode(TEXT));
      expect(() => zlib.inflateSync(encoded)).toThrow();
      expect(() => zlib.gunzipSync(encoded)).toThrow();
    });

    it('rejects a wrapped frame for every corpus entry, not just one', () => {
      // A single sample could fail by luck of its first bytes. A zlib header
      // (0x78 ...) read as raw DEFLATE always decodes as BTYPE=00 "stored",
      // whose LEN/~LEN check then has to pass by chance for the failure to be
      // missed - roughly 1 in 65,536, so "it threw once" is not proof.
      const codec = new DeflateCodec();
      for (const [label, text] of Object.entries(CODEC_CORPUS)) {
        const wrapped = zlib.deflateSync(Buffer.from(text, 'utf8'), { level: 9 });
        let decoded: string | undefined;
        try {
          decoded = codec.decode(wrapped);
        } catch {
          decoded = undefined;
        }
        expect(decoded, `wrapped '${label}' must not decode as raw`).not.toBe(text);
      }
    });
  });

  describe('preset dictionary', () => {
    it('passes the dictionary to inflate as well as deflate', () => {
      const codec = new DeflateCodec().withDictionary(TEST_DICTIONARY);
      const encoded = codec.encode(CODEC_CORPUS.prose);

      // The external check: the frame is readable by a stock raw inflate that
      // is handed the same dictionary bytes, and only by that one.
      expect(
        zlib.inflateRawSync(Buffer.from(encoded), { dictionary: Buffer.from(TEST_DICTIONARY) })
          .toString('utf8')
      ).toBe(CODEC_CORPUS.prose);
    });

    it('records no dictionary id in the frame - which is why the schema carries one', () => {
      // RFC 1951 has no DICTID field (RFC 1950 does, which is exactly what
      // the wrapper buys and what `compression_dictionary.dict_id` replaces).
      // Evidence: the dictionary changes the frame's CONTENT, never its
      // length in a way that encodes an id, and the two frames below differ
      // only as compressed data - there is no fixed id-shaped prefix.
      const bound = Buffer.from(new DeflateCodec().withDictionary(TEST_DICTIONARY).encode(TEXT));
      const unbound = Buffer.from(new DeflateCodec().encode(TEXT));

      expect(bound).not.toEqual(unbound);
      expect(bound.subarray(0, 4)).not.toEqual(unbound.subarray(0, 4));
      // Round-tripping the bound frame through an unbound decoder gives
      // either an error or wrong bytes - never a clean rejection naming the
      // dictionary, because there is nothing in the frame to name it with.
      let decoded: string | undefined;
      try {
        decoded = new DeflateCodec().decode(bound);
      } catch {
        decoded = undefined;
      }
      expect(decoded).not.toBe(TEXT);
    });
  });

  describe('level', () => {
    it('encodes at level 9 - publish once, read often', () => {
      const encoded = new DeflateCodec().encode(TEXT);
      expect(Buffer.from(encoded)).toEqual(zlib.deflateRawSync(BYTES, { level: 9 }));
      expect(encoded.length).toBeLessThanOrEqual(zlib.deflateRawSync(BYTES, { level: 1 }).length);
    });
  });
});
