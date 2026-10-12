/**
 * Worker repo `memory` (S3, design §5): every `MEMORY_API_METHODS` key, each awaiting a lazily started
 * `MemoryService` over the worker's sqlPort; the Bible port calls back to the leader tab via `ctx.hostCall('memory.bible', …)`.
 * A failed start is retried on the next call. `repos.ts` calls `[REPO_DISPOSE]()` (if present) on wipe.
 * STUB (C3): signature only; S3 fills the body. No side effects at module load.
 */
import type { Sync } from '@bible/core/browser';
import type { MemoryApi } from '@bible/memory/api';
import type { RepoCtx } from './handler';

export function createMemoryRepo(sql: Sync.ISql, ctx: RepoCtx): MemoryApi {
  void sql;
  void ctx;
  throw new Error('not implemented');
}
