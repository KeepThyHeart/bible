/**
 * RemoteSemanticService - the main-process side of the online meaning search
 * (task 0190). It holds the one `RemoteSemanticClient`, the first-use consent
 * record, and the rules that keep both honest:
 *
 *  - NOTHING is sent unless the build configured a service AND the user agreed
 *    (`consent === 'granted'`, for the current notice version). Not even a
 *    `/v1/info` probe.
 *  - Calls go through `NetworkGateway.fetchBuffered`, the app's single egress
 *    choke-point, so the master "Allow web requests" switch applies. With the
 *    switch off the call is refused before a socket opens; that surfaces as a
 *    `network` error, which the caller treats like any other remote failure
 *    (fall back to the installed pack).
 *  - The API key lives here and in `config/appConfig.ts` only. It never crosses
 *    the preload bridge.
 *
 * Consent is stored under the key `remoteSemantic.consent` in a small JSON file
 * in userData (like `NetworkConfig`): it is a per-install privacy choice, not
 * user content, so it stays out of the backed-up user database.
 */

import fs from 'fs';
import path from 'path';
import log from 'electron-log';
import { RemoteSemantic } from '@bible/core';
import { getNetworkGateway, type INetworkGateway } from './NetworkGateway';

export const CONSENT_KEY = 'remoteSemantic.consent';

export type ConsentDecisionArg = 'granted' | 'declined' | 'reset';

export interface RemoteSemanticStatus {
  /** A service URL is baked into this build. When false, the feature does not exist in the UI. */
  configured: boolean;
  consent: RemoteSemantic.ConsentStatus;
  noticeVersion: number;
  /** ISO time of the current decision (absent when unset). */
  consentedAt?: string;
}

/** Where the consent record is persisted. Injectable for tests. */
export interface ConsentStore {
  read(): unknown;
  write(record: RemoteSemantic.ConsentRecord | null): void;
}

export class JsonFileConsentStore implements ConsentStore {
  constructor(private readonly filePath: string) {}

  read(): unknown {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Record<string, unknown>;
      return parsed[CONSENT_KEY];
    } catch {
      return undefined;
    }
  }

  write(record: RemoteSemantic.ConsentRecord | null): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const body = record ? { [CONSENT_KEY]: record } : {};
      fs.writeFileSync(this.filePath, JSON.stringify(body, null, 2), 'utf-8');
    } catch (err) {
      log.warn('[remote-semantic] could not persist consent:', err);
      throw err;
    }
  }
}

export interface RemoteSemanticServiceOptions {
  url: string;
  apiKey: string;
  store: ConsentStore;
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

/** A `fetch` look-alike over `NetworkGateway.fetchBuffered` (no redirects, 10 s). */
export function gatewayFetch(getGateway: () => INetworkGateway): typeof fetch {
  return (async (input: unknown, init: RequestInit = {}) => {
    const gateway = getGateway();
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
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
          fetch: opts.fetch ?? gatewayFetch(this.getGateway),
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
    };
  }

  setConsent(decision: ConsentDecisionArg): RemoteSemanticStatus {
    if (decision === 'reset') this.opts.store.write(null);
    else this.opts.store.write(RemoteSemantic.makeConsentRecord(decision, this.opts.now?.()));
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
    if (!this.client || this.getStatus().consent !== 'granted') {
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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { APP_CONFIG } = require('../config/appConfig') as typeof import('../config/appConfig');
    singleton = new RemoteSemanticService({
      url: APP_CONFIG.remoteSemantic.url,
      apiKey: APP_CONFIG.remoteSemantic.apiKey,
      store: new JsonFileConsentStore(path.join(app.getPath('userData'), 'remote-semantic.json')),
    });
  }
  return singleton;
}

/** Test-only: swap or clear the singleton. */
export function __setRemoteSemanticServiceForTests(s: RemoteSemanticService | null): void {
  singleton = s;
}
