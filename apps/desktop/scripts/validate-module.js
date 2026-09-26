#!/usr/bin/env node

/**
 * validate-module.js - Public conformance checker for Bible app module databases.
 *
 * Validates a module `.db` file against the module format contract:
 *   - `module_info` exists and carries the single `info_id = 1` row.
 *   - A recognised content table for the module type is present.
 *   - Bible modules stay inside the 66-book Protestant canon and the standard
 *     English (KJV) versification: every (book, chapter, verse) triple present in
 *     the module must exist in the canonical reference space, and per-book chapter
 *     counts must not EXCEED the canonical chapter count.
 *   - `module_info` declares the v2 identity block (uuid, exact format version,
 *     versioning, licensing) that a generic consumer reads without knowing the
 *     type.
 *   - `compression` names a codec this build can actually decode, a
 *     `compression_dictionary` row exists exactly when the module is
 *     compressed, and `content_sha256` recomputes to the stored value.
 *   - No `fts5` virtual table exists anywhere in the file. v0.2 ships no FTS5
 *     tables at all - the app builds its own sidecar keyword index at install
 *     time instead (task 0026/0027).
 *   - The primary text column actually contains TEXT, compressed or not. A
 *     converter bug once produced modules where 99% of entries were a few
 *     bytes of binary noise and every structural check still passed - the
 *     shape was perfect and the content was gone. For a compressed module
 *     this means decoding a sample and scoring the DECODED text, not the raw
 *     BLOB - scoring the BLOB directly produces exactly the same kind of
 *     false "corrupt" verdict this check exists to avoid.
 *
 * A canonical *subset* passes (an OT-only Bible, a Pentateuch-only Bible). Only
 * *shifted* or *out-of-canon* numbering fails - that is what silently collides in
 * the shared verse-id space.
 *
 * Canon source: `main.db` (`chapter_info` + `bible_book`) when it is populated,
 * otherwise the checked-in `scripts/data/kjv-versification.json`.
 *
 * Uses the repo root's `better-sqlite3`, which is built for system Node.js (the
 * desktop's own `better-sqlite3-multiple-ciphers` is built for Electron). All
 * module databases are opened READ-ONLY - this script never writes.
 *
 * Usage:
 *   node scripts/validate-module.js <module> [options]
 *   node scripts/validate-module.js --all [options]
 *
 * Arguments:
 *   <module>            DB filename ("bible_kjv"), abbreviation ("kjv"), or full path.
 *
 * Options:
 *   --all               Validate every .db module in the modules directory.
 *   --type=<type>       With --all, restrict to one type (bible, commentary,
 *                       dictionary, lexicon, book, devotional, topical, xref,
 *                       tag_graph).
 *   --json              Emit machine-readable JSON instead of a text report.
 *   --quiet             Only print failures (text mode).
 *   --modules-dir=PATH  Override the modules directory.
 *   --main-db=PATH      Override the main.db used as the canon source.
 *
 * Exit code: 0 if everything validated passes, 1 if any module fails,
 *            2 on a usage/setup error.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
// Same require('@bible/core') pattern build-feature-pack.js already uses from
// this same scripts/ directory - established and safe here, unlike
// scripts/init/catalog.js at the repo root, which avoids it for an unrelated
// reason that does not apply to this file.
const {
  FORMAT_VERSION,
  CONTENT_MAP,
  normalizeModuleType,
  createNodeCodecRegistry,
  resolveModuleCodec,
  computeContentSha256,
} = require('@bible/core');

// ============================================================================
// Constants
// ============================================================================

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const DEFAULT_MODULES_DIR = path.join(PROJECT_ROOT, 'apps', 'desktop', 'data', 'modules');
const DEFAULT_MAIN_DB = path.join(PROJECT_ROOT, 'apps', 'desktop', 'data', 'main.db');
const VERSIFICATION_PATH = path.join(__dirname, 'data', 'kjv-versification.json');

const MAX_BOOK_NUMBER = 66;

/**
 * Content tables that identify a module type. A module needs at least one.
 *
 * v2 table names (ModuleFormat section 9): topical index content is `topic` (singular),
 * cross-reference content is `cross_reference_group`, and `tag_graph` is a
 * first-class type keyed on its entity/association tables. The old `topics` /
 * `cross_reference` spellings are retained here only so a v1 module produces a
 * type-specific "wrong table" message rather than an opaque "unknown type".
 */
const CONTENT_TABLES = {
  bible: ['bible_verse'],
  commentary: ['commentary_entry'],
  dictionary: ['dictionary_entry'],
  lexicon: ['dictionary_entry'],   // a lexicon is a dictionary-shaped module (section 9.3)
  book: ['book_section'],
  devotional: ['devotional_entry'],
  topical: ['topic', 'topics'],
  xref: ['cross_reference_group', 'cross_reference'],
  tag_graph: ['tag_association', 'person', 'place', 'object', 'theme'],
};

/** Info tables accepted in place of the canonical `module_info`. */
const INFO_TABLE_ALIASES = ['module_info', 'topical_index_module_info'];

/**
 * Tables every conforming module MUST carry, whatever its type (ModuleFormat section 8).
 * `verse_link` is the one uniform content->verse linking shape (may be empty);
 * `schema_version` records the schema revision the file was built at.
 */
const REQUIRED_TABLES = ['verse_link', 'schema_version'];

/** The only canon / versification the v2 format accepts (ModuleFormat section 4). */
const REQUIRED_CANON = 'protestant-66';
const REQUIRED_VERSIFICATION = 'kjv-english';

/** RFC 4122 UUID (any version/variant). `module_uuid` MUST match (section 8.1, section 12). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Non-conforming range column spellings (ModuleFormat section 5). A v2 module MUST NOT
 * declare these in ANY table; they are the reversed v1 spelling that a validator
 * exists to flag.
 */
const FORBIDDEN_RANGE_COLUMNS = ['start_verse_id', 'end_verse_id'];

/**
 * `module_info` columns the v2 contract requires of every module type.
 * A consumer reads these without knowing the module type, so a module missing
 * one is unusable generically even if its own content is fine.
 *
 * `canon` is deliberately NOT in this list. The canon is always the 66-book
 * Protestant canon and `packages/core/sql/schemas/shared/module_info.sql`
 * carries no such column at all - only `versification` varies (see that
 * file's own comment on the point). A `canon` requirement here would fail
 * every module built from the current schema.
 */
const REQUIRED_INFO_COLUMNS = [
  'module_uuid', 'abbreviation', 'full_name',
  'format', 'format_version', 'content_version', 'content_sha256',
  'versification',
  'license_spdx', 'source_url',
];

/** Up to how many rows of a compressed prose column {@link checkDecodeRoundTrip} samples. */
const DECODE_SAMPLE_SIZE = 50;

/**
 * Content sanity: the primary text column of each module type.
 *
 * A module can be structurally perfect and still hold garbage. A converter bug
 * (the SWBuf use-after-free) produced modules where 99% of entries were a few
 * bytes of binary noise, and this validator passed all of them - it was checking
 * the shape of the container and never looking inside. These thresholds are
 * deliberately loose: they are meant to catch wholesale corruption, not to judge
 * editorial quality.
 */
const CONTENT_COLUMNS = {
  bible: { table: 'bible_verse', column: 'text', minChars: 8 },
  commentary: { table: 'commentary_entry', column: 'content', minChars: 12 },
  dictionary: { table: 'dictionary_entry', column: 'definition', minChars: 8 },
  devotional: { table: 'devotional_entry', column: 'content', minChars: 12 },
  book: { table: 'book_section', column: 'content', minChars: 12 },
};

