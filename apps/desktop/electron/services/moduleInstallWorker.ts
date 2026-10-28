/**
 * Worker-thread entry that runs the conformance gate for a module being
 * installed.
 *
 * The gate opens the (untrusted, possibly hundreds of MB) module file with a
 * synchronous SQLite driver and scans its verse table. On the main thread that
 * freezes every window for as long as the scan takes, so it runs here instead.
 * Built as its own entry next to `out/main/index.js` (see `electron.vite.config.ts`);
 * `runValidationInWorker.ts` is the main-process side.
 */
import { parentPort } from 'worker_threads';
import { validateModuleFileForInstall } from './moduleInstallValidation';

export interface ValidationRequest {
  id: number;
  dbPath: string;
  /** book number -> verse count per chapter, from main.db (empty = skip the canon check). */
  canon: Array<[number, number[]]>;
}

parentPort?.on('message', (msg: ValidationRequest) => {
  try {
    const result = validateModuleFileForInstall(msg.dbPath, new Map(msg.canon));
    parentPort?.postMessage({ id: msg.id, ok: true, result });
  } catch (error) {
    parentPort?.postMessage({ id: msg.id, ok: false, message: error instanceof Error ? error.message : String(error) });
  }
});
