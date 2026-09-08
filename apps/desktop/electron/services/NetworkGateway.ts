/**
 * NetworkGateway - THE single network egress choke-point for the desktop app.
 *
 * This is the ONLY module in `electron/**` allowed to open a socket / call
 * Electron `net.request`. Every other egress path (module catalog fetch,
 * module download, diagnostics upload, the future manual updater, and the
 * per-extension network gateway) routes through here. An ESLint rule
 * (`apps/desktop/eslint.config.js`) bans `http`/`https`/`node:http`/
 * `node:https`, global `fetch`, and `net.request` everywhere in `electron/**`
 * EXCEPT this file, so no future code can quietly add a fifth path.
 *
 * ## Master "Allow web requests" switch
 *
 * The gateway checks the persisted `allowNetwork` flag (see `NetworkConfig`)
 * FIRST on every request. It is OFF by default, so a fresh install refuses
 * every request with a typed `NetworkBlockedError` and never opens a socket
 * until the user turns the switch on and confirms.
 *
 * The switch is app-wide, and this file is not its only consumer: the updater
 * (electron-updater, which brings its own HTTP stack) and `openExternalUrl`
 * check the same flag before they act. The rule is one SWITCH, not one socket.
 * See `NetworkConfig` for what this does and does not claim.
 *
 * ## Why Electron `net` (not Node `http`/`https`)
 *
 * `net.request` honors the system/Electron proxy and certificate chain
 * automatically, so a configured proxy/VPN applies to every request without
 * per-caller plumbing.
 *
 * ## Redirect / downgrade policy
 *
 * `fetchBuffered` and `downloadStream` follow redirects MANUALLY, reusing the
 * pure helpers in `utils/networkPolicy.ts`: at most `NETWORK_MAX_REDIRECTS`
 * hops, only http/https targets, and a hard refusal of any https -> http
 * downgrade. Electron's own auto-follow is disabled (`redirect: 'manual'`) so
 * these rules are enforced here rather than trusted to the platform.
 */

import type { ClientRequest, IncomingMessage, Session } from 'electron';
import { NETWORK_MAX_REDIRECTS } from '../config/constants';
import { isRedirectStatus, parseHttpUrl, resolveRedirectTarget } from '../utils/networkPolicy';

/**
 * Thrown (or returned) when the master offline switch is engaged. Callers that
 * "never throw" (the extension gateway) map this to their own error union.
 */
export class NetworkBlockedError extends Error {
  readonly code = 'NetworkBlocked' as const;
  constructor(context: string) {
    super(`Network egress blocked by offline mode: ${context}`);
    this.name = 'NetworkBlockedError';
  }
}

/** Minimal config surface the gateway needs - lets tests inject a fake. */
export interface NetworkConfigLike {
  get(): { allowNetwork: boolean };
}

export interface CreateRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** Isolated session (used by the per-extension gateway). */
  session?: Session;
  /** Passed through to `net.request`; the extension gateway sets `false`. */
  useSessionCookies?: boolean;
  /** Electron redirect mode. Defaults to `'manual'`. */
  redirect?: 'follow' | 'error' | 'manual';
  /** Human-readable label for logs/errors (e.g. `'catalog fetch'`). */
  context: string;
}

export interface FetchBufferedOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Abort once the response body exceeds this many bytes. */
  maxResponseBytes: number;
  /** Abort the request after this many ms. Optional (no timeout if unset). */
  timeoutMs?: number;
  /**
   * Max redirect hops. Defaults to `NETWORK_MAX_REDIRECTS`. Pass `0` to treat
   * a 3xx as a terminal response (return it as-is) rather than following it -
   * the diagnostics uploader relies on this to classify its own statuses.
   */
  maxRedirects?: number;
  context: string;
}

export interface FetchBufferedResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  /** Final URL after any redirects. */
  url: string;
  body: Buffer;
}

export interface DownloadStreamOptions {
  url: string;
  headers?: Record<string, string>;
  maxRedirects?: number;
  context: string;
}

export interface DownloadStreamResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  /** Final URL after any redirects. */
  url: string;
  /** The readable response stream. The caller attaches `data`/`end`/`error`. */
  response: IncomingMessage;
  /** The underlying request, so the caller can abort (pause/cancel). */
  request: ClientRequest;
}

export interface INetworkGateway {
  isOffline(): boolean;
  /** True when Electron reports network connectivity (cheap DNS hint). */
  isConnected(): boolean;
  /** Throws `NetworkBlockedError` when offline. */
  assertEgressAllowed(context: string): void;
  createRequest(opts: CreateRequestOptions): ClientRequest;
  fetchBuffered(opts: FetchBufferedOptions): Promise<FetchBufferedResult>;
  downloadStream(opts: DownloadStreamOptions): Promise<DownloadStreamResult>;
}

