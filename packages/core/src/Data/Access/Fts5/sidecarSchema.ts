/**
 * The `.kwi` sidecar keyword-index schema (task 0027, "Module Format v2",
 * revision 2, subtask F6, design doc §4.2).
 *
 * ## Why this is a TypeScript constant and not a file under `sql/schemas/`
 *
 * Every other schema in this package lives in `sql/schemas/**` and is read at
 * runtime by {@link loadSchemaSql}. That is right for those, because they are
 * *module* schemas: large, shared between the app and the module publisher,
 * cross-referenced by `-- @include` fragments, and asserted against by
 * `SharedSchemaFragments.test.ts`. None of that applies here:
 *
 * - A `.kwi` is not a module and carries no `module_info`, no
 *   `compression_dictionary`, no `schema_version` - nothing this package's
 *   shared fragments define. There is nothing to include and nothing to share.
 * - `loadSchemaSql` takes a *path*, which the caller must resolve. `sql/` sits
 *   at the package root and is NOT copied into `dist/` by
 *   `scripts/copy-assets.js`, so a schema read from disk only works for a
 *   consumer that happens to have the source tree laid out beside the build.
 *   Every existing `loadSchemaSql` caller is app-side install/bootstrap code
 *   that already knows where the repo's `sql/` directory is; this provider is
 *   library code that runs wherever `@bible/core` is installed and has no such
 *   anchor. A string constant has no path to resolve and no asset to ship.
 * - The tokenizer is the index's staleness key (see
 *   {@link SIDECAR_TOKENIZER}), so the DDL and the value `status()` compares
 *   against must be the same literal. Building the DDL from the constant makes
 *   that true by construction; two files could drift.
 *
 * ## Two deliberate schema choices, both measured rather than assumed
 *
 * - **No `columnsize=0`.** The obvious next contentless-FTS5 space saving is
 *   `columnsize=0`, and the design doc's §4.2 explicitly warns it off: with it
 *   set, `snippet()`/`highlight()` fail with SQLite's "malformed" error rather
 *   than degrading. This provider does not itself call either function (it
 *   reports `snippetFromIndex: false` - a contentless index has no stored text
 *   to snippet, so both return NULL here) but F7's transient highlighting
 *   table may, and a "malformed" error is a far worse failure mode than a NULL
 *   for a few bytes per document. `SidecarFts5Provider.test.ts` asserts both
 *   halves: that this SQL does not contain `columnsize`, and that `snippet()`
 *   against a really-built index returns NULL instead of raising.
 * - **`contentless_delete=1`.** Nothing in this per-module-file provider ever
 *   deletes a row - a module revision gets a whole new `.kwi` (see the file
 *   naming in `SidecarFts5Provider`), and a pruned module gets the file
 *   removed. It is set anyway because it costs nothing measured on real data
 *   and a future shared-index provider (one `.kwi` holding several modules'
 *   rows) cannot be added later without it: `contentless_delete` can only be
 *   chosen when the table is created, so an index built without it can never
 *   have one module's rows removed - only the whole file discarded.
 */

/**
 * The FTS5 tokenizer every `.kwi` is built with, and the value `status()`
 * compares `kwi_meta.tokenizer` against to decide staleness.
 *
 * Identical to the tokenizer the remaining shipped fts5 schema uses
 * (`UserDatabase.sql`'s `user_note_fts`; the in-module `*_fts` tables F2
 * removed, and main.db's own `bible_search_index` task 0026 subtask M12
 * removed), so a query that matched through `InModuleFts5Provider` matches
 * the same documents through this one - Porter stemming and unicode61
 * folding behave the same either side of the strangler.
 *
 * Changing this value is a breaking index change: every existing `.kwi`
 * immediately reports `stale` and is rebuilt in place. That is the intended
 * mechanism, not a side effect.
 */
export const SIDECAR_TOKENIZER = 'porter unicode61';

