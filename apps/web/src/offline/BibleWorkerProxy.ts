/**
 * Main-thread proxy for the Bible SQLite Web Worker.
 *
 * Provides a promise-based API for opening databases and querying verses.
 * Follows the same pattern as BrowserSearchProxy.
 */

import type { ChapterData, VerseData } from '../types';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export class BibleWorkerProxy {
  private worker: Worker | null = null;
  private requestCounter = 0;
  private pending = new Map<number, PendingRequest>();
  private openModules = new Set<string>();
  private openingModules = new Map<string, Promise<void>>();
  /** Rejecters for in-flight openDb() calls, so a dead worker can settle them. */
  private openWaiters = new Map<string, (reason: Error) => void>();

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('./bibleWorker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.addEventListener('message', (e: MessageEvent) => {
        const msg = e.data;

        if (msg.type === 'dbReady') {
          this.openModules.add(msg.module);
          // Resolve the opening promise if one exists
          const key = msg.module as string;
          // Opening promises are resolved via the pending map using a special key
          return;
        }

        if (msg.type === 'result' || msg.type === 'error') {
          const req = this.pending.get(msg.requestId);
          if (!req) return;
          this.pending.delete(msg.requestId);

          if (msg.type === 'error') {
            req.reject(new Error(msg.message));
          } else {
            req.resolve(msg.data);
          }
        }
      });

      this.worker.addEventListener('error', (err) => {
        const error = new Error(err.message || 'Worker error');

        // Reject all pending requests
        for (const [id, req] of this.pending) {
          req.reject(error);
          this.pending.delete(id);
        }

        // openDb() waits on its own one-off 'message' listener rather than the
        // pending map, so without this it never settles: a wasm CompileError
        // fires 'error' and no message ever arrives. Callers that await it (the
        // server-down fallback in OfflineBibleProvider) then hang the Bible
        // pane on a spinner forever.
        for (const [module, reject] of this.openWaiters) {
          this.openingModules.delete(module);
          reject(error);
        }
        this.openWaiters.clear();

        // Drop the dead worker so the next call can spawn a fresh one instead
        // of posting into a corpse.
        this.worker = null;
      });
    }
    return this.worker;
  }

  private nextRequestId(): number {
    return ++this.requestCounter;
  }

  private request<T>(msg: Record<string, unknown>): Promise<T> {
    const worker = this.ensureWorker();
    const requestId = this.nextRequestId();
    msg.requestId = requestId;

    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      worker.postMessage(msg);
    });
  }

  /**
   * Open a Bible database in the worker from OPFS (no data transfer needed).
   */
  async openDb(module: string): Promise<void> {
    // If already open, skip
    if (this.openModules.has(module)) return;

    // If currently opening, wait for it
    const existing = this.openingModules.get(module);
    if (existing) return existing;

    const promise = new Promise<void>((resolve, reject) => {
      const worker = this.ensureWorker();

      const settle = (): void => {
        worker.removeEventListener('message', onMessage);
        this.openingModules.delete(module);
        this.openWaiters.delete(module);
      };

      const onMessage = (e: MessageEvent) => {
        if (e.data.type === 'dbReady' && e.data.module === module) {
          settle();
          this.openModules.add(module);
          resolve();
        } else if (e.data.type === 'error' && e.data.requestId === -1) {
          settle();
          reject(new Error(e.data.message));
        }
      };
      worker.addEventListener('message', onMessage);

      // Registered so the 'error' handler above can reject this open if the
      // worker dies before answering.
      this.openWaiters.set(module, (reason: Error) => {
        worker.removeEventListener('message', onMessage);
        this.openWaiters.delete(module);
        reject(reason);
      });

      worker.postMessage({ type: 'openDb', module });
    });

    this.openingModules.set(module, promise);
    return promise;
  }

  /**
   * Close a module database in the worker.
   */
  closeDb(module: string): void {
    if (!this.worker) return;
    this.openModules.delete(module);
    this.worker.postMessage({ type: 'closeDb', module });
  }

  isModuleOpen(module: string): boolean {
    return this.openModules.has(module);
  }

  getChapter(module: string, book: number, chapter: number): Promise<ChapterData> {
    return this.request<ChapterData>({ type: 'getChapter', module, book, chapter });
  }

  getVerse(module: string, verseId: number): Promise<VerseData> {
    return this.request<VerseData>({ type: 'getVerse', module, verseId });
  }

  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pending.clear();
    this.openModules.clear();
    this.openingModules.clear();
  }
}
