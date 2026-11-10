/**
 * The main-process side of the keyword-index worker: progress and the target
 * reach the caller as the worker reports them, cancel reaches the worker, and
 * a worker that dies is reported as a failed build rather than hanging.
 * The worker is a fake (`createWorker`), so no native SQLite is needed.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('../keywordIndexBuild', () => ({
  buildKeywordIndexFile: vi.fn(async () => ({ kind: 'nothing-to-index' })),
}));

import { runKeywordIndexBuild } from '../runKeywordIndexBuild';
import type { KeywordIndexWorkerInbound, KeywordIndexWorkerOutbound } from '../keywordIndexWorker';
import { buildKeywordIndexFile } from '../keywordIndexBuild';

class FakeWorker extends EventEmitter {
  posted: KeywordIndexWorkerInbound[] = [];
  terminated = false;
  postMessage(msg: KeywordIndexWorkerInbound): void {
    this.posted.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
  send(msg: KeywordIndexWorkerOutbound): void {
    this.emit('message', msg);
  }
}

const request = { moduleType: 'commentary' as const, absoluteDatabasePath: '/m/commentary_gill.db', indexDir: '/idx' };
const target = { moduleUuid: 'u-1', contentSha256: 'c'.repeat(64) };

describe('runKeywordIndexBuild', () => {
  it('runs the build in the worker and relays start, progress and the result', async () => {
    const worker = new FakeWorker();
    const onStart = vi.fn();
    const onProgress = vi.fn();
    const done = runKeywordIndexBuild(request, { onStart, onProgress }, undefined, { createWorker: () => worker });

    expect(worker.posted).toEqual([{ type: 'build', request }]);
    worker.send({ type: 'start', target });
    worker.send({ type: 'progress', done: 2000, total: 6000 });
    worker.send({ type: 'progress', done: 4000, total: 6000 });
    worker.send({ type: 'result', outcome: { kind: 'built', target, docCount: 6000, sizeBytes: 123 } });

    await expect(done).resolves.toEqual({ kind: 'built', target, docCount: 6000, sizeBytes: 123 });
    expect(onStart).toHaveBeenCalledWith(target);
    expect(onProgress.mock.calls).toEqual([[2000, 6000], [4000, 6000]]);
    expect(worker.terminated).toBe(true);
    expect(buildKeywordIndexFile).not.toHaveBeenCalled();
  });

  it('forwards a cancel to the worker, which stops at its next batch', async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const done = runKeywordIndexBuild(request, {}, controller.signal, { createWorker: () => worker });
    worker.send({ type: 'start', target });

    controller.abort();
    expect(worker.posted).toContainEqual({ type: 'abort' });
    worker.send({ type: 'result', outcome: { kind: 'aborted', target } });

    await expect(done).resolves.toEqual({ kind: 'aborted', target });
  });

  it('terminates a worker that ignores the cancel and reports the build aborted', async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const controller = new AbortController();
      const done = runKeywordIndexBuild(request, {}, controller.signal, { createWorker: () => worker, abortGraceMs: 1000 });
      worker.send({ type: 'start', target });
      controller.abort();
      vi.advanceTimersByTime(1000);
      await expect(done).resolves.toEqual({ kind: 'aborted', target });
      expect(worker.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a worker that dies mid-build as a failed build', async () => {
    const worker = new FakeWorker();
    const done = runKeywordIndexBuild(request, {}, undefined, { createWorker: () => worker });
    worker.send({ type: 'start', target });
    worker.emit('exit', 1);
    await expect(done).resolves.toEqual({
      kind: 'failed',
      target,
      reason: 'Keyword index build stopped unexpectedly (exit code 1)',
    });
  });

  it('rejects when the worker dies before it could open the module', async () => {
    const worker = new FakeWorker();
    const done = runKeywordIndexBuild(request, {}, undefined, { createWorker: () => worker });
    worker.send({ type: 'error', message: 'unable to open database file' });
    await expect(done).rejects.toThrow('unable to open database file');
  });

  it('builds in this thread when there is no worker file (unit tests, unusual packaging)', async () => {
    await expect(runKeywordIndexBuild(request, {}, undefined, { workerDir: '/definitely/not/here' })).resolves.toEqual({
      kind: 'nothing-to-index',
    });
    expect(buildKeywordIndexFile).toHaveBeenCalledTimes(1);
  });
});
