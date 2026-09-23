/**
 * SidecarFts5Provider
 *
 * The first genuinely build-capable {@link IKeywordIndexProvider} (task 0027,
 * "Module Format v2", revision 2, subtask F6, design doc §4). Where
 * `InModuleFts5Provider` (M3) wraps an FTS5 table that someone else already
 * built inside the module file, this one owns a real on-disk artifact - one
 * `.kwi` file per module revision, under a writable index directory - and
 * therefore owns a real state machine: unbuilt -> building -> ready, with
 * stale, failed, corrupt and interrupted all as first-class outcomes rather
 * than as "search quietly returns nothing".
 *
 * ## Why a sidecar at all
 *
 * F2 removed the shipped `*_fts` tables from every module schema: a module
 * file is an immutable, signed, shareable artifact, and an index is a derived,
 * machine-local, rebuildable cache with a different lifetime and a different
 * tokenizer-versioning story. Keeping the two apart means a module can be
 * re-downloaded without rebuilding the index, and an index can be discarded or
 * rebuilt without touching the module.
 *
 * ## The state machine (design doc §4.4), and where each state lives
 *
 * | Situation                     | How this provider detects it                           | Reported |
 * |-------------------------------|--------------------------------------------------------|----------|
 * | Module updated                | new `content_sha256` -> a different filename entirely    | `unbuilt` |
 * | Tokenizer / builder changed   | `kwi_meta` disagrees with this build's constants         | `stale`   |
 * | Build interrupted             | a `.kwi.part` exists, no `.kwi`; the `.part` is never opened | `unbuilt` |
 * | Index corrupt                 | `kwi_meta` unreadable (incl. `SQLITE_CORRUPT`) -> file deleted | `unbuilt` |
 * | Disk full / cannot write      | `build()` throws {@link SidecarIndexBuildError}          | `failed`  |
 * | Module uninstalled            | caller calls {@link SidecarFts5Provider.prune}           | `unbuilt` |
 * | Orphans after a crash         | caller calls {@link SidecarFts5Provider.pruneExcept}     | -         |
 *
 * Every one of those is decided from the filesystem and from each `.kwi`'s own
 * `kwi_meta` table - this provider's own source of truth - with exactly one
 * exception, `failed`, which has nowhere on disk to live (the build never
 * produced a file) and is therefore remembered in memory for the life of this
 * provider instance. The durable home for `failed` is `main.db`'s
 * `keyword_index` table, and writing it there is deliberately NOT this class's
 * job; see "What this provider does not do" below.
 *
 * ## What this provider does NOT do, on purpose
 *
 * - **It never reads or writes `main.db`'s `keyword_index` table.** That table
 *   is added to `sql/schemas/initial/MainDatabase.sql` by this same subtask,
 *   but `main.db` is a different database from any `.kwi`, owned by the
 *   install/library layer. Mirroring build results into it is the install
 *   flow's job (F8). A provider that wrote to `main.db` would have two sources
 *   of truth for one fact and no way to reconcile them after a crash between
 *   the two writes; instead `status()` re-derives everything from the files
 *   themselves, which cannot drift from what is actually on disk.
 * - **It never resolves `<userData>` (or any other platform directory).** It
 *   is handed an `indexDir` as configuration. That is exactly what M1's
 *   `RuntimeEnvironment.indexDir` already carries, and a composition root
 *   supplies it. Real path resolution stays in `apps/desktop`.
 * - **It never opens a module database.** It consumes an {@link IIndexSource}
 *   (M5's `getIndexSource()` on the content repositories); whoever owns the
 *   module connection hands one over.
 *
 * ## Why the SQLite driver is injected
 *
 * `packages/core` has no runtime SQLite dependency - `better-sqlite3` is a
 * devDependency, and every repository here takes an {@link ISql} the platform
 * supplies (see `Data/Core/ISql.ts`). This provider is the first thing in core
 * that must CREATE a database file rather than be handed an open one, so it
 * takes a {@link SidecarDatabaseOpener} instead of importing a driver. The
 * opener returns a {@link SidecarSql}: `ISql` plus `exec()`, which both
 * shipped platform providers (`apps/desktop/electron/providers/SqliteProvider`
 * and `apps/web/server/providers/SqliteProvider`) already implement, and which
 * is needed here because `ISql` alone cannot run multi-statement DDL, a
 * `PRAGMA`, or `VACUUM`.
 */

// Namespace imports, not named ones - same reason `Data/Schema/loadSchemaSql`
// documents: this module is reachable from the core index barrel, which the
// desktop renderer bundles, and Vite stubs Node builtins there with a module
// that has no named exports.
import * as fs from 'node:fs';
import * as path from 'node:path';

import { ISql } from '../../Core/ISql';
import { PassageRange } from '../../../Api/ApiTypes';
import { VerseId } from '../../Core/Types';
import { KeywordCapability, KeywordFeatures } from '../Capabilities';
import { IKeywordIndexProvider, RuntimeEnvironment } from '../IKeywordIndexProvider';
import { indexTargetKey } from '../KeywordIndexRegistry';
import {
  IndexDocument,
  IndexTarget,
  IIndexSource,
  IKeywordIndex,
  KeywordHit,
  KeywordQuery,
  KeywordSearchOptions,
  KeywordSearchResponse,
} from '../KeywordTypes';
import { compileKeywordQuery } from './Fts5QueryCompiler';
import {
  KWI_FORMAT,
  KWI_META_KEYS,
  SIDECAR_BUILDER_VERSION,
  SIDECAR_SCHEMA_SQL,
  SIDECAR_TOKENIZER,
} from './sidecarSchema';

