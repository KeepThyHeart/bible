/**
 * Client for the hosted bibsearch semantic API (`GET|POST /v1/search`, `GET /v1/info`).
 * Written against bibsearch's docs/CLIENTS.md; see task 0190.
 *
 * Platform-free: it takes a `fetch` and works in a browser, the Electron main
 * process and the web server alike.
 *
 * Behaviour (CLIENTS.md, "Errors" and "Fallback and good behaviour"):
 *  - always `include_text=false`; the caller hydrates hits by id in its own translation.
 *  - queries are checked client-side and never sent when empty, one character,
 *    digits-only, symbols-only or repeated.
 *  - at most ONE automatic retry per call: 429 `rate_limited` (after
 *    `Retry-After`), 502/504, network errors and timeouts.
 *  - after 429, 503 `budget_exhausted` or 403 the client refuses to call until
 *    the reset / `Retry-After` has passed (`blockedUntil`), without probing.
 *  - 10 s timeout.
 *  - anonymous by default: no Authorization header, no user id. An API key
 *    (`X-API-Key`, not a secret) may be configured. `auth` is the seam where a
 *    signed-in user's JWT goes later.
 */

import { parseBibsearchId, passageFromRange, type MappedPassage } from './idMapper';
import { checkRemoteQuery, type QueryRule } from './queryGuard';

export type RemoteErrorKind =
  | 'blocked'        // client-side: still inside a blockedUntil window, nothing was sent
  | 'invalid_query'  // client-side guard refused the query, nothing was sent
  | 'network'
  | 'timeout'
  | 'bad_request'    // 400
  | 'auth_required'  // 401 auth_required
  | 'unauthorized'   // 401 unauthorized (after the one refresh attempt)
  | 'forbidden'      // 403 forbidden / banned
  | 'rejected'       // 422 query_rejected
  | 'rate_limited'   // 429 rate_limited (after the one retry)
  | 'quota_exceeded' // 429 quota_exceeded
  | 'embedder_error' // 502 / 504 (after the one retry)
  | 'budget_exhausted' // 503
  | 'not_ready'      // 503 not_ready
  | 'internal'       // 500
  | 'unknown';

export class RemoteSemanticError extends Error {
  constructor(
    public readonly kind: RemoteErrorKind,
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly details: {
      retryAfterSec?: number;
      /** Epoch ms when the quota / block ends, when known. */
      resetAtMs?: number;
      /** `error.rule` of a 422, or the client-side rule for `invalid_query`. */
      rule?: string;
      /** For `blocked`: the error kind that started the pause. */
      cause?: RemoteErrorKind;
      requestId?: string;
    } = {},
  ) {
    super(message ?? `${status} ${code}`);
    this.name = 'RemoteSemanticError';
  }
  get resetAtMs(): number | undefined { return this.details.resetAtMs; }
  get retryAfterSec(): number | undefined { return this.details.retryAfterSec; }
  get rule(): string | undefined { return this.details.rule; }
}

export interface RemoteRateLimit {
  limit?: number;
  remaining?: number;
  /** Epoch ms of the daily reset (00:00 UTC), from `RateLimit-Reset`. */
  resetAtMs?: number;
}

export interface RemoteHit {
  rank: number;
  id: string;
  score: number;
  ref?: string;
  startVerseId: number;
  endVerseId: number;
  /** The row's `level` (`verse` | `paragraph` | `chapter` | `topic`) when bibsearch sent one. */
  level?: string;
}

export interface RemoteSearchResponse {
  query: string;
  hits: RemoteHit[];
  /** Server answered with keyword results because it could not embed (show a small note). */
  degraded: boolean;
  /** `reference` / `one_word` when the server routed to keyword search without the embedder. */
  routed?: 'reference' | 'one_word';
  mode: string;
  /** Rows dropped because their id could not be mapped. */
  skipped: number;
  rateLimit: RemoteRateLimit;
}

export interface RemoteInfo {
  model?: string;
  dims?: number;
  rows?: number;
  modes?: string[];
  [key: string]: unknown;
}

