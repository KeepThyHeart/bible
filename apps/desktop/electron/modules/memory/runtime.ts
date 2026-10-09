/**
 * The memory core running in desktop main (task 0114): loaded on the first
 * `module:memory:*` call, never at startup.
 *
 * Start order matters for users' data:
 *   1. the user database is open and the memory tables exist;
 *   2. the one-time import of the old extension database runs, before the
 *      core writes anything (it creates the Default list on first start);
 *   3. the core starts;
 *   4. the old extension is retired (decision 2026-10-07): once its data is
 *      here, a still-enabled copy of it is disabled, so nothing practised
 *      there after the import is left behind, and the user is told once. If
 *      the import was skipped because Memory already had a plan, the
 *      extension is left alone and the user is told once where the manual
 *      import is.
 *
 * A failed import (or a file from a newer extension) is logged, nothing is
 * recorded, and the core does not start (`MemoryImportPendingError`), so the
 * store stays empty and the import is tried again on the next call. The old
 * file is never modified or deleted.
 */

import { existsSync } from 'fs';
import { join } from 'path';

import type { ISql } from '@bible/core';
import type { ISpeechApi } from '@bible/core/speech';
import {
  MemoryService,
  createSqlPort,
  importLegacyMemory,
  mergeLegacyMemory,
  installMemorySchema,
  LEGACY_DB_NAME,
  LEGACY_EXTENSION_ID,
  type LegacyImportResult,
  type IRemindersApi,
  type MemoryBibleApi,
  type MemoryImportResult,
  type MemoryPush,
  type Translate,
} from '@bible/memory/core';
import { readMemoryStatus } from '@bible/memory/status';

import type { ModuleExtensionsPort, ModuleLogger } from '../FeatureMainModule';
import { queueNotice, RETIRED_KEY } from './notices';

export { RETIRED_KEY, RETIRED_NOTICE, SKIPPED_NOTICE, SKIPPED_NOTICE_KEY } from './notices';

/** The core is held back because an existing old database could not be imported (message for the user). */
export class MemoryImportPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryImportPendingError';
  }
}

export interface MemoryRuntimeDeps {
  /** The shared, open user database. */
  getUserDb(): Promise<ISql>;
  /** Where the extension kept its database (`<user data>/extensions/<id>/db/memory.db`). */
  readonly legacyDbPath: string;
  /** Open a database file read-only. */
  openReadOnly(path: string): ISql;
  readonly bible: MemoryBibleApi;
  readonly speech?: ISpeechApi;
  readonly reminders?: IRemindersApi;
  /** The extension host, when it is running (retiring the old extension). */
  getExtensions?(): ModuleExtensionsPort | null;
  emit(push: MemoryPush): void;
  /** Catalog lookup for the messages the core shows (default English). */
  t?: Translate;
  /** Bring the Memory app forward (a notification click while the core runs). */
  openApp?(): void;
  readonly log: ModuleLogger;
  now?(): number;
  /** Retiring re-checks the extension host this often (default `RETIRE_RETRY_MS`). */
  readonly retireRetryMs?: number;
}

export interface MemoryRuntime {
  readonly service: MemoryService;
  readonly importResult: LegacyImportResult;
  dispose(): void;
}

/** Path of the old extension's database under the writable extension root. */
export function legacyMemoryDbPath(extensionsRoot: string): string {
  return join(extensionsRoot, LEGACY_EXTENSION_ID, 'db', `${LEGACY_DB_NAME}.db`);
}

