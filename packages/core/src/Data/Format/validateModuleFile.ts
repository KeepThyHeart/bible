/**
 * The one conformance rule table for a module file, shared by every reader
 * that needs to answer "can I trust / read this file at all" (task 0027,
 * "Module Format v2", revision 2, subtask F5).
 *
 * ## Why this file exists
 *
 * Before F5, two hand-maintained checkers existed - the untrusted-install gate
 * in `apps/desktop/electron/services/InstallationService.ts` and the
 * boot-time filesystem scan in `apps/desktop/electron/utils/moduleDetector.ts`
 * - and they had already drifted apart: only one of them knew about
 * `format_version` at all, and neither agreed with the publisher's own
 * `scripts/validate-module.js`. The design doc's §2.8 table is the single
 * source of truth for which checks exist and at what severity; this file is
 * that table turned into one function, so a new call site adds a row here
 * once instead of copying an `if` from whichever of the other two it found
 * first.
 *
 * The design doc's §2.8 table (the columns this pass owns - the publisher
 * script and the "Open" capability-surface column are separate work, not
 * reimplemented here):
 *
 * | Check                                    | Install                | Boot scan            |
 * |-------------------------------------------|-------------------------|------------------------|
 * | SQLite header, 16 bytes                    | error                    | error (new)            |
 * | `module_uuid` is a UUID                    | error                    | error (unchanged)      |
 * | `format_version` readable or legacy        | error (new)              | skip + report (new)    |
 * | `compression` in the codec registry        | warn (new)               | -                      |
 *
 * `validateModuleFile()` runs every row that applies to the `ISql` connection
 * and `ICodecRegistry` it is given, and returns every issue found - it does
 * not itself decide "error means fail the install" vs. "error means skip and
 * keep scanning". That decision is a call site's, not this function's: the
 * install path wants a hard `{ ok: false }`, the boot scan wants to skip one
 * file and keep going, and both get there by reading `issues` (or `ok`) and
 * choosing what to do, not by this function throwing or logging anything.
 *
 * ## Never throws for a database that is merely unusual
 *
 * Same posture as {@link resolveModuleCodec}, which this file mirrors deliberately: a
 * repository - and now this validator - is routinely constructed over
 * databases that have no `module_info` at all (in-memory test fixtures,
 * partial files, a stray non-module `.db` dropped into the modules folder by
 * hand), and validation must not be the thing that crashes a best-effort scan
 * over such a file. `module_info` and its columns are probed with `PRAGMA
 * table_info`, which answers "not present" as an empty result rather than
 * raising.
 *
 * ## The header check is separate from, and driver-agnostic of, the rest
 *
 * `validateModuleFile()` takes an already-open `ISql` connection - which
 * means, for a corrupt or truncated file, something has *already* successfully
 * opened it before this function ever runs a query. That is too late for the
 * one check that exists precisely to catch a truncated download or a
 * non-SQLite file *before* any SQLite driver touches it (a hostile or garbled
 * file is a much larger attack surface for a native SQLite binding than for a
 * 16-byte memory compare). So the byte-level check is split out as
 * {@link hasSqliteHeader}, a pure function over raw bytes with no SQL and no
 * driver dependency at all: a caller reads the first 16 bytes with whatever
 * primitive its runtime has (`fs.openSync`/`readSync` in Electron's main
 * process, a `Uint8Array` handed to it directly in a test) *before* opening a
 * connection, and only opens one once `hasSqliteHeader` passes. Both
 * `apps/desktop` call sites gate this way - see their comments at the call
 * site for why neither routes the header check through this function's
 * `opts.header` instead.
 *
 * `opts.header` still exists on this function (rather than being dropped
 * entirely) so that a caller who already has both the raw bytes AND an open
 * `ISql` in hand can get the header row folded into the same result as
 * everything else, and so the header rule has exactly one place it is
 * exercised in tests - this file's - even though real callers gate on it
 * earlier, before a connection exists to pass in at all.
 *
 * ## Why the codec check is a warning, never an error
 *
 * A module whose `compression` names a codec this build does not have is
 * still a perfectly readable module for everything *except* its prose: the
 * design's `resolveModuleCodec()` explicitly returns `{ codec: null,
 * supported: false }` rather than throwing, and a repository still opens and
 * `module_info` still reads. Refusing an install over a codec gap would throw
 * away a module a future build (or a build with the optional native zstd
 * binding available) could read perfectly well; the honest answer is to
 * install it and let the module register with reduced capability, which is a
 * greyed-out "content unavailable" state elsewhere in the app (M7/F8/M9,
 * not this subtask), not an install failure.
 */

