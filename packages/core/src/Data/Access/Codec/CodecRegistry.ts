/**
 * The concrete {@link ICodecRegistry}: a runtime's codec set, built once in
 * that runtime's composition root.
 */

import { CompressionCodec } from '../../Format/ModuleFormat';
import { ICodecRegistry, IContentCodec } from './IContentCodec';

/**
 * An immutable lookup table from `module_info.compression` to a codec.
 *
 * Constructed from a list rather than by a `register()` method on purpose:
 * the set of codecs a runtime can read is a property of that runtime, fixed
 * the moment it starts, not something a module or a plugin adds to later. A
 * frozen list also makes "which codecs does this build have" answerable by
 * reading one call site - the design's rule that no runtime may hard-code its
 * codec set anywhere but its composition root only means anything if there IS
 * exactly one such place per runtime. See `createNodeCodecRegistry()` in
 * `NodeCodecs.ts` for this pass's.
 *
 * ```typescript
 * const registry = new CodecRegistry([new NoneCodec(), new DeflateCodec()]);
 * registry.get('zstd');   // null - this runtime hasn't got it
 * ```
 *
 * The codecs it holds are the UNBOUND ones (no dictionary). Binding is
 * per-module and per-open: {@link resolveModuleCodec} takes the registry's
 * instance and calls `withDictionary()` on it, which returns a new instance
 * and leaves the registry's own untouched - so one registry is safely shared
 * by every open module in the process.
 */
export class CodecRegistry implements ICodecRegistry {
  private readonly codecs: ReadonlyMap<CompressionCodec, IContentCodec>;

  /**
   * @param codecs The codecs this runtime can read with. Where two entries
   *        claim the same {@link IContentCodec.codec}, the LAST wins - so a
   *        composition root can append an override after a shared default
   *        list without having to filter the list first.
   */
  constructor(codecs: readonly IContentCodec[]) {
    const map = new Map<CompressionCodec, IContentCodec>();
    for (const codec of codecs) {
      map.set(codec.codec, codec);
    }
    this.codecs = map;
  }

  has(c: CompressionCodec): boolean {
    return this.codecs.has(c);
  }

  /** `null` for an unregistered codec - never a throw. See {@link ICodecRegistry.get}. */
  get(c: CompressionCodec): IContentCodec | null {
    return this.codecs.get(c) ?? null;
  }

  /**
   * Which codecs this registry holds, for diagnostics and for a capability
   * surface that wants to report the runtime's whole codec set rather than
   * answer one question at a time.
   */
  available(): CompressionCodec[] {
    return [...this.codecs.keys()];
  }
}
