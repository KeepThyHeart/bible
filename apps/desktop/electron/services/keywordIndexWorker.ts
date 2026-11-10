/**
 * Worker-thread entry that builds one module's keyword index (`.kwi`), so the
 * seconds of synchronous FTS5 work a large module takes never run on the main
 * process, where they froze every window (see `keywordIndexBuild.ts` for the
 * measurements). Built as its own entry next to `out/main/index.js` (see
 * `electron.vite.config.ts`); `runKeywordIndexBuild.ts` is the main-process side.
 *
 * Protocol (one build per worker):
 *   in:  { type: 'build', request }   then optionally { type: 'abort' }
 *   out: { type: 'start', target }, { type: 'progress', done, total }*,
 *        then exactly one { type: 'result', outcome } or { type: 'error', message }
 */
import { parentPort } from 'worker_threads';
import { buildKeywordIndexFile } from './keywordIndexBuild';
import type { KeywordIndexBuildOutcome, KeywordIndexBuildRequest, KeywordIndexBuildTarget } from './keywordIndexBuild';

export type KeywordIndexWorkerInbound = { type: 'build'; request: KeywordIndexBuildRequest } | { type: 'abort' };

export type KeywordIndexWorkerOutbound =
  | { type: 'start'; target: KeywordIndexBuildTarget }
  | { type: 'progress'; done: number; total: number }
  | { type: 'result'; outcome: KeywordIndexBuildOutcome }
  | { type: 'error'; message: string };

const controller = new AbortController();
const post = (msg: KeywordIndexWorkerOutbound): void => parentPort?.postMessage(msg);

parentPort?.on('message', (msg: KeywordIndexWorkerInbound) => {
  if (msg.type === 'abort') {
    controller.abort();
    return;
  }
  if (msg.type !== 'build') return;
  buildKeywordIndexFile(
    msg.request,
    {
      onStart: (target) => post({ type: 'start', target }),
      onProgress: (done, total) => post({ type: 'progress', done, total }),
    },
    controller.signal
  ).then(
    (outcome) => post({ type: 'result', outcome }),
    (error: unknown) => post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  );
});
