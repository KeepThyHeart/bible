/**
 * `compression = 'zstd'`: standard zstd frames (RFC 8878), optional trained
 * dictionary. Backed by Node's own `node:zlib`, with no npm dependency.
 */

import * as zlib from 'node:zlib';
import { CompressionCodec } from '../../Format/ModuleFormat';
import { IContentCodec } from './IContentCodec';

/**
 * The slice of `node:zlib` this codec uses.
 *
 * Declared here rather than imported because the package pins
 * `@types/node@^20`, which predates zstd landing in Node core (22.15 / 23.8);
 * the functions exist at runtime on Node 24 and Electron 44 but are absent
 * from those typings. A narrow structural declaration plus one cast at the
 * boundary keeps that gap in one visible place instead of scattering `any`.
 *
 * `params` keys are `zlib.constants.ZSTD_c_*` - numeric, hence the index
 * signature.
 */
interface ZstdZlib {
  zstdCompressSync(
    data: Uint8Array,
    options?: { params?: Record<number, number>; dictionary?: Uint8Array }
  ): Buffer;
  zstdDecompressSync(data: Uint8Array, options?: { dictionary?: Uint8Array }): Buffer;
}

const nodeZstd = zlib as Partial<ZstdZlib>;

/**
 * `zlib.constants.ZSTD_c_compressionLevel`, read through an index because the
 * pinned `@types/node@^20` does not declare the `ZSTD_c_*` constants either.
 * Falls back to 100 - libzstd's own `ZSTD_c_compressionLevel` enum value - so
 * the parameter is still addressed correctly on a runtime that has the
 * functions but typings that don't; `isZstdAvailable()` gates everything that
 * reads this anyway.
 */
const ZSTD_C_COMPRESSION_LEVEL =
  (zlib.constants as unknown as Record<string, number>).ZSTD_c_compressionLevel ?? 100;

/**
 * Whether this runtime can read zstd at all.
 *
 * Node gained `zstdCompressSync`/`zstdDecompressSync` in 22.15 / 23.8; this
 * repo's Electron 44 bundles Node 24.20, so both are present in the desktop
 * app and in any current Node. On an older runtime they simply are not there,
 * and a composition root must not register a codec it cannot run - see
 * `createNodeCodecRegistry()`, which asks this question and registers `zstd`
 * only when the answer is yes. A module compressed with a codec the runtime
 * lacks is a capability answer (`missing-codec`), which is precisely what an
 * absent registry entry produces.
 */
export function isZstdAvailable(): boolean {
  return (
    typeof nodeZstd.zstdCompressSync === 'function' &&
    typeof nodeZstd.zstdDecompressSync === 'function'
  );
}

/**
 * Raised when this codec is used on a runtime whose `node:zlib` has no zstd.
 * Distinct from {@link ContentCodecUnavailableError}, which means the
 * registry had no entry at all: reaching this one means something built a
 * `ZstdCodec` directly instead of going through a composition root.
 */
export class ZstdUnavailableError extends Error {
  constructor() {
    super(
      `zstd is not available in this build: node:zlib has no zstdCompressSync/zstdDecompressSync ` +
        `(Node >= 22.15 or Electron >= 37 is required).`
    );
    this.name = 'ZstdUnavailableError';
  }
}

/**
 * Standard zstd, the format `module_info.compression = 'zstd'` names.
 *
 * ## Standard frames, deliberately
 *
 * {@link encode} emits a complete zstd frame: magic `28 b5 2f fd`, a frame
 * header carrying the dictID when a dictionary is bound, then the compressed
 * blocks. A magicless variant would save four bytes per cell and was
 * explicitly rejected in the design - interoperability is the entire reason
 * to use a standard framing, and a cell that `zstd -d` can decode as-is is
 * worth far more than 4 bytes against prose that averages hundreds.
 *
 * ## Why `node:zlib` and not an npm binding
 *
 * zstd is in Node core as of 22.15, and Electron 44 (this repo's version)
 * bundles Node 24.20 - verified, not assumed. Native npm bindings
 * (`zstd-napi`, `@mongodb-js/zstd`) all mean a compiled addon that must be
 * rebuilt for Electron's ABI on every platform the app ships to; the built-in
 * needs none of that, has no supply chain, and produces byte-identical
 * standard frames. `isZstdAvailable()` covers the one thing the built-in
 * costs: a runtime older than 22.15 has nothing, where a bundled addon would
 * have worked.
 *
 * ## Dictionaries
 *
 * `dictionary` is passed to both calls. Unlike raw DEFLATE, a zstd frame
 * records the dictionary's ID, so decoding a dictionary-compressed frame
 * WITHOUT that dictionary fails loudly rather than producing garbage - see
 * `ZstdCodec.test.ts`. `compression_dictionary.dict_id` mirrors that ID for
 * the publisher's benefit; the frame itself is what the decoder checks.
 */
export class ZstdCodec implements IContentCodec {
  readonly codec: CompressionCodec = 'zstd';

