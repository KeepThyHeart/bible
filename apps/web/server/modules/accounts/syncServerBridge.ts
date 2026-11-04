/**
 * Loads `@bible/sync-server` for the ESM web server. The package is built to CommonJS (`dist/`), so
 * named imports from ESM do not work; this mirrors `server/core.ts` and bridges with `createRequire`.
 *
 * Only the accounts module's route file imports this file, so a disabled module never loads the package.
 * The package name is resolved first (needs `"@bible/sync-server": "workspace:*"` in apps/web/package.json);
 * in a checkout where the dependency is not linked yet it falls back to the workspace build output.
 */

import { createRequire } from 'module';
import type * as SyncServerPackage from '@bible/sync-server';

const require = createRequire(import.meta.url);

function load(): typeof SyncServerPackage {
  try {
    return require('@bible/sync-server') as typeof SyncServerPackage;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw err;
    // Development fallback: <repo>/packages/sync-server/dist, from apps/web/server/modules/accounts.
    return require('../../../../../packages/sync-server/dist/index.js') as typeof SyncServerPackage;
  }
}

const pkg = load();

export const createSyncServer = pkg.createSyncServer;
export const consoleEmailSender = pkg.consoleEmailSender;
export const createSmtpEmailSender = pkg.createSmtpEmailSender;
export type { SyncServerOptions, SyncServer, EmailSender } from '@bible/sync-server';
