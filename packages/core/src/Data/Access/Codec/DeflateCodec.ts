/**
 * `compression = 'deflate'`: RAW DEFLATE (RFC 1951), optional preset dictionary.
 */

import * as zlib from 'node:zlib';
import { CompressionCodec } from '../../Format/ModuleFormat';
import { IContentCodec } from './IContentCodec';

/**
 * Raw DEFLATE, the format `module_info.compression = 'deflate'` names.
 *
 * ## Raw, not zlib-wrapped, not gzip
 *
 * This is `deflateRawSync`/`inflateRawSync` - RFC 1951 compressed data with
 * NOTHING around it. It is NOT:
 *
 *   - `zlib.deflateSync`/`inflateSync` (RFC 1950): a 2-byte CMF/FLG header
 *     plus a 4-byte Adler-32 trailer around the same RFC 1951 data;
 *   - `zlib.gzipSync`/`gunzipSync` (RFC 1952): a 10+ byte header plus CRC32
 *     and length trailer.
 *
 * Mixing them up is the single most expensive mistake available in this
 * format, because a publisher that wrote wrapped frames and a reader that
 * reads raw ones disagree about every compressed cell in every module it ever
 * ships - and the mistake is invisible in a type system, since all three
 * produce a `Buffer`. `DeflateCodec.test.ts` pins the distinction down with
 * real bytes: a zlib-wrapped frame fed to this codec's {@link decode} fails
 * with `Z_DATA_ERROR` rather than yielding plausible-looking wrong text.
 *
 * The reason to be raw is the reason the whole compression design is
 * defensible: every runtime that will ever read a module can already inflate
 * raw DEFLATE. Node and Electron have `zlib` built in; a browser has
 * `DecompressionStream('deflate-raw')` and, failing that, pako in ~15 KB.
 * The 6 wrapper bytes buy an Adler-32 the module's own `content_sha256`
 * already covers, at the cost of nothing.
 *
 * ## Preset dictionary
 *
 * Node's `dictionary` option on both sides is the RFC 1951 preset-dictionary
 * mechanism: up to 32 KiB of representative text pre-loaded into the sliding
 * window so that short cells can match against it. It is optional - a module
 * may be `'deflate'` with no `compression_dictionary` row at all.
 *
 * Note what raw DEFLATE does NOT give you: a dictionary identifier. RFC 1950
 * (the wrapped form) carries an Adler-32 DICTID and can therefore reject the
 * wrong dictionary; RFC 1951 alone cannot, so inflating with the wrong
 * dictionary yields corrupt output or a `Z_DATA_ERROR` depending on the data.
 * That asymmetry is exactly why `compression_dictionary.dict_id` exists in
 * the schema ("zstd dictID, or Adler-32 of dict_blob for deflate") - the
 * check moved from the frame into the file, once, instead of into every cell.
 */
export class DeflateCodec implements IContentCodec {
  readonly codec: CompressionCodec = 'deflate';

  /**
   * Compression level for {@link encode}. 9 (maximum) because a module is
   * compressed once at publish time and decompressed on every read: encode
   * time is paid by the publisher, and inflate speed is level-independent.
   */
  private static readonly LEVEL = 9;

  private readonly dictionary: Buffer | null;

  constructor(dictionary?: Uint8Array | null) {
    this.dictionary = dictionary ? toBuffer(dictionary) : null;
  }

  /** True only while unbound - see {@link IContentCodec.needsDictionary}. */
  get needsDictionary(): boolean {
    return this.dictionary === null;
  }

  withDictionary(dict: Uint8Array | null): IContentCodec {
    return new DeflateCodec(dict);
  }

  decode(blob: Uint8Array | string): string {
    // Already-text cells stay text: a publisher keeps a compressed blob only
    // when it is smaller, so short entries in a 'deflate' module are stored
    // uncompressed. See IContentCodec's "Mixed cells" note.
    if (typeof blob === 'string') {
      return blob;
    }
    const inflated = zlib.inflateRawSync(
      toBuffer(blob),
      this.dictionary ? { dictionary: this.dictionary } : undefined
    );
    return inflated.toString('utf8');
  }

  encode(text: string): Uint8Array {
    return zlib.deflateRawSync(Buffer.from(text, 'utf8'), {
      level: DeflateCodec.LEVEL,
      ...(this.dictionary ? { dictionary: this.dictionary } : {}),
    });
  }
}

/**
 * `zlib`'s sync functions take a `Buffer`/`TypedArray`/`DataView`, so a plain
 * `Uint8Array` is already acceptable - but `Buffer.from(view)` COPIES, which
 * would silently double every decode's allocation. Wrap the existing memory
 * instead, and pass a `Buffer` through untouched.
 */
function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