/** Seam for signed-in calls (JWT, a later task). Anonymous when absent. */
export interface RemoteAuth {
  getHeaders(): Promise<Record<string, string>> | Record<string, string>;
  /** Called once after a 401 `unauthorized`; the call is retried once if it resolves. */
  refresh?(): Promise<void>;
}

export interface RemoteSearchOptions {
  k?: number;
  translation?: string;
  lang?: string;
  book?: string;
  testament?: 'OT' | 'NT';
}

export interface RemoteSemanticClientOptions {
  baseUrl: string;
  /** Optional build-config key sent as `X-API-Key`. Not a secret. */
  apiKey?: string;
  auth?: RemoteAuth;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const REMOTE_TIMEOUT_MS = 10_000;
/** Longest we will wait for one Retry-After before giving up instead (a user is waiting). */
const MAX_RETRY_WAIT_SEC = 5;
const SHORT_RETRY_SEC = 1;
const DEFAULT_RATE_BLOCK_SEC = 60;
const DEFAULT_FORBIDDEN_BLOCK_SEC = 600;
const DEFAULT_BUDGET_BLOCK_SEC = 300;
const MAX_GET_URL_QUERY = 700;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class RemoteSemanticClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly auth?: RemoteAuth;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private _blockedUntil = 0;
  private _blockedError: RemoteSemanticError | null = null;
  private _lastRateLimit: RemoteRateLimit = {};

