/**
 * A `fetch`-shaped function over `NetworkGateway.fetchBuffered`, for `Sync.SyncApiClient` (the global fetch is banned in
 * electron/**, and the gateway also enforces the "Allow web requests" switch).
 *
 * - Redirects are refused: a 3xx answer becomes a `TypeError` (what `redirect: 'error'` does), so a key or token is never
 *   re-sent to another URL.
 * - `NetworkBlockedError` from the gateway is rethrown unchanged (SyncApiClient turns every fetch failure into a
 *   `SyncNetworkError`, so the service also checks the switch to tell "blocked" from "offline").
 * - The response is capped at 24 MiB (a pull page is at most 8 MiB on the server; base64 makes it about 11 MiB).
 * - `signal` is honoured: an abort rejects at once with the abort reason. The gateway offers no way to cancel the
 *   request that is already in flight, so it finishes in the background and its answer is dropped.
 */
import type { INetworkGateway } from '../NetworkGateway';

export const SYNC_MAX_RESPONSE_BYTES = 24 << 20;
export const SYNC_REQUEST_TIMEOUT_MS = 60_000;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
}

function toBody(body: unknown): string | Buffer | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  throw new TypeError('Unsupported request body');
}

export function createGatewayFetch(gateway: Pick<INetworkGateway, 'fetchBuffered'>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const signal = init?.signal ?? undefined;
    if (signal?.aborted) throw abortReason(signal);

    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });

    let onAbort: (() => void) | undefined;
    const aborted = signal
      ? new Promise<never>((_, reject) => {
          onAbort = () => reject(abortReason(signal));
          signal.addEventListener('abort', onAbort, { once: true });
        })
      : null;
    try {
      const request = gateway.fetchBuffered({
        url,
        method: init?.method ?? 'GET',
        headers,
        body: toBody(init?.body),
        maxResponseBytes: SYNC_MAX_RESPONSE_BYTES,
        maxRedirects: 0,
        timeoutMs: SYNC_REQUEST_TIMEOUT_MS,
        context: 'sync',
      });
      if (aborted) request.catch(() => undefined); // the loser of the race must not be an unhandled rejection
      const res = await (aborted ? Promise.race([request, aborted]) : request);
      if (res.status >= 300 && res.status < 400) throw new TypeError('The server answered with a redirect');
      const outHeaders = new Headers();
      for (const [name, value] of Object.entries(res.headers)) {
        if (value === undefined) continue;
        for (const v of Array.isArray(value) ? value : [value]) outHeaders.append(name, v);
      }
      const noBody = res.status === 204 || res.status === 205;
      return new Response(noBody ? null : new Uint8Array(res.body), { status: res.status, headers: outHeaders });
    } finally {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    }
  }) as typeof fetch;
}
