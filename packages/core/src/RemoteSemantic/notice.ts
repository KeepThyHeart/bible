/**
 * What the UI says about a semantic search, shared by web and desktop.
 * Carried on `SearchResultSet.semantic` (web) and on the desktop IPC reply.
 */
import type { RemoteNote } from './fallbackChain';

export type SemanticSource = 'remote' | 'local' | 'keyword' | 'server' | 'browser';

export type SemanticNotice =
  /** Remote answered with keyword results (small "keyword results" note). */
  | { kind: 'degraded' }
  /** The user chose "Not now" (or turned the option off): one-line hint to enable it in settings. */
  | { kind: 'declined' }
  | RemoteNote;

export interface SemanticRateLimit {
  limit?: number;
  remaining?: number;
  /** Epoch ms of the daily reset. */
  resetAtMs?: number;
}

export interface SemanticMeta {
  /** Which provider produced the results. */
  source: SemanticSource;
  notice?: SemanticNotice;
  rateLimit?: SemanticRateLimit;
}
