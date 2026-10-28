/**
 * Main-process side of the install worker: runs the module conformance gate in
 * a worker thread, and falls back to running it in this thread when the worker
 * file is absent (unit tests, unusual packaging) or cannot start.
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { Worker } from 'worker_threads';
import { validateModuleFileForInstall } from './moduleInstallValidation';

export const INSTALL_WORKER_FILE = 'module-install-worker.js';

export type ValidationOutcome = { ok: boolean; errors: string[]; warnings: string[] };

export function runValidationInWorker(
  dbPath: string,
  canon: Map<number, number[]>,
  workerDir: string = __dirname
): Promise<ValidationOutcome> {
  const workerPath = join(workerDir, INSTALL_WORKER_FILE);
  const inThread = (): ValidationOutcome => validateModuleFileForInstall(dbPath, canon);
  if (!existsSync(workerPath)) return Promise.resolve(inThread());

  return new Promise<ValidationOutcome>((resolve, reject) => {
    let settled = false;
    let worker: Worker;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      void worker?.terminate();
      fn();
    };
    // A worker that cannot start or dies must not make installs impossible.
    const fallback = (): void => finish(() => {
      try {
        resolve(inThread());
      } catch (e) {
        reject(e);
      }
    });
    try {
      worker = new Worker(workerPath);
    } catch {
      settled = false;
      resolve(inThread());
      return;
    }
    worker.once('message', (msg: { ok: boolean; result?: ValidationOutcome; message?: string }) => {
      finish(() => (msg.ok && msg.result ? resolve(msg.result) : reject(new Error(msg.message ?? 'Module validation failed'))));
    });
    worker.once('error', fallback);
    worker.once('exit', (code) => {
      if (code !== 0) fallback();
    });
    worker.postMessage({ id: 1, dbPath, canon: [...canon.entries()] });
  });
}
