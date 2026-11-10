/**
 * Main-process side of the keyword-index worker: runs one build in a worker
 * thread (`keywordIndexWorker.ts`) so the main process keeps serving IPC - and
 * so every window stays responsive - while a large module is indexed.
 *
 * - Progress: the worker posts `progress` after every batch; it is handed to
 *   `hooks.onProgress` as it arrives.
 * - Cancel: aborting `signal` asks the worker to stop at its next batch
 *   boundary (the same place the in-thread build checked the signal). The
 *   final `optimize`/`VACUUM` cannot be interrupted, so a worker that has not
 *   stopped within `abortGraceMs` is terminated and the build reported aborted.
 *   An interrupted build leaves only a `.part` file, which the next build of
 *   the same module removes before it starts.
 * - Fallback: when the worker file is absent (unit tests, unusual packaging) or
 *   a worker cannot be created at all, the build runs in this thread, exactly
 *   as it did before the worker existed. A worker that started and then died
 *   is reported as a failed build, not retried here.
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { Worker } from 'worker_threads';
import { buildKeywordIndexFile } from './keywordIndexBuild';
import type {
  KeywordIndexBuildHooks,
  KeywordIndexBuildOutcome,
  KeywordIndexBuildRequest,
  KeywordIndexBuildTarget,
} from './keywordIndexBuild';
import type { KeywordIndexWorkerInbound, KeywordIndexWorkerOutbound } from './keywordIndexWorker';

export const KEYWORD_INDEX_WORKER_FILE = 'keyword-index-worker.js';

const DEFAULT_ABORT_GRACE_MS = 30_000;

/** The slice of `worker_threads.Worker` this file uses (a seam for tests). */
export interface KeywordIndexWorkerLike {
  postMessage(message: KeywordIndexWorkerInbound): void;
  on(event: 'message', listener: (message: KeywordIndexWorkerOutbound) => void): unknown;
  on(event: 'error', listener: (error: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  terminate(): unknown;
}

export interface RunKeywordIndexBuildOptions {
  /** Directory holding the worker file. Defaults to this bundle's own directory (`out/main`). */
  workerDir?: string;
  /** Test seam: create the worker. When given, the worker-file check is skipped. */
  createWorker?: (workerPath: string) => KeywordIndexWorkerLike;
  abortGraceMs?: number;
}

export function runKeywordIndexBuild(
  request: KeywordIndexBuildRequest,
  hooks: KeywordIndexBuildHooks = {},
  signal?: AbortSignal,
  options: RunKeywordIndexBuildOptions = {}
): Promise<KeywordIndexBuildOutcome> {
  const workerPath = join(options.workerDir ?? __dirname, KEYWORD_INDEX_WORKER_FILE);
  const inThread = (): Promise<KeywordIndexBuildOutcome> => buildKeywordIndexFile(request, hooks, signal);
  if (!options.createWorker && !existsSync(workerPath)) return inThread();

  let worker: KeywordIndexWorkerLike;
  try {
    worker = options.createWorker ? options.createWorker(workerPath) : new Worker(workerPath);
  } catch {
    return inThread();
  }

  return new Promise<KeywordIndexBuildOutcome>((resolve, reject) => {
    let settled = false;
    let target: KeywordIndexBuildTarget | undefined;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (graceTimer) clearTimeout(graceTimer);
      signal?.removeEventListener('abort', onAbort);
      void worker.terminate();
      fn();
    };

    const died = (why: string): void =>
      finish(() => {
        // Once the target is known the caller has recorded "building"; report a
        // failed build so that record is closed. Before that, nothing was
        // recorded and the caller treats it like a module that cannot be opened.
        if (target) resolve({ kind: 'failed', target, reason: why });
        else reject(new Error(why));
      });

    function onAbort(): void {
      try {
        worker.postMessage({ type: 'abort' });
      } catch {
        /* the exit handler reports the outcome */
      }
      graceTimer = setTimeout(
        () =>
          finish(() => {
            if (target) resolve({ kind: 'aborted', target });
            else reject(new Error('Keyword index build cancelled'));
          }),
        options.abortGraceMs ?? DEFAULT_ABORT_GRACE_MS
      );
    }

    worker.on('message', (msg: KeywordIndexWorkerOutbound) => {
      if (settled) return;
      switch (msg.type) {
        case 'start':
          target = msg.target;
          hooks.onStart?.(msg.target);
          break;
        case 'progress':
          hooks.onProgress?.(msg.done, msg.total);
          break;
        case 'result':
          finish(() => resolve(msg.outcome));
          break;
        case 'error':
          finish(() => reject(new Error(msg.message)));
          break;
      }
    });
    worker.on('error', (error: unknown) =>
      died(`Keyword index build stopped unexpectedly: ${error instanceof Error ? error.message : String(error)}`)
    );
    worker.on('exit', (code: number) => died(`Keyword index build stopped unexpectedly (exit code ${code})`));

    worker.postMessage({ type: 'build', request });
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}
