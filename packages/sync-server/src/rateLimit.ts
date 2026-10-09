/**
 * In-memory fixed-window rate limiter (no dependency). Keys are namespaced strings such as `ip:auth:1.2.3.4`
 * or `email:login:a@b.c`; each rule names its own window and maximum. `now` is injectable for tests.
 * State is per process; a multi-process deployment would need a shared store (not v1).
 */
import { createHash } from 'node:crypto';
import { ApiHttpError } from './http';

export interface RateRule { windowMs: number; max: number }

/** Default limits. `auth` covers prelogin/signup/login/recover (and W2-D's email flows) per IP. */
export const RATE_LIMITS = {
  /** Every request to the sync API, per IP. Generous: sync pulls page through changes. */
  ipAll: { windowMs: 60_000, max: 600 },
  /** Account entry points, per IP. */
  ipAuth: { windowMs: 10 * 60_000, max: 30 },
  /** Failed login / recovery / key-change attempts (and signup attempts) per (normalised email, client IP /64). */
  emailAuth: { windowMs: 15 * 60_000, max: 10 },
  /** Failures per email from anyone: a much higher ceiling, so one attacker cannot lock the owner out. */
  emailAuthGlobal: { windowMs: 15 * 60_000, max: 100 },
  /** Email-send requests per (address, client IP /64): verify / reset. */
  emailSend: { windowMs: 60 * 60_000, max: 5 },
  /** Email-send requests per address from anyone (anti mail-bombing across many IPs). */
  emailSendGlobal: { windowMs: 60 * 60_000, max: 30 },
  /** Data exports per account. */
  export: { windowMs: 60 * 60_000, max: 3 },
  /** "Someone tried to sign up with your address" notices: one per address per hour (anti mail-bombing). */
  dupSignupMail: { windowMs: 60 * 60_000, max: 1 },
} as const satisfies Record<string, RateRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RateDecision { ok: boolean; retryAfterSec: number }

export interface RateLimiter {
  /** Counts one hit against `key` under `rule`; `ok: false` once the window is full. */
  hit(rule: RateRule, key: string): RateDecision;
  /** Like `hit` without counting: `ok: false` once the window is already full. */
  peek(rule: RateRule, key: string): RateDecision;
  /** Number of tracked windows (tests, monitoring). */
  size(): number;
  /** Drops expired windows (also done opportunistically). */
  sweep(): void;
  clear(): void;
}

interface Window { start: number; count: number; windowMs: number }

const SWEEP_EVERY = 10_000;
/** Upper bound on tracked windows; beyond it the oldest windows are evicted (memory DoS guard). */
export const MAX_LIMITER_KEYS = 100_000;
const MAX_KEY_CHARS = 128;

function shortKey(key: string): string {
  return key.length <= MAX_KEY_CHARS ? key : `h:${createHash('sha256').update(key).digest('base64url')}`;
}

export function createRateLimiter(now: () => number = Date.now, maxKeys = MAX_LIMITER_KEYS): RateLimiter {
  const windows = new Map<string, Window>();
  let hits = 0;

  function sweep(): void {
    const t = now();
    for (const [k, w] of windows) if (t - w.start >= w.windowMs) windows.delete(k);
  }

  function fullKey(rule: RateRule, key: string): string {
    return `${rule.windowMs}/${rule.max}|${shortKey(key)}`;
  }

  return {
    peek(rule: RateRule, key: string): RateDecision {
      const t = now();
      const w = windows.get(fullKey(rule, key));
      if (!w || t - w.start >= rule.windowMs || w.count < rule.max) return { ok: true, retryAfterSec: 0 };
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((w.start + rule.windowMs - t) / 1000)) };
    },
    size(): number { return windows.size; },
    hit(rule: RateRule, key: string): RateDecision {
      if (++hits % SWEEP_EVERY === 0) sweep();
      const t = now();
      const k = fullKey(rule, key);
      let w = windows.get(k);
      if (!w || t - w.start >= rule.windowMs) {
        windows.delete(k);
        if (windows.size >= maxKeys) {
          // Evict the oldest tenth in one pass (Map keeps insertion order); expired ones go in the periodic sweep.
          let drop = Math.max(1, Math.floor(maxKeys / 10));
          for (const old of windows.keys()) {
            windows.delete(old);
            if (--drop <= 0) break;
          }
        }
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

/** Throws `429 rate_limited` when the window is already full, without counting. */
export function checkLimit(limiter: RateLimiter, name: RateLimitName, key: string): void {
  const d = limiter.peek(RATE_LIMITS[name], `${name}:${key}`);
  if (!d.ok) throw new ApiHttpError(429, 'rate_limited', 'Too many requests', d.retryAfterSec);
}

/** Counts a hit and throws `429 rate_limited` (with `retryAfterSec`) when the window is full. */
export function enforceLimit(limiter: RateLimiter, name: RateLimitName, key: string): void {
  const d = limiter.hit(RATE_LIMITS[name], `${name}:${key}`);
  if (!d.ok) throw new ApiHttpError(429, 'rate_limited', 'Too many requests', d.retryAfterSec);
}
