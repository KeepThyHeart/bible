/**
 * The round-trip matrix every content codec must satisfy (task 0027 F4).
 *
 * One suite over all three codecs, bound and unbound, rather than three
 * near-identical suites: the contract is `IContentCodec`, and a codec that
 * passes here is interchangeable with the others everywhere
 * `BaseModuleRepository.text()` uses one. Codec-specific behaviour - raw vs
 * wrapped DEFLATE, zstd frame headers - lives in `DeflateCodec.test.ts` and
 * `ZstdCodec.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { DeflateCodec } from './DeflateCodec';
import { NoneCodec } from './NoneCodec';
import { ZstdCodec, isZstdAvailable } from './ZstdCodec';
import { IContentCodec } from './IContentCodec';
import {
  CODEC_CORPUS,
  CODEC_CORPUS_CASES,
  OTHER_DICTIONARY,
  TEST_DICTIONARY,
} from '../../../__tests__/helpers/codecFixtures';

/**
 * The codecs under test. `zstd` is included only where the runtime has it
 * (Node >= 22.15) - skipping is the honest result on an older one, and
 * `isZstdAvailable()` is the same question `createNodeCodecs()` asks.
 */
const CODECS: ReadonlyArray<readonly [string, () => IContentCodec]> = [
  ['none', () => new NoneCodec()],
  ['deflate', () => new DeflateCodec()],
  ...(isZstdAvailable() ? ([['zstd', () => new ZstdCodec()]] as const) : []),
];

