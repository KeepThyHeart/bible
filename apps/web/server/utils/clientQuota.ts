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

import { isIPv6 } from 'node:net';
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

/**
 * The key a client is counted under: its IPv4 address, or its IPv6 /64.
 *
 * One home or VPS is normally handed a whole /64 (often more), so keying on
 * the full IPv6 address would let a single caller rotate addresses and never
 * run out. bibsearch groups IPv6 the same way. IPv4-mapped IPv6 addresses
 * (`::ffff:1.2.3.4`) count as the IPv4 address.
 */
export function clientKey(req: Request): string {
  return clientKeyFor(req.ip || req.socket.remoteAddress || 'unknown');
}

export function clientKeyFor(addr: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
  if (mapped) return mapped[1];
  if (!isIPv6(addr)) return addr;
  return `${ipv6Prefix64(addr)}::/64`;
}

/** The first four hextets of an IPv6 address, expanded, lower case, e.g. `2001:db8:0:0`. */
function ipv6Prefix64(addr: string): string {
  const bare = addr.split('%')[0]; // drop a zone id
  const [head, tail = ''] = bare.split('::');
  const h = head ? head.split(':') : [];
  const t = bare.includes('::') && tail ? tail.split(':') : [];
  // An embedded IPv4 tail (::1.2.3.4 forms) takes two hextets; only the first 64 bits matter here.
  const tailLen = t.reduce((n, part) => n + (part.includes('.') ? 2 : 1), 0);
  const groups = bare.includes('::') ? [...h, ...Array(8 - h.length - tailLen).fill('0'), ...t] : h;
  return groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':');
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
