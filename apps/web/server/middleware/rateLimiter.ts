/**
 * In-memory rate limiter.
 *
 * Tracks request counts per IP in a fixed window. IPs are held only in
 * memory — never written to disk — so that a seized server does not expose
 * historical request patterns. Tiers allow different limits per route group;
 * see DEFAULT_RATE_LIMITS below for the values and how they were derived.
 *
 * Exactly one tier is charged per request. The caller is responsible for
 * selecting it — mounting several tier middlewares on overlapping path
 * prefixes charges a request to each one that matches, which silently makes
 * the strictest of them the real cap.
 *
 * On limit hit the middleware responds 429 with a Retry-After header and
 * passes control back to the caller without invoking downstream handlers.
 */

import type { Request, Response, NextFunction } from 'express';

export type RateLimitTier = 'search' | 'content' | 'default';

export interface RateLimitConfig {
  search: number;
  content: number;
  default: number;
  global: number;
  /** Window length in ms. Defaults to 60_000 (1 minute). */
  windowMs?: number;
}

/**
 * Caps are sized from measured traffic, not guessed.
 *
 * An ordinary reading pace — a chapter every few seconds with the study pane
 * open — measures at roughly 180 API requests/minute: ~4-7 per chapter
 * navigation (chapter text, study overview, commentary chapter-overview,
 * interlinear, plus one bulk commentary call and one per parallel tab) and 2
 * per verse tap. The old caps sat well below that, so reading normally tripped
 * them in about twenty seconds.
 *
 * `content` is therefore set to roughly 3× the measured pace, which leaves room
 * for parallel tabs, a second device on the same address, and bursts of rapid
 * navigation, while still bounding a scraper to ~10 req/s.
 */
// `satisfies` rather than a type annotation: `windowMs` is optional on
// `RateLimitConfig` (callers may leave it out), but it is always set here, and
// annotating widened it back to `number | undefined` for every reader of the
// constant.
export const DEFAULT_RATE_LIMITS = {
  // Submit-only (not per-keystroke), but a semantic result set also fires a
  // verse-text batch, and refining a query many times in a minute is normal.
  search: 60,
  // Reference reads: the bulk of all traffic while reading.
  content: 600,
  // Boot-time odds and ends — health, config, version, plugins. A handful per
  // session, so this stays tight without ever gating content.
  default: 120,
  // Process-wide overload valve, an order of magnitude above ~5 concurrent
  // active readers (5 × 180 = 900/min). Mounted on /api only, so static assets,
  // /data and the login page no longer consume it.
  global: 10_000,
  windowMs: 60_000,
} satisfies RateLimitConfig;

/**
 * Route prefix → tier, keyed on the first path segment below `/api`.
 *
 * Everything classified as `content` is immutable reference material read
 * while turning pages. Every such prefix has to be listed here: anything left
 * out — interlinear, cross-references, topics, Strong's — falls through to
 * `default`, running ordinary read traffic under the strictest cap in the app.
 */
const TIER_BY_PREFIX: Record<string, RateLimitTier> = {
  search: 'search',
  bible: 'content',
  commentary: 'content',
  dictionary: 'content',
  interlinear: 'content',
  strongs: 'content',
  xref: 'content',
  topical: 'content',
  taggraph: 'content',
  study: 'content',
  books: 'content',
  modules: 'content',
  'module-sections': 'content',
};

/**
 * The single tier a given `/api` path is charged to.
 *
 * `path` is relative to the `/api` mount (`/bible/KJV/43/3`). Exactly one tier
 * applies: mounting several tier middlewares on overlapping prefixes charges a
 * request to every one that matches, which silently makes the strictest of
 * them the effective cap for everything.
 */
export function tierForApiPath(path: string): RateLimitTier {
  return TIER_BY_PREFIX[path.split('/')[1] ?? ''] ?? 'default';
}

interface Counter {
  count: number;
  windowStart: number;
}

function getCount(map: Map<string, Counter>, key: string, now: number, windowMs: number): Counter {
  const existing = map.get(key);
  if (!existing || now - existing.windowStart >= windowMs) {
    const fresh = { count: 0, windowStart: now };
    map.set(key, fresh);
    return fresh;
  }
  return existing;
}

function sweep(map: Map<string, Counter>, now: number, windowMs: number): void {
  for (const [key, counter] of map) {
    if (now - counter.windowStart >= windowMs) map.delete(key);
  }
}

function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export interface RateLimiterHandle {
  /** Per-tier middleware. Mount on the appropriate route groups. */
  middleware(tier: RateLimitTier): (req: Request, res: Response, next: NextFunction) => void;
  /** Global middleware; mount once before per-tier limiters. */
  global(): (req: Request, res: Response, next: NextFunction) => void;
  /** For tests: reset internal state. */
  reset(): void;
}

export function createRateLimiter(config: Partial<RateLimitConfig> = {}): RateLimiterHandle {
  const limits: RateLimitConfig = { ...DEFAULT_RATE_LIMITS, ...config };
  const windowMs = limits.windowMs ?? 60_000;

  // Item #9: Rate limit audit log — warn if rate limiting is disabled
  if (process.env.DISABLE_RATE_LIMIT === '1') {
    console.warn('[security] DISABLE_RATE_LIMIT is set — all rate limiting is OFF');
  }

  const perTier: Record<RateLimitTier, Map<string, Counter>> = {
    search: new Map(),
    content: new Map(),
    default: new Map(),
  };
  let globalCounter: Counter = { count: 0, windowStart: Date.now() };

  // Periodic sweep prevents unbounded growth from ephemeral IPs. 5-minute
  // cadence is plenty — each entry is ~40 bytes and entries expire on access.
  const sweeper = setInterval(() => {
    const now = Date.now();
    sweep(perTier.search, now, windowMs);
    sweep(perTier.content, now, windowMs);
    sweep(perTier.default, now, windowMs);
  }, 5 * 60_000);
  // Don't keep the event loop alive just for sweeping.
  sweeper.unref?.();

  function reject(res: Response, retrySeconds: number): void {
    res.setHeader('Retry-After', String(retrySeconds));
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
  }

  return {
    middleware(tier: RateLimitTier) {
      const cap = limits[tier];
      const map = perTier[tier];
      return (req: Request, res: Response, next: NextFunction) => {
        const now = Date.now();
        const counter = getCount(map, clientKey(req), now, windowMs);
        counter.count++;
        if (counter.count > cap) {
          const retrySeconds = Math.max(1, Math.ceil((counter.windowStart + windowMs - now) / 1000));
          return reject(res, retrySeconds);
        }
        next();
      };
    },

    global() {
      return (_req: Request, res: Response, next: NextFunction) => {
        const now = Date.now();
        if (now - globalCounter.windowStart >= windowMs) {
          globalCounter = { count: 0, windowStart: now };
        }
        globalCounter.count++;
        if (globalCounter.count > limits.global) {
          const retrySeconds = Math.max(1, Math.ceil((globalCounter.windowStart + windowMs - now) / 1000));
          return reject(res, retrySeconds);
        }
        next();
      };
    },

    reset() {
      perTier.search.clear();
      perTier.content.clear();
      perTier.default.clear();
      globalCounter = { count: 0, windowStart: Date.now() };
    },
  };
}
