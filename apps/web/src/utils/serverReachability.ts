/**
 * Whether the app's own server can be reached, learned from the API requests
 * the app already makes.
 *
 * `navigator.onLine` only says the device has *a* network. It stays `true`
 * when the server is down, the Wi-Fi has no internet, or a captive portal sits
 * in the way — and every pane that showed "You're offline" only on
 * `!navigator.onLine` instead told the reader "No commentary for this verse",
 * which may well be false: the app could not check.
 *
 * So every same-origin `/api/` request reports its outcome here:
 *   - a transport failure (fetch rejects with a TypeError) or a gateway status
 *     (502/503/504, or a body-less 500 — what the Vite dev proxy answers when
 *     the API server is not running) marks the server unreachable;
 *   - any other response, error statuses included, proves it reachable.
 *
 * While unreachable, a light probe of `/api/version` runs so the app notices
 * the server coming back even if the reader does nothing. Aborted requests
 * (AbortController, navigation) say nothing either way and are ignored.
 *
 * The monitor wraps `window.fetch` once at boot rather than editing each of
 * the ~15 call sites, most of which turn a failure into an empty result.
 */

const PROBE_INTERVAL_MS = 10_000;

type Listener = (reachable: boolean) => void;

let reachable = true;
const listeners = new Set<Listener>();
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let originalFetch: typeof fetch | null = null;

export function isServerReachable(): boolean {
  return reachable;
}

export function onServerReachabilityChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setReachable(next: boolean): void {
  if (next === reachable) return;
  reachable = next;
  if (next) stopProbe();
  else scheduleProbe();
  for (const l of [...listeners]) l(next);
}

export function markServerReachable(): void {
  setReachable(true);
}

export function markServerUnreachable(): void {
  setReachable(false);
}

function apiBase(): string {
  const base = ((import.meta.env?.BASE_URL as string | undefined) ?? '/').replace(/\/$/, '');
  return `${base}/api/`;
}

/** Same-origin request under the app's `/api/` path? */
export function isApiRequest(input: RequestInfo | URL): boolean {
  if (typeof window === 'undefined') return false;
  let url: URL;
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    url = new URL(raw, window.location.href);
  } catch {
    return false;
  }
  return url.origin === window.location.origin && url.pathname.startsWith(apiBase());
}

/** A response that came from something standing in for an absent server. */
export function isGatewayFailure(res: Response): boolean {
  if (res.status === 502 || res.status === 503 || res.status === 504) return true;
  // The Vite dev proxy answers 500 with no body and no content type when the
  // backend refuses the connection. The real server's 500s are JSON.
  return res.status === 500 && !res.headers.get('content-type');
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function scheduleProbe(): void {
  if (probeTimer || typeof window === 'undefined') return;
  probeTimer = setTimeout(async () => {
    probeTimer = null;
    if (reachable) return;
    // Through the wrapped fetch, so the outcome is recorded the usual way.
    try { await window.fetch(`${apiBase()}version`, { cache: 'no-store' }); } catch { /* recorded */ }
    if (!reachable) scheduleProbe();
  }, PROBE_INTERVAL_MS);
}

function stopProbe(): void {
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = null;
}

/** Wrap `window.fetch` so API requests report reachability. Idempotent. */
export function installServerReachabilityMonitor(): void {
  if (typeof window === 'undefined' || originalFetch) return;
  originalFetch = window.fetch.bind(window);
  const base = originalFetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isApiRequest(input)) return base(input, init);
    try {
      const res = await base(input, init);
      setReachable(!isGatewayFailure(res));
      return res;
    } catch (err) {
      if (!isAbort(err)) setReachable(false);
      throw err;
    }
  };
  // The device coming back online is a good moment to check at once.
  window.addEventListener('online', () => {
    if (reachable) return;
    stopProbe();
    void window.fetch(`${apiBase()}version`, { cache: 'no-store' }).catch(() => {});
  });
}

/** Test hook: undo the wrapper and reset state. */
export function __resetServerReachabilityForTests(): void {
  if (originalFetch && typeof window !== 'undefined') window.fetch = originalFetch;
  originalFetch = null;
  reachable = true;
  listeners.clear();
  stopProbe();
}
