/**
 * `IAssetTransport` over the desktop `NetworkGateway` (task 0090). All egress stays behind the
 * gateway's offline switch and redirect policy; this file only adapts it to the core port.
 *
 * Electron's `IncomingMessage` has no backpressure, so the body is a chunk queue fed by the
 * response events; aborting the signal aborts the request and fails the pending `next()`.
 */

import type { ClientRequest, IncomingMessage } from 'electron';
import {
  AssetError,
  isAssetError,
  type IAssetTransport,
  type TransportRequest,
  type TransportResponse,
} from '@bible/core/browser';
import { NetworkBlockedError, type INetworkGateway } from '../NetworkGateway';

const TEXT_MAX_BYTES = 2 * 1024 * 1024;
const TEXT_TIMEOUT_MS = 30_000;

function aborted(): AssetError {
  return new AssetError('aborted', 'Aborted');
}

function mapError(e: unknown): AssetError {
  if (isAssetError(e)) return e as AssetError;
  if (e instanceof NetworkBlockedError) return new AssetError('offline', e.message);
  return new AssetError('network', e instanceof Error ? e.message : String(e), true);
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function body(response: IncomingMessage, request: ClientRequest, signal: AbortSignal): AsyncIterable<Uint8Array> {
  const queue: Uint8Array[] = [];
  let finished = false;
  let failure: AssetError | null = null;
  let waiter: { resolve: () => void } | null = null;

  const wake = (): void => {
    const w = waiter;
    waiter = null;
    w?.resolve();
  };
  const fail = (err: AssetError): void => {
    if (finished) return;
    finished = true;
    failure = err;
    wake();
  };
  const abortRequest = (): void => {
    try { request.abort(); } catch { /* already finished */ }
  };

  const onAbort = (): void => {
    abortRequest();
    fail(aborted());
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });

  response.on('data', (chunk: Buffer) => {
    if (finished) return;
    queue.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    wake();
  });
  response.on('end', () => {
    if (finished) return;
    finished = true;
    wake();
  });
  response.on('error', (err: Error) => fail(new AssetError('network', err.message, true)));
  response.on('aborted', () => fail(new AssetError('network', 'Connection aborted', true)));

  const cleanup = (): void => signal.removeEventListener('abort', onAbort);

  return {
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          for (;;) {
            if (failure) { cleanup(); throw failure; }
            const chunk = queue.shift();
            if (chunk) return { value: chunk, done: false };
            if (finished) { cleanup(); return { value: undefined, done: true }; }
            await new Promise<void>((resolve) => { waiter = { resolve }; });
          }
        },
        async return(): Promise<IteratorResult<Uint8Array>> {
          // Consumer stopped early (stall abort, size guard): drop the connection.
          if (!finished) { finished = true; abortRequest(); }
          queue.length = 0;
          cleanup();
          return { value: undefined, done: true };
        },
      };
    },
  };
}

const EMPTY: AsyncIterable<Uint8Array> = {
  [Symbol.asyncIterator]: () => ({ next: async () => ({ value: undefined, done: true }) }),
};

export class GatewayTransport implements IAssetTransport {
  constructor(private readonly gateway: INetworkGateway) {}

  async get(req: TransportRequest): Promise<TransportResponse> {
    if (req.signal.aborted) throw aborted();
    const headers: Record<string, string> = {};
    if (req.rangeStart !== undefined) {
      headers['Range'] = `bytes=${req.rangeStart}-`;
      if (req.ifRange) headers['If-Range'] = req.ifRange;
    }

    let result;
    try {
      result = await this.gateway.downloadStream({ url: req.url, headers, context: 'asset download' });
    } catch (e) {
      if (req.signal.aborted) throw aborted();
      throw mapError(e);
    }
    const { response, request } = result;
    const h = result.headers;
    const parsedLength = Number(first(h['content-length']));
    const out: TransportResponse['headers'] = {};
    if (Number.isFinite(parsedLength) && first(h['content-length']) !== undefined) out.contentLength = parsedLength;
    const cr = first(h['content-range']);
    if (cr) out.contentRange = cr;
    const etag = first(h['etag']);
    if (etag) out.etag = etag;
    const lm = first(h['last-modified']);
    if (lm) out.lastModified = lm;
    const ct = first(h['content-type']);
    if (ct) out.contentType = ct;

    if (req.signal.aborted) {
      try { request.abort(); } catch { /* ignore */ }
      throw aborted();
    }
    if (result.status !== 200 && result.status !== 206) {
      // The manager only needs the status; do not keep the connection streaming an error page.
      try { request.abort(); } catch { /* ignore */ }
      return { status: result.status, headers: out, body: EMPTY };
    }
    return { status: result.status, headers: out, body: body(response, request, req.signal) };
  }

  async getText(url: string, signal: AbortSignal): Promise<string | null> {
    if (signal.aborted) throw aborted();
    let onAbort: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      onAbort = () => reject(aborted());
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const res = await Promise.race([
        this.gateway.fetchBuffered({
          url,
          method: 'GET',
          maxResponseBytes: TEXT_MAX_BYTES,
          timeoutMs: TEXT_TIMEOUT_MS,
          context: 'asset text',
        }),
        abortPromise,
      ]);
      if (res.status === 404 || res.status === 410) return null;
      if (res.status !== 200) {
        throw new AssetError('http', `HTTP ${res.status} for ${url}`, res.status >= 500, res.status);
      }
      return res.body.toString('utf-8');
    } catch (e) {
      throw mapError(e);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
      abortPromise.catch(() => undefined);
    }
  }
}
