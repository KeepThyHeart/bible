/**
 * Worker-thread entry that runs Argon2id for backups.
 *
 * The key derivation takes a few hundred milliseconds and 64 MiB of memory;
 * running it here keeps the main process responsive to every window meanwhile.
 * Built as its own entry next to `out/main/index.js` (see `electron.vite.config.ts`).
 */
import { parentPort } from 'worker_threads';
import { Crypto } from '@bible/core/browser';

interface KdfRequest {
  id: number;
  password: string;
  params: { m: number; t: number; p: number; salt: Uint8Array };
}

parentPort?.on('message', (msg: KdfRequest) => {
  const { id, password, params } = msg;
  Crypto.argon2id(password, { id: 'argon2id', v: 19, m: params.m, t: params.t, p: params.p, salt: params.salt }, 32)
    .then((out) => parentPort?.postMessage({ id, ok: true, out }))
    .catch((err: unknown) => parentPort?.postMessage({ id, ok: false, message: err instanceof Error ? err.message : String(err) }));
});
