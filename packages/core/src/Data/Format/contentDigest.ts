/**
 * Canonical content digest: `module_info.content_sha256` (task 0027, "Module
 * Format v2", revision 2, subtask F3, design doc §2.7).
 *
 * The point of this digest is that it is a property of a module's DECODED
 * content, not of its bytes on disk. Republishing the exact same content
 * under a different `module_info.compression` - `'none'` today, `'zstd'`
 * tomorrow - must not change the hash. See {@link computeContentSha256}'s doc
 * comment for the exact byte layout; this file is the one place that layout
 * is defined, and any reimplementation (a SWORD converter in `bible-scripts`,
 * a future F9 publisher) must match it exactly to produce the same hash for
 * the same content.
 */

import { createHash, Hash } from 'node:crypto';
import { ISql, SqlParameter, SqlRow } from '../Core/ISql';
import { ModuleType } from '../Core/Types';
import { CONTENT_MAP, ContentShape } from './ModuleFormat';
import { ContentCodecUnavailableError, ResolvedModuleCodec } from '../Access/Codec';

/** Same paging size `BaseModuleRepository`'s `streamContentDocuments` uses. */
const BATCH_SIZE = 500;

/** ASCII Record Separator - written once after each fully-hashed table/shape. */
const TABLE_SEPARATOR = Buffer.from([0x1e]);

/** NULL marker byte, per the digest's cell layout. */
const NULL_MARKER = Buffer.from([0x00]);

/** "present" marker byte, per the digest's cell layout. */
const PRESENT_MARKER = Buffer.from([0x01]);

/**
 * An 8-byte little-endian unsigned integer, per the digest's cell layout.
 *
 * `BigInt`, not `number`: a rowid or a byte length could in principle exceed
 * 32 bits, and the algorithm is specified as u64 - implemented as such even
 * though no real row in this app's data comes remotely close.
 */