import { ISql, SqlRow } from '../Core/ISql';
import { ICodecRegistry } from '../Access/Codec/IContentCodec';
import { CompressionCodec, FormatVersionKind, parseFormatVersion } from './ModuleFormat';

/** RFC 4122 UUID (any version/variant) - `module_info.module_uuid` must match this. */
export const MODULE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The literal SQLite database header magic, byte for byte: `"SQLite format
 * 3\0"`, 16 bytes, hex `53 51 4c 69 74 65 20 66 6f 72 6d 61 74 20 33 00`. Every
 * valid SQLite file begins with exactly this. See this file's top comment for
 * why the comparison lives here, in one place, rather than in each caller.
 */
const SQLITE_HEADER_MAGIC: readonly number[] = [
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
];

/**
 * True when `bytes` begins with the literal 16-byte SQLite header magic.
 *
 * A real byte comparison, not "did opening the file throw" - see this file's
 * top comment. Never throws: fewer than 16 bytes (a zero-length or truncated
 * file) is simply `false`, the same answer as 16-or-more bytes that do not
 * match. Extra bytes past the first 16 are ignored, so it is safe to pass a
 * larger buffer than exactly 16 bytes.
 */
export function hasSqliteHeader(bytes: Uint8Array): boolean {
  if (bytes.length < SQLITE_HEADER_MAGIC.length) {
    return false;
  }
  for (let i = 0; i < SQLITE_HEADER_MAGIC.length; i++) {
    if (bytes[i] !== SQLITE_HEADER_MAGIC[i]) {
      return false;
    }
  }
  return true;
}

/** One rule-table row's verdict. `code` is machine-readable and stable; `message` names the specific rule for logs/UI. */
export interface ModuleValidationIssue {
  code:
    | 'invalid-header'
    | 'missing-module-info'
    | 'invalid-uuid'
    | 'unsupported-format-version'
    | 'missing-codec';
  severity: 'error' | 'warning';
  message: string;
}

/** What {@link validateModuleFile} found. */
export interface ModuleValidationResult {
  /** True iff `issues` contains no `'error'`-severity entry. A `'warning'` alone still leaves this `true`. */
  ok: boolean;
  issues: ModuleValidationIssue[];
  /**
   * The classification of `module_info.format_version`, when a value was
   * present to classify at all (absent after an `'invalid-header'` or
   * `'missing-module-info'` short-circuit, or when the row itself carries no
   * `format_version`). See {@link FormatVersionKind}.
   */
  formatVersionKind?: FormatVersionKind;
}

/** Options for {@link validateModuleFile}. */
export interface ModuleValidationOptions {
  /**
   * The first 16 (or more) bytes of the module file, if the caller wants the
   * SQLite-header row checked as part of this call. Omit it to skip that row
   * entirely - which is what both `apps/desktop` call sites do, because they
   * gate on {@link hasSqliteHeader} themselves *before* opening a connection
   * to pass in here at all (see this file's top comment). Passing bytes that
   * fail the check short-circuits the rest of the table: nothing SQL-shaped
   * is attempted against a connection that was opened over a file that isn't
   * actually a SQLite database.
   */
  header?: Uint8Array;
}

/** Columns actually present in `table` on `sql`; empty (not a throw) when the table does not exist. Mirrors `resolveModuleCodec`'s `columnsOf`. */
function columnsOf(sql: ISql, table: string): Set<string> {
  return new Set(
    sql.queryAll<{ name: string }>(`PRAGMA table_info(${table})`).map(row => row.name)
  );
}

