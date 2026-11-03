/**
 * Provider order for `search:semanticSearchEx` (task 0190), kept free of
 * Electron and database imports so it is unit-testable.
 *
 *   source 'off'                          -> throws 'unavailable' (keyword search only)
 *   source 'online' + consent granted     -> remote, then the installed local pack
 *   otherwise ('offline', or no consent)  -> the installed local pack only
 *   nothing answered                      -> throws the 'unavailable' IpcKnownError
 *                                            (the renderer shows keyword results)
 *
 * The remote service is only ever touched through `runSemanticChain`, which
 * refuses to call it without consent.
 */
import { RemoteSemantic } from '@bible/core';
import { IpcKnownError } from './result';
import type { RemoteSemanticService, SemanticSource } from '../services/RemoteSemanticService';

/** Same shape as the rows `search:semanticSearch` returns. */
export interface SemanticRow {
  id: string;
  level: string;
  startVerseId: number;
  endVerseId: number;
  reference: string;
  text: string;
  textPreview: string;
  similarity: number;
}

export interface SemanticSearchExOptions {
  maxResults?: number;
  levels?: string[];
}

export interface SemanticSearchExResult {
  results: SemanticRow[];
  source: 'remote' | 'local';
  notice?: RemoteSemantic.SemanticNotice;
  rateLimit?: RemoteSemantic.SemanticRateLimit;
}

export interface SemanticSearchExDeps {
  service: Pick<RemoteSemanticService, 'isConfigured' | 'getStatus' | 'search'>;
  /** True when the installed pack can answer. */
  localAvailable: () => boolean;
  /** The existing local path; may throw. */
  runLocal: (query: string, options?: SemanticSearchExOptions) => Promise<SemanticRow[]>;
  /** Turn remote hits into rows; hits that cannot be hydrated are dropped. */
  hydrate: (hits: RemoteSemantic.RemoteHit[]) => SemanticRow[];
}

/** True when the semantic toggle should be offered. */
export function isSemanticOffered(
  localAvailable: boolean,
  status: { configured: boolean; consent: RemoteSemantic.ConsentStatus; source?: SemanticSource },
): boolean {
  const source = status.source ?? 'online';
  if (source === 'off') return false;
  if (source === 'offline') return localAvailable;
  return localAvailable || (status.configured && status.consent !== 'declined');
}

export async function runSemanticSearchEx(
  deps: SemanticSearchExDeps,
  query: string,
  options: SemanticSearchExOptions = {},
): Promise<SemanticSearchExResult> {
  const status = deps.service.getStatus();
  const levels = options.levels;
  if (status.source === 'off') {
    throw new IpcKnownError('unavailable', 'Meaning search is turned off in Preferences > Search.');
  }
  const online = status.configured && status.source === 'online';

  const outcome = await RemoteSemantic.runSemanticChain<SemanticSearchExResult>({
    consent: status.consent,
    remote: online
      ? async () => {
          const res = await deps.service.search(query, { maxResults: options.maxResults });
          let results = deps.hydrate(res.hits);
          if (levels) results = results.filter(r => levels.includes(r.level));
          const rl = res.rateLimit;
          const hasRl = rl && (rl.limit !== undefined || rl.remaining !== undefined || rl.resetAtMs !== undefined);
          return {
            results,
            source: 'remote' as const,
            ...(res.degraded || res.routed ? { notice: { kind: 'degraded' as const } } : {}),
            ...(hasRl ? { rateLimit: { limit: rl.limit, remaining: rl.remaining, resetAtMs: rl.resetAtMs } } : {}),
          };
        }
      : undefined,
    fallbacks: [
      {
        name: 'local',
        run: async () =>
          deps.localAvailable()
            ? { results: await deps.runLocal(query, options), source: 'local' as const }
            : null,
      },
    ],
  });

  if (!outcome.result) {
    throw new IpcKnownError(
      'unavailable',
      'Semantic search is not available. Install the semantic search pack from Module Manager -> Features.',
    );
  }

  const result = outcome.result;
  if (outcome.source !== 'remote') {
    // Something other than the remote answered: say why, when there is a reason.
    const note = RemoteSemantic.noteForRemoteError(outcome.remoteError);
    if (note) result.notice = note;
    // After "Not now" (which also moved the source to offline), keep pointing
    // at where it can be changed. A plain offline choice gets no note.
    else if (status.configured && status.consent === 'declined') result.notice = { kind: 'declined' };
  }
  return result;
}
