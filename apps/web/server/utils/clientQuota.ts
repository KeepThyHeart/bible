/**
 * Per-client quotas over a long window, for routes whose cost the per-minute
 * tiers in `middleware/rateLimiter.ts` do not bound well: anonymous writes to
 * disk (feedback, desktop reports) and paid remote calls (online meaning search).
 *
 * This is a second, route-level check, not a rate-limit tier: the request has
 * already been charged to its one tier by the API middleware. A route takes
 * from its quota only for the expensive part of its work, so a cheap rejection
 * (bad input, a cached answer) costs the caller nothing.
 *
 * Like the rate limiter, keys (client IPs) live only in memory and are never
 * written to disk. `req.ip` is only trustworthy because `trust proxy` is
 * limited to the loopback proxy in `server/index.ts`; with `true` a caller
 * could pick a fresh address per request and never run out.
 */

import type { Request } from 'express';

export interface ClientQuotaOptions {
  /** Requests each client may make per window. */
  limit: number;
  /** Window length in ms. */
  windowMs: number;
}

export interface ClientQuota {
  /**
   * Charge one use to this request's client. Returns null when allowed, or the
   * number of seconds until the client's window resets when it is used up.
   */
  take(req: Request): number | null;
  /** For tests: forget every client. */
  reset(): void;
}

export function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function createClientQuota({ limit, windowMs }: ClientQuotaOptions): ClientQuota {
  const counters = new Map<string, { count: number; windowStart: number }>();

  // Expired entries are dropped on a timer so ephemeral addresses cannot grow
  // the map without bound. unref: never keep the process alive for this.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, c] of counters) {
      if (now - c.windowStart >= windowMs) counters.delete(key);
    }
  }, Math.min(windowMs, 10 * 60_000));
  sweeper.unref?.();

  return {
    take(req) {
      const now = Date.now();
      const key = clientKey(req);
      let c = counters.get(key);
      if (!c || now - c.windowStart >= windowMs) {
        c = { count: 0, windowStart: now };
        counters.set(key, c);
      }
      if (c.count >= limit) {
        return Math.max(1, Math.ceil((c.windowStart + windowMs - now) / 1000));
      }
      c.count++;
      return null;
    },
    reset() {
      counters.clear();
    },
  };
}
