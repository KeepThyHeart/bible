/**
 * The Node/Electron composition root for content codecs.
 *
 * This file - and only this file - decides which codecs a Node or Electron
 * process can read modules with. Nothing else in `packages/core` may name a
 * codec set: a different runtime (the browser worker, out of scope for this
 * pass) builds its own {@link CodecRegistry} from whatever it can actually
 * run, which for a browser is `none` + `deflate` and not `zstd`.
 */

import { CodecRegistry } from './CodecRegistry';
import { DeflateCodec } from './DeflateCodec';
import { IContentCodec } from './IContentCodec';
import { NoneCodec } from './NoneCodec';
import { ZstdCodec, isZstdAvailable } from './ZstdCodec';

/**
 * The codec set for this runtime: `none` and `deflate` always, plus `zstd`
 * when `node:zlib` has it (Node >= 22.15; Electron 44 bundles Node 24.20, so
 * in practice always, in this app).
 *
 * `zstd` is conditional rather than unconditional because a registry entry is
 * a promise that the codec works. Registering one that throws
 * `ZstdUnavailableError` on first use would convert a clean capability answer
 * (`readContent: false, reason: 'missing-codec'`, the module greyed out in
 * the library) into a crash at the moment someone opens a commentary. Absent
 * is the honest state, and `ICodecRegistry.get()` returning `null` is how
 * this layer says "not in this build".
 */
export function createNodeCodecs(): IContentCodec[] {
  const codecs: IContentCodec[] = [new NoneCodec(), new DeflateCodec()];
  if (isZstdAvailable()) {
    codecs.push(new ZstdCodec());
  }
  return codecs;
}

/** A fresh registry over {@link createNodeCodecs}. */
export function createNodeCodecRegistry(): CodecRegistry {
  return new CodecRegistry(createNodeCodecs());
}

let shared: CodecRegistry | undefined;

/**
 * The process-wide Node/Electron registry, built on first use.
 *
 * Shared because a registry is immutable and its codecs are unbound (see
 * {@link CodecRegistry}), so there is nothing per-module in it to keep apart
 * - and because `BaseModuleRepository` needs a default that does not force
 * every existing construction site of every repository to grow an argument.
 * Anything that wants a different set (a test, or a non-Node runtime) passes
 * its own registry to the repository constructor instead.
 */
export function nodeCodecRegistry(): CodecRegistry {
  if (!shared) {
    shared = createNodeCodecRegistry();
  }
  return shared;
}
