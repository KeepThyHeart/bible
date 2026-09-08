/**
 * Shared HTTP policy for the two places the app fetches from the network on a
 * user-supplied URL: the module catalog fetch (`services/ModuleCatalogService`)
 * and the module downloader (`services/DownloadService`).
 *
 * Following redirects by recursing on `response.headers.location` with no depth
 * counter and no scheme check lets a malicious or misconfigured server drive
 * unbounded recursion and silently downgrade an `https:` request to plaintext
 * `http:`. This module centralises the rules so neither caller can get it
 * wrong:
 *
 *   - only `http:` / `https:` URLs are ever requested;
 *   - at most `NETWORK_MAX_REDIRECTS` hops;
 *   - `https:` never downgrades to `http:` across a redirect;
 *   - relative `Location` values are resolved against the current URL;
 *   - the full set of redirect statuses is honoured (301/302/303/307/308),
 *     not just 301/302.
 *
 * Deliberately free of `node:http` imports so it stays trivially unit-testable.
 */

import { NETWORK_MAX_REDIRECTS } from '../config/constants';

/** HTTP statuses that carry a `Location` header we should follow. */
export const REDIRECT_STATUS_CODES: readonly number[] = [301, 302, 303, 307, 308];

/** True when the response is a redirect we know how to follow. */
export function isRedirectStatus(statusCode: number | undefined): boolean {
  return statusCode !== undefined && REDIRECT_STATUS_CODES.includes(statusCode);
}

/**
 * Parse a URL we are about to request and reject any scheme other than
 * `http:` / `https:` (so a catalog entry can't point the downloader at
 * `file:` or a custom OS handler).
 */
export function parseHttpUrl(raw: string, context = 'request'): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid ${context} URL: ${raw}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `Refusing ${context} to unsupported scheme "${url.protocol}" (only http: and https: are allowed)`
    );
  }

  return url;
}

/**
 * Validate a redirect and return the absolute URL to follow next.
 *
 * @param currentUrl         URL that produced the redirect response.
 * @param location           Raw `Location` header (may be relative).
 * @param redirectsRemaining Hops left in this chain; `<= 0` aborts.
 * @throws When the budget is exhausted, the header is missing/unparseable, the
 *         target uses a non-HTTP scheme, or the hop downgrades https -> http.
 */
export function resolveRedirectTarget(
  currentUrl: string,
  location: string | undefined,
  redirectsRemaining: number
): string {
  if (redirectsRemaining <= 0) {
    throw new Error(
      `Too many redirects (limit ${NETWORK_MAX_REDIRECTS}) while requesting ${currentUrl}`
    );
  }

  if (location === undefined || location.trim() === '') {
    throw new Error(`Redirect from ${currentUrl} is missing a Location header`);
  }

  let target: URL;
  try {
    target = new URL(location, currentUrl);
  } catch {
    throw new Error(`Redirect from ${currentUrl} has an invalid Location: ${location}`);
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(
      `Redirect from ${currentUrl} points at unsupported scheme "${target.protocol}"`
    );
  }

  // A server that answers an https:// request with a plaintext http:// target
  // has thrown away transport security; treat it as an error rather than
  // quietly following along.
  if (currentUrl.toLowerCase().startsWith('https:') && target.protocol === 'http:') {
    throw new Error(
      `Refusing insecure redirect from ${currentUrl} to ${target.toString()} (https → http downgrade)`
    );
  }

  return target.toString();
}
