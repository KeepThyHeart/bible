/**
 * In-memory fixed-window rate limiter (no dependency). Keys are namespaced strings such as `ip:auth:1.2.3.4`
 * or `email:login:a@b.c`; each rule names its own window and maximum. `now` is injectable for tests.
 * State is per process; a multi-process deployment would need a shared store (not v1).
 */
import { ApiHttpError } from './http';

export interface RateRule { windowMs: number; max: number }

/** Default limits. `auth` covers prelogin/signup/login/recover (and W2-D's email flows) per IP. */
export const RATE_LIMITS = {
  /** Every request to the sync API, per IP. Generous: sync pulls page through changes. */
  ipAll: { windowMs: 60_000, max: 600 },
  /** Account entry points, per IP. */
  ipAuth: { windowMs: 10 * 60_000, max: 30 },
  /** Login / recovery / signup attempts per normalised email. */
  emailAuth: { windowMs: 15 * 60_000, max: 10 },
  /** Emails sent per address (W2-D: verify / reset). */
  emailSend: { windowMs: 60 * 60_000, max: 5 },
} as const satisfies Record<string, RateRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RateDecision { ok: boolean; retryAfterSec: number }

export interface RateLimiter {
  /** Counts one hit against `key` under `rule`; `ok: false` once the window is full. */
  hit(rule: RateRule, key: string): RateDecision;
  /** Drops expired windows (also done opportunistically). */
  sweep(): void;
  clear(): void;
}

interface Window { start: number; count: number; windowMs: number }

const SWEEP_EVERY = 1000;

export function createRateLimiter(now: () => number = Date.now): RateLimiter {
  const windows = new Map<string, Window>();
  let hits = 0;

  function sweep(): void {
    const t = now();
    for (const [k, w] of windows) if (t - w.start >= w.windowMs) windows.delete(k);
  }

  return {
    hit(rule: RateRule, key: string): RateDecision {
      if (++hits % SWEEP_EVERY === 0) sweep();
      const t = now();
      const k = `${rule.windowMs}/${rule.max}|${key}`;
      let w = windows.get(k);
      if (!w || t - w.start >= rule.windowMs) {
        w = { start: t, count: 0, windowMs: rule.windowMs };
        windows.set(k, w);
      }
      w.count++;
      if (w.count <= rule.max) return { ok: true, retryAfterSec: 0 };
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((w.start + rule.windowMs - t) / 1000)) };
    },
    sweep,
    clear(): void { windows.clear(); },
  };
}

/** Counts a hit and throws `429 rate_limited` (with `retryAfterSec`) when the window is full. */
export function enforceLimit(limiter: RateLimiter, name: RateLimitName, key: string): void {
  const d = limiter.hit(RATE_LIMITS[name], `${name}:${key}`);
  if (!d.ok) throw new ApiHttpError(429, 'rate_limited', 'Too many requests', d.retryAfterSec);
}
