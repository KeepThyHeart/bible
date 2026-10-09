/**
 * Test harness for `MemoryService`: a real sqlite store, a mock host `bible`,
 * and a fake `emit` that records what the service pushed.
 */

import { createMockApi, MODULE_KJV } from '@bible/extension-testing';
import type { ISpeechApi } from '@bible/core/speech';

import { MemoryService } from '../../src/core/service';
import type { MemoryServiceOptions } from '../../src/core/service';
import type { MemoryApi, MemoryPush } from '../../src/core/api';
import type { IRemindersApi, MemorySql } from '../../src/core/ports';
import type { PanelRequest } from '../../src/core/types';
import { createMemoryTestDb } from './sqlite';
import type { MemoryTestDb } from './sqlite';

export { MODULE_KJV };

export interface StartOptions {
  /** Overrides for the mock host's `bible` (as `createMockApi({ bible })`). */
  bible?: Record<string, unknown>;
  speech?: ISpeechApi;
  reminders?: IRemindersApi;
  /** A pre-seeded database, or one wrapped to inject failures. */
  db?: MemoryTestDb;
  sql?: MemorySql;
  openApp?: MemoryServiceOptions['openApp'];
  openSettings?: MemoryServiceOptions['openSettings'];
  log?: MemoryServiceOptions['log'];
  now?: () => number;
}

const started: MemoryService[] = [];

/** Dispose every service started by `startTestService` (call from `afterEach`). */
export function disposeAll(): void {
  while (started.length) started.pop()!.dispose();
}

export const quietLog = { warn: () => undefined, error: () => undefined };

export async function startTestService(o: StartOptions = {}) {
  const db = o.db ?? createMemoryTestDb();
  const mockApi = createMockApi({ bible: { listModules: async () => [MODULE_KJV], ...(o.bible ?? {}) } });
  const pushes: MemoryPush[] = [];
  const svc = await MemoryService.start({
    sql: o.sql ?? db.sql,
    host: { bible: mockApi.bible, speech: o.speech, reminders: o.reminders },
    emit: (p) => void pushes.push(p),
    openApp: o.openApp,
    openSettings: o.openSettings,
    log: o.log ?? quietLog,
    ...(o.now ? { now: o.now } : {}),
  });
  started.push(svc);
  return {
    svc,
    db,
    sql: db.sql,
    pushes,
    notices: () => pushes.flatMap((p) => (p.type === 'notice' ? [p.message] : [])),
  };
}

/** Run a former panel request as the matching method call. */
export function call<T>(svc: MemoryApi, req: PanelRequest): Promise<T> {
  const { type, ...args } = req as { type: keyof MemoryApi } & Record<string, unknown>;
  const method = svc[type] as unknown as (a?: unknown) => Promise<T>;
  return method.call(svc, Object.keys(args).length > 0 ? args : undefined);
}
