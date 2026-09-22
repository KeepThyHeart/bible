import { ISql, SqlParameter, SqlRow } from '../Core/ISql';
import { ModuleInfoRow } from '../Core/RowTypes';
import { BaseModuleInfo, BaseModuleInfoData } from '../Models/BaseModuleInfo';
import { ModuleType } from '../Core/Types';
import { CONTENT_MAP } from '../Format/ModuleFormat';
import { IIndexSource, IndexDocument, IndexTarget } from '../Access/KeywordTypes';
import { stripHtml } from '../../Services/PassageFormat/formatHelpers';

/**
 * The identity + provenance fields of {@link BaseModuleInfoData}.
 */
export type ModuleIdentityData = Pick<
  BaseModuleInfoData,
  | 'moduleUuid'
  | 'format'
  | 'formatVersion'
  | 'contentVersion'
  | 'contentSha256'
  | 'licenseSpdx'
  | 'licenseUrl'
  | 'sourceUrl'
  | 'versification'
  | 'isOriginalLanguage'
  | 'rightToLeft'
>;

/**
 * Map the identity + provenance block off a `module_info` row.
 *
 * Spread the result into a module-info constructor so every module type picks up
 * the block with one call:
 *
 * ```typescript
 * return new BibleModuleInfo({ ...mapModuleIdentity(row), abbreviation: row.abbreviation, ... });
 * ```
 *
 * fallbacks inside `BaseModuleInfo` go away.
 */
export function mapModuleIdentity(row: ModuleInfoRow): ModuleIdentityData {
  return {
    moduleUuid: row.module_uuid,
    format: row.format,
    formatVersion: row.format_version,
    contentVersion: row.content_version,
    contentSha256: row.content_sha256,
    licenseSpdx: row.license_spdx,
    licenseUrl: row.license_url,
    sourceUrl: row.source_url,
    versification: row.versification,
    isOriginalLanguage: row.is_original_language === 1,
    rightToLeft: row.right_to_left === 1
  };
}

/**
 * The `module_info` columns written by {@link buildIdentityAssignments}, in
 * write order.
 *
 */
const IDENTITY_COLUMNS: ReadonlyArray<[column: string, read: (i: BaseModuleInfo) => SqlParameter]> = [
  ['version', i => i.version ?? i.contentVersion ?? null],
  ['module_uuid', i => i.moduleUuid ?? null],
  ['format', i => i.format ?? null],
  ['format_version', i => i.formatVersion ?? null],
  ['content_version', i => i.contentVersion ?? null],
  ['content_sha256', i => i.contentSha256 ?? null],
  ['license_spdx', i => i.licenseSpdx ?? null],
  ['license_url', i => i.licenseUrl ?? null],
  ['source_url', i => i.sourceUrl ?? null],
  ['versification', i => i.versification ?? null],
  ['is_original_language', i => (i.isOriginalLanguage ? 1 : 0)],
  ['right_to_left', i => (i.rightToLeft ? 1 : 0)]
];

/**
 * Build the `SET` fragment updating the identity block.
 *
 * ```typescript
 * const identity = buildIdentityAssignments(this.sql, info);
 * this.sql.execute(`UPDATE module_info SET abbreviation = ?${identity.sql} WHERE info_id = 1`,
 *                  [info.abbreviation, ...identity.params]);
 * ```
 *
 * Column names come from the fixed {@link IDENTITY_COLUMNS} list - never from
 * caller input - so interpolating them is safe. All values bind as parameters.
 */
export function buildIdentityAssignments(
  info: BaseModuleInfo
): { sql: string; params: SqlParameter[] } {
  const assignments: string[] = [];
  const params: SqlParameter[] = [];
  for (const [column, read] of IDENTITY_COLUMNS) {
    assignments.push(`${column} = ?`);
    params.push(read(info));
  }

  return {
    sql: `, ${assignments.join(', ')}`,
    params
  };
}

