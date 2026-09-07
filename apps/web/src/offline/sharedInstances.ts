/**
 * Shared singleton instances for offline support.
 * Separated from main.tsx to avoid circular imports.
 */

import { OfflineStorageManager } from '../providers/OfflineStorageManager';
import { API_BASE } from '../utils/apiUrl';
import { OfflineBibleProvider } from './OfflineBibleProvider';
import type { BibleWorkerProxy } from './BibleWorkerProxy';
import type { IBibleDataProvider } from '../providers/interfaces';

export const offlineStorageManager = new OfflineStorageManager(API_BASE);

/**
 * Create the OfflineBibleProvider and kick off a background DB-open for every
 * already-downloaded module, so the first Bible request after app boot can be
 * served locally instead of waiting on the server. Fire-and-forget — failures
 * are logged but never block init, and the lazy-open path in the provider
 * remains as a safety net.
 */
export function createOfflineBibleProvider(
  server: IBibleDataProvider,
  workerProxy: BibleWorkerProxy,
): OfflineBibleProvider {
  const offlineBibleProvider = new OfflineBibleProvider(server, workerProxy);
  offlineBibleProvider.preload().catch(err =>
    console.warn('OfflineBibleProvider preload failed', err)
  );
  return offlineBibleProvider;
}
