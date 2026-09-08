/**
 * Host-side implementation of `INetworkApi` for one extension worker.
 *
 * The api-impl owns every host-side defense around the
 * outbound HTTP gateway:
 *
 *   1. Permission gate: every call requires `network`.
 *   2. URL parse + scheme check (`http(s):` only).
 *   3. Hostname allowlist match against `manifest.network.allowedHosts`
 *      wildcards.
 *   4. DNS resolve + private-IP block (loopback / RFC1918 / link-local /
 *      RFC4193). Private destinations require an explicit literal entry
 *      in `allowedHosts` AND the user-grantable `network:private-hosts`
 *      contract - for v1 we approximate that by accepting literal IPs
 *      that already appear in the allowlist verbatim. Anything else
 *      rejects with `NetworkHostNotAllowedError`.
 *   5. Method allowlist (per-host `methods` array, default = all).
 *   6. Per-extension throttle (sliding 60s window, default 120 req/min).
 *   7. Forward to the gateway, capping `maxResponseBytes` at the gateway
 *      level so a 1 GB response never sits in renderer memory.
 *   8. `redactHeaders` are stripped from the structured log message
 *      before it ever leaves the host process.
 *
 * Test surface: the impl is constructed with three injectable seams -
 * the gateway, a DNS resolver, and a clock. Production wires
 * `ElectronNetworkGateway`, `dns.promises.lookup`, and `Date.now`. Tests
 * inject in-memory fakes (see `NetworkApi.test.ts`).
 */

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import {
  type ExtensionPermissionGrant,
  requirePermission,
} from '../ExtensionPermissionGuard';
import type {
  GatewayMethod,
  GatewayRequest,
  IExtensionNetworkGateway,
} from '../gateways/ExtensionNetworkGateway';
import { NETWORK_MAX_REDIRECTS } from '../../config/constants';
import { isRedirectStatus, resolveRedirectTarget } from '../../utils/networkPolicy';

const {
  ExtensionNotActiveError,
  NetworkHostNotAllowedError,
  ResponseTooLargeError,
  RpcProtocolError,
} = Extensions;

type AllowedNetworkHost = Extensions.AllowedNetworkHost;

type NetworkFetchInit = Extensions.NetworkFetchInit;
type NetworkFetchResponse = Extensions.NetworkFetchResponse;

const ALLOWED_METHODS: ReadonlySet<GatewayMethod> = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
]);

/** `INetworkApi` defaults. */
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
export const MAX_FETCH_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
export const MAX_MAX_RESPONSE_BYTES = 100 * 1024 * 1024;
export const DEFAULT_THROTTLE_REQUESTS_PER_MINUTE = 120;
/** Default per-extension bandwidth cap: 50 MB per sliding 60 s window. */
export const DEFAULT_BANDWIDTH_BYTES_PER_MINUTE = 50 * 1024 * 1024;
const THROTTLE_WINDOW_MS = 60_000;

/** Resolve-IP shape - minimal slice of `dns.promises.lookup`. */
export interface DnsLookupResult {
  address: string;
  family: 4 | 6;
}

/** Pluggable DNS resolver. Returns every address for the given host. */
export type DnsResolver = (host: string) => Promise<DnsLookupResult[]>;

/** Structured record emitted for every outbound network request. */
export interface NetworkActivityRecord {
  extensionId: string;
  url: string;
  method: string;
  status: number | 'error';
  requestBytes: number;
  responseBytes: number;
  durationMs: number;
  timestamp: number;
}

/** Optional callback to receive per-request network activity. */
export type NetworkActivityLogger = (record: NetworkActivityRecord) => void;

