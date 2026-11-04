/**
 * Provider selection and fallback for the online meaning search.
 *
 * The remote provider runs only with consent. Every failure (and no consent, and
 * no configuration) falls through to the next provider: the installed local pack
 * on desktop, keyword search on web. The caller supplies the providers; this
 * function owns the order and the "nothing is sent before consent" rule.
 */

import { RemoteSemanticError, type RemoteErrorKind } from './RemoteSemanticClient';
import type { ConsentStatus } from './consent';

export type ChainSkipReason = 'not-configured' | 'no-consent' | 'declined' | 'remote-error';

export interface ChainFallback<T> {
  name: string;
  /** Return null/undefined (or throw) to move on to the next fallback. */
  run: () => Promise<T | null | undefined>;
}

export interface ChainOptions<T> {
  consent: ConsentStatus;
  /** Absent when the build/site has no remote configuration. */
  remote?: () => Promise<T>;
  fallbacks: ChainFallback<T>[];
}

export interface ChainOutcome<T> {
  result: T | null;
  /** `'remote'` or the name of the fallback that answered; null if none did. */
  source: string | null;
  /** Why the remote provider did not answer; absent when it did. */
  skipped?: ChainSkipReason;
  /** The remote error behind `skipped: 'remote-error'`. */
  remoteError?: RemoteSemanticError;
}

export async function runSemanticChain<T>(opts: ChainOptions<T>): Promise<ChainOutcome<T>> {
  let skipped: ChainSkipReason | undefined;
  let remoteError: RemoteSemanticError | undefined;

  if (!opts.remote) skipped = 'not-configured';
  else if (opts.consent === 'unset') skipped = 'no-consent';
  else if (opts.consent === 'declined') skipped = 'declined';
  else {
    try {
      return { result: await opts.remote(), source: 'remote' };
    } catch (e) {
      skipped = 'remote-error';
      remoteError = e instanceof RemoteSemanticError
        ? e
        : new RemoteSemanticError('unknown', 0, 'unknown', e instanceof Error ? e.message : String(e));
    }
  }

  for (const fb of opts.fallbacks) {
    try {
      const r = await fb.run();
      if (r !== null && r !== undefined) return { result: r, source: fb.name, skipped, remoteError };
    } catch { /* try the next one */ }
  }
  return { result: null, source: null, skipped, remoteError };
}

/** What the UI should say about a failed remote call. */
export type RemoteNote =
  | { kind: 'quota'; resetAtMs?: number }
  | { kind: 'paused'; resetAtMs?: number }
  | { kind: 'unavailable' }
  | { kind: 'rephrase' };

const PAUSED: RemoteErrorKind[] = ['blocked', 'budget_exhausted', 'forbidden', 'rate_limited'];

export function noteForRemoteError(e: RemoteSemanticError | undefined): RemoteNote | undefined {
  if (!e) return undefined;
  if (e.kind === 'quota_exceeded' || (e.kind === 'blocked' && e.details.cause === 'quota_exceeded')) {
    return { kind: 'quota', resetAtMs: e.resetAtMs };
  }
  if (e.kind === 'invalid_query' || e.kind === 'rejected') return { kind: 'rephrase' };
  if (PAUSED.includes(e.kind)) return { kind: 'paused', resetAtMs: e.resetAtMs };
  return { kind: 'unavailable' };
}