export async function startMemoryRuntime(deps: MemoryRuntimeDeps): Promise<MemoryRuntime> {
  const db = await deps.getUserDb();
  // `initializeUserSchema` already created these when the database opened; repeated here so the
  // runtime never depends on which handler opened the database first. Idempotent.
  installMemorySchema(db);

  // If an old database exists but could not be imported, the core must not start: on first
  // start it creates the Default list, and once the user adds a passage the import would be
  // skipped for good. Refusing keeps the store empty until a build that can read the file runs.
  let importResult: LegacyImportResult;
  try {
    importResult = importLegacyMemory(db, {
      openSource: () => (existsSync(deps.legacyDbPath) ? deps.openReadOnly(deps.legacyDbPath) : null),
      now: deps.now ? deps.now() : Date.now(),
    });
  } catch (err) {
    deps.log.error('[memory] importing the old extension database failed; nothing was changed, it will be retried:', err);
    throw new MemoryImportPendingError('Your Scripture Memory data could not be brought over yet. Nothing was changed; it will be tried again.');
  }
  if (importResult.status === 'unsupported-version') {
    deps.log.warn(`[memory] old extension database is schema v${importResult.sourceVersion}, newer than this build reads`);
    throw new MemoryImportPendingError('Your Scripture Memory data was saved by a newer version. Update the app to bring it over.');
  }
  if (importResult.status === 'imported') {
    deps.log.info('[memory] imported the Scripture Memory extension database', importResult.counts, importResult.dropped);
  } else if (importResult.status === 'skipped-not-empty' || importResult.status === 'not-a-memory-db') {
    deps.log.warn(`[memory] old extension database not imported: ${importResult.status}`);
  }

  const legacyAvailable = () => existsSync(deps.legacyDbPath);
  const retirements: Array<{ cancel(): void }> = [];
  const service = await MemoryService.start({
    sql: createSqlPort(db),
    host: {
      bible: deps.bible,
      ...(deps.speech ? { speech: deps.speech } : {}),
      ...(deps.reminders ? { reminders: deps.reminders } : {}),
    },
    emit: deps.emit,
    ...(deps.t ? { t: deps.t } : {}),
    log: deps.log,
    ...(deps.openApp ? { openApp: deps.openApp } : {}),
    ...(deps.now ? { now: deps.now } : {}),
    legacy: {
      available: legacyAvailable,
      merge: (): MemoryImportResult => {
        const result = mergeLegacyMemory(db, {
          openSource: () => (legacyAvailable() ? deps.openReadOnly(deps.legacyDbPath) : null),
          now: deps.now ? deps.now() : Date.now(),
        });
        deps.log.info('[memory] manual import of the old extension database:', result);
        if (result.status === 'merged') {
          retirements.push(retireLegacyExtension(db, deps, 'merged'));
          return { status: 'merged', added: result.added, matched: result.matched, revived: result.revived };
        }
        return { status: result.status, added: {}, matched: {}, revived: 0 };
      },
    },
  });

  // Before disabling a still-running extension, bring over what was practised in it since the import.
  // Only shortly after the import: later, the user's own removals here could be undone by a merge
  // (a passage removed and purged no longer matches, and would come back as new).
  const catchUp = (): void => {
    if (!legacyAvailable()) return;
    const recordedAt = db.queryOne<{ recorded_at: number }>(
      'SELECT recorded_at FROM memory_import WHERE source = ?',
      [`extension:${LEGACY_EXTENSION_ID}/${LEGACY_DB_NAME}`],
    )?.recorded_at;
    if (recordedAt === undefined || (deps.now ? deps.now() : Date.now()) - recordedAt > CATCH_UP_WINDOW_MS) return;
    const r = mergeLegacyMemory(db, { openSource: () => deps.openReadOnly(deps.legacyDbPath), now: deps.now ? deps.now() : Date.now() });
    if (r.status === 'merged' && (Object.keys(r.added).length > 0 || Object.keys(r.advanced).length > 0)) {
      deps.log.info('[memory] brought over recent practice from the old extension:', r.added, r.advanced);
      deps.emit({ type: 'planChanged' });
    }
  };
  retirements.push(retireLegacyExtension(db, deps, importStatusOf(db), catchUp));

  return {
    service,
    importResult,
    dispose: () => {
      for (const r of retirements) r.cancel();
      service.dispose();
    },
  };
}

