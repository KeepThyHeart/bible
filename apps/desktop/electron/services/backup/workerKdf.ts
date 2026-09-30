/**
 * Main-process side of the Argon2id worker: a `Backup.KdfFunction` that derives
 * the key in a worker thread, and falls back to deriving it in this thread when
 * the worker file is absent (unit tests, unusual packaging).
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { Worker } from 'worker_threads';
import { Backup, Crypto } from '@bible/core';

export const KDF_WORKER_FILE = 'backup-kdf-worker.js';

export function createWorkerKdf(workerDir: string = __dirname): Backup.KdfFunction {
  const workerPath = join(workerDir, KDF_WORKER_FILE);
  return async (password, params) => {
    // Deriving in this thread blocks the app and holds the memory here; that is acceptable for the
    // default cost (about half a second, 64 MiB) but not for whatever a hostile file asks for.
    const inThreadOk = params.m <= Crypto.DEFAULT_KDF.m;
    if (!existsSync(workerPath)) {
      if (!inThreadOk) throw new Error('Key derivation needs the worker thread, which is not available');
      return Crypto.argon2id(password, params, 32);
    }
    // Validate here too, so hostile parameters are refused before a thread is started.
    Crypto.validateKdfParams(params);
    return new Promise<Uint8Array>((resolve, reject) => {
      const worker = new Worker(workerPath);
      let settled = false;
      const done = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        void worker.terminate();
        fn();
      };
      worker.once('message', (msg: { ok: boolean; out?: Uint8Array; message?: string }) => {
        done(() => (msg.ok && msg.out ? resolve(new Uint8Array(msg.out)) : reject(new Error(msg.message ?? 'Key derivation failed'))));
      });
      // A worker that cannot start or dies (an unusual packaging, an out-of-memory
      // kill) must not make backups impossible: derive in this thread instead.
      const fallback = (): void => {
        if (!inThreadOk) reject(new Error('The key-derivation worker stopped (it may have run out of memory)'));
        else Crypto.argon2id(password, params, 32).then(resolve, reject);
      };
      worker.once('error', () => done(fallback));
      worker.once('exit', (code) => {
        if (code !== 0) done(fallback);
      });
      worker.postMessage({ id: 1, password, params: { m: params.m, t: params.t, p: params.p, salt: params.salt } });
    });
  };
}
