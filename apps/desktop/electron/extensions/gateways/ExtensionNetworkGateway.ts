/**
 * ExtensionNetworkGateway - host-side outbound HTTP gateway for extensions.
 *
 * The gateway is the *transport* half of the
 * `INetworkApi.fetch` pipeline: by the time a request reaches it the
 * api-impl has already validated the URL scheme, matched the host against
 * the manifest allowlist, performed DNS-resolve + private-IP rejection,
 * and applied per-extension throttling. The gateway only owns the
 * "actually open a socket" step plus body collection / size capping.
 *
 * Two implementations live here:
 *
 *   - `IExtensionNetworkGateway` - the interface the api-impl depends on.
 *     Tests inject a fake (see `NetworkApi.test.ts`).
 *   - `ElectronNetworkGateway` - production wrapper that opens its socket
 *     through the app-wide `NetworkGateway` (the single egress choke-point),
 *     running on an isolated `Session` so cookies, credentials, and proxy
 *     state never bleed in from the user's browsing profile. Routing through
 *     the shared gateway means the master offline switch turns extension
 *     egress off together with everything else, while the per-extension
 *     `Session` isolation is preserved (it is passed straight through).
 *
 * The gateway never throws - it returns either a `GatewayResponse` or a
 * `GatewayError` so the api-impl can map the error code to the matching
 * `ExtensionApiError` subclass with a clear message.
 */

import type { Session } from 'electron';
import { getNetworkGateway, type INetworkGateway } from '../../services/NetworkGateway';

/** Methods the network gateway forwards. Mirrors `NetworkFetchInit['method']`. */
export type GatewayMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

/** Resolved request the api-impl hands to the gateway. */
export interface GatewayRequest {
  url: string;
  method: GatewayMethod;
  headers: Record<string, string>;
  /**
   * Body bytes (already serialized by the api-impl). `undefined` for
   * GET/HEAD requests.
   */
  body?: Uint8Array;
  /** Resolved cap; the gateway aborts the read once this many bytes arrive. */
  maxResponseBytes: number;
  /** Hard ceiling for the underlying request, in milliseconds. */
  timeoutMs: number;
  /** Mirrors `NetworkFetchInit.redirect`. */
  redirect: 'follow' | 'error' | 'manual';
}

/** Successful response payload returned to the api-impl. */
export interface GatewayResponse {
  ok: true;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Final URL after redirects. */
  url: string;
  body: Uint8Array;
}

/**
 * Failure modes the gateway reports back. The api-impl maps each `code` to
 * the matching `ExtensionApiError` subclass before throwing.
 */
export type GatewayError =
  | { ok: false; code: 'ResponseTooLargeError'; message: string }
  | { ok: false; code: 'NetworkTimeoutError'; message: string }
  | { ok: false; code: 'NetworkRequestFailedError'; message: string };

/** One address a hostname resolved to. Mirrors `DnsLookupResult`. */
export interface GatewayResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface IExtensionNetworkGateway {
  /**
   * Perform a single HTTP request. Never throws - returns either a
   * `GatewayResponse` or a `GatewayError`.
   *
   * Redirects are NOT followed here: the api-impl drives the hop loop itself
   * so its allowlist / private-IP policy re-runs against every hop. Callers
   * always pass `redirect: 'manual'`.
   */
  fetch(req: GatewayRequest): Promise<GatewayResponse | GatewayError>;

  /**
   * Resolve a hostname using the same resolver this transport will use when
   * it opens the socket.
   *
   * Optional so test fakes can omit it - the api-impl falls back to its
   * injected resolver. Implementing it is what lets the private-IP check and
   * the connection agree on an address instead of consulting two independent
   * resolvers (the DNS-rebinding TOCTOU).
   */
  resolveHost?(hostname: string): Promise<GatewayResolvedAddress[]>;
}

// --- Production implementation (Electron net.request) ---------------------

/**
 * Electron-backed gateway. Lazily resolves a `Session` so the production
 * factory can defer the cost of the partition until the first request, and
 * tests can stub the session out entirely. Each extension gets its own
 * session partition keyed by `ext.<id>` so cookies, cache, and HTTP auth
 * cannot bleed across extensions.
 */
export class ElectronNetworkGateway implements IExtensionNetworkGateway {
  private readonly extensionId: string;
  private session: Session | undefined;
  private readonly sessionFactory: (extensionId: string) => Session;
  private readonly networkGateway: () => INetworkGateway;

  constructor(opts: {
    extensionId: string;
    /** Override for tests. Production passes a closure over `session.fromPartition`. */
    sessionFactory: (extensionId: string) => Session;
    /**
     * The app-wide egress gateway. Defaults to the initialized singleton;
     * tests inject a fake so they never touch a real `electron` runtime.
     */
    networkGateway?: INetworkGateway;
  }) {
    this.extensionId = opts.extensionId;
    this.sessionFactory = opts.sessionFactory;
    const injected = opts.networkGateway;
    this.networkGateway = injected ? (): INetworkGateway => injected : getNetworkGateway;
  }

