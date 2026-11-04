/**
 * The accounts server module's route file: the end-to-end encrypted sync API at `/api/sync/v1`.
 *
 * Mounted only while the `accounts` module is on (flag `accounts`, which needs `localUserDb`; see
 * `serverModules.ts`). With it off this file is never imported and `/api/sync/*` answers "not available".
 *
 * Settings come from the site config's `accounts` block (`extra.accountsSettings`). The routes mount
 * after the password gate like every other module's.
 *
 * Body parsing: the push (up to 8 MiB) is parsed by the sync router's own parser, which runs after the
 * router's per-IP limit and origin check. No host-level parser is registered for it (that would read up to
 * 9 MB from anyone before any check); instead the push path is declared self-parsed so the host's 100 kB
 * global parser skips it. Everything else under the prefix keeps its small limit.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { registerRoute, registerSelfParsedPath } from '../../routes/routeRegistry.js';
import type { AccountsSettings, TrustProxySetting } from '../../SiteConfig.js';
import { logger } from '../../utils/logger.js';
import { createAccounts } from './createAccounts.js';
import type { AccountsInstance } from './createAccounts.js';
import { AccountsConfigError } from './syncOptions.js';

/** `SYNC_API_PREFIX` of @bible/core (a test asserts they agree). */
export const SYNC_PREFIX = '/api/sync/v1';
export const PUSH_PATH = `${SYNC_PREFIX}/push`;

registerSelfParsedPath(PUSH_PATH);

let instance: AccountsInstance | undefined;
let exitHookInstalled = false;

function unavailable(message: string): Router {
  const r = Router();
  r.use((_req: Request, res: Response) => {
    res.status(503).set('Cache-Control', 'no-store').json({ error: 'unavailable', message });
  });
  return r;
}

/** Test hook: stop and forget the running instance. */
export function resetAccountsInstance(): void {
  instance?.close();
  instance = undefined;
}

registerRoute({
  path: SYNC_PREFIX,
  createRoutes: (deps) => {
    const settings = deps.extra.accountsSettings as AccountsSettings | undefined;
    const appStateDir = String(deps.extra.appStateDir ?? '');
    try {
      if (!settings) throw new AccountsConfigError('the accounts settings were not provided');
      if (!appStateDir) throw new AccountsConfigError('the app state directory was not provided');
      resetAccountsInstance();
      instance = createAccounts({ settings, appStateDir, trustProxy: deps.extra.trustProxy as TrustProxySetting | undefined });
      if (!exitHookInstalled) {
        exitHookInstalled = true;
        process.once('exit', () => instance?.close());
      }
      logger.info(`Accounts enabled; sync API at ${SYNC_PREFIX}`);
      return instance.router;
    } catch (err) {
      // A misconfigured sync server must not take the whole site down.
      const message = err instanceof AccountsConfigError ? err.message : 'the sync server could not start (see the server log)';
      logger.error(`Accounts enabled but not started: ${err instanceof Error ? err.message : 'error'}`);
      return unavailable(`Accounts are enabled but not available: ${message}`);
    }
  },
});