  /**
   * Compression level for {@link encode}. 19 (the top of zstd's normal range,
   * below the `--ultra` levels that raise the decoder's window requirement)
   * for the same reason {@link DeflateCodec} uses 9: publish-time cost,
   * read-time benefit.
   */
  private static readonly LEVEL = 19;

  private readonly dictionary: Uint8Array | null;

  constructor(dictionary?: Uint8Array | null) {
    this.dictionary = dictionary ?? null;
  }

  /** True only while unbound - see {@link IContentCodec.needsDictionary}. */
  get needsDictionary(): boolean {
    return this.dictionary === null;
  }

  withDictionary(dict: Uint8Array | null): IContentCodec {
    return new ZstdCodec(dict);
  }

  decode(blob: Uint8Array | string): string {
    // See IContentCodec's "Mixed cells" note.
    if (typeof blob === 'string') {
      return blob;
    }
    if (!isZstdAvailable()) {
      throw new ZstdUnavailableError();
    }
    let out: Buffer;
    try {
      out = nodeZstd.zstdDecompressSync!(
        blob,
        this.dictionary ? { dictionary: this.dictionary } : undefined
      );
    } catch (err) {
      // Newer Node (24.21+) reports a truncated frame itself, as Z_BUF_ERROR
      // "unexpected end of file". Surface it as the same error the size check
      // below raises on runtimes that still return silently.
      if ((err as { code?: unknown })?.code === 'Z_BUF_ERROR') {
        throw new Error(`zstd frame is truncated or corrupt: ${(err as Error).message}.`);
      }
      throw err;
    }
    const declared = declaredFrameContentSize(blob);
    if (declared !== null && declared !== out.length) {
      throw new Error(
        `zstd frame is truncated or corrupt: its header declares ${declared} bytes of content ` +
          `but ${out.length} decoded.`
      );
    }
    return out.toString('utf8');
  }

  encode(text: string): Uint8Array {
    if (!isZstdAvailable()) {
      throw new ZstdUnavailableError();
    }
    return nodeZstd.zstdCompressSync!(Buffer.from(text, 'utf8'), {
      params: { [ZSTD_C_COMPRESSION_LEVEL]: ZstdCodec.LEVEL },
      ...(this.dictionary ? { dictionary: this.dictionary } : {}),
    });
  }
}

/**
 * The `Frame_Content_Size` a zstd frame header declares, or `null` when the
 * frame does not carry one (or is too short to parse).
 *
 * ## Why this exists: Node's zstd does not report truncation
 *
 * `zlib.inflateRawSync` throws `Z_BUF_ERROR` on a truncated DEFLATE stream.
 * `zlib.zstdDecompressSync` on a truncated zstd frame throws NOTHING (up to
 * at least Node 24.20, the version Electron 44 bundles; 24.21 started throwing
 * `Z_BUF_ERROR`, which {@link ZstdCodec.decode} also handles): it returns
 * whatever it managed to decode - which for a frame cut in half is a
 * zero-length buffer. Left alone, a damaged cell would therefore decode to
 * `''`, and an empty commentary entry looks exactly like an entry that is
 * legitimately empty. That is the silent corruption this whole format is
 * designed to make impossible, so it gets checked rather than trusted.
 *
 * A one-shot `zstdCompressSync` always records the content size (single
 * segment, `ZSTD_c_contentSizeFlag` on by default), so in practice every
 * frame this project writes carries one and the check always runs. A frame
 * from some other producer that omits it yields `null` here and is decoded
 * unchecked - no worse than before, and never a false alarm.
 *
 * Header layout per RFC 8878 §3.1.1: 4-byte magic, 1-byte
 * `Frame_Header_Descriptor`, optional 1-byte `Window_Descriptor` (absent when
 * `Single_Segment` is set), optional `Dictionary_ID` (0/1/2/4 bytes), then
 * `Frame_Content_Size` (0/1/2/4/8 bytes, little-endian, with 256 added to the
 * 2-byte form).
 */
export function declaredFrameContentSize(frame: Uint8Array): number | null {
  const MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
  if (frame.length < 5 || MAGIC.some((byte, i) => frame[i] !== byte)) {
    return null;
  }

  const descriptor = frame[4];
  const fcsFlag = descriptor >> 6;
  const singleSegment = (descriptor >> 5) & 1;
  const dictIdFlag = descriptor & 0b11;

  let offset = 5;
  if (!singleSegment) {
    offset += 1; // Window_Descriptor
  }
  offset += [0, 1, 2, 4][dictIdFlag];

  const fcsSize = fcsFlag === 0 ? (singleSegment ? 1 : 0) : [0, 2, 4, 8][fcsFlag];
  if (fcsSize === 0 || frame.length < offset + fcsSize) {
    return null;
  }

  const view = new DataView(frame.buffer, frame.byteOffset + offset, fcsSize);
  switch (fcsSize) {
    case 1:
      return view.getUint8(0);
    case 2:
      return view.getUint16(0, true) + 256;
    case 4:
      return view.getUint32(0, true);
    default:
      return Number(view.getBigUint64(0, true));
  }
}
