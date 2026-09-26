/**
 * zstd framing and the one thing Node's zstd does not tell you (task 0027 F4).
 *
 * The round-trip matrix is in `ContentCodecs.test.ts`. This file covers what
 * is specific to zstd: that the frames are STANDARD ones (the design
 * explicitly rejected a magicless variant), that a dictionary-bound frame
 * cannot be mistaken for an unbound one, and that a truncated frame is
 * detected - which `zlib.zstdDecompressSync` on its own does NOT do before
 * Node 24.21.
 */

import { describe, it, expect } from 'vitest';
import * as zlib from 'node:zlib';
import { ZstdCodec, declaredFrameContentSize, isZstdAvailable } from './ZstdCodec';
import { CODEC_CORPUS, TEST_DICTIONARY } from '../../../__tests__/helpers/codecFixtures';

/**
 * `node:zlib`'s zstd functions, typed locally: the package pins
 * `@types/node@^20`, which predates zstd in Node core. Same one-cast-at-the
 * -boundary treatment `ZstdCodec.ts` itself uses, and the reason these tests
 * can call the platform directly to cross-check the codec's output.
 */
const nodeZstd = zlib as unknown as {
  zstdDecompressSync(data: Uint8Array, options?: { dictionary?: Uint8Array }): Buffer;
};

/** `28 b5 2f fd`, RFC 8878 §3.1.1. */
const ZSTD_MAGIC = '28b52ffd';

const TEXT = CODEC_CORPUS.repetitive;

describe('ZstdCodec', () => {
  it('is available on this runtime', () => {
    // Node >= 22.15 / Electron >= 37. If this ever fails, `createNodeCodecs()`
    // is right to drop zstd from the registry and the rest of this file is
    // correctly moot - but on Node 24 / Electron 44 it must not.
    expect(isZstdAvailable()).toBe(true);
    expect(process.versions.node.split('.').map(Number)[0]).toBeGreaterThanOrEqual(22);
  });

  describe('standard framing', () => {
    it('emits a frame with the zstd magic, not a stripped variant', () => {
      const frame = Buffer.from(new ZstdCodec().encode(TEXT));
      expect(frame.subarray(0, 4).toString('hex')).toBe(ZSTD_MAGIC);
    });

    it('is readable by a stock zstd decompressor that knows nothing of this project', () => {
      const frame = new ZstdCodec().encode(TEXT);
      expect(nodeZstd.zstdDecompressSync(Buffer.from(frame)).toString('utf8')).toBe(TEXT);
    });

    it('keeps the magic when a dictionary is bound', () => {
      const frame = Buffer.from(new ZstdCodec().withDictionary(TEST_DICTIONARY).encode(TEXT));
      expect(frame.subarray(0, 4).toString('hex')).toBe(ZSTD_MAGIC);
    });

    it('declares the uncompressed size in the frame header', () => {
      // Not decoration: `declaredFrameContentSize` is the truncation check
      // below, and it only works because one-shot compression records this.
      expect(declaredFrameContentSize(new ZstdCodec().encode(TEXT))).toBe(
        Buffer.byteLength(TEXT, 'utf8')
      );
      expect(declaredFrameContentSize(new ZstdCodec().encode(CODEC_CORPUS.ascii))).toBe(
        Buffer.byteLength(CODEC_CORPUS.ascii, 'utf8')
      );
      expect(declaredFrameContentSize(new ZstdCodec().encode(CODEC_CORPUS.utf8))).toBe(
        Buffer.byteLength(CODEC_CORPUS.utf8, 'utf8')
      );
    });

    it('reports no declared size for bytes that are not a zstd frame', () => {
      expect(declaredFrameContentSize(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
      expect(declaredFrameContentSize(new Uint8Array([0x28, 0xb5]))).toBeNull();
    });
  });

  describe('truncation', () => {
    /**
     * Node's own zstd has reported a truncated frame both ways: up to at least
     * 24.20 (Electron 44's Node) it returns what it managed to decode, which
     * for a frame cut in half is zero bytes; 24.21 throws Z_BUF_ERROR. Pinned
     * here as a fact about the platform, because the codec's guard exists to
     * compensate for the silent form and would look like dead code otherwise.
     */
    it('is silently empty or Z_BUF_ERROR through node:zlib alone - the reason the guard exists', () => {
      const frame = Buffer.from(new ZstdCodec().encode(TEXT));
      const half = frame.subarray(0, Math.floor(frame.length / 2));

      let naive: Buffer | null = null;
      let error: unknown = null;
      try {
        naive = nodeZstd.zstdDecompressSync(half);
      } catch (err) {
        error = err;
      }
      if (error) {
        expect((error as { code?: string }).code).toBe('Z_BUF_ERROR');
      } else {
        expect(naive!.length).toBe(0); // no throw, no content, no warning
      }
    });

    it('throws through the codec instead of decoding to an empty string', () => {
      const frame = new ZstdCodec().encode(TEXT);
      const half = frame.subarray(0, Math.floor(frame.length / 2));

      expect(() => new ZstdCodec().decode(half)).toThrow(/truncated or corrupt/);
    });
  });

  describe('dictionary', () => {
    it('cannot be decoded without the dictionary it was bound to', () => {
      const frame = new ZstdCodec().withDictionary(TEST_DICTIONARY).encode(TEXT);
      expect(() => new ZstdCodec().decode(frame)).toThrow();
    });

    it('decodes through a stock decompressor given the same dictionary bytes', () => {
      const frame = new ZstdCodec().withDictionary(TEST_DICTIONARY).encode(CODEC_CORPUS.prose);
      const out = nodeZstd.zstdDecompressSync(Buffer.from(frame), {
        dictionary: Buffer.from(TEST_DICTIONARY),
      });
      expect(out.toString('utf8')).toBe(CODEC_CORPUS.prose);
    });

    it('leaves dictID at 0 for a raw-content dictionary, and says so', () => {
      // `TEST_DICTIONARY` is plain text, i.e. a "raw content dictionary": zstd
      // accepts it, but there is no trained dictionary header to take an id
      // from, so the frame records none. A dictionary produced by
      // `zstd --train` would carry one. Either way the frame is unreadable
      // without the right bytes (previous test) - the id is a diagnostic, not
      // the safety mechanism, which is why `compression_dictionary.dict_id`
      // is the schema's own record of it.
      const frame = Buffer.from(new ZstdCodec().withDictionary(TEST_DICTIONARY).encode(TEXT));
      const dictIdFlag = frame[4] & 0b11;
      expect(dictIdFlag).toBe(0);
    });
  });
});
