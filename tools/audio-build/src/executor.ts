/** Where chapter tasks run: this thread (`--jobs=1`, tests) or a pool of worker threads, one engine each. */

import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { runChapterTask, type ChapterResult, type ChapterTask } from './chapterTask';
import type { ITtsEngine } from './core';
import type { EngineContext } from './engines/types';

export interface Executor {
  run(task: ChapterTask): Promise<ChapterResult>;
  close(): Promise<void>;
}

/** Runs tasks one after another with one engine. */
export class InProcessExecutor implements Executor {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly ctrl = new AbortController();
  constructor(private readonly engine: ITtsEngine) {}
  run(task: ChapterTask): Promise<ChapterResult> {
    const p = this.chain.then(() => runChapterTask(this.engine, task, this.ctrl.signal));
    this.chain = p.catch(() => undefined);
    return p;
  }
  async close(): Promise<void> { this.ctrl.abort(); this.engine.dispose(); }
}

export interface WorkerInit { engineId: string; voice: string; ctx: Omit<EngineContext, 'log'> }
type FromWorker =
  | { type: 'ready' }
  | { type: 'log'; message: string }
  | { type: 'result'; result: ChapterResult }
  | { type: 'fatal'; error: string };

/** A pool of worker threads, each with its own engine (so its own copy of the model in memory). */
export class WorkerPool implements Executor {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly waiting: Array<(w: Worker) => void> = [];
  private readonly pending = new Map<Worker, { resolve(r: ChapterResult): void; task: ChapterTask }>();
  private closed = false;

  private constructor(private readonly log: (m: string) => void) {}

  static async start(count: number, init: WorkerInit, log: (m: string) => void): Promise<WorkerPool> {
    const pool = new WorkerPool(log);
    await Promise.all(Array.from({ length: count }, () => pool.spawn(init)));
    return pool;
  }

  private spawn(init: WorkerInit): Promise<void> {
    return new Promise((resolve, reject) => {
      const w = new Worker(join(__dirname, 'worker.js'), { workerData: init });
      let ready = false;
      w.on('message', (m: FromWorker) => {
        if (m.type === 'ready') { ready = true; this.workers.push(w); this.release(w); resolve(); }
        else if (m.type === 'log') this.log(m.message);
        else if (m.type === 'fatal') { const e = new Error(m.error); if (!ready) reject(e); else this.failPending(w, m.error); }
        else if (m.type === 'result') {
          const p = this.pending.get(w);
          this.pending.delete(w);
          p?.resolve(m.result);
          this.release(w);
        }
      });
      w.on('error', e => { if (!ready) reject(e); else this.failPending(w, e.message); });
      w.on('exit', code => { if (!ready) reject(new Error(`A worker exited with code ${code} before it was ready.`)); else if (!this.closed) this.failPending(w, `A worker exited with code ${code}.`); });
    });
  }

  private failPending(w: Worker, error: string): void {
    const p = this.pending.get(w);
    this.pending.delete(w);
    p?.resolve({ book: p.task.book, chapter: p.task.chapter, ok: false, error, audioSeconds: 0, synthSeconds: 0, encodeSeconds: 0, bytes: 0 });
  }

  private release(w: Worker): void {
    const next = this.waiting.shift();
    if (next) next(w); else this.idle.push(w);
  }

  private acquire(): Promise<Worker> {
    const w = this.idle.pop();
    return w ? Promise.resolve(w) : new Promise(r => this.waiting.push(r));
  }

  async run(task: ChapterTask): Promise<ChapterResult> {
    const w = await this.acquire();
    return new Promise(resolve => {
      this.pending.set(w, { resolve, task });
      w.postMessage({ type: 'task', task });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(this.workers.map(w => w.terminate()));
  }
}
