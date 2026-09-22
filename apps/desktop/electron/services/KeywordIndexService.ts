import * as fs from 'fs';
import log from 'electron-log';
import type { ISql, ModuleType, IIndexSource, SidecarDatabaseOpener } from '@bible/core';
import {
  SidecarFts5Provider,
  SidecarIndexBuildError,
  SidecarIndexBuildAbortedError,
  SIDECAR_FTS5_PROVIDER_ID,
  SIDECAR_TOKENIZER,
  KeywordIndexRepository,
  ModuleMetadataRepository,
  BibleRepository,
  CommentaryRepository,
  DictionaryRepository,
  BookRepository,
  TopicalIndexRepository,
} from '@bible/core';
import { SqliteProvider } from '../providers/SqliteProvider';
import { getKeywordIndexRoot, resolveModulePath } from '../utils/appPaths';

/**
 * Status the renderer reads for one module's keyword index (F8, task 0027
 * revision 2, design doc §5.1/§5.3) - a thin, JSON-friendly projection of
 * `KeywordIndexRecord` (`@bible/core`), plus one state `keyword_index` itself
 * never stores: `'unavailable'` is computed fresh on every read, exactly as
 * `KeywordCapability`'s own doc comment requires ("describes the ENVIRONMENT
 * ..., not this module's index"). Here "environment" also covers two static
 * facts about the MODULE that make indexing impossible outright, distinct
 * from "not built yet":
 *
 *   - `reason: 'no-stable-identity'` - a pre-F3 module with no `module_uuid`,
 *     which `SidecarFts5Provider` cannot address at all (see its own
 *     `unsupportedReason()`).
 *   - `reason: 'nothing-to-index'` - a module type with no indexable content
 *     ({@link repositoryForIndexing}'s `null` branch): `cross_reference`,
 *     `tag_graph`, `devotional`.
 *
 * `state: 'unbuilt'` with every other field absent is what a module that
 * COULD be indexed but never has been (no `keyword_index` row) reports,
 * matching `SidecarFts5Provider.status()`'s own default.
 */
export interface KeywordIndexStatusDto {
  moduleUuid: string;
  providerId: string;
  state: 'unavailable' | 'unbuilt' | 'building' | 'ready' | 'stale' | 'failed';
  /** Only meaningful with `state === 'unavailable'`. */
  reason?: 'no-stable-identity' | 'nothing-to-index';
  tokenizer?: string;
  docCount?: number | null;
  sizeBytes?: number | null;
  builtAt?: string | null;
  error?: string | null;
}

/**
 * `SidecarDatabaseOpener` for `SidecarFts5Provider`: opens a `.kwi` file with
 * the same `better-sqlite3`-family driver every other connection in this app
 * uses. `SqliteProvider` already implements `exec()`, so it satisfies
 * `SidecarSql` with no adapter.
 *
 * `create: false` must fail rather than conjure an empty database (see
 * `SidecarOpenOptions`'s doc comment) - `fileMustExist: true` is exactly that
 * `better-sqlite3` behaviour.
 */
const openSidecarDatabase: SidecarDatabaseOpener = (filePath, options) =>
  new SqliteProvider(filePath, { readonly: options.readonly, fileMustExist: !options.create });

/**
 * The `ModuleType`s a keyword index can ever be built for - the single source
 * of truth {@link repositoryForIndexing} switches on and
 * {@link moduleTypeSupportsKeywordIndex} checks against, so the two cannot
 * silently drift apart the way `initMainDatabase.ts` and
 * `sql/schemas/initial/MainDatabase.sql` once did for `module_metadata`.
 *
 * Not every `ModuleType` carries indexable content:
 *
 * - `cross_reference` and `tag_graph` have an empty `CONTENT_MAP` entry (see
 *   `BaseModuleRepository.buildIndexSource`'s own doc comment) - there is no
 *   prose in either module type for a keyword index to be built over.
 * - `devotional` has no repository class implementing `getIndexSource()` yet
 *   (see `moduleDetector.ts`'s own `TODO` on that module type).
 */