/**
 * Lazily resolve Electron's `net`. Kept out of module scope so this file can
 * be imported in plain-Node unit tests (which never reach the socket paths
 * because they engage offline mode or inject a fake gateway) without a real
 * `electron` runtime. This is the one sanctioned `net` access in the app.
 */
let netOverride: typeof import('electron').net | undefined;

function getNet(): typeof import('electron').net {
  if (netOverride) return netOverride;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const electron = require('electron') as typeof import('electron');
  return electron.net;
}

/**
 * Test-only: inject a fake `net` so the gateway's socket paths can be driven
 * in plain-Node unit tests without a real `electron` runtime. Pass `undefined`
 * to restore the real module.
 */
export function __setNetForTests(net: typeof import('electron').net | undefined): void {
  netOverride = net;
}

export class NetworkGateway implements INetworkGateway {
  constructor(private readonly config: NetworkConfigLike) {}

  isOffline(): boolean {
    // Anything other than an explicit `true` is offline. The check is written
    // this way, rather than `=== false`, so a missing/corrupt/unmigrated config
    // fails closed.
    return this.config.get().allowNetwork !== true;
  }

  isConnected(): boolean {
    try {
      return getNet().isOnline();
    } catch {
      // If we can't tell, assume connected and let the request fail naturally.
      return true;
    }
  }

  assertEgressAllowed(context: string): void {
    if (this.isOffline()) {
      throw new NetworkBlockedError(context);
    }
  }

  createRequest(opts: CreateRequestOptions): ClientRequest {
    this.assertEgressAllowed(opts.context);
    // Validate the scheme up front so a `file:`/custom-handler URL never
    // reaches `net.request`.
    parseHttpUrl(opts.url, opts.context);

    const net = getNet();
    const requestOptions: Parameters<typeof net.request>[0] = {
      url: opts.url,
      method: opts.method ?? 'GET',
      redirect: opts.redirect ?? 'manual',
    };
    if (opts.session) requestOptions.session = opts.session;
    if (opts.useSessionCookies !== undefined) {
      requestOptions.useSessionCookies = opts.useSessionCookies;
    }
    const request = net.request(requestOptions);
    if (opts.headers) {
      for (const [k, v] of Object.entries(opts.headers)) {
        request.setHeader(k, v);
      }
    }
    return request;
  }

  fetchBuffered(opts: FetchBufferedOptions): Promise<FetchBufferedResult> {
    const maxRedirects = opts.maxRedirects ?? NETWORK_MAX_REDIRECTS;
    return this.fetchBufferedFrom(opts, opts.url, maxRedirects);
  }

