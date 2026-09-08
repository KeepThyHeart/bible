/**
 * Minimal fake for `node:http` / `node:https` used by the network-hardening
 * tests for `ModuleCatalogService` and `DownloadService`.
 *
 * Both services call `protocol.get(url[, options], cb)` and attach an `error`
 * listener to the returned request. The fake records every requested URL (so a
 * test can assert how many hops were followed) and lets the test script the
 * response per URL.
 */

import { EventEmitter } from 'events';

/** What the fake server should answer with for one request. */
export interface FakeResponseSpec {
  statusCode: number;
  headers?: Record<string, string>;
  /** Body chunks, emitted one `data` event each. */
  chunks?: Array<string | Buffer>;
}

export type FakeRoute = (url: string) => FakeResponseSpec;

/** URLs requested since the last `resetFakeHttp()`, in order. */
export const requestedUrls: string[] = [];

let route: FakeRoute = () => ({ statusCode: 404 });

export function setFakeRoute(next: FakeRoute): void {
  route = next;
}

export function resetFakeHttp(): void {
  requestedUrls.length = 0;
  route = () => ({ statusCode: 404 });
}

interface FakeIncomingMessage extends EventEmitter {
  statusCode: number;
  headers: Record<string, string>;
  destroyed: boolean;
  destroy(): void;
}

export function fakeGet(...args: unknown[]): EventEmitter {
  const url = args[0] as string;
  const callback = (typeof args[1] === 'function' ? args[1] : args[2]) as (
    res: FakeIncomingMessage
  ) => void;

  requestedUrls.push(url);

  const request = new EventEmitter() as EventEmitter & { destroy(): void };
  request.destroy = (): void => {};

  const spec = route(url);

  setImmediate(() => {
    const response = new EventEmitter() as FakeIncomingMessage;
    response.statusCode = spec.statusCode;
    response.headers = spec.headers ?? {};
    response.destroyed = false;
    response.destroy = (): void => {
      response.destroyed = true;
    };

    callback(response);

    setImmediate(() => {
      for (const chunk of spec.chunks ?? []) {
        if (response.destroyed) return;
        response.emit('data', typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      if (!response.destroyed) response.emit('end');
    });
  });

  return request;
}

/** Module shape shared by the `vi.mock('http')` / `vi.mock('https')` factories. */
export const fakeHttpModule = {
  get: fakeGet,
  default: { get: fakeGet },
};
