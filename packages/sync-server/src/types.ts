/** Public options and handle of the sync server (contracts 0063 §11). */
import type { Router } from 'express';
import type { ISql } from '@bible/core';

export interface SyncServerOptions {
  sql: ISql;                               // its own SQLite file (WAL), never a module DB
  serverSecret: Uint8Array;                // 32 B, persisted by the host; HMAC for fake prelogin salts
  publicUrl: string;                       // for email links
  email: EmailSender;
  signupOpen?: boolean; quotaBytes?: number; minAge?: number; termsUrl?: string; privacyUrl?: string;
  allowedOrigins: string[];                // Origin check for cookie-auth writes
  cookieSecure?: boolean;                  // false only for http://localhost dev
  now?: () => number; random?: (n: number) => Uint8Array; log?: (level: 'info' | 'warn' | 'error', msg: string, meta?: object) => void;
}
export interface EmailSender { send(m: { to: string; subject: string; text: string; html?: string }): Promise<void> }
export interface SyncServer {
  router: Router;                          // mount at SYNC_API_PREFIX; carries its own json parser (8 MB) and rate limits
  purgeExpired(): Promise<{ accounts: number; tokens: number; sessions: number }>;  // host runs hourly
  close(): void;
}