function u64le(value: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

/**
 * Compute `module_info.content_sha256`: a SHA-256 digest over a module's
 * DECODED content, defined identically no matter which `module_info
 * .compression` the module was published under.
 *
 * ## Byte layout
 *
 * ```
 * digest = SHA-256 over, for each ContentShape in CONTENT_MAP[moduleType] in
 *          declared order,
 *          for each row of that shape's table ordered by its rowid column
 *          ascending (numeric):
 *            u64le(rowid) ‖ for each column in the shape's PROSE-THEN-INDEXED
 *            union (see below), in that order:
 *              0x00 if the cell is NULL, else
 *              0x01 ‖ u64le(utf8 byte length of the DECODED value) ‖
 *                utf8(DECODED value)
 *          then 0x1E (ASCII Record Separator) - once per shape, including
 *          after the LAST shape, not only at the very end.
 * Hex-lowercase, 64 characters.
 * ```
 *
 * ## The column union and its order
 *
 * A {@link ContentShape}'s `prose` and `indexed` arrays may overlap (e.g.
 * commentary's `content` is in both) or be disjoint (dictionary's `indexed`
 * is `['word','definition','usage_notes']`, `prose` is `['definition',
 * 'usage_notes']` - `word` is indexed but never compressed). Every column that
 * appears in EITHER array is hashed exactly once - never twice for a column
 * in both - and the order is:
 *
 *   1. `prose`, in its declared order;
 *   2. then `indexed`, in its declared order, skipping any column already
 *      included from `prose`.
 *
 * So dictionary hashes `definition, usage_notes, word` (not `word,
 * definition, usage_notes`, and not `definition, usage_notes` twice). This
 * order is part of the digest's specification, exactly as load-bearing as the
 * SHA-256 algorithm itself: two implementations that decode the same rows but
 * union the columns in a different order produce different, non-comparable
 * digests. Any reimplementation (a SWORD converter, a future publisher) MUST
 * reproduce "prose order, then indexed-not-already-included order" exactly.
 *
 * ## Which columns get decoded
 *
 * Only `prose` columns are ever run through {@link resolvedCodec}'s codec -
 * mirroring `BaseModuleRepository.text()`'s own rule that a `string` cell is
 * returned unchanged (a prose column may legitimately hold plain TEXT even in
 * a compressed module - the publisher keeps the compressed BLOB only where it
 * is actually smaller) and a `Uint8Array`/`Buffer` cell is decoded through the
 * resolved codec. A column that is `indexed` but NOT `prose` is never
 * compressed by this format and is read as plain TEXT directly, with no
 * attempt to decode it.
 *
 * `resolvedCodec.codec === null` (this reader has no codec for the module's
 * `compression`) is fine right up until a PROSE column's cell is actually a
 * BLOB that needs decoding - at that point this throws
 * {@link ContentCodecUnavailableError}, exactly the failure mode
 * `BaseModuleRepository.text()` already uses for the same situation. A module
 * with an unsupported codec but no compressed cells (e.g. every prose cell
 * happens to be short enough to have stayed TEXT) still digests cleanly.
 *
 * ## `byteLength`
 *
 * The UTF-8 byte length of the DECODED string (`Buffer.byteLength`/
 * `Buffer.from(value, 'utf8').length`), not its JS `.length` (UTF-16 code
 * unit / character count) - these differ for any non-ASCII content, and real
 * shipped content (interlinear, lexicons) includes Greek, Hebrew and accented
 * Latin where the difference matters.
 *
 * ## NULL vs `''`
 *
 * A NULL cell writes `0x00` and contributes nothing else. A present cell -
 * including an empty string - writes `0x01` then `u64le(0)` and zero content
 * bytes. The two are therefore never confusable in the digest, unlike a
 * scheme that just concatenated bytes with no NULL marker.
 *
 * ## `0x1E` per shape, including the last
 *
 * Read as "for each shape: hash its rows, then hash one `0x1E`" - applied to
 * EVERY shape, not only appended once at the very end. This is the reading
 * that makes the separator do real work: without a separator after every
 * shape (only a final trailing one, or none at all), two shapes whose row
 * sequences were concatenated with nothing between them could hash the same
 * as one shape whose rows happen to be a transposition of the two - the
 * separator is what makes each table's row sequence unambiguous inside the
 * overall byte stream. (Every module type shipped today has exactly one
 * `ContentShape`, so this distinction is currently unobservable in practice,
 * but the algorithm is implemented for the general case per the design doc's
 * "declared array order" instruction, and `contentDigest.test.ts` proves it
 * with a synthetic two-row-vs-two-shape case regardless.)
 *
 * ## Table/shape order and row order
 *
 * Shapes: `CONTENT_MAP[moduleType]`'s declared array order (today, at most one
 * shape per type). Rows within a shape: ordered by the shape's `rowid`
 * column, ascending, NUMERICALLY (every real rowid column is an `INTEGER
 * PRIMARY KEY`, which SQLite aliases to the built-in `rowid` - the same fact
 * `streamContentDocuments` relies on for its own paging) - matching
 * `BaseModuleRepository`'s own paged-read order.
 *
 * ## Empty `CONTENT_MAP` entry (`cross_reference`, `tag_graph`)
 *
 * Zero shapes are iterated, so the hash absorbs nothing before `.digest()` is
 * called: the result is exactly the SHA-256 of the empty input,
 * `e3b0c442...b855`. This is a deliberate, well-defined answer (these module
 * types carry no prose/indexed content in `CONTENT_MAP`'s sense - see
 * `CONTENT_MAP`'s own doc comment), not a silent failure mode: the well-known
 * empty-SHA-256 value is easy to recognise in a test or a log as "this type
 * has no content shape", rather than looking like a crash that happened to
 * return something.
 *
 * ## Streamed, never materialised
 *
 * Rows are read `BATCH_SIZE` (500) at a time via the same
 * `WHERE rowid > ? ORDER BY rowid LIMIT ?` paging `streamContentDocuments`
 * uses (`ISql` has no cursor primitive), and each cell's bytes are pushed
 * into the running `Hash` via `.update()` as soon as they are computed. At
 * most one batch of raw rows, and the current row's decoded value, are ever
 * resident at once - never a whole table or a whole module.
 *
 * ## Schema-drift defence
 *
 * `CONTENT_MAP`'s `prose`/`indexed` describe the CURRENT schema. A shipped
 * file can predate a column (the same drift `BaseModuleRepository
 * .buildIndexSource()` documents - e.g. `topical_nave.db`'s `topic` table has
 * no `content` column). The column union is filtered down to columns actually
 * present in the table (`PRAGMA table_info`), exactly like `buildIndexSource`
 * filters `indexed`; a column `CONTENT_MAP` expects but this file lacks
 * simply contributes nothing, rather than the digest throwing "no such
 * column" on a real, currently-shipped module. A table that does not exist AT
 * ALL still throws a normal "no such table" SQL error - that is a genuinely
 * malformed module for its declared type, not schema drift, and is left
 * unguarded on purpose, matching `buildIndexSource`'s own posture (it guards
 * columns, not table existence).
 *
 * @param sql The open module database.
 * @param moduleType This module's type - supplied by the caller, the same
 *        way `BaseModuleRepository.buildIndexTarget()` takes it as a
 *        parameter rather than reading `module_info.module_type`, since a
 *        caller (a repository, a CLI tool that already knows what kind of
 *        module it opened) always knows this independently of whether
 *        `module_info` itself is present or trustworthy.
 * @param resolvedCodec This module's resolved codec, from
 *        {@link resolveModuleCodec}. Taking the ALREADY-resolved codec here,
 *        rather than a raw {@link ICodecRegistry} that this function would
 *        resolve internally, is a deliberate fit with
 *        `BaseModuleRepository.moduleCodec()`'s existing lazy-resolve-once
 *        pattern: a repository that has already opened this module has
 *        already paid for the one `module_info` + `compression_dictionary`
 *        read codec resolution costs, and re-resolving here would be a second
 *        read of the same rows for no reason. A caller with only a raw
 *        registry (the CLI script in `scripts/module-digest.js`, or any other
 *        first-time caller) does exactly what `moduleCodec()` does: call
 *        `resolveModuleCodec(sql, registry)` once and pass the result in.
 * @returns 64 lowercase hex characters.
 */
export function computeContentSha256(
  sql: ISql,
  moduleType: ModuleType,
  resolvedCodec: ResolvedModuleCodec
): string {
  const hash = createHash('sha256');
  const shapes = CONTENT_MAP[moduleType];

  for (const shape of shapes) {
    hashShape(sql, shape, resolvedCodec, hash);
    hash.update(TABLE_SEPARATOR);
  }

  return hash.digest('hex');
}

/** Columns actually present in `table` - see the "schema-drift defence" note above. */
function columnsOf(sql: ISql, table: string): Set<string> {
  // Table/column names interpolated below come only from CONTENT_MAP (a fixed
  // registry), never from caller input - the same posture `buildIndexSource`
  // and `resolveModuleCodec` document for their own interpolated identifiers.
  return new Set(
    sql.queryAll<{ name: string }>(`PRAGMA table_info(${table})`).map(row => row.name)
  );
}

/**
 * The deduplicated `prose`-then-`indexed` column order for one shape, filtered
 * to columns actually present in `table`. See {@link computeContentSha256}'s
 * "column union and its order" section - this is that rule's implementation.
 */
function digestColumns(shape: ContentShape, tableColumns: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const column of [...shape.prose, ...shape.indexed]) {
    if (!seen.has(column) && tableColumns.has(column)) {
      seen.add(column);
      columns.push(column);
    }
  }
  return columns;
}