/**
 * Two thresholds, because "short" and "not text" are very different signals.
 *
 * U+FFFD means bytes that were never valid UTF-8 - nothing legitimate produces
 * those, so a low bar is right. Shortness alone is unreliable: `bdbglosses` is a
 * Strong's gloss list where 3,461 of 8,674 entries (39%) are legitimately just a
 * key with no gloss, identically so in the v1 module. Only near-total shortness
 * indicates corruption.
 *
 * Calibrated against observed real data:
 *   corrupt  barnes 99.3% short / 69.3% U+FFFD  - mhc 100% / 96.6%
 *            easton 98.9% / 98.9%  - dbd 100% / 0%  - ylt 100% / 100%
 *            lo 100% / 32.3%
 *   healthy  bdbglosses 39% / 0%   - kjv 0.01% / 0%  - concord 0% / 0%
 *            webster1913 0% / 13.9%  - jochrist 0% / 25.9%
 *
 * SHORTNESS is the reliable discriminator: every corrupt module ran >= 98%
 * short, every healthy one <= 39%. U+FFFD on its own is NOT - `webster1913`
 * (13.9%) and `jochrist` (25.9%) carry replacement characters in identical
 * numbers to their v1 counterparts, because the SWORD sources lost Latin
 * ligatures (`ædificari`, `præparans`) long before we touched them. Failing on
 * that would reject data we cannot improve.
 */
const CONTENT_NONTEXT_RATIO = 0.60;   // only overwhelming non-text fails on its own
const CONTENT_SHORT_RATIO = 0.80;
// Below the failure thresholds above but still worth a warning. Same
// calibration data as CONTENT_NONTEXT_RATIO/CONTENT_SHORT_RATIO's comment.
const CONTENT_NONTEXT_WARN_RATIO = 0.05;
const CONTENT_SHORT_WARN_RATIO = 0.20;

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

// ============================================================================
// SQLite helpers (read-only)
// ============================================================================

// better-sqlite3 is synchronous; these stay async so a failure surfaces as a
// rejection, the way every caller below already handles it.