/**
 * The builder's own version, written to `kwi_meta.builder` and compared on
 * `status()` exactly as the tokenizer is.
 *
 * Bump it whenever the *way* documents are written changes in a manner that
 * makes an older index answer differently - a different text normalisation, a
 * different `kw_doc` mapping, a different rowid convention. A pure bug fix in
 * query compilation does not need a bump (the index is unchanged); a change to
 * what goes INTO the index does. Design doc §4.4's "tokenizer/builder changed
 * -> stale -> rebuild in place" row is exactly this knob.
 */
export const SIDECAR_BUILDER_VERSION = '1.0.0';

/** `kwi_meta.format`: the sidecar container format, independent of the module format version. */
export const KWI_FORMAT = 'kwi/1';

/** The `kwi_meta` keys this builder writes and `status()` reads back. */
export const KWI_META_KEYS = {
  format: 'format',
  providerId: 'provider_id',
  tokenizer: 'tokenizer',
  builder: 'builder',
  moduleUuid: 'module_uuid',
  contentSha256: 'content_sha256',
  source: 'source',
  docCount: 'doc_count',
  builtAt: 'built_at',
} as const;

/**
 * The complete DDL for a fresh `.kwi`, executed in one `exec()` against a
 * brand-new (empty) database file.
 *
 * `PRAGMA page_size` is first on purpose: SQLite only honours it while the
 * database has no pages, i.e. before the first table is created.
 *
 * `kw.rowid` is written explicitly at insert time from `IndexDocument.rowId`,
 * and `kw_doc.doc_id` is that same value - which is what makes the two tables
 * lockstep by construction rather than by a join key the builder maintains
 * separately. For a per-module sidecar that value is also the source row's own
 * rowid (`bible_verse.verse_id`, `commentary_entry.entry_id`, ...), so
 * `kw_doc.source_rowid` is equal to it today; the column is kept distinct
 * because a shared index (several modules in one file) could not keep them
 * equal, and the `KeywordHit.rowId` a caller resolves against its repository
 * must be the SOURCE rowid, never the index's own.
 */
export const SIDECAR_SCHEMA_SQL = `
PRAGMA page_size = 4096;

-- Provenance and staleness keys. Read by SidecarFts5Provider.status() on every
-- status check; never joined against.
CREATE TABLE kwi_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- The single indexed column is 'text', by construction: one FTS5 column means
-- a query never has to name one, and a provider-neutral KeywordQuery (M1) has
-- no column concept to compile into one.
--
-- content='' makes this contentless: postings only, no copy of the text. The
-- module file remains the single source of truth for the text itself.
--
-- Two choices here are load-bearing and are argued in this file's TypeScript
-- doc comment above: why contentless_delete is on, and why the obvious extra
-- space saving (the option that drops per-column size data) is deliberately
-- NOT set, because it makes snippet()/highlight() fail with "malformed"
-- instead of returning NULL. SidecarFts5Provider.test.ts asserts the option's
-- name appears nowhere in this SQL, so it is not written out here.
CREATE VIRTUAL TABLE kw USING fts5(
    text,
    tokenize = '${SIDECAR_TOKENIZER}',
    content = '',
    contentless_delete = 1
);

-- One row per indexed document, keyed by the same rowid the 'kw' row carries.
CREATE TABLE kw_doc (
    doc_id         INTEGER PRIMARY KEY,   -- = kw.rowid, always
    module_uuid    TEXT NOT NULL,
    source_rowid   INTEGER NOT NULL,      -- what KeywordHit.rowId carries
    start_verse_id INTEGER,               -- NULL for content with no passage anchor
    end_verse_id   INTEGER
);

-- Serves the pushed-down KeywordSearchOptions.scope filter (a passage-range
-- restriction), which is an overlap test on these two columns.
CREATE INDEX idx_kw_doc_range  ON kw_doc(start_verse_id, end_verse_id);
-- Serves per-module narrowing. Redundant for a per-module sidecar (every row
-- shares one module_uuid) and load-bearing for a future shared index; kept
-- because the schema is the same either way.
CREATE INDEX idx_kw_doc_module ON kw_doc(module_uuid, source_rowid);
`;
