/**
 * The registry contract (task 0027 F4): a missing codec is an answer, never
 * an exception, and a runtime's codec set lives in its composition root.
 */

import { describe, it, expect } from 'vitest';
import { CodecRegistry } from './CodecRegistry';
import { DeflateCodec } from './DeflateCodec';
import { NoneCodec } from './NoneCodec';
import { ZstdCodec, isZstdAvailable } from './ZstdCodec';
import { CompressionCodec } from '../../Format/ModuleFormat';
import { createNodeCodecRegistry, nodeCodecRegistry } from './NodeCodecs';
import { CODEC_CORPUS, TEST_DICTIONARY } from '../../../__tests__/helpers/codecFixtures';

describe('CodecRegistry', () => {
  it('answers for the codecs it was given', () => {
    const registry = new CodecRegistry([new NoneCodec(), new DeflateCodec()]);

    expect(registry.has('none')).toBe(true);
    expect(registry.has('deflate')).toBe(true);
    expect(registry.get('deflate')).toBeInstanceOf(DeflateCodec);
    expect(registry.available().sort()).toEqual(['deflate', 'none']);
  });

  it('returns null - never throws - for a codec this runtime has not got', () => {
    // The browser runtime's set, modelled: none + deflate, no zstd.
    const browserish = new CodecRegistry([new NoneCodec(), new DeflateCodec()]);

    expect(browserish.has('zstd')).toBe(false);
    expect(() => browserish.get('zstd')).not.toThrow();
    expect(browserish.get('zstd')).toBeNull();
  });

  it('returns null for a codec name outside CompressionCodec entirely', () => {
    // `module_info.compression` is an open set with no CHECK constraint, so a
    // future (or broken) publisher can write anything at all into it. That
    // must reach the registry as a plain "no", not as a crash.
    const registry = createNodeCodecRegistry();

    expect(registry.get('brotli' as CompressionCodec)).toBeNull();
    expect(registry.get('' as CompressionCodec)).toBeNull();
    expect(registry.has('lzma' as CompressionCodec)).toBe(false);
  });

  it('lets a later entry override an earlier one of the same name', () => {
    const override = new DeflateCodec(TEST_DICTIONARY);
    const registry = new CodecRegistry([new DeflateCodec(), override]);

    expect(registry.get('deflate')).toBe(override);
    expect(registry.available()).toEqual(['deflate']);
  });

  it('hands out UNBOUND codecs that binding a dictionary does not disturb', () => {
    // One registry is shared by every open module in the process, so binding
    // a dictionary for one module must not change what the next module gets.
    const registry = createNodeCodecRegistry();
    const first = registry.get('deflate')!;

    first.withDictionary(TEST_DICTIONARY);

    expect(registry.get('deflate')).toBe(first);
    expect(registry.get('deflate')!.needsDictionary).toBe(true);
    expect(first.decode(first.encode(CODEC_CORPUS.ascii))).toBe(CODEC_CORPUS.ascii);
  });
});

describe('the Node/Electron composition root', () => {
  it('registers none and deflate unconditionally', () => {
    const registry = createNodeCodecRegistry();

    expect(registry.get('none')).toBeInstanceOf(NoneCodec);
    expect(registry.get('deflate')).toBeInstanceOf(DeflateCodec);
  });

  it('registers zstd exactly when the runtime can run it', () => {
    // Registering a codec that would throw on first use turns a clean
    // capability answer into a crash, so availability decides.
    const registry = createNodeCodecRegistry();

    if (isZstdAvailable()) {
      expect(registry.get('zstd')).toBeInstanceOf(ZstdCodec);
    } else {
      expect(registry.get('zstd')).toBeNull();
    }
  });

  it('shares one immutable registry across the process', () => {
    expect(nodeCodecRegistry()).toBe(nodeCodecRegistry());
    expect(nodeCodecRegistry()).not.toBe(createNodeCodecRegistry());
  });
});