/**
 * Base class for module-specific repositories (Bible, Commentary, Dictionary, etc.).
 *
 * All module databases share the same `module_info` table structure with a single row
 * (info_id = 1). This base class provides the common getModuleInfo() implementation
 * while subclasses define the row-to-entity mapping for their specific ModuleInfo type.
 *
 */
export abstract class BaseModuleRepository<TModuleInfo extends BaseModuleInfo> {
  constructor(protected sql: ISql) {}

  /**
   * Get module metadata from the module_info table.
   * Every module database has exactly one row in module_info (info_id = 1).
   */
  getModuleInfo(): TModuleInfo | undefined {
    const row = this.sql.queryOne<ModuleInfoRow>('SELECT * FROM module_info WHERE info_id = 1');
    return row ? this.mapRowToModuleInfo(row) : undefined;
  }

  protected abstract mapRowToModuleInfo(row: ModuleInfoRow): TModuleInfo;

  // ==========================================================================
  // M5 (task 0026, revision 2): getIndexSource() shared plumbing
  // ==========================================================================
  //
  // Every content repository (Bible/Commentary/Dictionary/Book/TopicalIndex)
  // needs the same two things to implement `getIndexSource()`: an
  // `IndexTarget` derived from `getModuleInfo()`, and an `IIndexSource` that
  // reads `CONTENT_MAP`'s table/rowid/indexed-column shape for that module
  // type. Both are generic across every module type, so they live here -
  // `BaseModuleRepository` is the one class every content repository already
  // extends, and duplicating this five times (as `BibleSearchService`'s
  // private `indexTargetFor()` already duplicates the target half once) is
  // exactly the "five call sites can't disagree" problem `mapModuleIdentity`
  // / `buildIdentityAssignments` above solved for the identity block. Each
  // repository's own `getIndexSource()` is therefore a one-line call into
  // `buildIndexSource()` below - see BibleRepository/CommentaryRepository/
  // DictionaryRepository/BookRepository/TopicalIndexRepository.

  /**
   * Derive this repository's `IndexTarget`.
   *
   * Mirrors `BibleSearchService.indexTargetFor()`'s derivation (the only
   * other place an `IndexTarget` is built today): `moduleUuid` from
   * `getModuleInfo()`, `contentSha256` defaulting to `''` when the info row
   * (or the field) is absent, `moduleType` supplied by the caller rather than
   * read off the info row - a repository knows its own module type
   * unconditionally, even when `module_info` itself is missing or predates
   * the identity block, which is also why `indexTargetFor` hardcodes
   * `'bible'` rather than trying to read a possibly-absent one.
   *
   * The one deliberate difference: `indexTargetFor`'s fallback identity is
   * the caller-supplied module *abbreviation*, because `BibleSearchService`
   * already has one to hand for every module it manages. A repository has no
   * such value except by reading it off the very `module_info` row that, in
   * the fallback branch, isn't there - so this falls back to the open
   * database's file path instead, via `ISql.getDatabasePath()`: not as
   * portable an identity as a UUID, but still stable for the lifetime of the
   * connection and unique per file, which an empty string would not be.
   */
  protected buildIndexTarget(moduleType: ModuleType): IndexTarget {
    const info = this.getModuleInfo();
    return {
      moduleUuid: info?.moduleUuid ?? this.sql.getDatabasePath(),
      moduleType,
      contentSha256: info?.contentSha256 ?? '',
    };
  }

