/** Builds the sync server (contracts 0063 §11; W1-F: store, auth, router). */
import { randomBytes } from 'node:crypto';
import { Sync } from '@bible/core';
import type { SyncServer, SyncServerOptions } from './types';
import type { ResolvedOptions, ServerContext } from './http';
import { createSqliteSyncStore } from './store/SqliteSyncStore';
import { createRateLimiter } from './rateLimit';
import { buildRouter } from './router';

const DEFAULT_MIN_AGE = 16;

function resolveOptions(o: SyncServerOptions): ResolvedOptions {
  if (!(o.serverSecret instanceof Uint8Array) || o.serverSecret.length < 32) {
    throw new Error('createSyncServer: serverSecret must be at least 32 bytes');
  }
  return {
    serverSecret: o.serverSecret,
    publicUrl: o.publicUrl,
    email: o.email,
    signupOpen: o.signupOpen ?? true,
    quotaBytes: o.quotaBytes ?? Sync.LIMITS.defaultQuotaBytes,
    minAge: o.minAge ?? DEFAULT_MIN_AGE,
    termsUrl: o.termsUrl,
    privacyUrl: o.privacyUrl,
    allowedOrigins: new Set(o.allowedOrigins),
    cookieSecure: o.cookieSecure !== false,
    now: o.now ?? Date.now,
    random: o.random ?? ((n: number) => new Uint8Array(randomBytes(n))),
    log: o.log ?? (() => {}),
  };
}

/**
 * Creates the server over `o.sql` (migrated on creation). The server owns `o.sql` from here on: `close()`
 * closes it.
 */
export function createSyncServer(o: SyncServerOptions): SyncServer {
  const opts = resolveOptions(o);
  const store = createSqliteSyncStore(o.sql);
  store.migrate();
  const ctx: ServerContext = { store, opts, limiter: createRateLimiter(opts.now), onAccountCreated: [] };
  const router = buildRouter(ctx);
  let closed = false;
  return {
    router,
    purgeExpired(): Promise<{ accounts: number; tokens: number; sessions: number }> {
      try {
        ctx.limiter.sweep();
        return Promise.resolve(store.purgeExpired(opts.now()));
      } catch (e) {
        return Promise.reject(e);
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      ctx.limiter.clear();
      if (o.sql.isOpen()) o.sql.close();
    },
  };
}
