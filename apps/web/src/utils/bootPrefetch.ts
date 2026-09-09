/**
 * Consumes the responses the inline boot prefetch in index.html started.
 *
 * That script fires the handful of GETs the first paint depends on before this
 * bundle has even finished downloading, and parks the in-flight promises on
 * `window.__bootPrefetch` keyed by absolute URL. Everything here is the other
 * end of that: hand back the running request when there is one, and otherwise
 * behave exactly like `fetch`.
 *
 * The contract is deliberately one of pure optimisation. A URL that was not
 * prefetched, a prefetch that failed, a build where the inline script did not
 * run at all -- each simply falls through to a normal request, so no caller has
 * to know whether it was prefetched or not.
 */

type PrefetchMap = Record<string, Promise<Response>>;

function prefetchMap(): PrefetchMap | undefined {
  return (globalThis as { __bootPrefetch?: PrefetchMap }).__bootPrefetch;
}

/**
 * The in-flight prefetch for `url`, or null when there is none.
 *
 * Claimed once and removed: a `Response` body can only be read a single time,
 * so leaving it in the map would hand a second caller a stream that is already
 * consumed and fail in a way that looks like a server error.
 */
function claimPrefetched(url: string): Promise<Response> | null {
  const map = prefetchMap();
  const pending = map?.[url];
  if (!pending || !map) return null;
  delete map[url];
  return pending;
}

/**
 * `fetch`, preferring a response the boot prefetch already has in flight.
 *
 * `init` is ignored for a claimed response — the inline script issued the
 * request with the options that matter (currently only `cache: 'no-store'` on
 * /api/version) and it is far too late to change them here.
 */
export function bootFetch(url: string, init?: RequestInit): Promise<Response> {
  const prefetched = claimPrefetched(url);
  if (prefetched) return prefetched;
  // Forwarded only when there is one: `fetch(url, undefined)` behaves the same
  // as `fetch(url)` but is not the same *call*, and callers (tests included)
  // reasonably assert on the shape of the request this makes.
  return init ? fetch(url, init) : fetch(url);
}

/**
 * Drop whatever the prefetch has left over, once boot is finished.
 *
 * Without this an unclaimed entry -- the chapter the session pointed at, when
 * the reader deep-linked somewhere else instead -- would stay claimable for the
 * lifetime of the tab, and a navigation an hour later would silently be served
 * that hour-old response. Chapter text does not change, so the stale answer
 * would be correct; it would still be a surprising thing to leave armed.
 */
export function releaseBootPrefetch(): void {
  delete (globalThis as { __bootPrefetch?: PrefetchMap }).__bootPrefetch;
}
