/**
 * The keyword-index build itself (F8): open a module read-only, stream its
 * documents into a `.kwi` sidecar through `SidecarFts5Provider`, and report
 * what happened. No Electron imports and no `main.db` access, so the same code
 * runs in the keyword-index worker thread (`keywordIndexWorker.ts`) and, when
 * that worker is unavailable, in the calling thread.
 *
 * Why a worker: building the index of a large module is seconds of synchronous
 * SQLite work. Measured in this repo with the in-thread build, the event loop
 * was stalled for 3.5 s of a 4.3 s build of Gill's commentary and for 23 s of
 * a 27 s build of Matthew Henry's (one single stall of 3.4 s, the FTS5
 * `optimize` + `VACUUM` at the end). On the main process that is every window
 * frozen, because no IPC is served while it runs.
 *
 * Writing the outcome into `main.db`'s `keyword_index` table stays with the
 * caller (`KeywordIndexService`), on the main thread, which owns that
 * connection.
 */
import * as fs from 'fs';
import type { ISql, ModuleType, IIndexSource, SidecarDatabaseOpener, ICodecRegistry, IModuleRepositoryFactory } from '@bible/core';
import {
  SidecarFts5Provider,
  SidecarIndexBuildError,
  SidecarIndexBuildAbortedError,
  SqliteModuleRepositoryFactory,
  nodeCodecRegistry,
  wrapSqlConnection,
} from '@bible/core';
import { SqliteProvider } from '../providers/SqliteProvider';

const repositoryFactory: IModuleRepositoryFactory = new SqliteModuleRepositoryFactory();
const indexingCodecs: ICodecRegistry = nodeCodecRegistry();

export const openSidecarDatabase: SidecarDatabaseOpener = (filePath, options) =>
  new SqliteProvider(filePath, { readonly: options.readonly, fileMustExist: !options.create });

/**
 * The repository whose `getIndexSource()` feeds the build, or `null` for a
 * module type with nothing to index (`cross_reference`, `tag_graph`,
 * `devotional`).
 */
export function repositoryForIndexing(moduleType: ModuleType, db: ISql): { getIndexSource(): IIndexSource } | null {
  const conn = wrapSqlConnection(db);
  switch (moduleType) {
    case 'bible':
      return repositoryFactory.create(conn, 'bible', indexingCodecs);
    case 'commentary':
      return repositoryFactory.create(conn, 'commentary', indexingCodecs);
    case 'dictionary':
    case 'lexicon':
      return repositoryFactory.create(conn, 'dictionary', indexingCodecs);
    case 'book':
      return repositoryFactory.create(conn, 'book', indexingCodecs);
    case 'topical_index':
      return repositoryFactory.create(conn, 'topicalIndex', indexingCodecs);
    case 'cross_reference':
    case 'tag_graph':
    case 'devotional':
    default:
      return null;
  }
}

export interface KeywordIndexBuildRequest {
  moduleType: ModuleType;
  absoluteDatabasePath: string;
  indexDir: string;
}

/** Identity of the index being built, known once the module has been opened. */
export interface KeywordIndexBuildTarget {
  moduleUuid: string;
  contentSha256: string;
}

export type KeywordIndexBuildOutcome =
  | { kind: 'nothing-to-index' }
  | { kind: 'built'; target: KeywordIndexBuildTarget; docCount: number; sizeBytes: number | null }
  | { kind: 'aborted'; target: KeywordIndexBuildTarget }
  | { kind: 'failed'; target: KeywordIndexBuildTarget; reason: string };

export interface KeywordIndexBuildHooks {
  /** Called once the target is known and before any document is written. */
  onStart?: (target: KeywordIndexBuildTarget) => void;
  onProgress?: (done: number, total: number) => void;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statSizeSafe(filePath: string): number | null {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

/**
 * Build one module's `.kwi`. Throws only when the module cannot be opened at
 * all; every build outcome (built, aborted, failed) is returned.
 */
export async function buildKeywordIndexFile(
  request: KeywordIndexBuildRequest,
  hooks: KeywordIndexBuildHooks = {},
  signal?: AbortSignal
): Promise<KeywordIndexBuildOutcome> {
  const provider = new SidecarFts5Provider({ indexDir: request.indexDir, openDatabase: openSidecarDatabase });
  const db = new SqliteProvider(request.absoluteDatabasePath, { readonly: true });
  try {
    const repo = repositoryForIndexing(request.moduleType, db);
    if (!repo) return { kind: 'nothing-to-index' };

    const source = repo.getIndexSource();
    const target = { moduleUuid: source.target.moduleUuid, contentSha256: source.target.contentSha256 };
    hooks.onStart?.(target);

    let lastDone = 0;
    try {
      await provider.build(
        source,
        (done, total) => {
          lastDone = done;
          hooks.onProgress?.(done, total);
        },
        signal
      );
    } catch (error) {
      if (error instanceof SidecarIndexBuildAbortedError) return { kind: 'aborted', target };
      const reason = error instanceof SidecarIndexBuildError ? error.reason : describeError(error);
      return { kind: 'failed', target, reason };
    }

    return { kind: 'built', target, docCount: lastDone, sizeBytes: statSizeSafe(provider.kwiPathFor(source.target)) };
  } finally {
    db.close();
  }
}