describe('content codecs', () => {
  it('runs against every codec the Node runtime registers', () => {
    // Guards the list above against silently shrinking to one codec.
    expect(CODECS.map(([name]) => name)).toContain('deflate');
    expect(isZstdAvailable()).toBe(true); // Node 24 / Electron 44 both have it
    expect(CODECS).toHaveLength(3);
  });

  describe.each(CODECS)('%s', (name, make) => {
    it('reports itself as the codec module_info names', () => {
      expect(make().codec).toBe(name);
    });

    describe.each(CODEC_CORPUS_CASES)('%s', (_label, text) => {
      it('round-trips unbound', () => {
        const codec = make();
        expect(codec.decode(codec.encode(text))).toBe(text);
      });

      it('round-trips bound to a dictionary', () => {
        const codec = make().withDictionary(TEST_DICTIONARY);
        expect(codec.decode(codec.encode(text))).toBe(text);
      });

      it('returns an already-uncompressed string unchanged', () => {
        // The per-cell "keep the blob only if it is smaller" build rule means
        // a compressed module legitimately still holds TEXT in short cells.
        expect(make().decode(text)).toBe(text);
        expect(make().withDictionary(TEST_DICTIONARY).decode(text)).toBe(text);
      });
    });

    it('encodes to bytes, not to a string', () => {
      const encoded = make().encode(CODEC_CORPUS.prose);
      expect(encoded).toBeInstanceOf(Uint8Array);
    });

    it('decodes a plain Uint8Array as readily as a Buffer', () => {
      // better-sqlite3 hands back a Buffer, but ISql only promises a
      // Uint8Array, and a codec that quietly needed Buffer methods would
      // work in every test and fail under another ISql implementation.
      const codec = make();
      const buffer = codec.encode(CODEC_CORPUS.prose);
      const plain = Uint8Array.from(buffer);
      expect(Buffer.isBuffer(plain)).toBe(false);
      expect(codec.decode(plain)).toBe(CODEC_CORPUS.prose);
    });

    it('decodes a byte view that does not start at offset 0', () => {
      // Guards the zero-copy Buffer wrapping in DeflateCodec: a view with a
      // non-zero byteOffset must decode as itself, not as its whole backing
      // ArrayBuffer.
      const codec = make();
      const frame = codec.encode(CODEC_CORPUS.prose);
      const padded = new Uint8Array(frame.length + 7);
      padded.set(frame, 7);
      const view = padded.subarray(7);
      expect(view.byteOffset).toBe(7);
      expect(codec.decode(view)).toBe(CODEC_CORPUS.prose);
    });
  });

  describe('dictionary binding', () => {
    // NoneCodec has no dictionary concept; these are about the two real ones.
    const REAL = CODECS.filter(([name]) => name !== 'none');

    describe.each(REAL)('%s', (_name, make) => {
      it('asks for a dictionary lookup while unbound, and not after', () => {
        const unbound = make();
        expect(unbound.needsDictionary).toBe(true);
        expect(unbound.withDictionary(TEST_DICTIONARY).needsDictionary).toBe(false);
      });

      it('returns a NEW instance rather than mutating the receiver', () => {
        const unbound = make();
        const bound = unbound.withDictionary(TEST_DICTIONARY);

        expect(bound).not.toBe(unbound);
        expect(unbound.needsDictionary).toBe(true);
        // The registry's shared instance must stay usable for other modules:
        // a frame it encodes is still decodable by an equally unbound codec.
        expect(make().decode(unbound.encode(CODEC_CORPUS.prose))).toBe(CODEC_CORPUS.prose);
      });

      it('unbinds again on withDictionary(null)', () => {
        const rebound = make().withDictionary(TEST_DICTIONARY).withDictionary(null);
        expect(rebound.needsDictionary).toBe(true);
        expect(rebound.decode(rebound.encode(CODEC_CORPUS.ascii))).toBe(CODEC_CORPUS.ascii);
      });

      it('actually uses the dictionary: a bound frame is smaller', () => {
        // A dictionary that changed nothing would make every test above pass
        // while the feature did nothing. The corpus entry is short prose whose
        // phrases appear in TEST_DICTIONARY, which is the case dictionaries
        // exist for.
        const withDict = make().withDictionary(TEST_DICTIONARY).encode(CODEC_CORPUS.ascii);
        const without = make().encode(CODEC_CORPUS.ascii);
        expect(withDict.length).toBeLessThan(without.length);
      });

      it('does not silently decode a dictionary-bound frame without the dictionary', () => {
        // The failure this format cannot afford: plausible-looking wrong text.
        // Either it throws, or (never observed for these inputs) it differs -
        // what it must NOT do is return the original string.
        const frame = make().withDictionary(TEST_DICTIONARY).encode(CODEC_CORPUS.repetitive);
        let decoded: string | undefined;
        try {
          decoded = make().decode(frame);
        } catch {
          decoded = undefined;
        }
        expect(decoded).not.toBe(CODEC_CORPUS.repetitive);
      });

      it('does not silently decode with the WRONG dictionary', () => {
        const frame = make().withDictionary(TEST_DICTIONARY).encode(CODEC_CORPUS.repetitive);
        let decoded: string | undefined;
        try {
          decoded = make().withDictionary(OTHER_DICTIONARY).decode(frame);
        } catch {
          decoded = undefined;
        }
        expect(decoded).not.toBe(CODEC_CORPUS.repetitive);
      });
    });
  });

  describe('NoneCodec', () => {
    it('never asks for a dictionary and ignores one offered', () => {
      const none = new NoneCodec();
      expect(none.needsDictionary).toBe(false);
      expect(none.withDictionary(TEST_DICTIONARY)).toBe(none);
    });

    it('is the UTF-8 identity, not a copy of some other encoding', () => {
      const none = new NoneCodec();
      expect(none.encode(CODEC_CORPUS.utf8)).toEqual(
        new Uint8Array(Buffer.from(CODEC_CORPUS.utf8, 'utf8'))
      );
      expect(none.decode(new TextEncoder().encode(CODEC_CORPUS.utf8))).toBe(CODEC_CORPUS.utf8);
    });
  });

  describe('corrupt input', () => {
    // A registered codec failing on damaged bytes is a real error, not a
    // capability question: it must surface, not decode to something plausible.
    describe.each(CODECS.filter(([name]) => name !== 'none'))('%s', (_name, make) => {
      it('throws on a truncated frame', () => {
        const frame = make().encode(CODEC_CORPUS.repetitive);
        expect(() => make().decode(frame.subarray(0, Math.floor(frame.length / 2)))).toThrow();
      });

      it('throws on bytes that are not a frame at all', () => {
        expect(() => make().decode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow();
      });
    });
  });
});
