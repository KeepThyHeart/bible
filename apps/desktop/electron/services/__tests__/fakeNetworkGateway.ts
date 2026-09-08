/**
 * Configurable fake `INetworkGateway` for service unit tests
 * (`ModuleCatalogService`, `DownloadService`, `DiagnosticsUploader`).
 *
 * The gateway is the seam these services depend on, so their tests inject this
 * fake instead of touching a real socket. The redirect/scheme/size-cap
 * *security* assertions live in `NetworkGateway.test.ts` (which drives a mocked
 * Electron `net`); here we exercise how each service treats the gateway's
 * responses and errors.
 */

import { EventEmitter } from 'events';
import { NetworkBlockedError } from '../NetworkGateway';
import type {
  INetworkGateway,
  CreateRequestOptions,
  FetchBufferedOptions,
  FetchBufferedResult,
  DownloadStreamOptions,
  DownloadStreamResult,
} from '../NetworkGateway';
import type { ClientRequest, IncomingMessage } from 'electron';

export class FakeNetworkGateway implements INetworkGateway {
  offline = false;
  connected = true;

  readonly fetchCalls: FetchBufferedOptions[] = [];
  readonly downloadCalls: DownloadStreamOptions[] = [];
  readonly createRequestCalls: CreateRequestOptions[] = [];

  fetchBufferedImpl?: (opts: FetchBufferedOptions) => Promise<FetchBufferedResult>;
  downloadStreamImpl?: (opts: DownloadStreamOptions) => Promise<DownloadStreamResult>;
  createRequestImpl?: (opts: CreateRequestOptions) => ClientRequest;

  isOffline(): boolean {
    return this.offline;
  }

  isConnected(): boolean {
    return this.connected;
  }

  assertEgressAllowed(context: string): void {
    if (this.offline) throw new NetworkBlockedError(context);
  }

  createRequest(opts: CreateRequestOptions): ClientRequest {
    this.createRequestCalls.push(opts);
    this.assertEgressAllowed(opts.context);
    if (this.createRequestImpl) return this.createRequestImpl(opts);
    throw new Error('FakeNetworkGateway.createRequest not stubbed');
  }

  fetchBuffered(opts: FetchBufferedOptions): Promise<FetchBufferedResult> {
    this.fetchCalls.push(opts);
    try {
      this.assertEgressAllowed(opts.context);
    } catch (err) {
      return Promise.reject(err as Error);
    }
    if (this.fetchBufferedImpl) return this.fetchBufferedImpl(opts);
    return Promise.reject(new Error('FakeNetworkGateway.fetchBuffered not stubbed'));
  }

  downloadStream(opts: DownloadStreamOptions): Promise<DownloadStreamResult> {
    this.downloadCalls.push(opts);
    try {
      this.assertEgressAllowed(opts.context);
    } catch (err) {
      return Promise.reject(err as Error);
    }
    if (this.downloadStreamImpl) return this.downloadStreamImpl(opts);
    return Promise.reject(new Error('FakeNetworkGateway.downloadStream not stubbed'));
  }
}

/** Build a `FetchBufferedResult` from a status + optional JSON/text body. */
export function fetchResult(
  status: number,
  body = '',
  headers: Record<string, string | string[]> = {}
): FetchBufferedResult {
  return { status, headers, url: '', body: Buffer.from(body, 'utf-8') };
}

/**
 * Build a `DownloadStreamResult` whose response auto-emits the given chunks on
 * the next macrotask - after the consuming service has attached its listeners.
 */
export function downloadResult(spec: {
  status: number;
  headers?: Record<string, string | string[]>;
  chunks?: Array<string | Buffer>;
}): DownloadStreamResult {
  const response = new EventEmitter();
  const request = { aborted: false, abort(): void { (request as { aborted: boolean }).aborted = true; } };
  setImmediate(() => {
    for (const c of spec.chunks ?? []) {
      response.emit('data', typeof c === 'string' ? Buffer.from(c) : c);
    }
    response.emit('end');
  });
  return {
    status: spec.status,
    headers: spec.headers ?? {},
    url: '',
    response: response as unknown as IncomingMessage,
    request: request as unknown as ClientRequest,
  };
}
