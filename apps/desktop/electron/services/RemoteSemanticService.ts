/**
 * RemoteSemanticService - the main-process side of the online meaning search
 * (task 0190). It holds the one `RemoteSemanticClient`, the first-use consent
 * record, and the rules that keep both honest:
 *
 *  - NOTHING is sent unless the build configured a service AND the user agreed
 *    (`consent === 'granted'`, for the current notice version) AND the chosen
 *    source is `online` (see `SemanticSource`). Not even a `/v1/info` probe.
 *  - Calls go through `NetworkGateway.fetchBuffered`, the app's single egress
 *    choke-point, so the master "Allow web requests" switch applies. With the
 *    switch off the call is refused before a socket opens; that surfaces as a
 *    `network` error, which the caller treats like any other remote failure
 *    (fall back to the installed pack).
 *  - The API key lives here and in `config/appConfig.ts` only. It never crosses
 *    the preload bridge.
 *
 * Consent is stored under the key `remoteSemantic.consent` (and the source
 * choice under `semanticSearch.source`) in a small JSON file
 * in userData (like `NetworkConfig`): it is a per-install privacy choice, not
 * user content, so it stays out of the backed-up user database.
 */

import fs from 'fs';
import path from 'path';
import log from 'electron-log';
import { RemoteSemantic } from '@bible/core';
import { APP_CONFIG } from '../config/appConfig';
import { getNetworkGateway, type INetworkGateway } from './NetworkGateway';

export const CONSENT_KEY = 'remoteSemantic.consent';
export const SOURCE_KEY = 'semanticSearch.source';

export type ConsentDecisionArg = 'granted' | 'declined' | 'reset';

/**
 * Where meaning (semantic) search runs, chosen in Preferences > Search:
 *  - `online`  the hosted service (after first-use consent); the installed pack,
 *              if any, answers when the service cannot.
 *  - `offline` the installed pack only; nothing is ever sent.
 *  - `off`     no meaning search at all; keyword search only.
 */
export type SemanticSource = 'online' | 'offline' | 'off';
export const SEMANTIC_SOURCES: readonly SemanticSource[] = ['online', 'offline', 'off'];

export interface RemoteSemanticStatus {
  /** A service URL is baked into this build. When false, the online option does not exist in the UI. */
  configured: boolean;
  consent: RemoteSemantic.ConsentStatus;
  noticeVersion: number;
  /** ISO time of the current decision (absent when unset). */
  consentedAt?: string;
  /** The effective source: never `online` in a build without a service. */
  source: SemanticSource;
}

/** Where the consent record (and the source choice) is persisted. Injectable for tests. */
export interface ConsentStore {
  read(): unknown;
  write(record: RemoteSemantic.ConsentRecord | null): void;
  /** Optional: a store without these keeps the source in memory only. */
  readSource?(): unknown;
  writeSource?(source: SemanticSource): void;
}

export class JsonFileConsentStore implements ConsentStore {
  constructor(private readonly filePath: string) {}

  private readAll(): Record<string, unknown> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  private update(key: string, value: unknown): void {
    try {
      const body = this.readAll();
      if (value === undefined) delete body[key];
      else body[key] = value;
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(body, null, 2), 'utf-8');
    } catch (err) {
      log.warn('[remote-semantic] could not persist setting:', err);
      throw err;
    }
  }

  read(): unknown {
    return this.readAll()[CONSENT_KEY];
  }

  write(record: RemoteSemantic.ConsentRecord | null): void {
    this.update(CONSENT_KEY, record ?? undefined);
  }

  readSource(): unknown {
    return this.readAll()[SOURCE_KEY];
  }

  writeSource(source: SemanticSource): void {
    this.update(SOURCE_KEY, source);
  }
}

export interface RemoteSemanticServiceOptions {
  url: string;
  apiKey: string;
  store: ConsentStore;
  /**
   * Sent as `User-Agent` on every call, so the service can tell desktop
   * traffic (and which version) apart, and throttle a misbehaving release,
   * without an API key. See `remoteSemanticUserAgent`.
   */
  userAgent?: string;
  /** Defaults to the app gateway. */
  getGateway?: () => INetworkGateway;
  /** Test seam: replaces the gateway-backed fetch. */
  fetch?: typeof fetch;
  now?: () => Date;
  /** Test seam: replaces the client's retry sleep. */
  sleep?: (ms: number) => Promise<void>;
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * The app's self-description to the search service: product, version and,
 * when known, the short git commit it was built from (`+<sha>`, semver build
 * metadata), so a dev or test build is told apart from a tagged release.
 * No platform, architecture or Electron/Chromium version - Chromium's default
 * User-Agent carries all three, and the service has no use for them.
 */
export function remoteSemanticUserAgent(appVersion: string, buildId = ''): string {
  const build = /^[0-9A-Za-z.-]+$/.test(buildId) ? `+${buildId}` : '';
  return `KeepThyHeartBible/${appVersion}${build} (desktop)`;
}

/** A `fetch` look-alike over `NetworkGateway.fetchBuffered` (no redirects, 10 s). */
export function gatewayFetch(getGateway: () => INetworkGateway, userAgent?: string): typeof fetch {
  return (async (input: unknown, init: RequestInit = {}) => {
    const gateway = getGateway();
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
    if (userAgent) headers['user-agent'] = userAgent;
    const res = await gateway.fetchBuffered({
      url: String(input),
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? init.body : undefined,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      timeoutMs: RemoteSemantic.REMOTE_TIMEOUT_MS,
      maxRedirects: 0,
      context: 'remote semantic search',
    });
    const outHeaders = new Headers();
    for (const [k, v] of Object.entries(res.headers)) {
      if (v === undefined) continue;
      outHeaders.set(k, Array.isArray(v) ? v.join(', ') : v);
    }
    return new Response(NULL_BODY_STATUSES.has(res.status) ? null : new Uint8Array(res.body), {
      status: res.status,
      headers: outHeaders,
    });
  }) as unknown as typeof fetch;
}

export class RemoteSemanticService {
  private readonly client: RemoteSemantic.RemoteSemanticClient | null;
  private readonly getGateway: () => INetworkGateway;