function importStatusOf(db: ISql): string | null {
  return db.queryOne<{ status: string }>('SELECT status FROM memory_import WHERE source = ?', [`extension:${LEGACY_EXTENSION_ID}/${LEGACY_DB_NAME}`])?.status ?? null;
}

function isRecorded(db: ISql, source: string): boolean {
  return !!db.queryOne('SELECT 1 AS one FROM memory_import WHERE source = ?', [source]);
}

function recordOnce(db: ISql, source: string, status: string, now: number): boolean {
  return db.execute('INSERT OR IGNORE INTO memory_import (source, status, recorded_at) VALUES (?, ?, ?)', [source, status, now]).changes > 0;
}

/** How often, and how long, retiring waits for the extension host to load (it starts in the background). */
export const RETIRE_RETRY_MS = 5_000;
export const RETIRE_GIVE_UP_MS = 5 * 60_000;
/** Practice in the old extension is brought over before disabling it only this soon after the import. */
export const CATCH_UP_WINDOW_MS = 2 * 24 * 3600_000;

/**
 * Retire the old extension after its data is here (`imported` or `merged`),
 * once per machine:
 *   - enabled: bring over anything practised in it since the import (the
 *     merge is idempotent), disable it, tell the user once;
 *   - installed but already disabled, or not installed: just record it, so a
 *     user who turns it on again later keeps it on.
 * With `skipped-not-empty`, leave it and point the user at the manual import once.
 * Waits (re-checking every few seconds) until the extension host has loaded;
 * never blocks the core and never throws.
 */
export function retireLegacyExtension(
  db: ISql,
  deps: MemoryRuntimeDeps,
  status: string | null,
  catchUp?: () => void,
): { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  const startedAt = Date.now();
  const attempt = (): void => {
    timer = null;
    if (cancelled) return;
    try {
      const extensions = deps.getExtensions?.() ?? null;
      if (!extensions || !extensions.ready()) {
        if (Date.now() - startedAt < RETIRE_GIVE_UP_MS) {
          timer = setTimeout(attempt, deps.retireRetryMs ?? RETIRE_RETRY_MS);
          (timer as { unref?: () => void }).unref?.();
        }
        return;
      }
      const now = deps.now ? deps.now() : Date.now();
      if (status === 'imported' || status === 'merged') {
        if (isRecorded(db, RETIRED_KEY)) return;
        if (!extensions.isEnabled(LEGACY_EXTENSION_ID)) {
          recordOnce(db, RETIRED_KEY, 'not-enabled', now);
          return;
        }
        // Disable first (so nothing more is written there), then bring over what was practised in it
        // since the import, then record and tell the user. A failed disable records nothing: the next
        // start tries again. Not awaited by the core's start.
        void extensions
          .disable(LEGACY_EXTENSION_ID)
          .then(() => {
            deps.log.info('[memory] disabled the old Scripture Memory extension after the import');
            try {
              catchUp?.();
            } catch (err) {
              deps.log.warn('[memory] bringing over recent practice from the old extension failed:', err);
            }
            const at = deps.now ? deps.now() : Date.now();
            // Queued, not pushed: the renderer collects it when a window is visible (a hidden or tray
            // launch must not use it up). The status push tells an open window to look.
            if (recordOnce(db, RETIRED_KEY, 'disabled', at)) {
              queueNotice(db, 'retired', at);
              deps.emit({ type: 'status', status: readMemoryStatus(db, at) });
            }
          })
          .catch((err: unknown) => deps.log.warn('[memory] could not disable the old Scripture Memory extension:', err));
      } else if (status === 'skipped-not-empty') {
        if (!extensions.isEnabled(LEGACY_EXTENSION_ID)) return;
        if (queueNotice(db, 'skipped', now)) deps.emit({ type: 'status', status: readMemoryStatus(db, now) });
      }
    } catch (err) {
      deps.log.warn('[memory] could not retire the old Scripture Memory extension:', err);
    }
  };
  attempt();
  return {
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  };
}