// ---------------------------------------------------------------------------
// Configuration seam
// ---------------------------------------------------------------------------

/**
 * `ISql` plus `exec()`. See the file-level doc comment for why `exec` is
 * needed and why requiring it costs nothing: every real `ISql` implementation
 * in this repository already has it.
 */
export interface SidecarSql extends ISql {
  /** Run one or more statements with no bind parameters (DDL, `PRAGMA`, `VACUUM`). */
  exec(sql: string): void;
}

export interface SidecarOpenOptions {
  /** Open for reading only. A `.kwi` being searched is always opened read-only. */
  readonly: boolean;
  /** Create the file if absent. Only ever true for a `.kwi.part` being built. */
  create: boolean;
}

/**
 * Opens (and, with `create`, creates) a SQLite database file.
 *
 * `readonly: true, create: false` must fail rather than conjure an empty
 * database for a missing file - `status()` relies on that to tell "no index"
 * from "an index that will not open".
 */
export type SidecarDatabaseOpener = (filePath: string, options: SidecarOpenOptions) => SidecarSql;

export interface SidecarFts5Config {
  /**
   * The directory `.kwi` files live in. Supplied by a composition root - the
   * same value M1's `RuntimeEnvironment.indexDir` carries. This provider never
   * resolves it and never creates it: a missing directory is a configuration
   * error that `build()` reports rather than papers over.
   */
  indexDir: string;
  openDatabase: SidecarDatabaseOpener;
  /**
   * How old a stray `.kwi.part` must be before a scan treats it as an orphan
   * and deletes it. Defaults to one hour, per design doc §4.4's "plus any
   * `.part` older than an hour". The delay is the whole point: a `.part` that
   * was written seconds ago is far more likely to be another process's build
   * in progress than a crash leftover, and deleting it would break a build
   * that was going to succeed.
   */
  stalePartAgeMs?: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * A build that could not produce an index: unwritable or missing index
 * directory, a full disk, FTS5 missing from the SQLite build, a source row
 * that will not insert.
 *
 * Thrown rather than swallowed, AND recorded so the next `status()` for the
 * same target reports `{ state: 'failed', ... }` instead of `'unbuilt'` -
 * which is exactly the distinction task 0027's review added the `'failed'`
 * state for. Without it a build that failed for a permanent reason looks
 * identical to one that has simply not been attempted, and gets retried
 * forever.
 */
export class SidecarIndexBuildError extends Error {
  constructor(
    readonly target: IndexTarget,
    readonly reason: string,
    /** The driver-level error this wraps, when there was one. */
    readonly cause?: unknown
  ) {
    super(`sidecar-fts5: cannot build index for module ${target.moduleUuid}: ${reason}`);
    this.name = 'SidecarIndexBuildError';
  }
}

/**
 * A build stopped by its {@link AbortSignal}.
 *
 * Deliberately NOT a {@link SidecarIndexBuildError}: an interrupted build is
 * not a failure, it is a non-event. Design doc §4.4 puts it in the `unbuilt`
 * row, and this class's `build()` treats it that way - the `.part` is deleted,
 * nothing is recorded against the target, and the next attempt starts clean.
 * `name` is `'AbortError'` so callers that already sniff for the Web standard
 * abort name recognise it.
 */
export class SidecarIndexBuildAbortedError extends Error {
  constructor(readonly target: IndexTarget) {
    super(`sidecar-fts5: build aborted for module ${target.moduleUuid}`);
    this.name = 'AbortError';
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SIDECAR_FTS5_PROVIDER_ID = 'sidecar-fts5';

/** Design doc §4.3: documents per write transaction, and the progress/abort granularity. */
export const SIDECAR_BUILD_BATCH_SIZE = 2000;

/** Design doc §4.4's "`.part` older than an hour". */
const DEFAULT_STALE_PART_AGE_MS = 60 * 60 * 1000;

const KWI_EXTENSION = '.kwi';
const PART_EXTENSION = '.kwi.part';

/** How much of `content_sha256` goes in the filename. */
const CONTENT_SHA_PREFIX_LENGTH = 12;

/**
 * What may appear in a filename component this provider builds.
 *
 * This is a real defence, not decoration. `BaseModuleRepository.buildIndexTarget`
 * (M5) falls back to `ISql.getDatabasePath()` for `moduleUuid` when a module
 * has no `module_info` row - a value full of path separators. Interpolating
 * one into `<indexDir>/<moduleUuid>.<sha>.kwi` would write outside `indexDir`,
 * so such a target is simply not supported by this provider and says so,
 * rather than being silently rewritten into some other file's name.
 */
const FILENAME_SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/**
 * What this provider claims it can do. Every value is what it actually does,
 * not what FTS5 could be made to do.
 *
 * - `phrase` / `prefix` / `booleanOps`: `Fts5QueryCompiler` (M2) compiles all
 *   three, and the compiled MATCH string runs against `kw` unchanged.
 * - `near`: **false**, and this is the one that deserves an argument. FTS5
 *   `NEAR()` runs perfectly well against `kw` - a bare `NEAR(a b, 5)` query
 *   compiled by M2 will execute and return rows. What it MEANS, though, is
 *   "within N tokens of one another inside a single indexed document", and a
 *   document here is one row of whatever content table `IIndexSource` drew
 *   from: a verse for a Bible, a whole entry for a commentary, a whole
 *   definition for a dictionary. Unlike `InModuleFts5Provider` - which is
 *   Bible-only and can therefore honestly say "within N tokens of one verse" -
 *   this provider is module-type-generic, so one boolean would be describing
 *   four different granularities at once. `false` is the honest answer: the
 *   query still works if a caller sends one, but the capability is not
 *   advertised, so nothing builds a feature on a promise whose meaning changes
 *   per module type. (It is also not what the app's `~Nw` word-proximity
 *   feature needs, which is proximity ACROSS row boundaries - see
 *   `BibleSearchService.searchProximity`.)
 * - `rank`: false, and `KeywordHit.rank` is a `0` placeholder, matching M3.
 *   A contentless FTS5 table does expose `bm25()`/`rank` (this provider
 *   deliberately does not set `columnsize=0`, which would be what breaks it),
 *   but `KeywordHit.rank` is documented as comparable only within one
 *   `providerId`, and nothing downstream orders by it yet. Results come back
 *   ordered by document rowid, which is stable, repeatable, and - because
 *   `doc_id` is the source rowid - canonical order for verse-addressed
 *   content. Claiming `rank: true` while ordering by rowid would be the
 *   inconsistency worth avoiding; turning real ranking on is a later, separate
 *   decision with a UI consequence.
 * - `snippetFromIndex`: false. `kw` is contentless, so `snippet()` and
 *   `highlight()` return NULL (NOT an error - see `sidecarSchema.ts` on why
 *   `columnsize=0` is left unset). Highlighting from a transient in-memory
 *   FTS5 table is design doc §4.5, i.e. F7, not this subtask.
 */
export const SIDECAR_FTS5_FEATURES: KeywordFeatures = {
  phrase: true,
  prefix: true,
  near: false,
  booleanOps: true,
  rank: false,
  snippetFromIndex: false,
};

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

interface OpenEntry {
  readonly target: IndexTarget;
  readonly sql: SidecarSql;
}

export class SidecarFts5Provider implements IKeywordIndexProvider {
  readonly id = SIDECAR_FTS5_PROVIDER_ID;

  private readonly indexDir: string;
  private readonly openDatabase: SidecarDatabaseOpener;
  private readonly stalePartAgeMs: number;

  /**
   * Targets whose last `build()` failed, and why. In-memory and
   * instance-scoped on purpose: see the file-level doc comment on where
   * `failed` lives. A fresh provider (i.e. a fresh app run) forgets, and
   * reports `unbuilt` again - which is the right default when the durable
   * record in `main.db` has not been wired up yet (F8).
   */
  private readonly failures = new Map<string, string>();

  /** Targets this instance is building right now; their `.part` files are off-limits to any sweep. */
  private readonly building = new Set<string>();

  constructor(config: SidecarFts5Config) {
    this.indexDir = config.indexDir;
    this.openDatabase = config.openDatabase;
    this.stalePartAgeMs = config.stalePartAgeMs ?? DEFAULT_STALE_PART_AGE_MS;
  }

  // -------------------------------------------------------------------------
  // supports / status
  // -------------------------------------------------------------------------

  /**
   * Three independent conditions, all required:
   *
   * 1. `env.sqlite.fts5` - there is no fallback; a SQLite build without FTS5
   *    cannot create `kw` at all.
   * 2. `env.indexDir !== null` - M1 documents `null` as "no writable
   *    derived-data location", which is precisely the environment this
   *    provider cannot work in. The directory this provider actually writes to
   *    is its own configured `indexDir` (a composition root passes the same
   *    value to both); `env.indexDir` is the environment's assertion that such
   *    a location exists at all, which is a different question from where.
   * 3. The target can be turned into a filename - see
   *    {@link unsupportedReason}.
   *
   * Returning false here is what makes `KeywordIndexRegistry` route the target
   * to `skipped` with `{ state: 'unavailable', reason: 'no-provider' }` rather
   * than throw, which is M1's established degrade-rather-than-fail path.
   */
  supports(target: IndexTarget, env: RuntimeEnvironment): boolean {
    if (!env.sqlite.fts5) return false;
    if (env.indexDir === null) return false;
    return this.unsupportedReason(target) === null;
  }

  /**
   * Why this provider cannot address `target`, or `null` if it can.
   *
   * ### The empty-`contentSha256` judgement call
   *
   * Design doc §4.2 gives a fallback filename key for a module with no
   * `content_sha256`: hash `sm:<size>-<mtimeMs>` and use that, prefixed so it
   * is never confused with a real digest. That fallback is written for code
   * that holds the module FILE and can stat it. This provider does not: its
   * input is an {@link IIndexSource} / {@link IndexTarget}, which carry a
   * module uuid, a module type and a digest - no path, no size, no mtime. It
   * could not compute the documented fallback if it wanted to.
   *
   * So the honest answer, given what this provider actually receives, is to
   * require a usable digest and say so. A target with an empty (or too short,
   * or not filename-safe) `contentSha256` is unsupported: `supports()` is
   * false, the registry skips it as `unavailable`, and `build()` throws a
   * {@link SidecarIndexBuildError} naming the reason. Nothing is silently
   * mis-keyed, and nothing silently returns no results.
   *
   * The alternative - inventing a key from something else on the target, say
   * the module uuid alone - would be actively wrong: the digest IS the
   * staleness key (M1: "an index is for exactly one revision"), and a key that
   * does not change when the content changes produces a stale index that
   * reports `ready` forever. A missing digest is a real gap in the module (M5
   * documents its `contentSha256 ?? ''` fallback as exactly that gap, and F3
   * now provides `computeContentSha256()` to close it); the right place to close it is
   * where the module is installed, not by guessing here.
   */
  private unsupportedReason(target: IndexTarget): string | null {
    if (!FILENAME_SAFE.test(target.moduleUuid)) {
      return `moduleUuid ${JSON.stringify(target.moduleUuid)} is not usable as a filename component`;
    }
    if (target.contentSha256.length < CONTENT_SHA_PREFIX_LENGTH) {
      return (
        `contentSha256 is empty or shorter than ${CONTENT_SHA_PREFIX_LENGTH} characters ` +
        `(got ${JSON.stringify(target.contentSha256)}); a sidecar index is keyed by content digest ` +
        `and cannot be addressed without one`
      );
    }
    if (!FILENAME_SAFE.test(target.contentSha256)) {
      return `contentSha256 ${JSON.stringify(target.contentSha256)} is not usable as a filename component`;
    }
    return null;
  }

  /**
   * Cheap and read-only: at most one `SELECT` against a small table, never a
   * build. Resolves the whole §4.4 table for one target - see the class doc
   * comment.
   *
   * Order matters here. A `.kwi` that is present and current wins over a
   * remembered build failure: a rebuild that failed leaves the PREVIOUS index
   * untouched (the build writes to `.part` and only renames on success), and
   * an index that is on disk and answers queries is `ready`, whatever happened
   * on the last attempt. The remembered failure is dropped in that case,
   * because it is no longer the state of the world.
   */
  async status(target: IndexTarget): Promise<KeywordCapability> {
    if (this.unsupportedReason(target) !== null) {
      return { state: 'unavailable', reason: 'no-provider' };
    }

    const key = indexTargetKey(target);
    const { finalPath, partPath } = this.paths(target);

    if (!fileExists(finalPath)) {
      // A `.kwi.part` and no `.kwi` means a build was interrupted. It is never
      // opened and never mistaken for an index; it is swept once it is old
      // enough to be certainly nobody's work in progress.
      this.sweepStalePart(partPath, key);
      return this.unbuiltOrFailed(key);
    }

    const meta = this.readKwiMeta(finalPath);
    if (meta === null) {
      // Corrupt, truncated, not a database, or missing/empty `kwi_meta`.
      // Design doc §4.4: delete the file and allow a rebuild. Keeping it would
      // mean every future status check pays the same failed open and the user
      // never gets a working index back.
      removeFile(finalPath);
      this.sweepStalePart(partPath, key);
      return this.unbuiltOrFailed(key);
    }

    const builtFor = meta.get(KWI_META_KEYS.contentSha256) ?? '';
    const currentFor = {
      format: KWI_FORMAT,
      tokenizer: SIDECAR_TOKENIZER,
      builder: SIDECAR_BUILDER_VERSION,
    };

    const stale =
      meta.get(KWI_META_KEYS.format) !== currentFor.format ||
      meta.get(KWI_META_KEYS.tokenizer) !== currentFor.tokenizer ||
      meta.get(KWI_META_KEYS.builder) !== currentFor.builder ||
      meta.get(KWI_META_KEYS.moduleUuid) !== target.moduleUuid ||
      // The filename carries only the first 12 characters of the digest, so
      // this is the check that a 12-character prefix collision cannot slip
      // through as a correct index for the wrong revision.
      builtFor !== target.contentSha256;

    if (stale) {
      return { state: 'stale', providerId: this.id, builtFor };
    }

    this.failures.delete(key);
    return { state: 'ready', providerId: this.id, supports: SIDECAR_FTS5_FEATURES };
  }

  private unbuiltOrFailed(key: string): KeywordCapability {
    const reason = this.failures.get(key);
    if (reason !== undefined) {
      return { state: 'failed', providerId: this.id, reason };
    }
    return { state: 'unbuilt', providerId: this.id };
  }

  // -------------------------------------------------------------------------
  // open / search
  // -------------------------------------------------------------------------

  /**
   * Opens the `.kwi` behind every target that has one, and reports the rest as
   * skipped.
   *
   * `open()` deliberately never builds. The contract (M4, bullet 5) is that an
   * aborted build leaves a target `unbuilt` and never `ready`; a forgiving
   * `open()` that quietly built on demand would turn every search of an
   * unbuilt module into a multi-minute stall with no progress reporting and no
   * way to cancel, and would make "unbuilt" unobservable. A caller builds
   * explicitly, then opens.
   *
   * A `stale` target IS opened. Its postings are still valid answers to a
   * query - they were built from this exact revision's content, just with an
   * older tokenizer or builder - so degrading to "searchable, and due a
   * rebuild" beats degrading to "silently no results", which is this whole
   * subtask's named failure mode.
   */
  async open(targets: IndexTarget[]): Promise<IKeywordIndex> {
    const entries: OpenEntry[] = [];
    const skipped: KeywordSearchResponse['skipped'] = [];

    for (const target of targets) {
      const capability = await this.status(target);
      if (capability.state !== 'ready' && capability.state !== 'stale') {
        skipped.push({ target, reason: capability });
        continue;
      }
      try {
        const sql = this.openDatabase(this.paths(target).finalPath, { readonly: true, create: false });
        entries.push({ target, sql });
      } catch {
        // Raced with a prune, or the file became unreadable between the
        // status check above and this open. One target degrades; the rest of
        // the group still searches.
        skipped.push({ target, reason: { state: 'unbuilt', providerId: this.id } });
      }
    }

    return new SidecarFts5Index(this.id, entries, skipped);
  }

  // -------------------------------------------------------------------------
  // build
  // -------------------------------------------------------------------------

  /**
   * Build (or rebuild) the `.kwi` for `src.target`, following design doc
   * §4.3's six steps:
   *
   * 1. Refuse early if the index directory is missing or unwritable, and
   *    delete any stray `.kwi.part` left over from a previous attempt at this
   *    same target.
   * 2. Create the `.part` with `journal_mode = OFF, synchronous = OFF`. Both
   *    are safe precisely because the `.part` is disposable by construction:
   *    a torn `.part` is never renamed, so it is never read, so there is
   *    nothing for a journal to protect. Losing it costs a rebuild, which is
   *    the same thing a rollback would have cost.
   * 3. Stream `src.documents()` in batched transactions of
   *    {@link SIDECAR_BUILD_BATCH_SIZE}, reporting progress and honouring
   *    `signal` at each batch boundary.
   * 4. `optimize`, then `VACUUM` - in that order, and both. The design
   *    measured optimize-then-vacuum shrinking a real index by ~20% versus
   *    optimize alone: `optimize` merges the FTS5 b-tree segments, and only
   *    then does `VACUUM` have dead pages worth reclaiming.
   * 5. Write `kwi_meta`, close, and `fs.renameSync` the `.part` onto the final
   *    name. A rename within one directory is atomic on every filesystem this
   *    app runs on, which is what makes "a `.kwi` exists" mean "a COMPLETE
   *    `.kwi` exists" - the invariant the whole state machine rests on. Copy
   *    then delete would break it.
   * 6. Nothing is written to `main.db`. Reporting the build into
   *    `keyword_index` belongs to the install flow (F8); see the class doc.
   *
   * On abort: the `.part` is deleted, nothing is recorded, a
   * {@link SidecarIndexBuildAbortedError} is thrown, and `status()` says
   * `unbuilt`. On failure: the `.part` is deleted, the reason is recorded, a
   * {@link SidecarIndexBuildError} is thrown, and `status()` says `failed`.
   * Neither ever leaves a half-written index reporting `ready`.
   */
  async build(
    src: IIndexSource,
    onProgress?: (done: number, total: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const target = src.target;
    const unsupported = this.unsupportedReason(target);
    if (unsupported !== null) {
      throw new SidecarIndexBuildError(target, unsupported);
    }

    // Checked before anything is created, so an already-aborted signal costs
    // nothing and leaves no trace.
    throwIfAborted(signal, target);

    const key = indexTargetKey(target);
    const { finalPath, partPath } = this.paths(target);

    this.building.add(key);
    try {
      this.assertIndexDirWritable(target);
      removeFile(partPath);

      this.writeIndexFile(src, partPath, onProgress, signal);
      fs.renameSync(partPath, finalPath);

      this.failures.delete(key);
    } catch (error) {
      removeFile(partPath);

      if (error instanceof SidecarIndexBuildAbortedError) {
        // Aborted is not failed: leave the target `unbuilt` and retryable.
        this.failures.delete(key);
        throw error;
      }

      const wrapped =
        error instanceof SidecarIndexBuildError
          ? error
          : new SidecarIndexBuildError(target, describeError(error), error);
      this.failures.set(key, wrapped.reason);
      throw wrapped;
    } finally {
      this.building.delete(key);
    }
  }

  /** Steps 2-5 of `build()`, against the `.part` file. Synchronous: every `ISql` call is. */
  private writeIndexFile(
    src: IIndexSource,
    partPath: string,
    onProgress: ((done: number, total: number) => void) | undefined,
    signal: AbortSignal | undefined
  ): void {
    const target = src.target;
    const db = this.openDatabase(partPath, { readonly: false, create: true });

    try {
      db.exec('PRAGMA journal_mode = OFF;');
      db.exec('PRAGMA synchronous = OFF;');
      db.exec(SIDECAR_SCHEMA_SQL);

      const total = src.count();
      let done = 0;
      let batch: IndexDocument[] = [];

      const flush = (): void => {
        if (batch.length === 0) return;
        const pending = batch;
        batch = [];

        db.transaction(() => {
          for (const doc of pending) {
            // The explicit rowid is the whole point: `kw.rowid` and
            // `kw_doc.doc_id` are the same number by construction, so the
            // join below can never drift, and for a per-module sidecar that
            // number is also the source row's own rowid.
            db.execute('INSERT INTO kw(rowid, text) VALUES (?, ?)', [doc.rowId, doc.text]);
            db.execute(
              'INSERT INTO kw_doc(doc_id, module_uuid, source_rowid, start_verse_id, end_verse_id) ' +
                'VALUES (?, ?, ?, ?, ?)',
              [
                doc.rowId,
                target.moduleUuid,
                doc.rowId,
                doc.startVerseId ?? null,
                doc.endVerseId ?? null,
              ]
            );
          }
        });

        done += pending.length;
        onProgress?.(done, total);
        throwIfAborted(signal, target);
      };

      for (const doc of src.documents()) {
        batch.push(doc);
        if (batch.length >= SIDECAR_BUILD_BATCH_SIZE) flush();
      }
      flush();

      db.exec(`INSERT INTO kw(kw) VALUES('optimize');`);
      db.exec('VACUUM;');

      this.writeKwiMeta(db, target, done);
    } finally {
      try {
        db.close();
      } catch {
        // A close failure after the real work must not mask the real error,
        // and on the success path the file is about to be renamed anyway.
      }
    }
  }

  private writeKwiMeta(db: SidecarSql, target: IndexTarget, docCount: number): void {
    const rows: Array<[string, string]> = [
      [KWI_META_KEYS.format, KWI_FORMAT],
      [KWI_META_KEYS.providerId, this.id],
      [KWI_META_KEYS.tokenizer, SIDECAR_TOKENIZER],
      [KWI_META_KEYS.builder, SIDECAR_BUILDER_VERSION],
      [KWI_META_KEYS.moduleUuid, target.moduleUuid],
      [KWI_META_KEYS.contentSha256, target.contentSha256],
      // `IIndexSource` exposes documents, not the table and column they were
      // read from - that shape lives in `CONTENT_MAP`, on the repository side
      // (M5). The module type is what selects that shape, so it is the
      // faithful thing to record here; §4.2's `'<table.column>'` is a
      // description of provenance, and this is the provenance this provider
      // actually has.
      [KWI_META_KEYS.source, target.moduleType],
      [KWI_META_KEYS.docCount, String(docCount)],
      [KWI_META_KEYS.builtAt, new Date().toISOString()],
    ];

    db.transaction(() => {
      for (const [key, value] of rows) {
        db.execute('INSERT INTO kwi_meta(key, value) VALUES (?, ?)', [key, value]);
      }
    });
  }

  // -------------------------------------------------------------------------
  // prune / pruneExcept
  // -------------------------------------------------------------------------

  /**
   * Remove this target's index entirely - the `.kwi` and any `.part`, plus any
   * remembered failure. Called when a module is uninstalled, or when a caller
   * decides an index should be rebuilt from nothing.
   *
   * The `.part` goes unconditionally here, unlike in a scan: `prune()` is an
   * explicit instruction about this exact target, so there is no in-progress
   * build to protect - and if there were, the caller has just said it does not
   * want its result.
   */
  async prune(target: IndexTarget): Promise<void> {
    if (this.unsupportedReason(target) !== null) return;
    const { finalPath, partPath } = this.paths(target);
    removeFile(finalPath);
    removeFile(partPath);
    this.failures.delete(indexTargetKey(target));
  }

  /**
   * The boot-scan garbage collector (design doc §4.4, last two rows): delete
   * every `.kwi` in the index directory that is not one of `keep`, every
   * `.part` that is not one of `keep`, and any `.part` that IS one of `keep`
   * but is old enough to be a crash leftover rather than work in progress.
   *
   * This is the one method that lists the directory, which is what lets it
   * find orphans nobody can name any more - the `.kwi` of a module that was
   * uninstalled while the app was not running, or of a revision that was
   * superseded. `prune()` cannot: it is per-target, and an orphan is precisely
   * a file with no target.
   *
   * A `.part` belonging to a build this instance is running right now is never
   * touched, whatever its age.
   */
  async pruneExcept(keep: IndexTarget[]): Promise<void> {
    const keepFiles = new Set<string>();
    const keepKeys = new Set<string>();
    for (const target of keep) {
      if (this.unsupportedReason(target) !== null) continue;
      keepFiles.add(this.fileStem(target) + KWI_EXTENSION);
      keepFiles.add(this.fileStem(target) + PART_EXTENSION);
      keepKeys.add(indexTargetKey(target));
    }

    let names: string[];
    try {
      names = fs.readdirSync(this.indexDir);
    } catch {
      // No index directory means no orphans. Nothing to do, and nothing worth
      // failing a boot scan over.
      return;
    }

    const protectedParts = new Set<string>();
    for (const key of this.building) {
      protectedParts.add(key);
    }

    for (const name of names) {
      const full = path.join(this.indexDir, name);

      // `.kwi.part` also ends with `.part`, never with `.kwi` - test it first.
      if (name.endsWith(PART_EXTENSION)) {
        if (this.isBuildingPart(name, protectedParts)) continue;
        if (!keepFiles.has(name) || this.partIsStale(full)) removeFile(full);
        continue;
      }

      if (!name.endsWith(KWI_EXTENSION)) continue;
      if (!keepFiles.has(name)) removeFile(full);
    }

    for (const key of [...this.failures.keys()]) {
      if (!keepKeys.has(key)) this.failures.delete(key);
    }
  }

  private isBuildingPart(name: string, buildingKeys: Set<string>): boolean {
    for (const key of buildingKeys) {
      // `indexTargetKey` is `${moduleUuid}:${contentSha256}`; the part file is
      // `${moduleUuid}.${contentSha256[0:12]}.kwi.part`.
      const separator = key.lastIndexOf(':');
      if (separator === -1) continue;
      const stem =
        key.slice(0, separator) + '.' + key.slice(separator + 1, separator + 1 + CONTENT_SHA_PREFIX_LENGTH);
      if (name === stem + PART_EXTENSION) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Paths and small filesystem helpers
  // -------------------------------------------------------------------------

  /** `<moduleUuid>.<contentSha256[0:12]>` - the shared stem of both filenames. */
  private fileStem(target: IndexTarget): string {
    return `${target.moduleUuid}.${target.contentSha256.slice(0, CONTENT_SHA_PREFIX_LENGTH)}`;
  }

  /**
   * Where this target's index is, and where a build stages it. Public-ish
   * knowledge - `SidecarFts5Provider.test.ts` asserts against these paths
   * directly, because "the file is actually gone from disk" is the assertion
   * that matters for prune, not "status says so".
   */
  kwiPathFor(target: IndexTarget): string {
    return this.paths(target).finalPath;
  }

  partPathFor(target: IndexTarget): string {
    return this.paths(target).partPath;
  }

  private paths(target: IndexTarget): { finalPath: string; partPath: string } {
    const stem = path.join(this.indexDir, this.fileStem(target));
    return { finalPath: stem + KWI_EXTENSION, partPath: stem + PART_EXTENSION };
  }

  private assertIndexDirWritable(target: IndexTarget): void {
    // Deliberately not `mkdirSync`: the index directory is the composition
    // root's to create (it is a subdirectory of the platform's user-data
    // location, which this provider knows nothing about). A missing one is a
    // wiring bug that should surface as a clear error on the first build, not
    // as a directory quietly appearing somewhere unexpected.
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.indexDir);
    } catch {
      throw new SidecarIndexBuildError(target, `index directory does not exist: ${this.indexDir}`);
    }
    if (!stat.isDirectory()) {
      throw new SidecarIndexBuildError(target, `index directory is not a directory: ${this.indexDir}`);
    }
    try {
      fs.accessSync(this.indexDir, fs.constants.W_OK);
    } catch {
      throw new SidecarIndexBuildError(target, `index directory is not writable: ${this.indexDir}`);
    }
  }

  /**
   * Read a `.kwi`'s `kwi_meta` into a map, or `null` if the file will not give
   * one up for ANY reason - `SQLITE_CORRUPT`, "file is not a database", a
   * truncated header, a missing or empty `kwi_meta` table.
   *
   * Collapsing every one of those to `null` is deliberate: from the caller's
   * point of view they are one situation ("this file cannot be trusted as an
   * index"), they all have the same remedy (delete and rebuild), and
   * distinguishing them would mean matching on driver-specific error text.
   */
  private readKwiMeta(filePath: string): Map<string, string> | null {
    let db: SidecarSql | null = null;
    try {
      db = this.openDatabase(filePath, { readonly: true, create: false });
      const rows = db.queryAll<{ key: string; value: string }>('SELECT key, value FROM kwi_meta');
      if (rows.length === 0) return null;
      return new Map(rows.map((row) => [row.key, row.value]));
    } catch {
      return null;
    } finally {
      if (db !== null) {
        try {
          db.close();
        } catch {
          // Nothing useful to do; the read already succeeded or already failed.
        }
      }
    }
  }

  /**
   * Delete a stray `.kwi.part` once it is certainly not someone's build in
   * progress. Called from `status()` because that is the one method a caller
   * runs routinely per target, and because a `.part` that is never swept is
   * wasted disk that nothing else would ever notice.
   *
   * `status()` reports `unbuilt` either way - a `.part` is never opened and
   * never counts as an index - so this sweep is housekeeping, not part of the
   * answer. What it must NOT do is delete a `.part` a concurrent build is
   * still writing, hence both guards.
   */
  private sweepStalePart(partPath: string, key: string): void {
    if (this.building.has(key)) return;
    if (!this.partIsStale(partPath)) return;
    removeFile(partPath);
  }

  private partIsStale(partPath: string): boolean {
    try {
      const stat = fs.statSync(partPath);
      // `mtimeMs` carries sub-millisecond precision on Linux while `Date.now()`
      // is whole milliseconds, so a file written microseconds ago can report a
      // NEGATIVE age. Flooring the timestamp keeps "age >= 0" true for a
      // just-written file, which matters when `stalePartAgeMs` is 0.
      return Date.now() - Math.floor(stat.mtimeMs) >= this.stalePartAgeMs;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// The opened index
// ---------------------------------------------------------------------------

/**
 * The {@link IKeywordIndex} `SidecarFts5Provider.open()` returns. Unlike M3's,
 * this one genuinely owns file handles, so `close()` genuinely closes them.
 */
class SidecarFts5Index implements IKeywordIndex {
  readonly capability: KeywordCapability;

  constructor(
    readonly providerId: string,
    private readonly entries: OpenEntry[],
    private readonly skippedAtOpen: KeywordSearchResponse['skipped']
  ) {
    this.capability =
      entries.length > 0
        ? { state: 'ready', providerId, supports: SIDECAR_FTS5_FEATURES }
        : { state: 'unbuilt', providerId };
  }

  /**
   * One MATCH per opened `.kwi`, joined to `kw_doc` for the source rowid and
   * passage range.
   *
   * Targets that could not be opened were recorded at `open()` time and are
   * repeated in every response's `skipped`: a caller must be able to tell
   * "no hits" from "that module was not searched", which is the failure mode
   * this whole subtask exists to prevent.
   */
  async search(query: KeywordQuery, options: KeywordSearchOptions): Promise<KeywordSearchResponse> {
    const hits: KeywordHit[] = [];
    const skipped: KeywordSearchResponse['skipped'] = [...this.skippedAtOpen];
    let truncated = false;

    const compiled = compileKeywordQuery(query);
    // Same convention as M3: a boolean expression with no FTS5 equivalent
    // compiles to '' and means "no results everywhere", not "every target
    // failed".
    if (compiled === '') {
      return { hits, skipped, truncated };
    }

    // An empty `options.targets` means "every target this index holds" (the
    // registry always passes an explicit group, so this is the direct-call
    // path). A non-empty one narrows, which is the subset-search knob.
    const requested =
      options.targets.length > 0 ? new Set(options.targets.map(indexTargetKey)) : null;

    const scope = buildScopeFilter(options.scope);
    const limit = options.limit ?? -1; // SQLite: a negative LIMIT means no limit.

    for (const entry of this.entries) {
      if (requested !== null && !requested.has(indexTargetKey(entry.target))) continue;

      try {
        const rows = entry.sql.queryAll<KwHitRow>(
          `SELECT kw.rowid AS doc_id,
                  d.source_rowid AS source_rowid,
                  d.start_verse_id AS start_verse_id,
                  d.end_verse_id AS end_verse_id
             FROM kw
             JOIN kw_doc d ON d.doc_id = kw.rowid
            WHERE kw MATCH ?
              AND d.module_uuid = ?${scope.sql}
            ORDER BY kw.rowid
            LIMIT ?`,
          [compiled, entry.target.moduleUuid, ...scope.params, limit]
        );

        for (const row of rows) {
          hits.push({
            target: entry.target,
            rowId: Number(row.source_rowid),
            startVerseId: toVerseId(row.start_verse_id),
            endVerseId: toVerseId(row.end_verse_id),
            // `rank: false` in SIDECAR_FTS5_FEATURES - a placeholder, not a
            // claim. See that constant's doc comment.
            rank: 0,
            // Contentless FTS5: there is no stored text to snippet.
            snippet: undefined,
          });
        }

        if (options.limit !== undefined && rows.length >= options.limit) {
          truncated = true;
        }
      } catch {
        // A file that opened but will not answer - corruption that only shows
        // up once postings are actually read, most likely. One target
        // degrades to skipped; the rest of the group still returns hits.
        skipped.push({ target: entry.target, reason: { state: 'unbuilt', providerId: this.providerId } });
      }
    }

    return { hits, skipped, truncated };
  }

  /** Real work, unlike M3's no-op: this index opened these files and owns them. */
  close(): void {
    for (const entry of this.entries) {
      try {
        entry.sql.close();
      } catch {
        // Closing twice, or after the file was pruned, must not throw out of
        // a `finally` in KeywordIndexRegistry.search().
      }
    }
  }
}

interface KwHitRow {
  doc_id: number;
  source_rowid: number;
  start_verse_id: number | null;
  end_verse_id: number | null;
}

// ---------------------------------------------------------------------------
// Free helpers
// ---------------------------------------------------------------------------

/**
 * Push `KeywordSearchOptions.scope` down into SQL rather than filtering in JS.
 *
 * Two ranges overlap when each starts at or before the other ends, which is
 * exactly what `idx_kw_doc_range` serves.
 *
 * ## Documents with no passage anchor pass through, deliberately
 *
 * A document can have NULL range columns, and plenty do: `CONTENT_MAP` (F1)
 * declares a `range` only for `commentary` today - Bible verses, dictionary
 * entries, book sections and topics all reach `IIndexSource` with no
 * `startVerseId`/`endVerseId` at all, so `kw_doc` stores NULL for them. (For
 * Bible content that is a gap in `CONTENT_MAP['bible']`, not in this index:
 * `bible_verse.verse_id` IS the verse id and IS the rowid. Closing it belongs
 * with that entry, where every consumer of `IIndexSource` would benefit, not
 * with a module-type special case here.)
 *
 * The tempting SQL - `start <= ? AND end >= ?` - silently drops every one of
 * those rows, which would turn a scoped Bible search into zero results with no
 * indication anything was filtered. That is precisely the failure mode this
 * provider exists to avoid. So a row this index cannot place is returned
 * rather than discarded, matching what `KeywordSearchOptions.scope` already
 * promises: "pushed down where a provider can; filtered after where it
 * cannot". The caller gets a superset and narrows it with the passage
 * information it has; it never gets a confident empty answer.
 */
function buildScopeFilter(scope: PassageRange[] | undefined): { sql: string; params: number[] } {
  if (scope === undefined || scope.length === 0) return { sql: '', params: [] };

  const clauses: string[] = ['d.start_verse_id IS NULL', 'd.end_verse_id IS NULL'];
  const params: number[] = [];
  for (const range of scope) {
    clauses.push('(d.start_verse_id <= ? AND d.end_verse_id >= ?)');
    params.push(range.endVerseId, range.startVerseId);
  }
  return { sql: ` AND (${clauses.join(' OR ')})`, params };
}

function toVerseId(value: number | null): VerseId | undefined {
  return value === null ? undefined : value;
}

function throwIfAborted(signal: AbortSignal | undefined, target: IndexTarget): void {
  if (signal?.aborted) throw new SidecarIndexBuildAbortedError(target);
}

function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/** Delete if present; never throw. A file that is already gone is a success. */
function removeFile(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // Locked on Windows, or removed by someone else between the check and the
    // call. Either way there is nothing better to do here than carry on - the
    // caller's own error (if any) is the interesting one.
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