/**
 * Run the module-file conformance rule table (design doc §2.8) against one
 * open module connection, and report every issue found rather than stopping
 * at the first one - a caller wanting install-time behaviour reads `ok`
 * (or filters `issues` for `severity === 'error'`); a caller wanting
 * skip-and-report behaviour reads `issues` for the specific codes it cares
 * about (see the two `apps/desktop` call sites for both styles).
 *
 * Checks run, per the table (see this file's top comment for the full table
 * and why each severity is what it is):
 *   1. `opts.header`, if given: the SQLite file header. A failure here
 *      short-circuits everything else - see {@link ModuleValidationOptions.header}.
 *   2. `module_info` exists and has a row at `info_id = 1`. A failure here
 *      also short-circuits: nothing else in the table is checkable without it.
 *   3. `module_uuid` is present and RFC 4122-shaped.
 *   4. `format_version` is readable by this build - `current`, `readable` or
 *      `legacy` per {@link parseFormatVersion}; anything else is `'unsupported-format-version'`.
 *   5. `compression`, when the column exists at all (absent entirely on any
 *      module published before the compression column was added - that is
 *      not this check's business, `'none'` is), names a codec `registry` has.
 */
export function validateModuleFile(
  sql: ISql,
  registry: ICodecRegistry,
  opts: ModuleValidationOptions = {}
): ModuleValidationResult {
  const issues: ModuleValidationIssue[] = [];

  if (opts.header !== undefined && !hasSqliteHeader(opts.header)) {
    issues.push({
      code: 'invalid-header',
      severity: 'error',
      message:
        'File does not begin with the SQLite header magic ("SQLite format 3\\0"); ' +
        'it is not a valid module database (truncated download, or not a SQLite file at all).',
    });
    return { ok: false, issues };
  }

  const infoColumns = columnsOf(sql, 'module_info');
  if (!infoColumns.has('info_id')) {
    issues.push({
      code: 'missing-module-info',
      severity: 'error',
      message: '`module_info` table is missing.',
    });
    return { ok: false, issues };
  }

  const info = sql.queryOne<SqlRow>('SELECT * FROM module_info WHERE info_id = 1');
  if (!info) {
    issues.push({
      code: 'missing-module-info',
      severity: 'error',
      message: '`module_info` has no row with info_id = 1.',
    });
    return { ok: false, issues };
  }

  // module_uuid: present and RFC 4122-shaped.
  const uuid = info.module_uuid;
  if (!uuid || !MODULE_UUID_RE.test(String(uuid))) {
    issues.push({
      code: 'invalid-uuid',
      severity: 'error',
      message: '`module_info.module_uuid` is missing or not a valid UUID.',
    });
  }

  // format_version: allow-list only, via parseFormatVersion - never a range
  // comparison, and never re-implemented locally by a caller. See
  // ModuleFormat.ts's top comment for why that matters.
  let formatVersionKind: FormatVersionKind | undefined;
  const rawVersion = info.format_version;
  if (rawVersion === undefined || rawVersion === null || rawVersion === '') {
    issues.push({
      code: 'unsupported-format-version',
      severity: 'error',
      message: '`module_info.format_version` is missing.',
    });
  } else {
    const parsed = parseFormatVersion(String(rawVersion));
    formatVersionKind = parsed.kind;
    if (parsed.kind === 'unsupported') {
      issues.push({
        code: 'unsupported-format-version',
        severity: 'error',
        message: `\`format_version\` = ${JSON.stringify(rawVersion)} is not a version this build can read.`,
      });
    }
  }

  // compression: only meaningful when the column exists at all. A module
  // published before the column was added has no opinion to check, and that
  // is not the same thing as an unknown/unsupported value - see
  // resolveModuleCodec's readCompression() for the same distinction.
  if (infoColumns.has('compression')) {
    const raw = info.compression;
    const compression = (raw ? String(raw) : 'none') as CompressionCodec;
    if (!registry.has(compression)) {
      issues.push({
        code: 'missing-codec',
        severity: 'warning',
        message:
          `\`compression\` = ${JSON.stringify(compression)} has no codec registered in this build; ` +
          `this module will install, but its content will not be readable until one is.`,
      });
    }
  }

  const ok = issues.every(issue => issue.severity !== 'error');
  return { ok, issues, formatVersionKind };
}
