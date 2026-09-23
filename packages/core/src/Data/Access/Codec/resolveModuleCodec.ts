/**
 * Codec resolution at open: read `module_info.compression` once, bind the
 * module's `compression_dictionary` row to the codec once, and hand back the
 * single instance every read of that module will use.
 */

import { ISql } from '../../Core/ISql';
import { CompressionCodec } from '../../Format/ModuleFormat';
import { ICodecRegistry, IContentCodec } from './IContentCodec';

/** What a module's connection resolved to. See {@link resolveModuleCodec}. */
export interface ResolvedModuleCodec {
  /**
   * `module_info.compression` exactly as stored, or `'none'` when the table
   * or the column is absent (every module file published before F2 predates
   * the column). Typed as {@link CompressionCodec} for callers' convenience,
   * but the DB is an open set: a value outside the union - `'brotli'`, a
   * typo, anything a future publisher writes - arrives here unchanged, which
   * is the whole point of {@link supported} below.
   */
  compression: CompressionCodec;

  /**
   * The codec to decode this module's prose with, already bound to its
   * dictionary if it has one - or `null` when the registry has no codec for
   * {@link compression}. `null` is a capability answer, not an error: the
   * module still opens and `module_info` still reads.
   */
  codec: IContentCodec | null;

  /** `codec !== null`. Mirrors `ModuleCapabilities.compression.supported`. */
  supported: boolean;

  /**
   * Whether a `compression_dictionary` row was found AND bound. `false` for
   * an uncompressed module (no lookup is attempted at all), for a compressed
   * module that was encoded without a dictionary, and for one whose codec is
   * missing (nothing to bind it to).
   */
  dictionaryBound: boolean;
}

/**
 * Resolve the decoder for one open module database.
 *
 * Call this ONCE per connection - `BaseModuleRepository` memoizes it, so
 * every content repository gets it for free and no row-level read ever
 * re-reads `module_info`. The design is explicit that a codec is a property
 * of the whole module file, not of a table, a column or a cell.
 *
 * The sequence:
 *
 *   1. `module_info.compression`, defaulting to `'none'` when the table or
 *      column is absent.
 *   2. `'none'` ⇒ the registry's `NoneCodec`, and **no dictionary lookup at
 *      all** - `compression = 'none'` means `compression_dictionary` is empty
 *      by definition (`sql/schemas/shared/compression_dictionary.sql`), so
 *      querying it would be a guaranteed-empty read on every module open.
 *   3. Otherwise ask the registry. No codec ⇒ `{ codec: null, supported:
 *      false }`, and again no dictionary lookup (nothing to bind it to).
 *   4. A codec that {@link IContentCodec.needsDictionary} ⇒ one lookup by
 *      codec name; a row ⇒ `codec.withDictionary(row.dict_blob)`.
 *
 * ### Never throws for a database that is merely unusual
 *
 * Both tables are probed with `PRAGMA table_info`, which returns an empty
 * result for a table that does not exist rather than raising - the same
 * schema-drift defence `BaseModuleRepository.buildIndexSource()` already
 * documents. A repository is routinely constructed over databases that have
 * no `module_info` at all (in-memory test fixtures, partial files), and codec
 * resolution must not be the thing that breaks them. A genuine SQL error from
 * a table that does exist is NOT swallowed.
 */
export function resolveModuleCodec(sql: ISql, registry: ICodecRegistry): ResolvedModuleCodec {
  const compression = readCompression(sql);

  if (compression === 'none') {
    // Step 2: no dictionary lookup whatsoever.
    const codec = registry.get('none');
    return { compression, codec, supported: codec !== null, dictionaryBound: false };
  }

  const codec = registry.get(compression);
  if (!codec) {
    return { compression, codec: null, supported: false, dictionaryBound: false };
  }

  if (!codec.needsDictionary) {
    return { compression, codec, supported: true, dictionaryBound: false };
  }

  const dictionary = readDictionary(sql, compression);
  return dictionary
    ? { compression, codec: codec.withDictionary(dictionary), supported: true, dictionaryBound: true }
    : { compression, codec, supported: true, dictionaryBound: false };
}

/** Columns actually present in `table`; empty when the table does not exist. */
function columnsOf(sql: ISql, table: string): Set<string> {
  // The table name is a literal from this file, never caller input - the same
  // posture `buildIndexSource` documents for CONTENT_MAP's names.
  return new Set(
    sql.queryAll<{ name: string }>(`PRAGMA table_info(${table})`).map(row => row.name)
  );
}

function readCompression(sql: ISql): CompressionCodec {
  if (!columnsOf(sql, 'module_info').has('compression')) {
    return 'none';
  }
  const row = sql.queryOne<{ compression: string | null }>(
    'SELECT compression FROM module_info WHERE info_id = 1'
  );
  const raw = row?.compression;
  // NOT NULL DEFAULT 'none' in the schema, but a hand-built file can still
  // carry NULL or ''; both mean "uncompressed" and neither is worth an error.
  return raw ? (raw as CompressionCodec) : 'none';
}

function readDictionary(sql: ISql, codec: CompressionCodec): Uint8Array | null {
  if (!columnsOf(sql, 'compression_dictionary').has('dict_blob')) {
    return null;
  }
  const row = sql.queryOne<{ dict_blob: Uint8Array | null }>(
    'SELECT dict_blob FROM compression_dictionary WHERE codec = ?',
    [codec]
  );
  const blob = row?.dict_blob;
  // A row with an empty blob is a publisher bug, not a dictionary: binding a
  // zero-length preset dictionary changes nothing for deflate and is rejected
  // outright by zstd, so treat it as absent.
  return blob && blob.byteLength > 0 ? blob : null;
}
