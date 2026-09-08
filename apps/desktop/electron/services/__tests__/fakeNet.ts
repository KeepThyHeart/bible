/**
 * Minimal fake for Electron's `net` module, used by `NetworkGateway.test.ts`.
 *
 * The gateway calls `net.request(options)` and drives the returned request
 * through `on('response')` / `on('error')` / `on('abort')`. This fake records
 * every requested URL (so a test can assert how many redirect hops were
 * followed) and lets the test script the response per request. It follows the
 * `FakeRequest` shape used by `DiagnosticsUploader.test.ts` but adapted to
 * Electron's `net.request(options)` signature and its `IncomingMessage`
 * (data/end/error events, `statusCode`/`headers`, no pause/destroy).
 */

import { EventEmitter } from 'events';

export interface FakeResponseSpec {
  statusCode: number;
  headers?: Record<string, string | string[]>;
  /** Body chunks, emitted one `data` event each. */
  chunks?: Array<string | Buffer>;
}

export type FakeRoute = (req: { url: string; method: string }) => FakeResponseSpec;

/** URLs requested since the last `resetFakeNet()`, in order. */
export const requestedUrls: string[] = [];

let route: FakeRoute = () => ({ statusCode: 404 });
let online = true;

export function setFakeRoute(next: FakeRoute): void {
  route = next;
}

export function setOnline(value: boolean): void {
  online = value;
}

export function resetFakeNet(): void {
  requestedUrls.length = 0;
  route = () => ({ statusCode: 404 });
  online = true;
}

class FakeClientRequest extends EventEmitter {
  headers: Record<string, string> = {};
  body: Array<string | Buffer> = [];
  aborted = false;

  constructor(private readonly spec: FakeResponseSpec) {
    super();
  }

  setHeader(k: string, v: string): void {
    this.headers[k] = v;
  }

  write(chunk: string | Buffer): void {
    this.body.push(chunk);
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    this.emit('abort');
  }

  end(): void {
    setImmediate(() => {
      if (this.aborted) return;
      const response = new EventEmitter() as EventEmitter & {
        statusCode: number;
        headers: Record<string, string | string[]>;
      };
      response.statusCode = this.spec.statusCode;
      response.headers = this.spec.headers ?? {};
      this.emit('response', response);
      setImmediate(() => {
        if (this.aborted) return;
        for (const chunk of this.spec.chunks ?? []) {
          if (this.aborted) return;
          response.emit('data', typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        if (!this.aborted) response.emit('end');
      });
    });
  }
}

interface RequestOptions {
  url: string;
  method?: string;
}

function fakeRequest(options: string | RequestOptions): FakeClientRequest {
  const url = typeof options === 'string' ? options : options.url;
  const method = (typeof options === 'object' && options.method) || 'GET';
  requestedUrls.push(url);
  const spec = route({ url, method });
  return new FakeClientRequest(spec);
}

/** Shape compatible with the subset of Electron `net` the gateway uses. */
export const fakeNet = {
  request: fakeRequest,
  isOnline: () => online,
} as unknown as typeof import('electron').net;