  constructor(private readonly opts: RemoteSemanticServiceOptions) {
    this.getGateway = opts.getGateway ?? getNetworkGateway;
    this.client = opts.url
      ? new RemoteSemantic.RemoteSemanticClient({
          baseUrl: opts.url,
          apiKey: opts.apiKey || undefined,
          fetch: opts.fetch ?? gatewayFetch(this.getGateway, opts.userAgent),
          sleep: opts.sleep,
        })
      : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  private record(): RemoteSemantic.ConsentRecord | null {
    return RemoteSemantic.parseConsentRecord(this.opts.store.read());
  }

  getStatus(): RemoteSemanticStatus {
    const record = this.record();
    const consent = RemoteSemantic.consentStatus(record);
    return {
      configured: this.isConfigured(),
      consent,
      noticeVersion: RemoteSemantic.REMOTE_SEMANTIC_NOTICE_VERSION,
      ...(consent !== 'unset' && record?.at ? { consentedAt: record.at } : {}),
      source: this.source(consent),
    };
  }

  /**
   * The stored choice, else the default: online when this build has a service
   * (a user who already said "Not now" to it stays offline), offline otherwise.
   * A stored `online` in a build without a service reads as offline.
   */
  private source(consent: RemoteSemantic.ConsentStatus): SemanticSource {
    const raw = this.opts.store.readSource ? this.opts.store.readSource() : this.memorySource;
    const stored = SEMANTIC_SOURCES.includes(raw as SemanticSource) ? (raw as SemanticSource) : undefined;
    const wanted = stored ?? (this.isConfigured() && consent !== 'declined' ? 'online' : 'offline');
    return wanted === 'online' && !this.isConfigured() ? 'offline' : wanted;
  }

  private memorySource: SemanticSource | undefined;

  private storeSource(source: SemanticSource): void {
    if (this.opts.store.writeSource) this.opts.store.writeSource(source);
    else this.memorySource = source;
  }

  /**
   * The first-use answer. "Not now" also moves the source to offline, so the
   * preference shows what is actually happening.
   */
  setConsent(decision: ConsentDecisionArg): RemoteSemanticStatus {
    if (decision === 'reset') this.opts.store.write(null);
    else this.opts.store.write(RemoteSemantic.makeConsentRecord(decision, this.opts.now?.()));
    if (decision === 'declined') this.storeSource('offline');
    return this.getStatus();
  }

  /**
   * The Preferences choice. Choosing online after an earlier "Not now" clears
   * that answer, so the next meaning search asks again; it never grants consent
   * by itself - the notice is shown first.
   */
  setSource(source: SemanticSource): RemoteSemanticStatus {
    if (source === 'online') {
      if (!this.isConfigured()) {
        throw new RemoteSemantic.RemoteSemanticError('unknown', 0, 'not_configured', 'Online meaning search is not configured');
      }
      if (this.getStatus().consent === 'declined') this.opts.store.write(null);
    }
    this.storeSource(source);
    return this.getStatus();
  }

  /**
   * One remote search. Throws `RemoteSemanticError` for every failure (also a
   * refused network) and when called without consent or configuration, so no
   * caller can reach the network around the gate.
   */
  async search(
    query: string,
    opts: { maxResults?: number } = {},
  ): Promise<RemoteSemantic.RemoteSearchResponse> {
    const status = this.getStatus();
    if (!this.client || status.consent !== 'granted' || status.source !== 'online') {
      throw new RemoteSemantic.RemoteSemanticError('unknown', 0, 'no_consent', 'Remote search is not enabled');
    }
    // Pre-flight the master switch so a refused network does not cost the
    // client's one transient retry (a 1 s pause the user would feel).
    if (this.getGateway().isOffline()) {
      throw new RemoteSemantic.RemoteSemanticError('network', 0, 'network_blocked', 'Web requests are switched off');
    }
    const k = Math.min(50, Math.max(1, Math.floor(opts.maxResults ?? 20)));
    return this.client.search(query, { k });
  }
}

let singleton: RemoteSemanticService | null = null;

/** The app's service, built lazily from the build config. */
export function getRemoteSemanticService(): RemoteSemanticService {
  if (!singleton) {
    // Required lazily: keeps `electron`'s `app` out of plain-Node test imports.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as typeof import('electron');
    singleton = new RemoteSemanticService({
      url: APP_CONFIG.remoteSemantic.url,
      apiKey: APP_CONFIG.remoteSemantic.apiKey,
      store: new JsonFileConsentStore(path.join(app.getPath('userData'), 'remote-semantic.json')),
      // The release version (apps/desktop/package.json, which release.yml
      // requires to match the `v<version>` tag), as baked in at build time -
      // the same value the About dialog and issue reports show.
      userAgent: remoteSemanticUserAgent(APP_CONFIG.appVersion || app.getVersion(), APP_CONFIG.buildId),
    });
  }
  return singleton;
}

/** Test-only: swap or clear the singleton. */
export function __setRemoteSemanticServiceForTests(s: RemoteSemanticService | null): void {
  singleton = s;
}
