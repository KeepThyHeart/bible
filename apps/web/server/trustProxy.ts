/**
 * Express `trust proxy` wiring (task 0150).
 *
 * Behind a reverse proxy, `req.ip` is the proxy's address unless Express is told to trust the
 * forwarded header. The rate limiters and the sync server's per-IP limits key on `req.ip`.
 *
 * `server.trustProxy` in site-config.json sets it explicitly (boolean, hop count or subnet list).
 * Left unset, the host uses the `TRUST_PROXY` environment variable, or else `'loopback'`: only a
 * proxy on this machine is trusted, never `true`. With `true`, req.ip is the leftmost
 * X-Forwarded-For entry, which the client writes itself, so anyone could walk past every per-client
 * limit (rate limiter, login lockout, submission and download quotas). The server listens on
 * 127.0.0.1 behind the proxy, so its peer is always loopback.
 */

import type { Express } from 'express';
import type { TrustProxySetting } from './SiteConfig.js';

export const UNSET_TRUST_PROXY: TrustProxySetting = 'loopback';

/** Sets `trust proxy` on the app and returns the value applied: config, else `TRUST_PROXY`, else loopback. */
export function applyTrustProxy(
  app: Pick<Express, 'set'>,
  configured: TrustProxySetting | undefined,
  env: string | undefined = process.env.TRUST_PROXY,
): TrustProxySetting {
  const value = configured !== undefined ? configured : env || UNSET_TRUST_PROXY;
  app.set('trust proxy', value);
  return value;
}

/**
 * The accounts module's per-IP rate limits key on `req.ip`. With `trust proxy: true` Express takes the
 * left-most (client supplied) `X-Forwarded-For` entry, so a client can pick its own address and dodge
 * the limits. The module therefore needs an explicit hop count, a subnet list, or `false` (no proxy).
 * `true` and an unset `server.trustProxy` are refused (unset defers to the `TRUST_PROXY` environment
 * variable, which may be `true`).
 */
export function acceptableTrustProxy(configured: TrustProxySetting | undefined): boolean {
  return configured !== undefined && configured !== true;
}

export const TRUST_PROXY_HELP =
  'The accounts module needs an explicit server.trustProxy in site-config.json: a hop count (e.g. 1 behind one reverse proxy), '
  + 'a subnet list (e.g. "loopback, 10.0.0.0/8") or false when the server is reached directly. "true" and unset let clients forge X-Forwarded-For and bypass per-IP rate limits.';