async function openReadOnly(dbPath) {
  try {
    return new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (err) {
    throw new Error(`Cannot open database: ${dbPath} (${err.message})`);
  }
}

async function dbAll(db, sql, params = []) {
  return db.prepare(sql).all(params);
}

async function dbGet(db, sql, params = []) {
  return db.prepare(sql).get(params) || null;
}

async function dbClose(db) {
  if (db) db.close();
}

/**
 * The Node/Electron codec set this build can decode with. Built once at
 * module load: a `CodecRegistry` is immutable and holds no per-module state
 * (see `NodeCodecs.ts`), so there is nothing to gain by re-constructing it
 * for every module `--all` validates.
 */
const CODEC_REGISTRY = createNodeCodecRegistry();

/**
 * Minimal `ISql` adapter over this script's raw `better-sqlite3` connection,
 * so `resolveModuleCodec()` and `computeContentSha256()` - the real,
 * already-tested @bible/core implementations - run against it directly
 * instead of a second, hand-rolled reimplementation of codec resolution or
 * the content digest. Mirrors `ReadOnlyRawDbSql` in
 * `apps/desktop/electron/services/InstallationService.ts`, which solves
 * exactly the same problem for the install-time gate.
 *
 * Only `queryOne`/`queryAll` are ever actually called by either function, so
 * the rest of `ISql`'s surface is present only to satisfy the shape (this is
 * a plain JS script - nothing here enforces the TypeScript interface - and a
 * caller that ever did reach `execute()` on a read-only validator would be a
 * bug worth throwing on loudly, not swallowing).
 */
class ReadOnlyModuleSql {
  constructor(db, dbPath) {
    this.db = db;
    this.dbPath = dbPath;
  }

  queryOne(sql, params) {
    const stmt = this.db.prepare(sql);
    return params !== undefined ? stmt.get(params) : stmt.get();
  }

  queryAll(sql, params) {
    const stmt = this.db.prepare(sql);
    return params !== undefined ? stmt.all(params) : stmt.all();
  }

  execute() {
    throw new Error('ReadOnlyModuleSql is read-only: validate-module.js never writes.');
  }

  transaction(callback) {
    return callback();
  }

  close() {
    // Owned and closed by validateModule()'s own `finally`, not here.
  }

  isOpen() {
    return true;
  }

  getDatabasePath() {
    return this.dbPath;
  }
}

// ============================================================================
// Module resolution
// ============================================================================

/**
 * Resolve a module identifier to a full .db file path.
 * Accepts: full path, filename, or abbreviation/prefix.
 */
function resolveModule(identifier, modulesDir = DEFAULT_MODULES_DIR) {
  if (path.isAbsolute(identifier) || identifier.includes('/') || identifier.includes('\\')) {
    if (!fs.existsSync(identifier)) {
      throw new Error(`Database file not found: ${identifier}`);
    }
    return identifier;
  }

  const withExt = identifier.endsWith('.db') ? identifier : `${identifier}.db`;

  const directPath = path.join(modulesDir, withExt);
  if (fs.existsSync(directPath)) return directPath;

  const prefixes = ['bible_', 'commentary_', 'dictionary_', 'lexicon_', 'topical_', 'book_', 'devotional_', 'xref_', 'tag_graph'];
  for (const prefix of prefixes) {
    const prefixed = path.join(modulesDir, `${prefix}${withExt}`);
    if (fs.existsSync(prefixed)) return prefixed;
  }

  if (fs.existsSync(modulesDir)) {
    const files = fs.readdirSync(modulesDir).filter(f => f.endsWith('.db'));
    const lower = identifier.toLowerCase();
    const match = files.find(f => f.toLowerCase().includes(lower));
    if (match) return path.join(modulesDir, match);
  }

  throw new Error(`Cannot resolve module: "${identifier}". Provide a filename, abbreviation, or full path.`);
}

async function listTables(db) {
  const rows = await dbAll(db, "SELECT name FROM sqlite_master WHERE type IN ('table','view')");
  return new Set(rows.map(r => r.name));
}

function detectModuleType(tableNames) {
  // v2 content tables first; v1 spellings kept as fallbacks so an old file still
  // detects to the right type (and then fails its content-table check clearly).
  if (tableNames.has('bible_verse')) return 'bible';
  if (tableNames.has('commentary_entry')) return 'commentary';
  if (tableNames.has('dictionary_entry')) return 'dictionary';
  if (tableNames.has('book_section')) return 'book';
  if (tableNames.has('devotional_entry')) return 'devotional';
  if (tableNames.has('topic') || tableNames.has('topics')) return 'topical';
  if (tableNames.has('cross_reference_group') || tableNames.has('cross_reference')) return 'xref';
  if (tableNames.has('tag_association') || tableNames.has('entity_verse_link')
      || (tableNames.has('person') && tableNames.has('place'))) return 'tag_graph';
  return 'unknown';
}

/** Module type implied by the filename prefix (used when detection fails). */
function typeFromFilename(file) {
  const base = path.basename(file);
  if (base.startsWith('xref_')) return 'xref';
  if (base.startsWith('tag_graph')) return 'tag_graph';
  const prefix = base.split('_')[0];
  return Object.prototype.hasOwnProperty.call(CONTENT_TABLES, prefix) ? prefix : null;
}

// ============================================================================
// Canonical reference space
// ============================================================================

/**
 * Load the canonical versification.
 *
 * Returns { source, chapters: Map<bookNumber, number[]>, bookNames: Map<number,string> }
 * where chapters.get(n)[i] is the verse count of chapter i+1 of book n.
 *
 * Prefers the materialised reference space in main.db (chapter_info); falls back
 * to the checked-in canonical data file when main.db is absent or unpopulated.
 */
async function loadCanon(mainDbPath = DEFAULT_MAIN_DB) {
  const chapters = new Map();
  const bookNames = new Map();

  if (fs.existsSync(mainDbPath)) {
    let db = null;
    try {
      db = await openReadOnly(mainDbPath);
      const rows = await dbAll(db, `
        SELECT b.book_number AS book_number, b.book_name AS book_name,
               ci.chapter AS chapter, ci.verse_count AS verse_count
        FROM chapter_info ci
        JOIN bible_book b ON b.book_id = ci.book_id
        ORDER BY b.book_number, ci.chapter
      `);
      if (rows.length > 0) {
        for (const row of rows) {
          if (!chapters.has(row.book_number)) chapters.set(row.book_number, []);
          chapters.get(row.book_number)[row.chapter - 1] = row.verse_count;
          bookNames.set(row.book_number, row.book_name);
        }
        return { source: `main.db (${mainDbPath})`, chapters, bookNames };
      }
    } catch {
      // main.db missing the reference tables - fall through to the data file.
    } finally {
      await dbClose(db);
    }
  }

  if (!fs.existsSync(VERSIFICATION_PATH)) {
    throw new Error(
      `No canon source available: main.db reference space is empty and ${VERSIFICATION_PATH} is missing.`
    );
  }
  const doc = JSON.parse(fs.readFileSync(VERSIFICATION_PATH, 'utf8'));
  for (const book of doc.books) {
    chapters.set(book.book_number, book.verse_counts.slice());
    bookNames.set(book.book_number, book.name);
  }
  return { source: `data file (${VERSIFICATION_PATH})`, chapters, bookNames };
}

// ============================================================================
// Checks
// ============================================================================

function err(code, message, extra) {
  return Object.assign({ code, message }, extra || {});
}

/**
 * `module_info` (or its alias)'s `info_id = 1` row, or `null` when the table
 * or that row is absent. Shared by every check below that needs a column off
 * the row: `checkModuleInfo` is the one place that ABSENCE is itself
 * reported (`missing_module_info` / `missing_module_info_row`), so every
 * other check treats `null` here as "not this check's business" rather than
 * reporting the same absence a second time under a different code.
 */
async function getInfoRow(db, tableNames) {
  const infoTable = INFO_TABLE_ALIASES.find(t => tableNames.has(t));
  if (!infoTable) return null;
  const row = await dbGet(db, `SELECT * FROM ${infoTable} WHERE info_id = 1`);
  return row ? { infoTable, row } : null;
}

/**
 * `module_info.compression`, defaulting to `'none'` when the info row or the
 * `compression` column itself is absent - an old-schema database predating
 * the column (F2). Mirrors `resolveModuleCodec.ts`'s own `readCompression()`
 * so this script's notion of "what codec did this module choose" matches the
 * one the rest of the app reads modules through.
 */
async function moduleCompression(db, tableNames) {
  const info = await getInfoRow(db, tableNames);
  if (!info) return 'none';
  let declared;
  try {
    declared = new Set(
      (await dbAll(db, `SELECT name FROM pragma_table_info('${info.infoTable}')`)).map(c => c.name)
    );
  } catch {
    return 'none';
  }
  if (!declared.has('compression')) return 'none';
  const raw = info.row.compression;
  return raw ? String(raw) : 'none';
}

async function checkModuleInfo(db, tableNames, result) {
  const infoTable = INFO_TABLE_ALIASES.find(t => tableNames.has(t));
  if (!infoTable) {
    result.errors.push(err('missing_module_info', 'No `module_info` table found.'));
    return;
  }
  if (infoTable !== 'module_info') {
    result.warnings.push(err(
      'nonstandard_module_info',
      `Info table is \`${infoTable}\`; the format requires \`module_info\`.`
    ));
  }

  const row = await dbGet(db, `SELECT * FROM ${infoTable} WHERE info_id = 1`);
  if (!row) {
    // Distinguish "table empty" from "row uses a different id".
    const any = await dbGet(db, `SELECT COUNT(*) AS cnt FROM ${infoTable}`);
    const cnt = any ? any.cnt : 0;
    result.errors.push(err(
      'missing_module_info_row',
      cnt === 0
        ? `\`${infoTable}\` is empty; the format requires a single row with info_id = 1.`
        : `\`${infoTable}\` has ${cnt} row(s) but none with info_id = 1.`
    ));
    return;
  }

  result.info = {
    abbreviation: row.abbreviation ?? null,
    name: row.full_name ?? row.title ?? row.name ?? null,
    version: row.content_version ?? row.version ?? null,
    language_code: row.language_code ?? null,
    module_uuid: row.module_uuid ?? null,
    canon: row.canon ?? null,
    versification: row.versification ?? null,
  };

  // section 8.1 / section 12: module_uuid MUST be present and a valid UUID - it, not
  // `abbreviation`, is the cross-database join key.
  if (row.module_uuid === undefined || row.module_uuid === null || row.module_uuid === '') {
    result.errors.push(err('missing_module_uuid',
      '`module_info.module_uuid` is empty; a module MUST carry a stable RFC 4122 UUID.'));
  } else if (!UUID_RE.test(String(row.module_uuid))) {
    result.errors.push(err('invalid_module_uuid',
      `\`module_info.module_uuid\` = ${JSON.stringify(row.module_uuid)} is not a valid UUID.`));
  }

  // section 4 / section 12: canon and versification are declarations with exactly one accepted
  // value each in format 2.0. The column may exist (checked below) but hold a
  // shifted value, which is precisely what silently collides in the shared
  // verse-id space, so the VALUE is checked, not just the column.
  if (row.canon !== undefined && row.canon !== REQUIRED_CANON) {
    result.errors.push(err('wrong_canon',
      `\`module_info.canon\` = ${JSON.stringify(row.canon)}; the format accepts only '${REQUIRED_CANON}'.`));
  }
  if (row.versification !== undefined && row.versification !== REQUIRED_VERSIFICATION) {
    result.errors.push(err('wrong_versification',
      `\`module_info.versification\` = ${JSON.stringify(row.versification)}; the format accepts only '${REQUIRED_VERSIFICATION}'.`));
  }

  // Required v2 identity columns. Checked against the declared schema rather than
  // the row, because a NULL value is a data gap while a missing column breaks any
  // generic consumer's query outright.
  const declared = new Set(
    (await dbAll(db, `SELECT name FROM pragma_table_info('${infoTable}')`)).map(c => c.name)
  );
  const missing = REQUIRED_INFO_COLUMNS.filter(c => !declared.has(c));
  if (missing.length) {
    result.errors.push(err(
      'missing_info_columns',
      `\`${infoTable}\` is missing required column(s): ${missing.join(', ')}.`
    ));
  }

  const total = await dbGet(db, `SELECT COUNT(*) AS cnt FROM ${infoTable}`);
  if (total && total.cnt > 1) {
    result.warnings.push(err(
      'multiple_module_info_rows',
      `\`${infoTable}\` has ${total.cnt} rows; exactly one (info_id = 1) is expected.`
    ));
  }
}

/**
 * section 8.1 / section 12: `format_version` MUST be exactly `FORMAT_VERSION`
 * ('0.2'), the one version this build's publisher ever writes.
 *
 * This is deliberately stricter than a reader's `isReadableFormatVersion()`,
 * which is an ALLOW-LIST of everything still readable - the current version,
 * older still-readable 0.x minors, and the pre-0.x legacy string ('2.0'). A
 * reader has to tolerate all of those because real files in the wild carry
 * them. A publisher is not tolerating anything; it is the one WRITING new
 * files, so stamping anything other than the exact current version - an old
 * '0.1' as much as a made-up '0.3' - is always a publish-time defect: either
 * the writer forgot to bump the column, or it is knowingly mislabelling
 * stale content as fresh.
 */
async function checkFormatVersion(db, tableNames, result) {
  const info = await getInfoRow(db, tableNames);
  if (!info) return; // absence already reported by checkModuleInfo

  const raw = info.row.format_version;
  if (raw === undefined || raw === null || raw === '') {
    // Column missing entirely: REQUIRED_INFO_COLUMNS already reports that.
    // Column present but NULL/empty: a data gap, not this check's business.
    return;
  }
  if (String(raw) !== FORMAT_VERSION) {
    result.errors.push(err('wrong_format_version',
      `\`module_info.format_version\` = ${JSON.stringify(raw)}; a publisher MUST write exactly ` +
      `'${FORMAT_VERSION}' (the current format this build writes), never an older or newer value.`));
  }
}

/**
 * section 4: `compression` MUST name a codec this build can actually decode
 * (`createNodeCodecRegistry()`'s registry).
 *
 * Stricter than the install-time equivalent (`validateModuleFile.ts`'s
 * `'missing-codec'`, a WARNING there): an install-time reader tolerates a
 * codec gap because a FUTURE build (or one with the optional native zstd
 * binding) might still read the file, so refusing the install would throw
 * away a module that is fine for everything except its own prose. A
 * publisher has no such excuse - it is choosing, right now, to ship a module
 * its own build cannot decode, which is a real defect, not a
 * forward-compatibility grey area.
 */
async function checkCompressionCodec(db, tableNames, registry, result) {
  const compression = await moduleCompression(db, tableNames);
  if (!registry.has(compression)) {
    result.errors.push(err('missing_codec',
      `\`module_info.compression\` = ${JSON.stringify(compression)} has no codec registered in ` +
      `this build; a publisher MUST NOT ship a module its own build cannot decode.`));
  }
}

/**
 * A `compression_dictionary` row MUST exist for the module's `compression`
 * codec if and only if `compression != 'none'` - an uncompressed module has
 * nothing to bind a dictionary to (`compression = 'none'` means the table is
 * empty by definition, per `compression_dictionary.sql`'s own comment), and
 * this publisher never ships a compressed module without recording the
 * dictionary it trained for it.
 */
async function checkCompressionDictionary(db, tableNames, result) {
  const compression = await moduleCompression(db, tableNames);

  if (!tableNames.has('compression_dictionary')) {
    if (compression !== 'none') {
      result.errors.push(err('missing_dictionary_row',
        `\`module_info.compression\` = ${JSON.stringify(compression)} but this module carries no ` +
        `\`compression_dictionary\` table at all; a publisher MUST record the dictionary a ` +
        `compressed module was encoded with.`));
    }
    return;
  }

  let matching;
  try {
    matching = await dbGet(db, 'SELECT codec FROM compression_dictionary WHERE codec = ?', [compression]);
  } catch {
    return; // unreadable table: not this check's business
  }

  if (compression !== 'none' && !matching) {
    result.errors.push(err('missing_dictionary_row',
      `\`module_info.compression\` = ${JSON.stringify(compression)} but \`compression_dictionary\` ` +
      `has no row for it.`));
  }

  if (compression === 'none') {
    let any;
    try { any = await dbGet(db, 'SELECT COUNT(*) AS cnt FROM compression_dictionary'); }
    catch { any = null; }
    if (any && any.cnt > 0) {
      result.errors.push(err('unexpected_dictionary_row',
        `\`module_info.compression\` = 'none' but \`compression_dictionary\` has ${any.cnt} row(s); ` +
        `an uncompressed module MUST NOT carry a dictionary nothing will ever bind.`));
    }
  }
}

/**
 * No `fts5` virtual table may exist anywhere in the file.
 *
 * v0.2 reality, not the old v1 one: F2 removed every FTS5 table declaration
 * from every schema in this repo (see `packages/core/sql/schemas/`), and the
 * app now builds its own sidecar keyword index at install time instead (task
 * 0026/0027's keyword-index design). There is therefore no longer a
 * "correct FTS5 shape" for a module to carry - a shipped `fts5` table of ANY
 * shape is a leftover from an old conversion pipeline, not a legitimate
 * variant, so "must not exist" replaces the old column-order contract
 * outright rather than refining it.
 */
async function checkNoFts5Tables(db, tableNames, result) {
  let rows;
  try {
    rows = await dbAll(db, "SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL");
  } catch {
    return; // unreadable sqlite_master: not this check's business
  }

  const fts5Tables = rows.filter(r => /using\s+fts5/i.test(r.sql || '')).map(r => r.name);
  if (fts5Tables.length === 0) return;

  result.errors.push(err('unexpected_fts5_table',
    `Found FTS5 virtual table(s): ${fts5Tables.join(', ')}. The v0.2 format ships no FTS5 tables ` +
    `at all - the app builds its own sidecar keyword index at install time instead. Remove them ` +
    `before publishing.`));
}

/**
 * Shared short/non-text corruption verdict, given aggregate counts over some
 * sample of content. `checkContentSanity`'s SQL-aggregate path (compression
 * = 'none') and `checkDecodeRoundTrip`'s decoded-sample path (compression !=
 * 'none') both feed their counts through this one function, so the two
 * checks can never quietly drift onto different thresholds for what "looks
 * corrupt" means. See CONTENT_NONTEXT_RATIO/CONTENT_SHORT_RATIO's
 * calibration comment for where the numbers themselves come from.
 */
function corruptionLevel(total, short, nontext) {
  if (!total) return 'ok';
  const shortRatio = short / total;
  const nonTextRatio = nontext / total;
  if (nonTextRatio >= CONTENT_NONTEXT_RATIO || shortRatio >= CONTENT_SHORT_RATIO) return 'error';
  if (nonTextRatio >= CONTENT_NONTEXT_WARN_RATIO || shortRatio >= CONTENT_SHORT_WARN_RATIO) return 'warning';
  return 'ok';
}

/**
 * Look inside the module: is the primary text column actually text?
 *
 * Two independent signals, because either alone gives false positives:
 *   - implausibly short entries (a real commentary entry is not 6 bytes)
 *   - U+FFFD replacement characters, which mean bytes that were never valid UTF-8
 *
 * Reported as an ERROR past the threshold and a WARNING below it, so a module
 * with a handful of genuinely terse entries is not failed outright.
 *
 * Only meaningful for `compression = 'none'`. `trim()`/`LIKE` below run
 * directly against the column's raw bytes, which are plain TEXT only when
 * the module is uncompressed; against a compressed BLOB column, SQLite's
 * `trim()`/`LIKE` do not decode DEFLATE/zstd frames, so this SQL either
 * errors out or silently mismatches in a way that makes every row look
 * "short" or "non-text" - a compressed module's perfectly healthy content
 * would be reported `content_corrupt` for no reason at all. A compressed
 * module is `checkDecodeRoundTrip`'s job instead, which runs the same
 * verdict over the DECODED text.
 */
async function checkContentSanity(db, tableNames, moduleType, result) {
  const spec = CONTENT_COLUMNS[moduleType];
  if (!spec || !tableNames.has(spec.table)) return;

  const compression = await moduleCompression(db, tableNames);
  if (compression !== 'none') return; // checkDecodeRoundTrip's business instead

  const { table, column, minChars } = spec;

  let stats;
  try {
    stats = await dbGet(db, `
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN ${column} IS NULL OR length(trim(${column})) < ${minChars} THEN 1 ELSE 0 END) AS short,
             SUM(CASE WHEN ${column} LIKE '%' || char(65533) || '%' THEN 1 ELSE 0 END) AS nontext
        FROM ${table}
    `);
  } catch {
    return; // column absent in a v1 layout: not this check's business
  }
  if (!stats || !stats.total) return;

  const short = stats.short || 0;
  const nontext = stats.nontext || 0;
  const shortRatio = short / stats.total;
  const nonTextRatio = nontext / stats.total;
  const pct = n => `${(n * 100).toFixed(1)}%`;
  const level = corruptionLevel(stats.total, short, nontext);

  if (level === 'error') {
    result.errors.push(err(
      'content_corrupt',
      `\`${table}.${column}\` does not look like text: ` +
      `${short}/${stats.total} rows (${pct(shortRatio)}) shorter than ${minChars} chars, ` +
      `${nontext}/${stats.total} (${pct(nonTextRatio)}) contain U+FFFD. ` +
      `This is the signature of a converter reading freed or mis-decoded memory.`
    ));
    return;
  }

  if (level === 'warning') {
    result.warnings.push(err(
      'content_thin',
      `${short} very short (${pct(shortRatio)}) and ${nontext} non-UTF8 ` +
      `(${pct(nonTextRatio)}) row(s) in \`${table}.${column}\`. Below the failure ` +
      `thresholds (${pct(CONTENT_SHORT_RATIO)} short / ${pct(CONTENT_NONTEXT_RATIO)} non-UTF8). ` +
      `Often inherited from the source module rather than introduced by conversion — ` +
      `compare against the previous version before treating it as a defect.`
    ));
  }
}

/**
 * Decode round-trip on a sample of rows, for a compressed module
 * (`compression != 'none'`). The compressed replacement for
 * `checkContentSanity`'s SQL-based scan (see that function's doc comment for
 * why the SQL path is skipped for a compressed module in the first place):
 * decode a real sample through the resolved codec and run the SAME
 * short/non-text heuristic (`corruptionLevel`) over the DECODED text, so a
 * genuinely healthy compressed module is not flagged `content_corrupt` just
 * because SQLite cannot see through its BLOBs - the exact false positive
 * this subtask exists to fix - while content that is genuinely corrupt, or a
 * frame that fails to decode at all, still is.
 *
 * Samples up to `DECODE_SAMPLE_SIZE` rows per prose column, ordered by the
 * shape's rowid ascending (a cheap, deterministic sample - no
 * `ORDER BY RANDOM()` over a whole table). `CONTENT_MAP` (from `@bible/core`)
 * gives the table/rowid/prose columns generically rather than this script
 * hardcoding them a second time, the same generalization F14's `apps/web`
 * work already applied to its own lite-copy builder.
 *
 * A no-op wherever there is nothing to check: no codec for this build
 * (`checkCompressionCodec` already reported that), an unrecognised module
 * type, or a module type with no `prose` columns at all (Bible: verse text
 * is never compressed by this format, so this is correctly a no-op for
 * every Bible module, compressed or not).
 */
async function checkDecodeRoundTrip(db, tableNames, moduleType, resolvedCodec, result) {
  const compression = await moduleCompression(db, tableNames);
  if (compression === 'none') return; // checkContentSanity's business instead
  if (!resolvedCodec.codec) return; // no codec: checkCompressionCodec already reported it

  const normalizedType = normalizeModuleType(moduleType);
  const shapes = CONTENT_MAP[normalizedType];
  if (!shapes) return; // unrecognised type: nothing to sample

  const minChars = (CONTENT_COLUMNS[moduleType] && CONTENT_COLUMNS[moduleType].minChars) || 8;

  for (const shape of shapes) {
    if (!tableNames.has(shape.table) || shape.prose.length === 0) continue;

    let tableColumns;
    try {
      tableColumns = new Set(
        (await dbAll(db, `SELECT name FROM pragma_table_info('${shape.table}')`)).map(c => c.name)
      );
    } catch {
      continue;
    }

    for (const column of shape.prose) {
      if (!tableColumns.has(column)) continue; // schema drift: not this check's business

      let rows;
      try {
        rows = await dbAll(db,
          `SELECT ${shape.rowid} AS rowid_, ${column} AS cell FROM ${shape.table} ` +
          `ORDER BY ${shape.rowid} LIMIT ?`,
          [DECODE_SAMPLE_SIZE]
        );
      } catch {
        continue;
      }
      if (rows.length === 0) continue;

      let total = 0, short = 0, nontext = 0;
      const failures = [];
      for (const row of rows) {
        if (row.cell === null || row.cell === undefined) continue;
        total++;

        let text;
        try {
          // A string cell is legitimate even in a compressed module - the
          // publisher keeps the compressed frame only when it is actually
          // smaller (see IContentCodec.ts's "Mixed cells" note) - so only a
          // non-string cell is actually decoded.
          text = typeof row.cell === 'string' ? row.cell : resolvedCodec.codec.decode(row.cell);
        } catch (e) {
          failures.push({ rowid: row.rowid_, message: e && e.message ? e.message : String(e) });
          continue;
        }

        if (text.trim().length < minChars) short++;
        if (text.includes('�')) nontext++;
      }

      if (failures.length > 0) {
        const shown = failures.slice(0, 5)
          .map(f => `#${f.rowid} (${f.message})`)
          .join('; ');
        const more = failures.length > 5 ? ` ... and ${failures.length - 5} more` : '';
        result.errors.push(err('decode_failed',
          `${failures.length}/${rows.length} sampled row(s) of \`${shape.table}.${column}\` failed ` +
          `to decode under compression '${compression}': ${shown}${more}.`));
      }

      const level = corruptionLevel(total, short, nontext);
      if (level === 'error') {
        result.errors.push(err('content_corrupt',
          `\`${shape.table}.${column}\` does not look like text after decoding ${total} sampled ` +
          `row(s) (compression '${compression}'): ${short}/${total} shorter than ${minChars} chars, ` +
          `${nontext}/${total} contain U+FFFD. This is the signature of a converter reading freed ` +
          `or mis-decoded memory - or of decoding under the wrong codec/dictionary.`));
      } else if (level === 'warning') {
        result.warnings.push(err('content_thin',
          `${short}/${total} sampled row(s) of \`${shape.table}.${column}\` are short and ` +
          `${nontext}/${total} are non-UTF8 after decoding. Below the failure thresholds.`));
      }
    }
  }
}

/**
 * section 2.7 (F3): `content_sha256` MUST recompute to the same digest via
 * `computeContentSha256` from @bible/core - the canonical, already-tested
 * implementation this project defines the digest algorithm through (see that
 * function's own doc comment for the exact byte layout). A publisher whose
 * stored hash does not match its own content has either hashed the wrong
 * bytes or shipped content that drifted after hashing; either way, every
 * consumer's integrity check on this module will fail downstream, so this is
 * caught here, at the source, first.
 */
async function checkContentSha256(db, tableNames, moduleType, sqlAdapter, resolvedCodec, result) {
  const info = await getInfoRow(db, tableNames);
  if (!info) return;

  let declared;
  try {
    declared = new Set(
      (await dbAll(db, `SELECT name FROM pragma_table_info('${info.infoTable}')`)).map(c => c.name)
    );
  } catch {
    return;
  }
  if (!declared.has('content_sha256')) return; // pre-F3 schema: not this check's business

  const stored = info.row.content_sha256;
  if (stored === null || stored === undefined || stored === '') return; // data gap, not this check's business

  const normalizedType = normalizeModuleType(moduleType);
  if (!(normalizedType in CONTENT_MAP)) return; // unrecognised type: nothing to digest against

  let computed;
  try {
    computed = computeContentSha256(sqlAdapter, normalizedType, resolvedCodec);
  } catch (e) {
    result.errors.push(err('content_sha256_error',
      `Could not recompute \`content_sha256\`: ${e && e.message ? e.message : e}.`));
    return;
  }

  if (computed !== String(stored)) {
    result.errors.push(err('content_sha256_mismatch',
      `\`module_info.content_sha256\` = ${JSON.stringify(stored)} but recomputing over the ` +
      `module's decoded content gives ${JSON.stringify(computed)}.`));
  }
}

function checkContentTable(tableNames, moduleType, result) {
  const expected = CONTENT_TABLES[moduleType];
  if (!expected) {
    result.errors.push(err('unknown_module_type', `Cannot determine module type — no recognised content table found.`));
    return;
  }
  if (!expected.some(t => tableNames.has(t))) {
    result.errors.push(err(
      'missing_content_table',
      `Missing content table (expected one of: ${expected.join(', ')}).`
    ));
  }
}

/**
 * Canon + versification check for bible modules.
 *
 * Aggregates the module's verse ids per (book, chapter) and compares against the
 * canonical space. Because the canon is contiguous - every book has chapters
 * 1..N and every chapter has verses 1..M - bounding each chapter's min/max verse
 * inside [1, M] is exactly equivalent to asserting every individual
 * (book, chapter, verse) triple exists in `bible_verse_ref`, at ~1200 rows read
 * instead of ~31000.
 */
async function checkBibleCanon(db, canon, result) {
  const rows = await dbAll(db, `
    SELECT verse_id / 1000000                     AS book_number,
           (verse_id % 1000000) / 1000            AS chapter,
           MIN(verse_id % 1000)                   AS min_verse,
           MAX(verse_id % 1000)                   AS max_verse,
           COUNT(*)                               AS verse_rows
    FROM bible_verse
    GROUP BY book_number, chapter
    ORDER BY book_number, chapter
  `);

  if (rows.length === 0) {
    result.errors.push(err('empty_bible', '`bible_verse` contains no rows.'));
    return;
  }

  const perBook = new Map(); // book_number -> { chapters:[], maxChapter, verses }
  for (const row of rows) {
    if (!perBook.has(row.book_number)) {
      perBook.set(row.book_number, { chapters: [], maxChapter: 0, verses: 0 });
    }
    const entry = perBook.get(row.book_number);
    entry.chapters.push(row);
    entry.maxChapter = Math.max(entry.maxChapter, row.chapter);
    entry.verses += row.verse_rows;
  }

  const bookNumbers = [...perBook.keys()].sort((a, b) => a - b);
  result.stats = {
    books: bookNumbers.length,
    chapters: rows.length,
    verses: rows.reduce((s, r) => s + r.verse_rows, 0),
    first_book: bookNumbers[0],
    last_book: bookNumbers[bookNumbers.length - 1],
  };

  for (const bookNumber of bookNumbers) {
    const entry = perBook.get(bookNumber);
    const canonChapters = canon.chapters.get(bookNumber);

    if (bookNumber < 1 || bookNumber > MAX_BOOK_NUMBER || !canonChapters) {
      result.errors.push(err('book_out_of_canon',
        `Book ${bookNumber} is outside the 66-book Protestant canon ` +
        `(${entry.chapters.length} chapters, ${entry.verses} verses present).`,
        { book_number: bookNumber, actual_chapters: entry.chapters.length }
      ));
      continue;
    }

    const expectedChapters = canonChapters.length;
    if (entry.maxChapter > expectedChapters) {
      result.errors.push(err('chapter_count_exceeds_canon',
        `${canon.bookNames.get(bookNumber) || `Book ${bookNumber}`} (book ${bookNumber}): ` +
        `${entry.chapters.length} chapters present, highest chapter ${entry.maxChapter}, ` +
        `canonical chapter count ${expectedChapters}.`,
        {
          book_number: bookNumber,
          book_name: canon.bookNames.get(bookNumber) || null,
          expected_chapters: expectedChapters,
          actual_chapters: entry.chapters.length,
          highest_chapter: entry.maxChapter,
        }
      ));
    }

    for (const row of entry.chapters) {
      if (row.chapter < 1) {
        result.errors.push(err('invalid_chapter',
          `Book ${bookNumber} contains chapter ${row.chapter} (chapters start at 1).`,
          { book_number: bookNumber, chapter: row.chapter }
        ));
        continue;
      }
      if (row.chapter > expectedChapters) continue; // already reported at book level

      const expectedVerses = canonChapters[row.chapter - 1];
      if (row.min_verse < 1) {
        result.errors.push(err('invalid_verse',
          `Book ${bookNumber} chapter ${row.chapter} contains verse ${row.min_verse} (verses start at 1).`,
          { book_number: bookNumber, chapter: row.chapter, verse: row.min_verse }
        ));
      }
      if (row.max_verse > expectedVerses) {
        result.errors.push(err('verse_out_of_canon',
          `${canon.bookNames.get(bookNumber) || `Book ${bookNumber}`} ${row.chapter}: ` +
          `highest verse ${row.max_verse}, canonical verse count ${expectedVerses}.`,
          {
            book_number: bookNumber,
            chapter: row.chapter,
            expected_verses: expectedVerses,
            highest_verse: row.max_verse,
          }
        ));
      }
    }
  }
}

/**
 * section 8: every module MUST carry `verse_link` and `schema_version`, and
 * `schema_version` MUST have at least one row.
 */
async function checkRequiredTables(db, tableNames, result) {
  for (const t of REQUIRED_TABLES) {
    if (!tableNames.has(t)) {
      result.errors.push(err('missing_required_table',
        `Required table \`${t}\` is missing (ModuleFormat §8; every module MUST carry it).`));
    }
  }
  if (tableNames.has('schema_version')) {
    let row;
    try { row = await dbGet(db, 'SELECT COUNT(*) AS cnt FROM schema_version'); }
    catch { row = null; }
    if (!row || !row.cnt) {
      result.errors.push(err('empty_schema_version',
        '`schema_version` exists but has no rows; at least one row is required (§8.3).'));
    }
  }
}

/**
 * section 8.2 / section 12: `verse_link` MUST carry all three indexes, and its
 * `verse_id_end` MUST be non-NULL on every row - a single verse is spelled
 * `verse_id_end = verse_id_start`, never NULL. This is what makes the
 * containment probe `verse_id_start <= :v AND verse_id_end >= :v` correct
 * without a `COALESCE`/`OR IS NULL` branch, and what makes
 * `idx_verse_link_covering` a valid covering index in the first place.
 *
 * `idx_verse_link_start (verse_id_start)` is deliberately NOT in this list.
 * `packages/core/sql/schemas/shared/verse_link.sql` dropped it (its own
 * comment explains why): it is a strict prefix of `idx_verse_link_range
 * (verse_id_start, verse_id_end)`, which stays, so it added nothing SQLite
 * could not already serve from that composite index. Requiring it here would
 * fail every module built from the current schema.
 */
const REQUIRED_VERSE_LINK_INDEXES = [
  'idx_verse_link_source',
  'idx_verse_link_range',
  'idx_verse_link_covering',
];

async function checkVerseLinkShape(db, tableNames, result) {
  if (!tableNames.has('verse_link')) return; // reported separately by checkRequiredTables

  let indexRows;
  try {
    indexRows = await dbAll(db,
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'verse_link'");
  } catch { indexRows = []; }
  const indexNames = new Set(indexRows.map(r => r.name));
  const missingIndexes = REQUIRED_VERSE_LINK_INDEXES.filter(i => !indexNames.has(i));
  if (missingIndexes.length) {
    result.errors.push(err('missing_verse_link_index',
      `\`verse_link\` is missing required index(es): ${missingIndexes.join(', ')} (§8.2 — all three are part of the contract).`));
  }

  let nullEnd;
  try {
    nullEnd = await dbGet(db, 'SELECT COUNT(*) AS cnt FROM verse_link WHERE verse_id_end IS NULL');
  } catch { nullEnd = null; }
  if (nullEnd && nullEnd.cnt > 0) {
    result.errors.push(err('null_verse_link_end',
      `\`verse_link\` has ${nullEnd.cnt} row(s) with \`verse_id_end\` NULL; a single verse ` +
      `MUST be spelled \`verse_id_end = verse_id_start\`, never NULL (§5, §8.2).`));
  }
}

/**
 * section 5: the reversed range spellings `start_verse_id` / `end_verse_id` are
 * non-conforming and MUST NOT appear as a column in ANY table.
 */
async function checkForbiddenSpellings(db, tableNames, result) {
  for (const table of tableNames) {
    if (table.startsWith('sqlite_')) continue;
    let cols;
    try { cols = await dbAll(db, `SELECT name FROM pragma_table_info('${table}')`); }
    catch { continue; }
    const names = new Set(cols.map(c => c.name));
    for (const bad of FORBIDDEN_RANGE_COLUMNS) {
      if (names.has(bad)) {
        result.errors.push(err('forbidden_range_column',
          `Table \`${table}\` declares \`${bad}\`; the format spells ranges ` +
          `\`verse_id_start\` / \`verse_id_end\` (§5). The reversed spelling is non-conforming.`));
      }
    }
  }
}

/**
 * section 5: tables whose verse anchor is itself optional (a `'book'`/`'chapter'`-
 * level commentary entry, a non-scripture user note, a non-verse pinned item)
 * may leave BOTH range columns NULL together. Every other table that carries
 * `verse_id_start`/`verse_id_end` - `verse_link`, `cross_reference_group` - has
 * a mandatory range: both columns MUST be populated on every row.
 */
const ANCHOR_OPTIONAL_TABLES = new Set(['commentary_entry', 'user_note', 'pinned_item']);

/**
 * section 5: no range may have `verse_id_end < verse_id_start`, and in tables whose
 * range is mandatory (not in ANCHOR_OPTIONAL_TABLES - e.g. `verse_link`,
 * `cross_reference_group`), `verse_id_end` MUST NOT be NULL: a single verse is
 * `verse_id_end = verse_id_start`, never NULL. Anchor-optional tables may leave
 * both columns NULL together, but never one without the other.
 */
async function checkRangeSanity(db, tableNames, result) {
  for (const table of tableNames) {
    if (table.startsWith('sqlite_') || table.endsWith('_fts')) continue;
    let cols;
    try { cols = await dbAll(db, `SELECT name FROM pragma_table_info('${table}')`); }
    catch { continue; }
    const names = new Set(cols.map(c => c.name));
    if (!names.has('verse_id_start') || !names.has('verse_id_end')) continue;

    if (ANCHOR_OPTIONAL_TABLES.has(table)) {
      let half;
      try {
        half = await dbGet(db, `
          SELECT COUNT(*) AS cnt FROM ${table}
           WHERE (verse_id_start IS NULL) <> (verse_id_end IS NULL)
        `);
      } catch { half = null; }
      if (half && half.cnt > 0) {
        result.errors.push(err('half_populated_anchor',
          `\`${table}\` has ${half.cnt} row(s) with only one of verse_id_start/verse_id_end ` +
          `set; an anchor-optional table's range MUST be either both NULL or both populated (§5).`));
      }
    } else {
      let nullEnd;
      try {
        nullEnd = await dbGet(db, `
          SELECT COUNT(*) AS cnt FROM ${table}
           WHERE verse_id_start IS NOT NULL AND verse_id_end IS NULL
        `);
      } catch { nullEnd = null; }
      if (nullEnd && nullEnd.cnt > 0) {
        result.errors.push(err('null_mandatory_range_end',
          `\`${table}\` has ${nullEnd.cnt} row(s) with \`verse_id_end\` NULL; this table's range ` +
          `is mandatory — a single verse MUST be \`verse_id_end = verse_id_start\`, never NULL (§5).`));
      }
    }

    let row;
    try {
      row = await dbGet(db, `
        SELECT COUNT(*) AS cnt FROM ${table}
         WHERE verse_id_start IS NOT NULL AND verse_id_end IS NOT NULL
           AND verse_id_end < verse_id_start
      `);
    } catch { continue; }
    if (row && row.cnt > 0) {
      result.errors.push(err('inverted_range',
        `\`${table}\` has ${row.cnt} row(s) with verse_id_end < verse_id_start (§5).`));
    }
  }
}

/**
 * Cheap Bible-text conformance (section 6, section 7.1): `text` carries no HTML tags, pilcrow,
 * or backslash, and `word_count` matches the whitespace token count of `text`.
 */
async function checkBibleText(db, tableNames, result) {
  if (!tableNames.has('bible_verse')) return;

  let hygiene;
  try {
    hygiene = await dbGet(db, `
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN text LIKE '%<%>%' THEN 1 ELSE 0 END)                 AS html,
             SUM(CASE WHEN text LIKE '%' || char(182) || '%' THEN 1 ELSE 0 END) AS pilcrow,
             SUM(CASE WHEN text LIKE '%' || char(92)  || '%' THEN 1 ELSE 0 END) AS backslash
        FROM bible_verse
    `);
  } catch { return; }
  if (!hygiene || !hygiene.total) return;

  if (hygiene.html > 0) result.errors.push(err('bible_text_html',
    `\`bible_verse.text\` has ${hygiene.html} row(s) containing HTML/XML tags; ` +
    `text MUST be clean UTF-8 with structure in \`formatting\` instead (§7.1).`));
  if (hygiene.pilcrow > 0) result.errors.push(err('bible_text_pilcrow',
    `\`bible_verse.text\` has ${hygiene.pilcrow} row(s) containing a pilcrow (U+00B6); ` +
    `paragraph structure belongs in \`formatting.block\` (§7.1).`));
  if (hygiene.backslash > 0) result.errors.push(err('bible_text_backslash',
    `\`bible_verse.text\` has ${hygiene.backslash} row(s) containing a backslash (U+005C), ` +
    `which \`text\` MUST NOT contain (§7.1).`));

  // word_count == whitespace token count. Conforming `text` is single-spaced with
  // no leading/trailing whitespace, so tokens = (space count) + 1. Only rows with a
  // populated word_count are checked (word_count is nullable).
  let wc;
  try {
    wc = await dbGet(db, `
      SELECT COUNT(*) AS mismatched FROM bible_verse
       WHERE word_count IS NOT NULL
         AND length(trim(text)) > 0
         AND word_count <> length(trim(text)) - length(replace(trim(text), ' ', '')) + 1
    `);
  } catch { wc = null; }
  if (wc && wc.mismatched > 0) {
    result.errors.push(err('word_count_mismatch',
      `\`bible_verse.word_count\` disagrees with the whitespace token count of \`text\` ` +
      `in ${wc.mismatched} row(s) (§6). Conforming text is single-spaced with no leading/` +
      `trailing whitespace.`));
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Validate a single module database.
 *
 * @param {string} dbPath        Full path to the module .db file.
 * @param {object} [options]
 * @param {object} [options.canon]      Pre-loaded canon (see loadCanon) - avoids re-reading main.db.
 * @param {string} [options.mainDbPath] main.db to source the canon from when `canon` is not supplied.
 * @returns {Promise<object>} result - `ok` is false when `errors` is non-empty.
 */
async function validateModule(dbPath, options = {}) {
  const result = {
    file: path.basename(dbPath),
    path: dbPath,
    moduleType: null,
    ok: false,
    errors: [],
    warnings: [],
    info: null,
    stats: null,
  };

  if (!fs.existsSync(dbPath)) {
    result.errors.push(err('file_not_found', `File does not exist: ${dbPath}`));
    return result;
  }

  let db = null;
  try {
    db = await openReadOnly(dbPath);
    const tableNames = await listTables(db);

    if (tableNames.size === 0) {
      result.errors.push(err('empty_database', 'Database contains no tables.'));
      return result;
    }

    result.moduleType = detectModuleType(tableNames);
    if (result.moduleType === 'unknown') {
      const guessed = typeFromFilename(dbPath);
      if (guessed) {
        result.moduleType = guessed;
        checkContentTable(tableNames, guessed, result);
      } else {
        result.errors.push(err('unknown_module_type',
          'Cannot determine module type — no recognised content table and no known filename prefix.'));
      }
    } else {
      checkContentTable(tableNames, result.moduleType, result);
    }

    await checkModuleInfo(db, tableNames, result);
    await checkFormatVersion(db, tableNames, result);
    await checkRequiredTables(db, tableNames, result);
    await checkVerseLinkShape(db, tableNames, result);
    await checkNoFts5Tables(db, tableNames, result);
    await checkForbiddenSpellings(db, tableNames, result);
    await checkRangeSanity(db, tableNames, result);
    await checkContentSanity(db, tableNames, result.moduleType, result);
    await checkBibleText(db, tableNames, result);

    // Codec / dictionary / digest checks all share one resolved codec, the
    // same way BaseModuleRepository resolves it once per open connection
    // rather than once per check.
    await checkCompressionCodec(db, tableNames, CODEC_REGISTRY, result);
    await checkCompressionDictionary(db, tableNames, result);
    const sqlAdapter = new ReadOnlyModuleSql(db, dbPath);
    const resolvedCodec = resolveModuleCodec(sqlAdapter, CODEC_REGISTRY);
    await checkDecodeRoundTrip(db, tableNames, result.moduleType, resolvedCodec, result);
    await checkContentSha256(db, tableNames, result.moduleType, sqlAdapter, resolvedCodec, result);

    if (result.moduleType === 'bible' && tableNames.has('bible_verse')) {
      const canon = options.canon || await loadCanon(options.mainDbPath);
      await checkBibleCanon(db, canon, result);
    }
  } catch (e) {
    // Resilience: any driver/SQL failure becomes a clean reported error.
    result.errors.push(err('validation_error', e && e.message ? e.message : String(e)));
  } finally {
    await dbClose(db);
  }

  result.ok = result.errors.length === 0;
  return result;
}

/** Render a single result as a human-readable report. */
function formatResult(result, { verbose = true, maxDetails = 12 } = {}) {
  const lines = [];
  const status = result.ok
    ? `${colors.green}PASS${colors.reset}`
    : `${colors.red}FAIL${colors.reset}`;
  const type = result.moduleType || 'unknown';
  lines.push(`${status}  ${colors.bright}${result.file}${colors.reset} ${colors.dim}[${type}]${colors.reset}`);

  if (verbose && result.stats) {
    lines.push(`      ${colors.dim}${result.stats.books} books, ${result.stats.chapters} chapters, ${result.stats.verses} verses${colors.reset}`);
  }

  const shown = result.errors.slice(0, maxDetails);
  for (const e of shown) {
    lines.push(`      ${colors.red}✗${colors.reset} [${e.code}] ${e.message}`);
  }
  if (result.errors.length > shown.length) {
    lines.push(`      ${colors.red}✗${colors.reset} ... and ${result.errors.length - shown.length} more error(s)`);
  }
  if (verbose) {
    for (const w of result.warnings.slice(0, maxDetails)) {
      lines.push(`      ${colors.yellow}⚠${colors.reset} [${w.code}] ${w.message}`);
    }
  }
  return lines.join('\n');
}

/** Short one-line failure summary, for embedding in other scripts' output. */
function summarizeErrors(result, limit = 3) {
  if (result.ok) return '';
  const parts = result.errors.slice(0, limit).map(e => e.message);
  if (result.errors.length > limit) parts.push(`(+${result.errors.length - limit} more)`);
  return parts.join(' ');
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(argv) {
  const opts = {
    all: false, json: false, quiet: false, help: false,
    type: null, modulesDir: DEFAULT_MODULES_DIR, mainDb: DEFAULT_MAIN_DB,
    targets: [],
  };
  for (const arg of argv) {
    if (arg === '--all') opts.all = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--quiet') opts.quiet = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg.startsWith('--type=')) opts.type = arg.slice(7);
    else if (arg.startsWith('--modules-dir=')) opts.modulesDir = arg.slice(14);
    else if (arg.startsWith('--main-db=')) opts.mainDb = arg.slice(10);
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else opts.targets.push(arg);
  }
  return opts;
}

function printHelp() {
  console.log(`
validate-module.js — conformance checker for Bible app module databases

Usage:
  node scripts/validate-module.js <module> [options]
  node scripts/validate-module.js --all [options]

Options:
  --all                Validate every .db in the modules directory
  --type=<type>        With --all: bible | commentary | dictionary | lexicon | book | devotional | topical | xref | tag_graph
  --json               Machine-readable JSON output
  --quiet              Print failures only
  --modules-dir=PATH   Override modules directory (default: apps/desktop/data/modules)
  --main-db=PATH       Override main.db used as the canon source

Exit codes: 0 = all passed, 1 = one or more failed, 2 = usage/setup error
`.trim());
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    printHelp();
    process.exit(2);
  }

  if (opts.help || (!opts.all && opts.targets.length === 0)) {
    printHelp();
    process.exit(opts.help ? 0 : 2);
  }

  let paths = [];
  try {
    if (opts.all) {
      if (!fs.existsSync(opts.modulesDir)) {
        console.error(`Modules directory not found: ${opts.modulesDir}`);
        process.exit(2);
      }
      paths = fs.readdirSync(opts.modulesDir)
        .filter(f => f.endsWith('.db'))
        .filter(f => !opts.type || typeFromFilename(f) === opts.type)
        .sort()
        .map(f => path.join(opts.modulesDir, f));
    } else {
      paths = opts.targets.map(t => resolveModule(t, opts.modulesDir));
    }
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }

  if (paths.length === 0) {
    console.error('No modules matched.');
    process.exit(2);
  }

  let canon;
  try {
    canon = await loadCanon(opts.mainDb);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }

  const results = [];
  for (const p of paths) {
    results.push(await validateModule(p, { canon }));
  }

  const failed = results.filter(r => !r.ok);

  if (opts.json) {
    console.log(JSON.stringify({
      canon_source: canon.source,
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      results,
    }, null, 2));
  } else {
    console.log(`${colors.cyan}Canon source:${colors.reset} ${canon.source}`);
    console.log(`${colors.cyan}Validating ${results.length} module(s)${colors.reset}\n`);
    for (const r of results) {
      if (opts.quiet && r.ok) continue;
      console.log(formatResult(r, { verbose: !opts.quiet }));
    }
    console.log('');
    if (failed.length === 0) {
      console.log(`${colors.green}All ${results.length} module(s) passed.${colors.reset}`);
    } else {
      console.log(`${colors.red}${failed.length} of ${results.length} module(s) FAILED:${colors.reset} ${failed.map(r => r.file).join(', ')}`);
    }
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

module.exports = {
  validateModule,
  loadCanon,
  resolveModule,
  formatResult,
  summarizeErrors,
  detectModuleType,
  typeFromFilename,
  VERSIFICATION_PATH,
};

if (require.main === module) {
  main().catch(e => {
    console.error('Fatal error:', e && e.stack ? e.stack : e);
    process.exit(2);
  });
}