  /**
   * Build the `IIndexSource` for this repository's content, straight from
   * `CONTENT_MAP[moduleType]`. `shapeIndex` exists only because `CONTENT_MAP`
   * types every entry as an array (a module type could in principle carry
   * more than one content shape); every module type actually implemented
   * today has exactly one, so the default of 0 is what every real caller
   * uses.
   *
   * Throws for a module type whose `CONTENT_MAP` entry is empty
   * (`cross_reference`, `tag_graph`) - those carry no prose/indexed content
   * in this sense (see `CONTENT_MAP`'s own doc comment), so no repository for
   * them should ever call this.
   *
   * ### Schema-drift defence
   *
   * `CONTENT_MAP.indexed` describes what the *current* schema considers
   * indexable. A real shipped module file can predate that: this pass's own
   * cross-check against the real downloaded fixtures found that
   * `topical_nave.db`'s `topic` table has no `content` column at all (the
   * column was added to the schema after that file was built - see
   * `sql/schemas/initial/TopicalIndex.sql`'s doc comment on the `content`
   * column). Rather than let `documents()` throw "no such column" on a real,
   * currently-shipped module, the columns actually present in THIS database
   * are probed once via `PRAGMA table_info` and only those are selected; a
   * column `CONTENT_MAP` expects but this file doesn't have simply
   * contributes nothing to `text`, instead of crashing indexing for the whole
   * module. Same treatment for `range`: a module missing either range column
   * is treated as having no range for this repository's rows.
   */
  protected buildIndexSource(moduleType: ModuleType, shapeIndex = 0): IIndexSource {
    const shape = CONTENT_MAP[moduleType][shapeIndex];
    if (!shape) {
      throw new Error(
        `buildIndexSource(): CONTENT_MAP['${moduleType}'] has no content shape at index ` +
        `${shapeIndex} - this module type carries no indexable content, or the index is out of range.`
      );
    }

    const target = this.buildIndexTarget(moduleType);
    const sql = this.sql;
    const table = shape.table;
    const rowidColumn = shape.rowid;

    // Table/column names below come only from the fixed CONTENT_MAP registry,
    // never from caller input, so interpolating them into SQL is safe - the
    // same posture `buildIdentityAssignments` above documents for its own
    // column list.
    const tableColumns = new Set(
      sql.queryAll<{ name: string }>(`PRAGMA table_info(${table})`).map(row => row.name)
    );
    const indexedColumns = shape.indexed.filter(column => tableColumns.has(column));
    const rangeColumns = shape.range && tableColumns.has(shape.range.start) && tableColumns.has(shape.range.end)
      ? shape.range
      : undefined;

    const selectColumns = Array.from(new Set([
      rowidColumn,
      ...indexedColumns,
      ...(rangeColumns ? [rangeColumns.start, rangeColumns.end] : []),
    ]));
    const selectList = selectColumns.join(', ');

    return {
      target,
      count(): number {
        const row = sql.queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM ${table}`);
        return row?.c ?? 0;
      },
      documents(): Iterable<IndexDocument> {
        return streamContentDocuments(sql, table, rowidColumn, selectList, indexedColumns, rangeColumns);
      },
    };
  }
}

/**
 * Page through `table` ordered by `rowidColumn`, `BATCH_SIZE` rows at a time,
 * yielding one {@link IndexDocument} per row - the generator itself is the
 * `Iterable<IndexDocument>` `IIndexSource.documents()` promises.
 *
 * `ISql` has no cursor / `.iterate()` primitive - only `queryOne`/`queryAll`,
 * both of which read their whole result set into memory before returning
 * (see `ISql.ts`). A true single-statement SQLite cursor would need a new
 * method added to that interface, which every platform (`@bible/desktop`,
 * `@bible/web`, and any future ISql implementation) would then have to grow
 * too - out of scope for this `packages/core`-only pass. Paging by rowid with
 * a bounded `LIMIT` is the closest approximation reachable through the
 * existing interface: at most one batch (`BATCH_SIZE` rows) is ever resident
 * at once, rather than the whole table, and a caller that does
 * `for (const doc of source.documents()) { ...; break; }` after the first
 * document only pays for that one batch's query, never the rest of the
 * module.
 *
 * Every content table's rowid column here is an `INTEGER PRIMARY KEY`
 * (verse_id/entry_id/section_id/topic_id), which SQLite always aliases to the
 * built-in `rowid` - so paging on `rowidColumn > ?` is exactly paging on
 * `rowid > ?`, without needing SQLite's `rowid` keyword by name.
 */
function* streamContentDocuments(
  sql: ISql,
  table: string,
  rowidColumn: string,
  selectList: string,
  indexedColumns: readonly string[],
  rangeColumns: { start: string; end: string } | undefined
): IterableIterator<IndexDocument> {
  const BATCH_SIZE = 500;
  let cursor = 0;

  for (;;) {
    const rows = sql.queryAll<SqlRow>(
      `SELECT ${selectList} FROM ${table} WHERE ${rowidColumn} > ? ORDER BY ${rowidColumn} LIMIT ?`,
      [cursor, BATCH_SIZE]
    );
    if (rows.length === 0) return;

    for (const row of rows) {
      yield rowToIndexDocument(row, rowidColumn, indexedColumns, rangeColumns);
    }

    cursor = Number(rows[rows.length - 1][rowidColumn]);
    if (rows.length < BATCH_SIZE) return;
  }
}

/**
 * Map one content row to an {@link IndexDocument}.
 *
 * `text`: each indexed column is cleaned with the same `stripHtml()` used
 * throughout `PassageFormat` (strip tags, decode entities, drop paragraph
 * markers, collapse whitespace) BEFORE joining, not after - a tag that opens
 * in one column and closes in another would otherwise straddle the join and
 * strip incorrectly. This matters for real shipped content: `commentary_entry
 * .content` and `book_section.content` carry HTML in production (confirmed
 * against `commentary_barnes.db` / `book_concord.db`), and even
 * `commentary_entry_fts`'s OWN shipped index today still contains that raw
 * HTML unstripped (see `CommentaryRepository.searchEntries`'s NEAR-query
 * workaround for exactly that reason) - `IndexDocument.text` is documented as
 * "already decompressed and markup-free", so this is a deliberate
 * improvement over what's shipped today, not a bug. Multiple indexed columns
 * (e.g. dictionary's word + definition + usage_notes) are joined with a
 * single space: `IndexDocument.text` is freeform prose fed to a keyword
 * index, not a display format, and FTS5 tokenizes whitespace either way, so a
 * space keeps the joined text readable in test failures without meaning
 * anything different to the tokenizer than a newline would.
 *
 * Compression: F4 (the compression/codec accessor) has not landed. Every real
 * module file as of this pass carries `module_info.compression = 'none'` (or
 * lacks the column entirely - it predates F2's schema). So every column read
 * here is already plain TEXT; this is a deliberate, temporary simplification,
 * not an oversight - a real decode call belongs here once F4 lands.
 *
 * `startVerseId`/`endVerseId`: populated only when `rangeColumns` is set
 * (today, only `commentary`'s `verse_id_start`/`verse_id_end`), and only when
 * the row actually has a start (a book/chapter-level commentary entry can
 * have `verse_id_start IS NULL` - R-1 in `CommentaryRepository`). A NULL end
 * means "single verse", normalised the same way `resolveRangeEnd()` in
 * `Core/Types.ts` does (inlined rather than imported, to keep this function
 * independent of the verse-range helper's `VerseId`-specific typing) - end
 * falls back to start rather than being left as `undefined`.
 *
 * Bible carries no `range` in `CONTENT_MAP` (each row already IS one verse),
 * so `rangeColumns` is `undefined` for it and `startVerseId`/`endVerseId` are
 * both omitted rather than duplicating `rowId` (which already equals the
 * verse id for a bible document). This matches the one place `IndexDocument`'s
 * sibling shape (`KeywordHit`) is populated for Bible content today -
 * `InModuleFts5Provider`'s search loop sets `rowId: row.verse.verseId` and
 * never sets `startVerseId`/`endVerseId` either.
 */
function rowToIndexDocument(
  row: SqlRow,
  rowidColumn: string,
  indexedColumns: readonly string[],
  rangeColumns: { start: string; end: string } | undefined
): IndexDocument {
  const text = indexedColumns
    .map(column => row[column])
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map(value => stripHtml(value))
    .join(' ');

  const doc: IndexDocument = {
    rowId: Number(row[rowidColumn]),
    text,
  };

  if (rangeColumns) {
    const start = row[rangeColumns.start];
    if (typeof start === 'number') {
      const end = row[rangeColumns.end];
      doc.startVerseId = start;
      doc.endVerseId = typeof end === 'number' ? end : start;
    }
  }

  return doc;
}
