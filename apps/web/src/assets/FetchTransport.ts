/**
 * `IAssetTransport` over `fetch` (web). Any HTTP status is returned, not thrown;
 * connection failures become `AssetError`s the manager can retry.
 */

import { AssetError } from '@bible/core/browser';
import type { IAssetTransport, TransportRequest, TransportResponse } from '@bible/core/browser';

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const isAbort = (e: unknown, signal?: AbortSignal): boolean =>
  !!signal?.aborted || (!!e && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError');

export class FetchTransport implements IAssetTransport {
  constructor(
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
    private readonly isOnline: () => boolean = () => typeof navigator === 'undefined' || navigator.onLine !== false,
  ) {}

  private async request(url: string, signal: AbortSignal, headers?: Record<string, string>): Promise<Response> {
    if (signal.aborted) throw new AssetError('aborted', 'Aborted');
    if (!this.isOnline()) throw new AssetError('offline', 'The device is offline');
    try {
      return await this.fetchFn(url, { signal, cache: 'no-store', ...(headers ? { headers } : {}) });
    } catch (e) {
      if (isAbort(e, signal)) throw new AssetError('aborted', 'Aborted');
      if (!this.isOnline()) throw new AssetError('offline', 'The device is offline');
      throw new AssetError('network', `Network error: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  }

  async get(req: TransportRequest): Promise<TransportResponse> {
    const headers: Record<string, string> = {};
    if (req.rangeStart !== undefined) {
      headers.Range = `bytes=${req.rangeStart}-`;
      if (req.ifRange) headers['If-Range'] = req.ifRange;
    }
    const res = await this.request(req.url, req.signal, headers);
    const encoded = res.headers.get('content-encoding');
    const len = res.headers.get('content-length');
    const contentLength = len !== null && len !== '' && !(encoded && encoded !== 'identity') && Number.isFinite(Number(len))
      ? Number(len) : undefined;
    return {
      status: res.status,
      headers: {
        contentLength,
        contentRange: res.headers.get('content-range') ?? undefined,
        etag: res.headers.get('etag') ?? undefined,
        lastModified: res.headers.get('last-modified') ?? undefined,
        contentType: res.headers.get('content-type') ?? undefined,
      },
      body: this.stream(res, req.signal),
    };
  }

  private async *stream(res: Response, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    if (!res.body) return;
    const reader = res.body.getReader();
    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (e) {
          if (isAbort(e, signal)) throw new AssetError('aborted', 'Aborted');
          throw new AssetError('network', `Network error: ${e instanceof Error ? e.message : String(e)}`, true);
        }
        if (chunk.done) return;
        if (chunk.value && chunk.value.length > 0) yield chunk.value;
      }
    } finally {
      try { await reader.cancel(); } catch { /* already closed */ }
    }
  }

  async getText(url: string, signal: AbortSignal): Promise<string | null> {
    const res = await this.request(url, signal);
    if (res.status === 404) return null;
    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
      throw new AssetError('http', `HTTP ${res.status} for ${url}`, retryable, res.status);
    }
    try {
      return await res.text();
    } catch (e) {
      if (isAbort(e, signal)) throw new AssetError('aborted', 'Aborted');
      throw new AssetError('network', `Network error: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  }
}
