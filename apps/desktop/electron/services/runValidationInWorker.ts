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

const VALIDATION_TIMEOUT_MS = 10 * 60_000;

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
    // Only a worker that could not be created at all falls back to this thread.
    // One that started and then died (out of memory, a native crash) while
    // reading an untrusted file must fail the install, not repeat the same read
    // on the main thread where it would take the app down with it.
    try {
      worker = new Worker(workerPath);
    } catch {
      settled = true;
      resolve(inThread());
      return;
    }
    const timer = setTimeout(() => finish(() => reject(new Error('Module validation timed out'))), VALIDATION_TIMEOUT_MS);
    worker.once('message', (msg: { ok: boolean; result?: ValidationOutcome; message?: string }) => {
      clearTimeout(timer);
      finish(() => (msg.ok && msg.result ? resolve(msg.result) : reject(new Error(msg.message ?? 'Module validation failed'))));
    });
    worker.once('error', (e) => {
      clearTimeout(timer);
      finish(() => reject(new Error(`Module validation stopped unexpectedly: ${e instanceof Error ? e.message : String(e)}`)));
    });
    worker.once('exit', (code) => {
      clearTimeout(timer);
      finish(() => reject(new Error(`Module validation stopped unexpectedly (exit code ${code})`)));
    });
    worker.postMessage({ id: 1, dbPath, canon: [...canon.entries()] });
  });
}
