/**
 * Worker repo `memory` (S3, design §5): every `MEMORY_API_METHODS` key, each awaiting a lazily started
 * `MemoryService` over the worker's sqlPort; the Bible port calls back to the leader tab via `ctx.hostCall('memory.bible', …)`.
 * A failed start is retried on the next call. `repos.ts` calls `[REPO_DISPOSE]()` (if present) on wipe.
 * No speech, reminders or legacy import on web. No side effects at module load.
 */
import type { Sync } from '@bible/core/browser';
import { MemoryService, createSqlPort, installMemorySchema } from '@bible/memory/core';
import type { MemoryBibleApi } from '@bible/memory/core';
import { MEMORY_API_METHODS } from '@bible/memory/api';
import type { MemoryApi } from '@bible/memory/api';
import type { RepoCtx } from './handler';
import { REPO_DISPOSE } from './repos';

/** The Bible port: every method is a call to the leader tab's main thread. */
function bibleProxy(ctx: RepoCtx): MemoryBibleApi {
  const call = (method: string) => (...args: unknown[]) => ctx.hostCall('memory.bible', method, args);
  return {
    getRange: call('getRange'),
    listModules: call('listModules'),
    listBooks: call('listBooks'),
    listChapters: call('listChapters'),
    parseReference: call('parseReference'),
    navigateToVerse: call('navigateToVerse'),
  } as unknown as MemoryBibleApi;
}

export function createMemoryRepo(sql: Sync.ISql, ctx: RepoCtx): MemoryApi {
  let service: Promise<MemoryService> | undefined;

  const ensure = (): Promise<MemoryService> => {
    if (!service) {
      const starting = (async () => {
        installMemorySchema(sql as never);
        return MemoryService.start({
          sql: createSqlPort(sql as never),
          host: { bible: bibleProxy(ctx) },
          emit: (push) => ctx.emit({ event: 'memoryPush', push }),
          log: console,
        });
      })();
      service = starting;
      starting.catch(() => {
        if (service === starting) service = undefined; // retry on the next call
      });
    }
    return service;
  };

  const repo: Record<PropertyKey, unknown> = {};
  for (const method of MEMORY_API_METHODS) {
    repo[method] = async (...args: unknown[]) => {
      const svc = await ensure();
      return (svc as unknown as Record<string, (...a: unknown[]) => unknown>)[method]!.apply(svc, args);
    };
  }
  Object.defineProperty(repo, REPO_DISPOSE, {
    value: () => {
      const current = service;
      service = undefined;
      current?.then((svc) => svc.dispose(), () => undefined);
    },
  });
  return repo as unknown as MemoryApi;
}