  constructor(opts: RemoteSemanticClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey || undefined;
    this.auth = opts.auth;
    this.fetchImpl = opts.fetch ?? ((...a) => fetch(...a));
    this.timeoutMs = opts.timeoutMs ?? REMOTE_TIMEOUT_MS;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /** Epoch ms before which no call is made (0 when not blocked). */
  get blockedUntil(): number { return this.now() < this._blockedUntil ? this._blockedUntil : 0; }
  /** The most recent RateLimit-* headers seen. */
  get rateLimit(): RemoteRateLimit { return this._lastRateLimit; }

  async search(rawQuery: string, opts: RemoteSearchOptions = {}): Promise<RemoteSearchResponse> {
    const check = checkRemoteQuery(rawQuery);
    if (!check.ok) {
      throw new RemoteSemanticError('invalid_query', 0, 'invalid_query', `Query not sent: ${check.rule}`, { rule: check.rule satisfies QueryRule });
    }
    const query = check.query;
    const k = Math.min(100, Math.max(1, Math.floor(opts.k ?? 10)));
    const filters: Record<string, string> = {};
    for (const key of ['translation', 'lang', 'book', 'testament'] as const) {
      const v = opts[key];
      if (v) filters[key] = v;
    }

    const body = await this.request(() => {
      if (encodeURIComponent(query).length > MAX_GET_URL_QUERY) {
        return {
          url: `${this.baseUrl}/v1/search`,
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, k, include_text: false, ...filters }),
          },
        };
      }
      const params = new URLSearchParams({ query, k: String(k), include_text: 'false', ...filters });
      return { url: `${this.baseUrl}/v1/search?${params}`, init: { method: 'GET' } };
    });

    return this.toResponse(query, body.json, body.rateLimit);
  }

  async info(): Promise<RemoteInfo> {
    const { json } = await this.request(() => ({ url: `${this.baseUrl}/v1/info`, init: { method: 'GET' } }));
    const o = (json ?? {}) as Record<string, unknown>;
    return { ...o, model: o.model as string | undefined, dims: o.dims as number | undefined, rows: (o.rows ?? o.row_count) as number | undefined, modes: o.modes as string[] | undefined };
  }

  // ── internals ────────────────────────────────────────────────────────

  private toResponse(query: string, json: unknown, rateLimit: RemoteRateLimit): RemoteSearchResponse {
    const o = (json ?? {}) as Record<string, any>;
    const rows: any[] = Array.isArray(o.results) ? o.results : [];
    const hits: RemoteHit[] = [];
    let skipped = 0;
    rows.forEach((row, i) => {
      const p = mapRow(row);
      if (!p) { skipped++; return; }
      hits.push({
        rank: typeof row.rank === 'number' ? row.rank : i + 1,
        id: p.id,
        score: typeof row.score === 'number' ? row.score : 0,
        ref: typeof row.ref === 'string' ? row.ref : undefined,
        startVerseId: p.startVerseId,
        endVerseId: p.endVerseId,
        level: typeof row.level === 'string' ? row.level : undefined,
      });
    });
    const routed = o.routed === 'reference' || o.routed === 'one_word' ? o.routed : undefined;
    return {
      query,
      hits,
      degraded: o.degraded === true,
      routed,
      mode: typeof o.mode === 'string' ? o.mode : 'semantic',
      skipped,
      rateLimit,
    };
  }

  private block(sec: number, err: RemoteSemanticError): void {
    this._blockedUntil = this.now() + sec * 1000;
    this._blockedError = err;
  }

  private async headers(extra?: Record<string, string>): Promise<Record<string, string>> {
    const h: Record<string, string> = { Accept: 'application/json', ...extra };
    if (this.auth) Object.assign(h, await this.auth.getHeaders());
    else if (this.apiKey) h['X-API-Key'] = this.apiKey;
    return h;
  }

  /** One logical call: guard on blockedUntil, send, and apply the one-retry rules. */
  private async request(
    build: () => { url: string; init: RequestInit },
  ): Promise<{ json: unknown; rateLimit: RemoteRateLimit }> {
    if (this.now() < this._blockedUntil) {
      const prev = this._blockedError;
      throw new RemoteSemanticError('blocked', 0, 'blocked', 'Remote search is paused until the limit resets', {
        resetAtMs: this._blockedUntil,
        retryAfterSec: Math.ceil((this._blockedUntil - this.now()) / 1000),
        cause: prev?.kind,
      });
    }
    let retried = false;
    let refreshed = false;
    for (;;) {
      const { url, init } = build();
      const err = await this.attempt(url, init).then(
        (ok) => ({ ok }) as const,
        (e: RemoteSemanticError) => ({ e }) as const,
      );
      if ('ok' in err) return err.ok;
      const e = err.e;

      if (e.kind === 'unauthorized' && this.auth?.refresh && !refreshed) {
        refreshed = true;
        try { await this.auth.refresh(); continue; } catch { throw e; }
      }
      const transient = e.kind === 'network' || e.kind === 'timeout' || e.kind === 'embedder_error'
        || (e.kind === 'rate_limited' && (e.retryAfterSec ?? SHORT_RETRY_SEC) <= MAX_RETRY_WAIT_SEC);
      if (transient && !retried) {
        retried = true;
        const wait = e.kind === 'rate_limited' ? (e.retryAfterSec ?? SHORT_RETRY_SEC) : SHORT_RETRY_SEC;
        await this.sleep(wait * 1000);
        continue;
      }
      if (e.kind === 'rate_limited') this.block(e.retryAfterSec ?? DEFAULT_RATE_BLOCK_SEC, e);
      throw e;
    }
  }

  private async attempt(url: string, init: RequestInit): Promise<{ json: unknown; rateLimit: RemoteRateLimit }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    // The timeout covers the response body too, so it is cleared only when done.
    try {
      return await this.attemptInner(url, init, ctrl);
    } finally {
      clearTimeout(timer);
    }
  }

  private async attemptInner(url: string, init: RequestInit, ctrl: AbortController): Promise<{ json: unknown; rateLimit: RemoteRateLimit }> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        ...init,
        headers: await this.headers(init.headers as Record<string, string> | undefined),
        signal: ctrl.signal,
        // Never send cookies or ambient credentials: the API uses headers only.
        credentials: 'omit',
      });
    } catch (e: any) {
      const aborted = ctrl.signal.aborted || e?.name === 'AbortError' || e?.name === 'TimeoutError';
      throw new RemoteSemanticError(aborted ? 'timeout' : 'network', 0, aborted ? 'timeout' : 'network', aborted ? 'Request timed out' : String(e?.message ?? e));
    }

    const rateLimit = this.readRateLimit(res);
    this._lastRateLimit = rateLimit;
    if (res.ok) {
      let json: unknown = null;
      try { json = await res.json(); } catch {
        if (ctrl.signal.aborted) throw new RemoteSemanticError('timeout', 0, 'timeout', 'Request timed out');
        throw new RemoteSemanticError('unknown', res.status, 'bad_json', 'Unreadable response');
      }
      return { json, rateLimit };
    }

    let code = 'unknown';
    let rule: string | undefined;
    let message: string | undefined;
    try {
      const j: any = await res.json();
      code = j?.error?.code ?? code;
      rule = j?.error?.rule;
      message = j?.error?.message;
    } catch { /* body optional */ }
    const retryAfter = numHeader(res, 'Retry-After');
    const requestId = res.headers.get('X-Request-Id') ?? undefined;
    const resetAtMs = rateLimit.resetAtMs ?? (retryAfter !== undefined ? this.now() + retryAfter * 1000 : undefined);
    const details = { retryAfterSec: retryAfter, resetAtMs, rule, requestId };
    const mk = (kind: RemoteErrorKind) => new RemoteSemanticError(kind, res.status, code, message, details);

    switch (res.status) {
      case 400: return fail(mk('bad_request'));
      case 401: return fail(mk(code === 'auth_required' ? 'auth_required' : 'unauthorized'));
      case 403: {
        const e = mk('forbidden');
        this.block(retryAfter ?? DEFAULT_FORBIDDEN_BLOCK_SEC, e);
        return fail(e);
      }
      case 422: return fail(mk('rejected'));
      case 429: {
        if (code === 'quota_exceeded') {
          const e = mk('quota_exceeded');
          const secs = rateLimit.resetAtMs !== undefined ? Math.max(1, (rateLimit.resetAtMs - this.now()) / 1000) : (retryAfter ?? 3600);
          this.block(secs, e);
          return fail(e);
        }
        return fail(mk('rate_limited'));
      }
      case 502: case 504: return fail(mk('embedder_error'));
      case 503: {
        if (code !== 'budget_exhausted') return fail(mk('not_ready'));
        const e = mk('budget_exhausted');
        this.block(retryAfter ?? DEFAULT_BUDGET_BLOCK_SEC, e);
        return fail(e);
      }
      case 500: return fail(mk('internal'));
      default: return fail(mk('unknown'));
    }
  }

  private readRateLimit(res: Response): RemoteRateLimit {
    const reset = numHeader(res, 'RateLimit-Reset');
    return {
      limit: numHeader(res, 'RateLimit-Limit'),
      remaining: numHeader(res, 'RateLimit-Remaining'),
      resetAtMs: reset !== undefined ? this.now() + reset * 1000 : undefined,
    };
  }
}

function fail(e: RemoteSemanticError): never { throw e; }

/**
 * Map one result row to a passage. A facet row (bibsearch returns the best-scoring
 * facet of a passage) has a suffixed id such as `KJV.GEN.1.1#s0`, so after the id this
 * tries the row's `passage` id and then its numeric `start` / `end`. The returned `id`
 * is always the row's own.
 */
function mapRow(row: any): MappedPassage | null {
  const p = parseBibsearchId(row?.id);
  if (p) return p;
  if (typeof row?.id !== 'string') return null;
  const viaPassage = parseBibsearchId(row.passage);
  if (viaPassage) return { ...viaPassage, id: row.id };
  const translation = typeof row.translation === 'string'
    ? row.translation
    : /^([A-Za-z0-9_]+)\./.exec(row.id)?.[1] ?? '';
  return passageFromRange(row.id, row.start, row.end, translation);
}

function numHeader(res: Response, name: string): number | undefined {
  const v = res.headers.get(name);
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
