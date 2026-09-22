/**
 * `compression = 'none'`: the identity codec.
 */

import { CompressionCodec } from '../../Format/ModuleFormat';
import { IContentCodec } from './IContentCodec';

/**
 * The codec for an uncompressed module. `decode`/`encode` are the UTF-8
 * identity mapping.
 *
 * It exists so the read path has exactly one shape. Without it every caller
 * would have to branch on `compression === 'none'` before decoding, and every
 * such branch is a place the two paths can drift apart. With it,
 * `BaseModuleRepository.text()` is the same three lines for every module ever
 * published.
 *
 * `needsDictionary` is `false` and {@link withDictionary} is a no-op that
 * returns `this`: an uncompressed module's `compression_dictionary` table is
 * empty by definition (see `sql/schemas/shared/compression_dictionary.sql`),
 * so there is nothing to bind and no lookup worth running.
 */
export class NoneCodec implements IContentCodec {
  readonly codec: CompressionCodec = 'none';
  readonly needsDictionary = false;

  /**
   * No-op: there is no dictionary concept for uncompressed content, so this
   * returns the receiver rather than a copy. The parameter is kept (and
   * ignored) so a caller holding a concrete `NoneCodec` can still treat it
   * exactly like any other {@link IContentCodec}.
   */
  withDictionary(_dict?: Uint8Array | null): IContentCodec {
    return this;
  }

  /**
   * A `string` passes straight through; bytes are read as UTF-8.
   *
   * The byte branch is not dead code even though a `'none'` module stores
   * prose as `TEXT`: SQLite is dynamically typed, and a publisher bug (or a
   * hand-edited file) can leave a BLOB in a prose column of an otherwise
   * uncompressed module. Reading it as UTF-8 is the honest interpretation of
   * those bytes under `compression = 'none'`, and is what `sqlite3`'s own
   * `CAST(x AS TEXT)` would do.
   */
  decode(blob: Uint8Array | string): string {
    if (typeof blob === 'string') {
      return blob;
    }
    return new TextDecoder().decode(blob);
  }

  encode(text: string): Uint8Array {
    return new TextEncoder().encode(text);
  }
}
