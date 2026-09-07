/**
 * Auto-download manager for Bible translations.
 *
 * Automatically downloads a lite copy of Bible modules to OPFS when the user
 * selects a translation. Downloads are fire-and-forget — failures are silent.
 *
 * Also handles auto-cleanup of modules unused for a configurable number of days
 * (default 15, overridable via `staleDays` in server-config.json).
 * Explicitly downloaded modules (via Settings UI) are never auto-cleaned.
 */

import { offlineStore } from '../stores/offlineStore';
import type { OfflineStorageManager } from '../providers/OfflineStorageManager';

const DEFAULT_STALE_DAYS = 15;
let staleDays = DEFAULT_STALE_DAYS;

let storageManager: OfflineStorageManager | null = null;
let opfsAvailable: boolean | null = null;
const inProgressDownloads = new Set<string>();

/**
 * Initialize the auto-download manager with a shared OfflineStorageManager.
 * Must be called once at app startup.
 * @param configStaleDays Override for the number of days before auto-downloaded modules are cleaned up.
 */
export function initAutoDownload(manager: OfflineStorageManager, configStaleDays?: number): void {
  storageManager = manager;
  if (typeof configStaleDays === 'number' && configStaleDays > 0) {
    staleDays = configStaleDays;
  }
}

/**
 * Check OPFS availability (cached after first check).
 */
async function checkOpfs(): Promise<boolean> {
  if (opfsAvailable !== null) return opfsAvailable;
  try {
    await navigator.storage.getDirectory();
    opfsAvailable = true;
  } catch {
    opfsAvailable = false;
  }
  return opfsAvailable;
}

/**
 * Trigger a background lite download for a Bible translation.
 * Fire-and-forget — does nothing if the module is already downloaded or in progress.
 */
export function triggerAutoDownload(abbreviation: string, name: string): void {
  if (!storageManager) return;
  if (offlineStore.isModuleDownloaded(abbreviation)) return;
  if (inProgressDownloads.has(abbreviation)) return;
  if (offlineStore.activeDownloads.has(abbreviation)) return;

  inProgressDownloads.add(abbreviation);

  // Fire-and-forget — errors are swallowed
  (async () => {
    try {
      const available = await checkOpfs();
      if (!available) return;

      await storageManager!.downloadModuleLite(abbreviation, name);
    } catch {
      // Silent failure — user will just use server API
    } finally {
      inProgressDownloads.delete(abbreviation);
    }
  })();
}

/**
 * Clean up auto-downloaded modules that haven't been used within the staleDays threshold.
 * Called once at app startup. Only removes modules with autoDownloaded=true.
 */
export async function runAutoCleanup(): Promise<void> {
  if (!storageManager) return;

  const stale = offlineStore.getStaleAutoModules(staleDays);
  for (const mod of stale) {
    try {
      await storageManager.removeModule(mod.abbreviation);
      console.log(`[AutoCleanup] Removed stale module: ${mod.abbreviation} (unused for ${staleDays}+ days)`);
    } catch (err) {
      console.warn(`[AutoCleanup] Failed to remove ${mod.abbreviation}:`, err);
    }
  }
}