const INDEXABLE_MODULE_TYPES: ReadonlySet<ModuleType> = new Set<ModuleType>([
  'bible', 'commentary', 'dictionary', 'lexicon', 'book', 'topical_index',
]);

/** Whether `moduleType` can ever have a keyword index - see {@link INDEXABLE_MODULE_TYPES}. */
export function moduleTypeSupportsKeywordIndex(moduleType: ModuleType): boolean {
  return INDEXABLE_MODULE_TYPES.has(moduleType);
}

/**
 * The subset of `moduleDetector.ts`'s `moduleType -> repository` switch that
 * carries indexable content - one branch per member of
 * {@link INDEXABLE_MODULE_TYPES}. `null` for anything else means "nothing to
 * build", never an error - the caller treats it as a normal, silent no-op.
 */
function repositoryForIndexing(moduleType: ModuleType, db: ISql): { getIndexSource(): IIndexSource } | null {
  switch (moduleType) {
    case 'bible':
      return new BibleRepository(db);
    case 'commentary':
      return new CommentaryRepository(db);
    case 'dictionary':
    case 'lexicon':
      return new DictionaryRepository(db);
    case 'book':
      return new BookRepository(db);
    case 'topical_index':
      return new TopicalIndexRepository(db);
    case 'cross_reference':
    case 'tag_graph':
    case 'devotional':
    default:
      return null;
  }
}

