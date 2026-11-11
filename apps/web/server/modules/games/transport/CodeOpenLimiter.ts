/**
 * A per-client ceiling on opening a screen with nothing but a room code.
 *
 * That path has no credential, so the code is the only thing standing between
 * a stranger and a room's roster. The code space is large enough that guessing
 * is hopeless at a human pace, and this keeps it hopeless for a script too.
 * A TV opens one stream, and reconnects now and then, so the allowance is
 * generous for an honest screen and small for anything walking the code space.
 *
 * Clients are counted in memory only and by IPv4 address or IPv6 /64, the same
 * grouping the other quotas use. The clock is injected so a test moves the
 * window without waiting for it.
 */

import type { ServerTime } from '../../../../src/modules/games/shared/protocol.js';
import { clientKeyFor } from '../../../utils/clientQuota.js';

export interface CodeOpenLimiterOptions {
  /** Opens one client may make per window. */
  limit?: number;
  windowMs?: number;
  now?: () => ServerTime;
}

export const DEFAULT_CODE_OPEN_LIMIT = 30;
export const DEFAULT_CODE_OPEN_WINDOW_MS = 60_000;

interface Window {
  startedAt: ServerTime;
  used: number;
}

export class CodeOpenLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => ServerTime;
  private readonly windows = new Map<string, Window>();

  constructor(options: CodeOpenLimiterOptions = {}) {
    this.limit = options.limit ?? DEFAULT_CODE_OPEN_LIMIT;
    this.windowMs = options.windowMs ?? DEFAULT_CODE_OPEN_WINDOW_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Charge one open to this address. Null when allowed, otherwise the whole
   * seconds until the client's window resets.
   */
  take(address: string): number | null {
    const at = this.now();
    this.forgetExpired(at);
    const key = clientKeyFor(address);
    const current = this.windows.get(key);
    if (current === undefined) {
      this.windows.set(key, { startedAt: at, used: 1 });
      return null;
    }
    if (current.used >= this.limit) {
      return Math.max(1, Math.ceil((current.startedAt + this.windowMs - at) / 1000));
    }
    current.used += 1;
    return null;
  }

  /** Keeps the map from growing with every address ever seen. */
  private forgetExpired(at: ServerTime): void {
    for (const [key, window] of this.windows) {
      if (at - window.startedAt >= this.windowMs) this.windows.delete(key);
    }
  }
}
