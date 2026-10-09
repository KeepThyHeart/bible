/**
 * Express `trust proxy` wiring (task 0150).
 *
 * Behind a reverse proxy, `req.ip` is the proxy's address unless Express is told to trust the
 * forwarded header. The rate limiters and the sync server's per-IP limits key on `req.ip`.
 *
 * `server.trustProxy` in site-config.json sets it explicitly (boolean, hop count or subnet list).
 * Left unset, the host keeps the behaviour it had before the setting existed (`true`) so an existing
 * deployment behind Apache or nginx does not suddenly see every client as one address. Flip
 * `UNSET_TRUST_PROXY` to `false` to make "off" the default.
 */

import type { Express } from 'express';
import type { TrustProxySetting } from './SiteConfig.js';

export const UNSET_TRUST_PROXY: TrustProxySetting = true;

/** Sets `trust proxy` on the app and returns the value applied. */
export function applyTrustProxy(app: Pick<Express, 'set'>, configured: TrustProxySetting | undefined): TrustProxySetting {
  const value = configured === undefined ? UNSET_TRUST_PROXY : configured;
  app.set('trust proxy', value);
  return value;
}
