/**
 * Content codecs: the contract a module's prose columns are decoded through
 * (task 0027, "Module Format v2", revision 2, subtask F4).
 *
 * ## The one-codec-per-module rule
 *
 * `module_info.compression` names ONE codec for the whole module file. There
 * is no per-table or per-column codec and no mechanism to add one, so a
 * reader resolves its decoder exactly once, when it opens the module - see
 * {@link resolveModuleCodec} and `BaseModuleRepository.text()`, not once per
 * row.
 *
 * ## Frame layout: no header of our own
 *
 * A prose cell holds either `TEXT` (not compressed) or a `BLOB` that is one
 * bare codec frame and nothing else - no length prefix, no magic byte this
 * project invented, no per-cell codec tag. Everything a decoder needs that
 * isn't in the frame itself (which codec, which dictionary) lives once per
 * file in `module_info.compression` and `compression_dictionary`.
 *
 * Both codec framings are therefore the STANDARD ones, not stripped variants:
 * raw DEFLATE (RFC 1951) for `'deflate'`, and a standard zstd frame
 * (RFC 8878, magic `28 b5 2f fd`, optional dictID) for `'zstd'`. The design
 * considered and rejected magicless zstd: interoperability is the whole
 * reason to use a standard framing, and `zstd -d` reading a cell straight out
 * of the file is worth more than the four bytes it costs.
 *
 * ## Mixed cells inside one compressed module
 *
 * A module with `compression = 'deflate'` may still hold plain `TEXT` in some
 * prose cells: the publisher keeps the compressed blob only when it is
 * actually smaller, so a very short entry stays text. That is why
 * {@link IContentCodec.decode} accepts a `string` as well as bytes, and why
 * `BaseModuleRepository.text()` returns a `string` value unchanged rather
 * than treating it as an error.
 */

import { CompressionCodec } from '../../Format/ModuleFormat';

/**
 * One content codec, bound (or not) to a preset dictionary.
 *
 * Instances are immutable and freely shareable: {@link withDictionary}
 * returns a NEW instance rather than mutating this one, so the unbound codec
 * held in a registry can be handed to any number of modules and each can bind
 * its own dictionary without disturbing the others.
 */
export interface IContentCodec {
  /** Which `module_info.compression` value this codec decodes. */
  readonly codec: CompressionCodec;

  /**
   * True while this instance still owes a `compression_dictionary` lookup:
   * the codec CAN use a preset dictionary and is not yet bound to one.
   *
   * Read it as "ask the module whether it has a dictionary for me", not as
   * "this codec is unusable without one" - a dictionary is optional for both
   * real codecs, and a module with `compression != 'none'` and no
   * `compression_dictionary` row is perfectly valid (it simply encoded its
   * frames without one). The point of the flag is to let a caller skip the
   * lookup entirely where it cannot possibly matter:
   *
   * ```typescript
   * if (codec.needsDictionary) {
   *   const row = sql.queryOne(...);          // only then is the query worth running
   *   if (row) codec = codec.withDictionary(row.dict_blob);
   * }
   * ```
   *
   * So it is `false` for {@link NoneCodec} (which has no dictionary concept
   * at all) and `false` on an instance already returned by
   * {@link withDictionary} - binding a second dictionary over the first would
   * only ever be a bug.
   */
  readonly needsDictionary: boolean;

  /**
   * A new codec of the same kind bound to `dict`, or - for `null` - an
   * unbound one. Never mutates the receiver.
   *
   * The bytes are the `compression_dictionary.dict_blob` of the module being
   * opened. Nothing validates them here: a wrong dictionary is not detectable
   * for raw DEFLATE (RFC 1951 carries no dictionary id; that is what
   * `compression_dictionary.dict_id` is for) and shows up at
   * {@link decode} time for zstd, whose frame does carry a dictID.
   */
  withDictionary(dict: Uint8Array | null): IContentCodec;

  /**
   * Decode one prose cell to text.
   *
   * A `string` is returned unchanged - see "Mixed cells" above. A
   * `Uint8Array` is one bare codec frame and is decoded as such.
   *
   * Throws on a frame that is genuinely corrupt, truncated, or encoded with a
   * different codec or dictionary than this instance carries. That is a real
   * error and is deliberately NOT softened into an empty string: silently
   * returning `''` for a damaged module would hide the damage behind a blank
   * page. It is distinct from the capability question "this reader hasn't got
   * that codec at all", which is answered before decoding ever starts, by
   * {@link ICodecRegistry.get} returning `null`.
   */
  decode(blob: Uint8Array | string): string;

  /**
   * Encode text to one bare codec frame.
   *
   * Publisher-side: nothing in the read path calls this. It lives on the same
   * interface because a codec that can only be half-exercised cannot be
   * round-trip tested, and because the module publisher (F9) needs exactly
   * this operation against exactly this framing. A publisher - not this
   * interface - decides per cell whether to keep the frame or the original
   * text, by comparing sizes.
   */
  encode(text: string): Uint8Array;
}

/**
 * The set of codecs one runtime can read with.
 *
 * Deliberately tiny and lookup-only: a registry answers "have you got this
 * one", never "decode this". Registration happens in a runtime's composition
 * root and nowhere else - see `createNodeCodecRegistry()` in `NodeCodecs.ts`
 * for the Node/Electron set (`none` + `deflate` + `zstd` where the runtime
 * has it). No other module may hard-code a codec set; a browser runtime that
 * can only manage `none` + `deflate` builds its own registry the same way.
 */
export interface ICodecRegistry {
  has(c: CompressionCodec): boolean;

  /**
   * The codec for `c`, or `null` if this runtime has not got it.
   *
   * NEVER throws for an unregistered codec. "I can't read this module's
   * content" is a capability answer the caller turns into
   * `readContent: false, unavailableReason: 'missing-codec'`
   * ({@link ModuleCapabilities}); it is not an exception, and a module whose
   * codec is missing must still open far enough to read `module_info`.
   */
  get(c: CompressionCodec): IContentCodec | null;
}

/**
 * Thrown when compressed content is decoded through a reader that has no
 * codec for this module - i.e. `module_info.compression` names something
 * {@link ICodecRegistry.get} returned `null` for.
 *
 * This is the *last resort*, not the intended path. The intended path is that
 * a capability surface asks first (`BaseModuleRepository.getCompressionCapability()`)
 * and never lets a caller reach the content at all. Nothing populates
 * `ModuleCapabilities` for real yet (that is subtasks M7/F8/M9), so until it
 * does, a caller that ignores the capability and reads a BLOB cell anyway
 * gets this - a clear, typed, greppable error naming the codec, rather than a
 * `TypeError` deep inside a mapper or, far worse, a silently empty string.
 */
export class ContentCodecUnavailableError extends Error {
  /** Matches `ModuleCapabilities.unavailableReason`. */
  readonly reason = 'missing-codec' as const;

  constructor(readonly codec: string) {
    super(
      `This module's content is compressed with '${codec}', which this build has no codec for. ` +
        `Check getCompressionCapability().supported before reading content.`
    );
    this.name = 'ContentCodecUnavailableError';
  }
}