/** Size on disk, or `null` if the file cannot be stat'd (e.g. raced with a prune). */
function statSizeSafe(filePath: string): number | null {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Composition root and orchestration for the keyword-index build/status/prune
 * flow (F8, task 0027 revision 2, design doc §5). This is the piece that was
 * missing: `SidecarFts5Provider` (F6) is fully build-capable but is deliberately
 * platform-agnostic - it "never resolves `<userData>`", "never opens a module
 * database" and "never reads or writes `main.db`'s `keyword_index` table" (see
 * its own file-level doc comment). Everything this class does is exactly the
 * three things that doc comment names as someone else's job:
 *
 *   1. Supplies `indexDir` ({@link getKeywordIndexRoot}) and the SQLite driver
 *      ({@link openSidecarDatabase}) at construction.
 *   2. Opens the module's own file with the repository class matching its
 *      `ModuleType`, exactly as `moduleDetector.ts` already does when
 *      detecting modules, to obtain the `IIndexSource` `build()` consumes.
 *   3. Mirrors every build outcome into the `keyword_index` table in
 *      `main.db` via {@link KeywordIndexRepository}, which is the durable
 *      record `SidecarFts5Provider.status()` cannot itself provide (a build
 *      that failed for a permanent reason - full disk, unwritable directory -
 *      produces no `.kwi` file, so there is nowhere on disk for that fact to
 *      live; see F6's doc comment on `SidecarIndexBuildError`).
 *
 * One instance is constructed per `main.db` connection (`moduleHandlers.ts`'s
 * `initializeModuleManager()`), mirroring how `InstallationService` and
 * `ModuleCatalogService` are constructed there.
 */
export class KeywordIndexService {
  private readonly provider: SidecarFts5Provider;
  private readonly keywordIndexRepo: KeywordIndexRepository;
  private readonly moduleMetadataRepo: ModuleMetadataRepository;

  constructor(mainDb: ISql, indexDir: string = getKeywordIndexRoot()) {
    this.provider = new SidecarFts5Provider({ indexDir, openDatabase: openSidecarDatabase });
    this.keywordIndexRepo = new KeywordIndexRepository(mainDb);
    this.moduleMetadataRepo = new ModuleMetadataRepository(mainDb);
  }

  /**
   * Current keyword-index status for one module, by its `module_metadata`
   * `moduleId` - the same handle every other module IPC call
   * (`module:get-details`, `module:uninstall`, ...) already uses, so callers
   * never need to separately track a module's `moduleUuid`. `undefined` when
   * `moduleId` names no installed module (the IPC handler turns that into
   * `not_found`); never touches the filesystem or the module file - straight
   * from the durable `keyword_index` record (or the static facts described on
   * {@link KeywordIndexStatusDto} when there is no possible record at all).
   */
  getStatusForModule(moduleId: number): KeywordIndexStatusDto | undefined {
    const module = this.moduleMetadataRepo.getById(moduleId);
    return module ? this.statusFor(module) : undefined;
  }

  private statusFor(module: { moduleUuid: string; moduleType: ModuleType }): KeywordIndexStatusDto {
    if (!module.moduleUuid) {
      return { moduleUuid: '', providerId: SIDECAR_FTS5_PROVIDER_ID, state: 'unavailable', reason: 'no-stable-identity' };
    }
    if (!moduleTypeSupportsKeywordIndex(module.moduleType)) {
      return { moduleUuid: module.moduleUuid, providerId: SIDECAR_FTS5_PROVIDER_ID, state: 'unavailable', reason: 'nothing-to-index' };
    }
    const record = this.keywordIndexRepo.get(module.moduleUuid, SIDECAR_FTS5_PROVIDER_ID);
    if (!record) {
      return { moduleUuid: module.moduleUuid, providerId: SIDECAR_FTS5_PROVIDER_ID, state: 'unbuilt' };
    }
    return record;
  }

  /**
   * Best-effort, fire-and-forget keyword-index build immediately after a
   * module is registered.
   *
   * ## Why this never awaits, and never throws out to its caller
   *
   * Design doc §5.1's central point: "The module is usable the moment it is
   * registered. The index is a second, interruptible phase that search
   * degrades around - never a gate on reading." `InstallationService
   * .installModule()` has already returned success to its caller by the time
   * this fires (or is about to), and a large commentary module's build can
   * take real seconds (F6's own doc comment) - awaiting it here would make
   * every install pay that latency for a phase the user is not blocked on.
   * Firing it and letting it run against its own internal try/catch (see
   * {@link runBuild}) is therefore the deliberate choice over "await, but
   * catch": either shape keeps `installModule`'s RESULT unaffected by a
   * build failure, but only this one keeps its LATENCY unaffected too.
   *
   * Any error `runBuild` does not itself convert into a persisted `failed`
   * row (a bug in this class, not a build failure) is caught here and only
   * logged - an index that fails to build is never allowed to look like an
   * install that failed.
   *
   * `signal` is accepted (and threaded straight through to
   * `SidecarFts5Provider.build()`) for the same reason {@link rebuildForModule}
   * accepts one - see that method's doc comment - though no caller in this
   * pass supplies one for a post-install build either.
   */
  triggerBuildAfterInstall(
    module: { moduleType: ModuleType; absoluteDatabasePath: string },
    signal?: AbortSignal
  ): void {
    void this.runBuild(module, signal).catch((error) => {
      log.error('[KeywordIndexService] Unexpected error building keyword index after install:', error);
    });
  }

  /**
   * Awaited manual rebuild - the backend for the design doc §5.3 "Rebuild"
   * action. Unlike {@link triggerBuildAfterInstall}, this is a user-initiated
   * action with a caller waiting on its result, so it is awaited; but a build
   * failure still never throws out of here - it was already persisted to
   * `keyword_index` by {@link runBuild}, and the caller reads it back via the
   * returned status, the same "failures are reported, not thrown" posture as
   * the post-install hook, just synchronous instead of fire-and-forget.
   *
   * `undefined` when `moduleId` names no installed module. When the module
   * exists but cannot be indexed at all (see {@link KeywordIndexStatusDto}'s
   * `'unavailable'` states), this reports that status directly rather than
   * attempting - and silently no-op'ing inside - a build.
   *
   * `signal`, when given, is threaded straight through to
   * `SidecarFts5Provider.build()`. Nothing in this pass wires up a "cancel"
   * button that would supply one - the rebuild IPC handler always omits it -
   * but accepting it here means that button, when it exists, needs no change
   * to this method: it is the same interruptible/restartable build F6
   * designed, exercised end to end by
   * `KeywordIndexService.test.ts`'s aborted-build case.
   */
  async rebuildForModule(moduleId: number, signal?: AbortSignal): Promise<KeywordIndexStatusDto | undefined> {
    const module = this.moduleMetadataRepo.getById(moduleId);
    if (!module) return undefined;

    const status = this.statusFor(module);
    if (status.state === 'unavailable') return status;

    try {
      await this.runBuild(
        {
          moduleType: module.moduleType,
          absoluteDatabasePath: resolveModulePath(module.databasePath),
        },
        signal
      );
    } catch (error) {
      log.warn(`[KeywordIndexService] Rebuild failed for module ${moduleId}:`, error);
    }

    return this.statusFor(module);
  }

  /**
   * Delete this module's index - both the `.kwi` artifact (via
   * `SidecarFts5Provider.prune`) and the `keyword_index` row - and leave no
   * orphan of either kind. The backend for the design doc §5.3 "Delete index"
   * action. `undefined` when `moduleId` names no installed module.
   */
  async deleteIndexForModule(moduleId: number): Promise<KeywordIndexStatusDto | undefined> {
    const module = this.moduleMetadataRepo.getById(moduleId);
    if (!module) return undefined;

    if (module.moduleUuid) {
      await this.pruneIndex(module.moduleUuid, module.moduleType);
    }
    return this.statusFor(module);
  }

  /**
   * Remove one module's index - both the `.kwi` artifact and the
   * `keyword_index` row - keyed directly by `moduleUuid`/`moduleType` rather
   * than `moduleId`. This is the primitive {@link deleteIndexForModule} calls,
   * and is also called directly by `InstallationService.uninstallModule`,
   * which already has both values in hand from the `module_metadata` row it
   * read before deleting it - F8's own acceptance criterion is "uninstall
   * leaves no orphan index and no open handle."
   *
   * `moduleType` is required (not resolved internally) precisely so both
   * callers stay simple: `SidecarFts5Provider.prune()`'s file-naming
   * (`fileStem()`) and support check (`unsupportedReason()`) key ONLY on
   * `target.moduleUuid` and `target.contentSha256` - `target.moduleType` is
   * written into a built `.kwi`'s `kwi_meta.source` at build time but never
   * read back by `prune()` or `status()` - so a caller that genuinely has no
   * `module_metadata` row to read it from (none exists in this app today) may
   * safely pass any valid `ModuleType`; this method does not need to guess
   * one on a caller's behalf.
   */
  async pruneIndex(moduleUuid: string, moduleType: ModuleType): Promise<void> {
    const record = this.keywordIndexRepo.get(moduleUuid, SIDECAR_FTS5_PROVIDER_ID);

    // Clear the durable record unconditionally - a caller relies on "no
    // keyword_index row" as the after-state whether or not there was
    // anything on disk to prune.
    this.keywordIndexRepo.delete(moduleUuid, SIDECAR_FTS5_PROVIDER_ID);

    if (!record) return;

    await this.provider.prune({ moduleUuid, moduleType, contentSha256: record.contentSha256 });
  }

  /**
   * Build (or rebuild) one module's index, and mirror every outcome into
   * `keyword_index`. Shared by {@link triggerBuildAfterInstall} and
   * {@link rebuildForModule} - the only difference between them is whether the
   * caller awaits this.
   *
   * The `keyword_index` row is written to `'building'` BEFORE `provider
   * .build()` starts (so a status read mid-build reports `building`, not
   * `unbuilt`), and to a terminal state afterward:
   *
   *   - success -> `'ready'`, with `doc_count`/`size_bytes`/`built_at` filled in.
   *   - {@link SidecarIndexBuildAbortedError} -> the row is DELETED, not set to
   *     an explicit `'unbuilt'` state - design doc §4.4 places an interrupted
   *     build in the `unbuilt` row, and "no row" is exactly what
   *     {@link statusFor} already reports as `unbuilt`. The module's own
   *     content is entirely unaffected either way - nothing here ever touches
   *     the module file itself, only the separate `.kwi`/`keyword_index`
   *     record - which is the concrete shape of design doc §5.1's "never a
   *     gate on reading" for an interrupted build specifically.
   *   - any other error (including a genuine {@link SidecarIndexBuildError}) ->
   *     `'failed'`, with `error` set and `doc_count`/`size_bytes`/`built_at`
   *     cleared (an earlier successful build's `.kwi` is untouched on disk -
   *     `build()` writes to `.part` and only renames on success - but this
   *     REBUILD attempt did not produce a new one, so the row should not
   *     claim it did).
   *
   * `module.moduleType` carrying no indexable content (see
   * {@link repositoryForIndexing}) is not an error: the method returns with no
   * row written at all, same as if it had never been called.
   */
  private async runBuild(
    module: { moduleType: ModuleType; absoluteDatabasePath: string },
    signal?: AbortSignal
  ): Promise<void> {
    const db = new SqliteProvider(module.absoluteDatabasePath, { readonly: true });
    let repo: { getIndexSource(): IIndexSource } | null;
    try {
      repo = repositoryForIndexing(module.moduleType, db);
    } catch (error) {
      db.close();
      throw error;
    }

    if (!repo) {
      db.close();
      return;
    }

    try {
      const source = repo.getIndexSource();
      const target = source.target;

      this.keywordIndexRepo.upsert({
        moduleUuid: target.moduleUuid,
        providerId: SIDECAR_FTS5_PROVIDER_ID,
        contentSha256: target.contentSha256,
        state: 'building',
        tokenizer: SIDECAR_TOKENIZER,
        docCount: null,
        sizeBytes: null,
        builtAt: null,
        error: null,
      });

      let lastDone = 0;
      try {
        await this.provider.build(
          source,
          (done) => {
            lastDone = done;
          },
          signal
        );
      } catch (error) {
        if (error instanceof SidecarIndexBuildAbortedError) {
          this.keywordIndexRepo.delete(target.moduleUuid, SIDECAR_FTS5_PROVIDER_ID);
          return;
        }

        const reason = error instanceof SidecarIndexBuildError ? error.reason : describeError(error);
        this.upsertFailed(target.moduleUuid, target.contentSha256, reason);
        log.warn(
          `[KeywordIndexService] Keyword-index build failed for module ${target.moduleUuid}: ${reason}`
        );
        return;
      }

      const sizeBytes = statSizeSafe(this.provider.kwiPathFor(target));
      this.keywordIndexRepo.upsert({
        moduleUuid: target.moduleUuid,
        providerId: SIDECAR_FTS5_PROVIDER_ID,
        contentSha256: target.contentSha256,
        state: 'ready',
        tokenizer: SIDECAR_TOKENIZER,
        docCount: lastDone,
        sizeBytes,
        builtAt: new Date().toISOString(),
        error: null,
      });
      log.info(`[KeywordIndexService] Built keyword index for module ${target.moduleUuid} (${lastDone} docs)`);
    } finally {
      db.close();
    }
  }

  private upsertFailed(moduleUuid: string, contentSha256: string, reason: string): void {
    this.keywordIndexRepo.upsert({
      moduleUuid,
      providerId: SIDECAR_FTS5_PROVIDER_ID,
      contentSha256,
      state: 'failed',
      tokenizer: SIDECAR_TOKENIZER,
      docCount: null,
      sizeBytes: null,
      builtAt: null,
      error: reason,
    });
  }
}