  /**
   * Resolve through the extension's own `Session`, which is the resolver
   * `net.request` will consult (and the cache it will hit) when this same
   * gateway opens the socket a moment later. Validating against a *different*
   * resolver - which is what a bare `dns.lookup` in the api-impl amounted to -
   * left the private-IP check trivially bypassable by a rebinding server.
   */
  async resolveHost(hostname: string): Promise<GatewayResolvedAddress[]> {
    if (!this.session) {
      this.session = this.sessionFactory(this.extensionId);
    }
    const resolved = await this.session.resolveHost(hostname);
    return resolved.endpoints.map((e) => ({
      address: e.address,
      family: e.family === 'ipv6' ? 6 : 4,
    }));
  }

  async fetch(req: GatewayRequest): Promise<GatewayResponse | GatewayError> {
    const gateway = this.networkGateway();

    // Master offline switch, checked before anything else - no socket, no
    // session created. This class never throws, so map the blocked state onto
    // the existing error union.
    if (gateway.isOffline()) {
      return {
        ok: false,
        code: 'NetworkRequestFailedError',
        message: 'offline mode',
      };
    }

    if (!this.session) {
      this.session = this.sessionFactory(this.extensionId);
    }
    return await new Promise<GatewayResponse | GatewayError>((resolve) => {
      let settled = false;
      const finish = (r: GatewayResponse | GatewayError): void => {
        if (settled) return;
        settled = true;
        resolve(r);
      };

      let request: ReturnType<INetworkGateway['createRequest']>;
      try {
        request = gateway.createRequest({
          url: req.url,
          method: req.method,
          // Per-extension session isolation is preserved: the isolated
          // partition Session is passed straight through, and session-level
          // credentials stay disabled so OS auth + cookies never attach to
          // extension traffic implicitly.
          session: this.session,
          useSessionCookies: false,
          redirect: req.redirect === 'manual' ? 'manual' : req.redirect,
          context: `extension ${this.extensionId}`,
        });
      } catch (err) {
        finish({
          ok: false,
          code: 'NetworkRequestFailedError',
          message: `net.request rejected: ${(err as Error).message}`,
        });
        return;
      }

      for (const [k, v] of Object.entries(req.headers)) {
        try {
          request.setHeader(k, v);
        } catch (err) {
          finish({
            ok: false,
            code: 'NetworkRequestFailedError',
            message: `setHeader('${k}') rejected: ${(err as Error).message}`,
          });
          return;
        }
      }

      const timer = setTimeout(() => {
        try {
          request.abort();
        } catch {
          /* swallow */
        }
        finish({
          ok: false,
          code: 'NetworkTimeoutError',
          message: `Request timed out after ${req.timeoutMs}ms`,
        });
      }, req.timeoutMs);

      request.on('response', (response) => {
        const chunks: Buffer[] = [];
        let total = 0;
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(response.headers)) {
          headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
        }
        response.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > req.maxResponseBytes) {
            try {
              request.abort();
            } catch {
              /* swallow */
            }
            clearTimeout(timer);
            finish({
              ok: false,
              code: 'ResponseTooLargeError',
              message: `Response exceeded ${req.maxResponseBytes} bytes`,
            });
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (settled) return;
          clearTimeout(timer);
          const body = Buffer.concat(chunks, total);
          finish({
            ok: true,
            status: response.statusCode,
            statusText: response.statusMessage,
            headers,
            // electron's `net.request` does not surface the final URL on
            // the response object; the request URL is the best we can do
            // when redirect=manual or follow without explicit tracking.
            url: req.url,
            body: new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
          });
        });
        response.on('error', (err: Error) => {
          clearTimeout(timer);
          finish({
            ok: false,
            code: 'NetworkRequestFailedError',
            message: `Response stream errored: ${err.message}`,
          });
        });
      });
      request.on('error', (err: Error) => {
        clearTimeout(timer);
        finish({
          ok: false,
          code: 'NetworkRequestFailedError',
          message: `net.request errored: ${err.message}`,
        });
      });
      request.on('abort', () => {
        clearTimeout(timer);
        finish({
          ok: false,
          code: 'NetworkRequestFailedError',
          message: 'net.request aborted',
        });
      });

      if (req.body && req.body.byteLength > 0) {
        request.write(Buffer.from(req.body));
      }
      request.end();
    });
  }
}

/**
 * Build the production session factory. Pulled into its own function so
 * `main.ts` can wire it once and the rest of the host treats sessions as
 * an opaque dependency.
 */
export function defaultExtensionSessionFactory(): (extensionId: string) => Session {
  return (extensionId: string): Session => {
    // Lazy require so unit tests can import the factory module without
    // touching electron internals at module-load time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { session } = require('electron') as typeof import('electron');
    return session.fromPartition(`ext.${extensionId}`, { cache: false });
  };
}