/**
 * Hash every row of one {@link ContentShape}'s table into `hash`, in rowid
 * order, `BATCH_SIZE` rows at a time. Does NOT write the trailing `0x1E` -
 * that is {@link computeContentSha256}'s job, once per shape.
 */
function hashShape(
  sql: ISql,
  shape: ContentShape,
  resolvedCodec: ResolvedModuleCodec,
  hash: Hash
): void {
  const tableColumns = columnsOf(sql, shape.table);
  const proseColumns = new Set(shape.prose);
  const columns = digestColumns(shape, tableColumns);
  const rowidColumn = shape.rowid;
  const selectList = [rowidColumn, ...columns].join(', ');

  let cursor = 0;
  for (;;) {
    const rows = sql.queryAll<SqlRow>(
      `SELECT ${selectList} FROM ${shape.table} WHERE ${rowidColumn} > ? ORDER BY ${rowidColumn} LIMIT ?`,
      [cursor, BATCH_SIZE]
    );
    if (rows.length === 0) return;

    for (const row of rows) {
      hashRow(row, rowidColumn, columns, proseColumns, resolvedCodec, hash);
    }

    cursor = Number(rows[rows.length - 1][rowidColumn]);
    if (rows.length < BATCH_SIZE) return;
  }
}

/** Hash one content row's `rowid ‖ cell*` sequence into `hash`. */
function hashRow(
  row: SqlRow,
  rowidColumn: string,
  columns: readonly string[],
  proseColumns: ReadonlySet<string>,
  resolvedCodec: ResolvedModuleCodec,
  hash: Hash
): void {
  hash.update(u64le(Number(row[rowidColumn])));

  for (const column of columns) {
    const raw = row[column];
    if (raw === null || raw === undefined) {
      hash.update(NULL_MARKER);
      continue;
    }

    const value = proseColumns.has(column)
      ? decodeProseCell(raw, resolvedCodec)
      : rawTextCell(raw);

    const bytes = Buffer.from(value, 'utf8');
    hash.update(PRESENT_MARKER);
    hash.update(u64le(bytes.length));
    hash.update(bytes);
  }
}

/**
 * Decode one PROSE cell. Mirrors `BaseModuleRepository.text()`'s rules
 * exactly (a `string` is returned unchanged - "mixed cells" in a compressed
 * module are legitimate; anything else is one bare codec frame, decoded
 * through the resolved codec, or {@link ContentCodecUnavailableError} if this
 * reader has none). `raw` is never `null` here - the caller checks that
 * first, so the cell is genuinely present.
 */
function decodeProseCell(raw: SqlParameter, resolvedCodec: ResolvedModuleCodec): string {
  if (typeof raw === 'string') {
    return raw;
  }
  const { codec, compression } = resolvedCodec;
  if (!codec) {
    throw new ContentCodecUnavailableError(compression);
  }
  // Every prose column is declared TEXT or holds a bare codec frame written
  // into that TEXT/BLOB cell - never a number or boolean. See ISql's
  // `SqlParameter` union and `BaseModuleRepository.text()`'s identical
  // `string | Uint8Array | null` narrowing.
  return codec.decode(raw as Uint8Array);
}

/**
 * Read one INDEXED-BUT-NOT-PROSE cell as plain TEXT, with no attempt to
 * decode it - such a column is never compressed by this format. `raw` is
 * never `null` here - the caller checks that first.
 */
function rawTextCell(raw: SqlParameter): string {
  // The schema declares this column TEXT; a non-string value here would be a
  // schema violation rather than something this format ever writes. Coerced
  // defensively rather than thrown, so a stray anomaly in one column does not
  // abort hashing the rest of a real, currently-shipped module.
  return typeof raw === 'string' ? raw : String(raw);
}
