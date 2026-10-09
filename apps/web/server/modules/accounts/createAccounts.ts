/**
 * Builds the sync server for the web host: its own SQLite file (WAL) and persisted secret under
 * `<appState>/plugin-data/sync`, the router (with an HSTS header when `publicUrl` is https) and the
 * hourly purge. Imported only by `routes.ts`, so a disabled module never loads any of it.
 */

import { mkdirSync } from 'fs';
import { join } from 'path';
import { Router } from 'express';
import type { AccountsSettings } from '../../SiteConfig.js';
import { SqliteProvider } from '../../providers/SqliteProvider.js';
import { logger } from '../../utils/logger.js';
import { consoleEmailSender, createSmtpEmailSender, createSyncServer } from './syncServerBridge.js';
import type { SyncServer } from './syncServerBridge.js';
import { loadOrCreateServerSecret, syncStateDir } from './serverSecret.js';
import { buildEmailSender, buildSyncOptions, parsePublicUrl } from './syncOptions.js';

export const SYNC_DB_FILE = 'sync.db';
export const PURGE_INTERVAL_MS = 60 * 60 * 1000;
/** Strict-Transport-Security for the sync API when `publicUrl` is https (global HSTS belongs to the host). */
export const HSTS_VALUE = 'max-age=31536000';

export interface AccountsInstance {
  router: Router;
  server: SyncServer;
  /** Stops the purge timer and closes the server (and its database). Idempotent. */
  close(): void;
}

export interface CreateAccountsOptions {
  settings: AccountsSettings;
  appStateDir: string;
  /** Test hook: purge interval. */
  purgeIntervalMs?: number;
  /** Test hook: capture log lines instead of the server log. */
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export function createAccounts(o: CreateAccountsOptions): AccountsInstance {
  const log = o.log ?? ((level, message) => logger[level](`[accounts] ${message}`));
  parsePublicUrl(o.settings.publicUrl); // fail on a bad config before touching the disk
  const dir = syncStateDir(o.appStateDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const serverSecret = loadOrCreateServerSecret(dir);
  const email = buildEmailSender(o.settings.email, {
    console: () => consoleEmailSender(),
    smtp: (opts) => createSmtpEmailSender(opts),
  });
  const sql = new SqliteProvider(join(dir, SYNC_DB_FILE));
  const { options, publicUrl } = buildSyncOptions(o.settings, {
    sql,
    serverSecret,
    email,
    log: (level, message) => log(level, message), // meta is dropped on purpose
  });
  let server: SyncServer;
  try {
    server = createSyncServer(options);
  } catch (err) {
    sql.close();
    throw err;
  }

  const router = Router();
  if (publicUrl.protocol === 'https:') {
    router.use((_req, res, next) => {
      res.setHeader('Strict-Transport-Security', HSTS_VALUE);
      next();
    });
  }
  router.use(server.router);

  const timer = setInterval(() => {
    server.purgeExpired().catch((err: unknown) => log('warn', `purge failed: ${err instanceof Error ? err.message : 'error'}`));
  }, o.purgeIntervalMs ?? PURGE_INTERVAL_MS);
  timer.unref();

  let closed = false;
  return {
    router,
    server,
    close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      server.close();
    },
  };
}