export interface NetworkApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  grant: ExtensionPermissionGrant;
  /** Snapshot of the manifest's `network.allowedHosts`. May be empty. */
  allowedHosts: readonly AllowedNetworkHost[];
  gateway: IExtensionNetworkGateway;
  /**
   * Override the hostname resolver. When omitted, resolution goes through the
   * gateway (production: the transport's own resolver) and falls back to
   * `dns.promises.lookup`. Inject a fake in tests.
   */
  dnsResolver?: DnsResolver;
  /** Defaults to `Date.now`. Inject a fake clock for throttle tests. */
  clock?: () => number;
  /** Override the per-extension request budget. */
  throttleRequestsPerMinute?: number;
  /** Override the per-extension bandwidth cap (bytes per minute). */
  bandwidthBytesPerMinute?: number;
  /** Override the default 30s timeout. */
  defaultTimeoutMs?: number;
  /**
   * Optional network activity logger. Called for every completed request
   * (success or failure). Used by the host to populate the "Extension
   * Activity" panel for telemetry transparency.
   */
  activityLogger?: NetworkActivityLogger;
}

export class NetworkApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly grant: ExtensionPermissionGrant;
  private readonly allowedHosts: readonly AllowedNetworkHost[];
  private readonly gateway: IExtensionNetworkGateway;
  /** Explicit override only; see `resolveAddresses` for the resolution order. */
  private readonly dnsResolver: DnsResolver | undefined;
  private readonly clock: () => number;
  private readonly throttleLimit: number;
  private readonly bandwidthLimit: number;
  private readonly defaultTimeoutMs: number;
  private readonly activityLogger?: NetworkActivityLogger;

  /** Sliding-window timestamps for the request-count throttle. */
  private readonly recentRequestTimestamps: number[] = [];
  /** Sliding-window byte records for the bandwidth throttle. */
  private readonly recentBandwidthRecords: Array<{ ts: number; bytes: number }> = [];
  private disposed = false;

  constructor(opts: NetworkApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.grant = opts.grant;
    this.allowedHosts = opts.allowedHosts;
    this.gateway = opts.gateway;
    this.dnsResolver = opts.dnsResolver;
    this.clock = opts.clock ?? Date.now;
    this.throttleLimit =
      opts.throttleRequestsPerMinute ?? DEFAULT_THROTTLE_REQUESTS_PER_MINUTE;
    this.bandwidthLimit =
      opts.bandwidthBytesPerMinute ?? DEFAULT_BANDWIDTH_BYTES_PER_MINUTE;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    this.activityLogger = opts.activityLogger;
  }

  attach(): void {
    this.router.registerNamespace('network', {
      fetch: (args) => this.handleFetch(args),
      isHostAllowed: (args) => this.handleIsHostAllowed(args),
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.recentRequestTimestamps.length = 0;
    this.recentBandwidthRecords.length = 0;
  }

  /** Used by `authApiImpl.ts` to share a single throttle + gateway pipeline. */
  fetchInternal(url: string, init?: NetworkFetchInit): Promise<NetworkFetchResponse> {
    return this.doFetch(url, init);
  }

  // --- Handlers ---------------------------------------------------------

  private async handleFetch(args: unknown[]): Promise<NetworkFetchResponse> {
    this.assertActive();
    requirePermission(this.grant, 'network');
    const url = args[0];
    if (typeof url !== 'string' || url.length === 0) {
      throw new RpcProtocolError('network.fetch: url must be a non-empty string');
    }
    const init = args[1];
    if (init !== undefined && (typeof init !== 'object' || init === null)) {
      throw new RpcProtocolError('network.fetch: init must be an object when provided');
    }
    return this.doFetch(url, init as NetworkFetchInit | undefined);
  }

  private async handleIsHostAllowed(args: unknown[]): Promise<boolean> {
    this.assertActive();
    requirePermission(this.grant, 'network');
    const host = args[0];
    if (typeof host !== 'string' || host.length === 0) {
      throw new RpcProtocolError('network.isHostAllowed: host must be a non-empty string');
    }
    return this.findAllowedHost(host) !== undefined;
  }

  // --- Pipeline ---------------------------------------------------------

  private async doFetch(
    rawUrl: string,
    init: NetworkFetchInit | undefined,
  ): Promise<NetworkFetchResponse> {
    // -- Caller-supplied options: validated once, they apply to every hop --
    const requestedMethod: GatewayMethod = (init?.method ?? 'GET') as GatewayMethod;
    if (!ALLOWED_METHODS.has(requestedMethod)) {
      throw new RpcProtocolError(`network.fetch: unsupported method '${requestedMethod}'`);
    }

    const { headerMap, bodyBytes } = serializeBodyAndHeaders(init);

    const requestedMaxBytes = init?.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (typeof requestedMaxBytes !== 'number' || requestedMaxBytes <= 0) {
      throw new RpcProtocolError('network.fetch: maxResponseBytes must be a positive number');
    }
    const maxResponseBytes = Math.min(requestedMaxBytes, MAX_MAX_RESPONSE_BYTES);

    const requestedTimeout = init?.timeoutMs ?? this.defaultTimeoutMs;
    if (typeof requestedTimeout !== 'number' || requestedTimeout <= 0) {
      throw new RpcProtocolError('network.fetch: timeoutMs must be a positive number');
    }
    const timeoutMs = Math.min(requestedTimeout, MAX_FETCH_TIMEOUT_MS);

    const redirectMode = init?.redirect ?? 'follow';
    if (redirectMode !== 'follow' && redirectMode !== 'error' && redirectMode !== 'manual') {
      throw new RpcProtocolError(`network.fetch: invalid redirect '${String(redirectMode)}'`);
    }

    // Throttle once per caller-initiated fetch rather than once per hop - a
    // three-hop redirect chain is still one request from the extension's
    // point of view. Bandwidth, by contrast, accrues on every hop below,
    // because every hop moves real bytes.
    this.enforceThrottle();

    // -- Redirect loop ----------------------------------------------------
    //
    // Redirects are followed HERE, not by the transport, so the full
    // destination policy (scheme + allowlist + method + DNS + private-IP)
    // re-runs against every hop. An allowlisted host that answers 302 with
    // `Location: http://169.254.169.254/` is precisely the SSRF this pipeline
    // exists to stop, and validating only the first URL would wave it through.
    let currentUrl = rawUrl;
    let method = requestedMethod;
    let headers = headerMap;
    let body = bodyBytes;
    let hopsRemaining = NETWORK_MAX_REDIRECTS;

    for (;;) {
      const parsed = await this.validateTarget(currentUrl, method);

      this.enforceBandwidth();
      const requestBodyBytes = body ? body.byteLength : 0;
      const fetchStart = this.clock();

      const gatewayReq: GatewayRequest = {
        url: parsed.toString(),
        method,
        headers,
        maxResponseBytes,
        timeoutMs,
        // Always manual: this loop owns redirect policy. The caller's own
        // `redirect` preference is applied to the *result* below.
        redirect: 'manual',
        ...(body ? { body } : {}),
      };

      const result = await this.gateway.fetch(gatewayReq);
      if (!result.ok) {
        // Even failed requests consume outbound bandwidth.
        this.recordBandwidth(requestBodyBytes);
        this.logActivity(parsed.toString(), method, 'error', requestBodyBytes, 0, fetchStart);
        if (result.code === 'ResponseTooLargeError') {
          throw new ResponseTooLargeError(result.message, {
            extensionId: this.extensionId,
            maxResponseBytes,
          });
        }
        // Both timeout and generic transport failures collapse into
        // RpcProtocolError on the wire so the worker sees a clear,
        // actionable error code. The structured `data` carries the
        // gateway-side classification.
        throw new RpcProtocolError(result.message, {
          extensionId: this.extensionId,
          gatewayCode: result.code,
        });
      }

      const responseBytes = result.body.byteLength;
      this.recordBandwidth(requestBodyBytes + responseBytes);
      this.logActivity(
        parsed.toString(),
        method,
        result.status,
        requestBodyBytes,
        responseBytes,
        fetchStart,
      );

      if (isRedirectStatus(result.status)) {
        if (redirectMode === 'error') {
          throw new RpcProtocolError(
            `network.fetch: redirect encountered (${result.status}) but redirect='error'`,
            { extensionId: this.extensionId, url: parsed.toString(), status: result.status },
          );
        }
        if (redirectMode === 'follow') {
          let nextUrl: string;
          try {
            // Enforces the hop budget, resolves relative Locations, rejects
            // non-HTTP schemes, and refuses https -> http downgrades.
            nextUrl = resolveRedirectTarget(
              currentUrl,
              result.headers['location'],
              hopsRemaining,
            );
          } catch (err) {
            throw new RpcProtocolError(`network.fetch: ${(err as Error).message}`, {
              extensionId: this.extensionId,
              url: parsed.toString(),
            });
          }
          hopsRemaining -= 1;
          ({ method, headers, body } = applyRedirectRules({
            status: result.status,
            fromUrl: parsed.toString(),
            toUrl: nextUrl,
            method,
            headers,
            body,
          }));
          currentUrl = nextUrl;
          continue;
        }
        // redirectMode === 'manual' - hand the 3xx back verbatim.
      }

      return decodeGatewayResponse(result, init?.responseType ?? 'text');
    }
  }

  /**
   * Run the full destination policy against a single URL. Called for the
   * initial request AND for every redirect hop.
   *
   * Returns the parsed URL so the caller can hand a normalized string to the
   * transport.
   */
  private async validateTarget(rawUrl: string, method: GatewayMethod): Promise<URL> {
    // 1. URL parse + scheme check
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new RpcProtocolError(`network.fetch: invalid URL '${rawUrl}'`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new RpcProtocolError(
        `network.fetch: only http(s): URLs are allowed (got '${parsed.protocol}')`,
      );
    }

    // 2. Allowlist match (literal host text - the resolve below catches
    // rebinding attacks).
    const hostname = parsed.hostname;
    const allowedEntry = this.findAllowedHost(hostname);
    if (!allowedEntry) {
      throw new NetworkHostNotAllowedError(
        `Host '${hostname}' is not in the manifest allowlist for ${this.extensionId}`,
        { extensionId: this.extensionId, host: hostname },
      );
    }

    // 3. Method allowlist. Re-checked per hop because a 301/302/303 can
    // rewrite the method to GET, and a host may be allowlisted for only some
    // verbs.
    const allowedMethods = allowedEntry.methods;
    if (allowedMethods && !allowedMethods.includes(method)) {
      throw new NetworkHostNotAllowedError(
        `Method '${method}' is not allowed for host '${hostname}' (allowed: ${allowedMethods.join(', ')})`,
        { extensionId: this.extensionId, host: hostname, method },
      );
    }

    // 4. Resolve + private-IP block. Bare-IP literal entries skip the resolve
    // step because the literal already represents the destination, and the
    // user has already explicitly approved them at install time.
    if (!isLiteralIp(hostname)) {
      let resolved: DnsLookupResult[] = [];
      try {
        resolved = await this.resolveAddresses(hostname);
      } catch (err) {
        throw new NetworkHostNotAllowedError(
          `DNS resolution failed for '${hostname}': ${(err as Error).message}`,
          { extensionId: this.extensionId, host: hostname },
        );
      }
      if (resolved.length === 0) {
        throw new NetworkHostNotAllowedError(
          `Host '${hostname}' resolved to no addresses — refusing to connect`,
          { extensionId: this.extensionId, host: hostname },
        );
      }
      for (const r of resolved) {
        if (isPrivateAddress(r.address)) {
          throw new NetworkHostNotAllowedError(
            `Host '${hostname}' resolved to private address '${r.address}' — refusing to connect`,
            { extensionId: this.extensionId, host: hostname, address: r.address },
          );
        }
      }
    } else if (isPrivateAddress(hostname)) {
      // Literal private IP - only allowed if it appears verbatim in the
      // allowlist. The matcher above already enforced this; we double-check
      // here so the spec rule is visible.
      const literalEntry = this.allowedHosts.find((h) => h.host === hostname);
      if (!literalEntry) {
        throw new NetworkHostNotAllowedError(
          `Private literal '${hostname}' is not explicitly listed in allowedHosts`,
          { extensionId: this.extensionId, host: hostname },
        );
      }
    }

    return parsed;
  }

  /**
   * Resolve a hostname to its addresses.
   *
   * Order matters. An explicitly injected resolver wins so tests can drive the
   * pipeline deterministically. Otherwise we ask the *transport* to resolve -
   * in production that is Chromium's resolver via the extension's isolated
   * `Session`, i.e. the same resolver and the same cache that will pick the
   * address `net.request` actually connects to.
   *
   * That last point is the whole reason this indirection exists. Validating
   * with Node's `dns.lookup` and then handing the hostname to `net.request`
   * meant two completely independent resolvers, so a rebinding server could
   * answer the check with a public address and the connection with a private
   * one - the validation was close to advisory. Sharing the resolver narrows
   * that to Chromium's own cache-entry lifetime.
   */
  private async resolveAddresses(hostname: string): Promise<DnsLookupResult[]> {
    if (this.dnsResolver) return await this.dnsResolver(hostname);
    const viaTransport = this.gateway.resolveHost;
    if (viaTransport) return await viaTransport.call(this.gateway, hostname);
    return await defaultDnsResolver(hostname);
  }

  // --- Helpers ----------------------------------------------------------

  private assertActive(): void {
    if (this.disposed) {
      throw new ExtensionNotActiveError(
        `networkApiImpl for ${this.extensionId} is disposed`,
      );
    }
  }

  private findAllowedHost(hostname: string): AllowedNetworkHost | undefined {
    return this.allowedHosts.find((entry) => matchesHostPattern(entry.host, hostname));
  }

  private enforceThrottle(): void {
    const now = this.clock();
    const cutoff = now - THROTTLE_WINDOW_MS;
    while (
      this.recentRequestTimestamps.length > 0 &&
      this.recentRequestTimestamps[0]! < cutoff
    ) {
      this.recentRequestTimestamps.shift();
    }
    if (this.recentRequestTimestamps.length >= this.throttleLimit) {
      throw new RpcProtocolError(
        `network.fetch: throttle exceeded (${this.throttleLimit} req/min) for ${this.extensionId}`,
        { extensionId: this.extensionId, throttleLimit: this.throttleLimit },
      );
    }
    this.recentRequestTimestamps.push(now);
  }

  /**
   * Pre-flight bandwidth check - reject the request if the extension has
   * already transferred more than `bandwidthLimit` bytes in the current
   * sliding 60 s window.
   */
  private enforceBandwidth(): void {
    const now = this.clock();
    const cutoff = now - THROTTLE_WINDOW_MS;
    while (
      this.recentBandwidthRecords.length > 0 &&
      this.recentBandwidthRecords[0]!.ts < cutoff
    ) {
      this.recentBandwidthRecords.shift();
    }
    let totalBytes = 0;
    for (const rec of this.recentBandwidthRecords) {
      totalBytes += rec.bytes;
    }
    if (totalBytes >= this.bandwidthLimit) {
      const limitMB = (this.bandwidthLimit / (1024 * 1024)).toFixed(0);
      throw new RpcProtocolError(
        `network.fetch: bandwidth exceeded (${limitMB} MB/min) for ${this.extensionId}`,
        { extensionId: this.extensionId, bandwidthLimit: this.bandwidthLimit, usedBytes: totalBytes },
      );
    }
  }

  /** Record bytes transferred against the bandwidth sliding window. */
  private recordBandwidth(bytes: number): void {
    if (bytes > 0) {
      this.recentBandwidthRecords.push({ ts: this.clock(), bytes });
    }
  }

  /** Emit a structured activity record for telemetry transparency. */
  private logActivity(
    url: string,
    method: string,
    status: number | 'error',
    requestBytes: number,
    responseBytes: number,
    startTime: number,
  ): void {
    if (!this.activityLogger) return;
    this.activityLogger({
      extensionId: this.extensionId,
      url,
      method,
      status,
      requestBytes,
      responseBytes,
      durationMs: this.clock() - startTime,
      timestamp: startTime,
    });
  }
}

// --- Default DNS resolver -------------------------------------------------

const defaultDnsResolver: DnsResolver = async (host) => {
  // Lazy require so the module is loadable in environments where `dns` is
  // unavailable (e.g. tests that supply their own resolver).
  const dns = await import('dns');
  const results = await dns.promises.lookup(host, { all: true });
  return results.map((r) => ({ address: r.address, family: r.family as 4 | 6 }));
};

// --- Hostname matching ---------------------------------------------------

/**
 * Match a manifest pattern against a real hostname. Patterns:
 *
 *   - `example.com`        -> matches only `example.com`
 *   - `*.example.com`      -> matches `a.example.com`, `b.c.example.com`,
 *                             but NOT `example.com` itself
 *   - `*`                  -> matches anything (rejected by manifest validator)
 */
export function matchesHostPattern(pattern: string, hostname: string): boolean {
  if (!pattern || !hostname) return false;
  const p = pattern.toLowerCase();
  const h = hostname.toLowerCase();
  if (p === h) return true;
  if (p.startsWith('*.')) {
    const suffix = p.slice(1); // ".example.com"
    return h.endsWith(suffix) && h.length > suffix.length;
  }
  return false;
}

// --- IP classification ---------------------------------------------------

const IPV4_LITERAL = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_GROUP = /^[0-9a-f]{1,4}$/;

/** Four octets of an IPv4 address, most-significant first. */
type Ipv4Octets = readonly [number, number, number, number];

/** Strip the `[...]` wrapper browsers put around IPv6 hosts inside URLs. */
function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/**
 * Parse a dotted-quad. Returns `undefined` for anything that isn't a valid
 * IPv4 literal - including out-of-range octets like `999.1.1.1`, which the
 * old bare regex accepted and then classified as public.
 */
function parseIpv4(value: string): Ipv4Octets | undefined {
  const m = IPV4_LITERAL.exec(value);
  if (!m) return undefined;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if (a > 255 || b > 255 || c > 255 || d > 255) return undefined;
  return [a, b, c, d];
}

/**
 * Expand an IPv6 literal into its eight 16-bit groups, or `undefined` if the
 * input isn't a valid IPv6 address. A trailing dotted-quad (`::ffff:127.0.0.1`)
 * is folded into the final two groups, and a `%zone` suffix is discarded, so
 * every spelling of an address reaches the classifier in one canonical form.
 */
function parseIpv6(value: string): number[] | undefined {
  let text = value.toLowerCase();
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  if (!text.includes(':')) return undefined;

  // Fold an embedded IPv4 tail into two hex groups before splitting.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const quad = parseIpv4(tail);
    if (!quad) return undefined;
    const hi = ((quad[0] << 8) | quad[1]).toString(16);
    const lo = ((quad[2] << 8) | quad[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  for (const g of [...head, ...rest]) {
    if (!IPV6_GROUP.test(g)) return undefined;
  }

  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return undefined;
    return [
      ...head.map((g) => parseInt(g, 16)),
      ...new Array<number>(fill).fill(0),
      ...rest.map((g) => parseInt(g, 16)),
    ];
  }
  if (head.length !== 8) return undefined;
  return head.map((g) => parseInt(g, 16));
}

/**
 * Pull the IPv4 address out of an IPv6 address that merely wraps one. Covers
 * IPv4-mapped (`::ffff:a.b.c.d`), the deprecated IPv4-compatible form
 * (`::a.b.c.d`), and the RFC 6052 NAT64 well-known prefix
 * (`64:ff9b::a.b.c.d`).
 *
 * These are classified by the address they carry rather than being blanket
 * blocked: `64:ff9b::8.8.8.8` really does reach 8.8.8.8 and should be allowed,
 * while `::ffff:169.254.169.254` is the cloud-metadata endpoint wearing a
 * different hat and must not slip past the IPv4 rules.
 */
function embeddedIpv4(groups: number[]): Ipv4Octets | undefined {
  const g6 = groups[6] ?? 0;
  const g7 = groups[7] ?? 0;
  const low = (): Ipv4Octets => [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff];

  const topFiveZero =
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0;

  // ::ffff:0:0/96 (mapped) and ::/96 (compatible).
  if (topFiveZero && (groups[5] === 0xffff || groups[5] === 0)) {
    // `::`, `::1` and friends are plain IPv6 specials, not wrapped IPv4 -
    // leave them to the IPv6 classifier.
    if (groups[5] === 0 && g6 === 0) return undefined;
    return low();
  }
  // 64:ff9b::/96 - NAT64 well-known prefix (RFC 6052 section 2.1).
  if (
    groups[0] === 0x64 &&
    groups[1] === 0xff9b &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0
  ) {
    return low();
  }
  return undefined;
}

function isPrivateIpv4(octets: Ipv4Octets): boolean {
  const [a, b] = octets;
  if (a === 0) return true; //                       0.0.0.0/8     "this network"
  if (a === 10) return true; //                      10.0.0.0/8    RFC1918
  if (a === 127) return true; //                     127.0.0.0/8   loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT (RFC6598)
  if (a === 169 && b === 254) return true; //        169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 RFC1918
  if (a === 192 && b === 168) return true; //        192.168.0.0/16 RFC1918
  return false;
}

function isPrivateIpv6(groups: number[]): boolean {
  if (groups.every((g) => g === 0)) return true; // ::  unspecified
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1
  const first = groups[0] ?? 0;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7  unique-local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

export function isLiteralIp(host: string): boolean {
  const stripped = stripBrackets(host);
  if (parseIpv4(stripped) !== undefined) return true;
  return parseIpv6(stripped) !== undefined;
}

/**
 * True for any address that should never be reachable from an extension
 * unless the user has explicitly approved a literal allowlist entry.
 *
 * Covers:
 *   - 0.0.0.0/8          "this network"
 *   - 10.0.0.0/8         RFC1918
 *   - 100.64.0.0/10      CGNAT (RFC6598)
 *   - 127.0.0.0/8        loopback
 *   - 169.254.0.0/16     link-local (incl. the cloud metadata endpoint)
 *   - 172.16.0.0/12      RFC1918
 *   - 192.168.0.0/16     RFC1918
 *   - ::                 IPv6 unspecified
 *   - ::1                IPv6 loopback
 *   - fc00::/7           IPv6 unique-local
 *   - fe80::/10          IPv6 link-local
 *   - ::ffff:a.b.c.d     IPv4-mapped IPv6 - classified by the embedded address
 *   - 64:ff9b::a.b.c.d   NAT64 (RFC6052) - classified by the embedded address
 */
export function isPrivateAddress(addr: string): boolean {
  const stripped = stripBrackets(addr);

  const v4 = parseIpv4(stripped);
  if (v4) return isPrivateIpv4(v4);

  const v6 = parseIpv6(stripped);
  if (!v6) return false;

  const embedded = embeddedIpv4(v6);
  if (embedded) return isPrivateIpv4(embedded);

  return isPrivateIpv6(v6);
}

// --- Redirect rewrite rules ----------------------------------------------

interface RedirectRewrite {
  method: GatewayMethod;
  headers: Record<string, string>;
  body: Uint8Array | undefined;
}

/**
 * Rewrite the request for the next hop of a redirect chain.
 *
 * Two rules, both of which match what browsers and `fetch()` do:
 *
 *   1. 301/302/303 turn a non-GET/HEAD request into a GET and drop the body.
 *      307/308 preserve the method and body. (This is why `validateTarget`
 *      re-checks the method allowlist per hop - the verb can change.)
 *   2. `Authorization` and `Cookie` are stripped when the hop crosses to a
 *      different origin, so an allowlisted host cannot harvest credentials
 *      meant for another allowlisted host by answering with a redirect.
 */
function applyRedirectRules(opts: {
  status: number;
  fromUrl: string;
  toUrl: string;
  method: GatewayMethod;
  headers: Record<string, string>;
  body: Uint8Array | undefined;
}): RedirectRewrite {
  let method = opts.method;
  let body = opts.body;

  const rewritesToGet = opts.status === 301 || opts.status === 302 || opts.status === 303;
  if (rewritesToGet && method !== 'GET' && method !== 'HEAD') {
    method = 'GET';
    body = undefined;
  }

  const headers: Record<string, string> = {};
  const sameOrigin = isSameOrigin(opts.fromUrl, opts.toUrl);
  for (const [k, v] of Object.entries(opts.headers)) {
    const lower = k.toLowerCase();
    if (!sameOrigin && (lower === 'authorization' || lower === 'cookie')) continue;
    // A body-less GET should not keep advertising the old body's shape.
    if (body === undefined && (lower === 'content-type' || lower === 'content-length')) continue;
    headers[k] = v;
  }

  return { method, headers, body };
}

function isSameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.protocol === ub.protocol && ua.host === ub.host;
  } catch {
    return false;
  }
}

// --- Body / header serialization ----------------------------------------

interface SerializedRequest {
  headerMap: Record<string, string>;
  bodyBytes: Uint8Array | undefined;
}

function serializeBodyAndHeaders(init: NetworkFetchInit | undefined): SerializedRequest {
  const headers: Record<string, string> = {};
  if (init?.headers) {
    for (const [k, v] of Object.entries(init.headers)) {
      if (typeof v !== 'string') {
        throw new RpcProtocolError(
          `network.fetch: header '${k}' must be a string (got ${typeof v})`,
        );
      }
      headers[k] = v;
    }
  }

  if (!init?.body) return { headerMap: headers, bodyBytes: undefined };

  const body = init.body;
  if (typeof body === 'string') {
    return { headerMap: headers, bodyBytes: new TextEncoder().encode(body) };
  }
  if (body instanceof Uint8Array) {
    return { headerMap: headers, bodyBytes: body };
  }
  if (body instanceof ArrayBuffer) {
    return { headerMap: headers, bodyBytes: new Uint8Array(body) };
  }
  if (typeof body === 'object' && body !== null && 'json' in body) {
    if (!('content-type' in headers) && !('Content-Type' in headers)) {
      headers['content-type'] = 'application/json';
    }
    const serialized = JSON.stringify((body as { json: unknown }).json);
    if (serialized === undefined) {
      throw new RpcProtocolError('network.fetch: body.json is not JSON-serializable');
    }
    return { headerMap: headers, bodyBytes: new TextEncoder().encode(serialized) };
  }
  if (typeof body === 'object' && body !== null && 'form' in body) {
    if (!('content-type' in headers) && !('Content-Type' in headers)) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
    }
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries((body as { form: Record<string, string> }).form)) {
      params.append(k, String(v));
    }
    return { headerMap: headers, bodyBytes: new TextEncoder().encode(params.toString()) };
  }
  throw new RpcProtocolError('network.fetch: unsupported body shape');
}

function decodeGatewayResponse(
  result: { status: number; statusText: string; headers: Record<string, string>; url: string; body: Uint8Array },
  responseType: 'text' | 'json' | 'arrayBuffer',
): NetworkFetchResponse {
  const ok = result.status >= 200 && result.status < 300;
  let body: string | unknown | ArrayBuffer;
  if (responseType === 'arrayBuffer') {
    // Copy out of the worker-shared buffer.
    body = result.body.slice().buffer;
  } else if (responseType === 'json') {
    const text = new TextDecoder().decode(result.body);
    if (text.length === 0) {
      body = undefined;
    } else {
      try {
        body = JSON.parse(text);
      } catch (err) {
        throw new RpcProtocolError(
          `network.fetch: response was not valid JSON: ${(err as Error).message}`,
        );
      }
    }
  } else {
    body = new TextDecoder().decode(result.body);
  }
  return {
    ok,
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
    url: result.url,
    body,
  };
}