  private fetchBufferedFrom(
    opts: FetchBufferedOptions,
    currentUrl: string,
    redirectsRemaining: number
  ): Promise<FetchBufferedResult> {
    return new Promise<FetchBufferedResult>((resolve, reject) => {
      let request: ClientRequest;
      try {
        request = this.createRequest({
          url: currentUrl,
          method: opts.method,
          headers: opts.headers,
          redirect: 'manual',
          context: opts.context,
        });
      } catch (err) {
        reject(err as Error);
        return;
      }

      let settled = false;
      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        fn();
      };

      let timeoutHandle: NodeJS.Timeout | undefined;
      if (opts.timeoutMs !== undefined) {
        timeoutHandle = setTimeout(() => {
          try {
            request.abort();
          } catch {
            /* ignore */
          }
          settle(() =>
            reject(new Error(`Request timed out after ${opts.timeoutMs}ms: ${opts.context}`))
          );
        }, opts.timeoutMs);
      }
      const clearTimer = (): void => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      };

      // When the caller opts out of following redirects (`maxRedirects: 0`) a
      // 3xx is returned verbatim so it can classify the status itself (the
      // diagnostics uploader treats 3xx as transient). Otherwise redirects are
      // followed here so the scheme/downgrade rules apply, and the hop budget
      // is enforced by `resolveRedirectTarget` (which throws once exhausted).
      const follow = (opts.maxRedirects ?? NETWORK_MAX_REDIRECTS) > 0;

      request.on('response', (response: IncomingMessage) => {
        const statusCode = response.statusCode;

        if (isRedirectStatus(statusCode) && follow) {
          let nextUrl: string;
          try {
            const loc = response.headers.location;
            const location = Array.isArray(loc) ? loc[0] : loc;
            nextUrl = resolveRedirectTarget(currentUrl, location, redirectsRemaining);
          } catch (err) {
            clearTimer();
            settle(() => reject(err as Error));
            // Electron's IncomingMessage has no destroy(); abort the request to
            // tear down the connection. Settle first so `settled` guards the
            // abort event.
            try {
              request.abort();
            } catch {
              /* ignore */
            }
            return;
          }
          clearTimer();
          settle(() => {
            this.fetchBufferedFrom(opts, nextUrl, redirectsRemaining - 1)
              .then(resolve)
              .catch(reject);
          });
          try {
            request.abort();
          } catch {
            /* ignore */
          }
          return;
        }

        const chunks: Buffer[] = [];
        let byteCount = 0;
        let aborted = false;
        response.on('data', (chunk: Buffer) => {
          if (aborted) return;
          byteCount += chunk.length;
          if (byteCount > opts.maxResponseBytes) {
            aborted = true;
            clearTimer();
            // Settle BEFORE aborting so the size-limit error wins over the
            // request's synchronous 'abort' event.
            settle(() =>
              reject(
                new Error(
                  `Response exceeded the ${opts.maxResponseBytes} byte limit: ${opts.context}`
                )
              )
            );
            try {
              request.abort();
            } catch {
              /* ignore */
            }
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (aborted) return;
          clearTimer();
          settle(() =>
            resolve({
              status: statusCode,
              headers: response.headers,
              url: currentUrl,
              body: Buffer.concat(chunks, byteCount),
            })
          );
        });
        response.on('error', (err: Error) => {
          clearTimer();
          settle(() => reject(err));
        });
      });

      request.on('error', (err: Error) => {
        clearTimer();
        settle(() => reject(err));
      });
      request.on('abort', () => {
        clearTimer();
        settle(() => reject(new Error(`Request aborted: ${opts.context}`)));
      });

      if (opts.body !== undefined) {
        request.write(opts.body);
      }
      request.end();
    });
  }

  downloadStream(opts: DownloadStreamOptions): Promise<DownloadStreamResult> {
    const maxRedirects = opts.maxRedirects ?? NETWORK_MAX_REDIRECTS;
    return this.downloadStreamFrom(opts, opts.url, maxRedirects);
  }

  private downloadStreamFrom(
    opts: DownloadStreamOptions,
    currentUrl: string,
    redirectsRemaining: number
  ): Promise<DownloadStreamResult> {
    return new Promise<DownloadStreamResult>((resolve, reject) => {
      let request: ClientRequest;
      try {
        request = this.createRequest({
          url: currentUrl,
          method: 'GET',
          headers: opts.headers,
          redirect: 'manual',
          context: opts.context,
        });
      } catch (err) {
        reject(err as Error);
        return;
      }

      let settled = false;
      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        fn();
      };

      request.on('response', (response: IncomingMessage) => {
        const statusCode = response.statusCode;
        const follow = (opts.maxRedirects ?? NETWORK_MAX_REDIRECTS) > 0;
        if (isRedirectStatus(statusCode) && follow) {
          let nextUrl: string;
          try {
            const loc = response.headers.location;
            const location = Array.isArray(loc) ? loc[0] : loc;
            nextUrl = resolveRedirectTarget(currentUrl, location, redirectsRemaining);
          } catch (err) {
            settle(() => reject(err as Error));
            try {
              request.abort();
            } catch {
              /* ignore */
            }
            return;
          }
          settle(() => {
            this.downloadStreamFrom(opts, nextUrl, redirectsRemaining - 1)
              .then(resolve)
              .catch(reject);
          });
          // Electron's IncomingMessage has no destroy(); abort the request to
          // release the redirect response. `settled` guards the abort event.
          try {
            request.abort();
          } catch {
            /* ignore */
          }
          return;
        }

        // Hand the still-paused stream to the caller. We deliberately do NOT
        // attach a `data` listener here so no bytes are consumed before the
        // caller wires up its own progress/write handlers.
        settle(() =>
          resolve({
            status: statusCode,
            headers: response.headers,
            url: currentUrl,
            response,
            request,
          })
        );
      });

      request.on('error', (err: Error) => {
        settle(() => reject(err));
      });
      request.on('abort', () => {
        settle(() => reject(new Error(`Download request aborted: ${opts.context}`)));
      });

      request.end();
    });
  }
}

// --- Singleton wiring -----------------------------------------------------
//
// Cross-cutting callers (the extension gateway, the future updater) reach the
// gateway without deep constructor threading. Services that have unit tests
// still take the gateway via constructor (defaulting to `getNetworkGateway()`)
// so those tests can inject a fake.

let singleton: INetworkGateway | undefined;

export function initNetworkGateway(config: NetworkConfigLike): INetworkGateway {
  singleton = new NetworkGateway(config);
  return singleton;
}

export function getNetworkGateway(): INetworkGateway {
  if (!singleton) {
    throw new Error(
      'NetworkGateway used before initialization. Call initNetworkGateway(config) during startup.'
    );
  }
  return singleton;
}

/** Test-only: reset the singleton between test files. */
export function __resetNetworkGatewayForTests(): void {
  singleton = undefined;
}
