/**
 * Auto-download manager for Bible translations.
 *
 * Automatically downloads a lite copy of Bible modules to OPFS when the user
 * selects a translation. Downloads are fire-and-forget — failures are silent.
 *
 * Also handles auto-cleanup of modules unused for a configurable number of days
 * (default 15, overridable via `staleDays` in server-config.json).
 * Explicitly downloaded modules (via Settings UI) are never auto-cleaned.
 *
 * Only the reader's *working* translations are fetched. A site may offer
 * dozens, and opening one in passing — a shared link, a quick comparison, a
 * look through the translation list — must not cost a full download each. So:
 *   - a translation is downloaded only after {@link MIN_CHAPTER_READS} chapter
 *     reads in it (counted across visits, in localStorage);
 *   - at most {@link MAX_AUTO_DOWNLOADS} auto-downloaded translations are kept;
 *     adding one past that removes the least recently used of them.
 */

import { offlineStore } from '../stores/offlineStore';
import type { OfflineStorageManager } from '../providers/OfflineStorageManager';

const DEFAULT_STALE_DAYS = 15;

/** Chapter reads in a translation before it is worth keeping a local copy. */
export const MIN_CHAPTER_READS = 3;
/** Auto-downloaded translations kept at once (explicit downloads do not count). */
export const MAX_AUTO_DOWNLOADS = 2;

const READS_KEY = 'bible-reader-auto-download-reads';

function loadReads(): Record<string, number> {
  try {
    const raw = localStorage.getItem(READS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed as Record<string, number> : {};
  } catch {
    return {};
  }
}

/** Count one chapter read of `abbreviation`; returns the new total. */
function countRead(abbreviation: string): number {
  const reads = loadReads();
  const next = Math.min((reads[abbreviation] ?? 0) + 1, MIN_CHAPTER_READS);
  if (next !== reads[abbreviation]) {
    reads[abbreviation] = next;
    try { localStorage.setItem(READS_KEY, JSON.stringify(reads)); } catch { /* storage full or blocked */ }
  }
  return next;
}

/** Remove least-recently-used auto downloads until there is room for `keep` more. */
async function makeRoom(keep: number): Promise<void> {
  const auto = offlineStore.downloadedModules
    .filter(m => m.autoDownloaded && m.type === 'bible')
    .sort((a, b) => lastUsed(a) - lastUsed(b));
  while (auto.length + keep > MAX_AUTO_DOWNLOADS && auto.length > 0) {
    const victim = auto.shift()!;
    try {
      await storageManager!.removeModule(victim.abbreviation);
    } catch (err) {
      console.warn(`[AutoDownload] Failed to remove ${victim.abbreviation}:`, err);
    }
  }
}

function lastUsed(m: { lastUsedAt?: string; downloadedAt: string }): number {
  return new Date(m.lastUsedAt ?? m.downloadedAt).getTime();
}
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
 * Run `fn` once the browser is idle, or after `timeoutMs` at the latest.
 *
 * The download this defers is the largest thing a visitor fetches (KJV is
 * ~1.9 MB gzipped). Its only caller is `navigateTo`, which runs *during* boot —
 * before the first chapter has painted — so starting it there put a multi-
 * megabyte transfer in direct competition with the app bundle and the boot API
 * requests, on exactly the slow links where that hurts most. Nothing waits on
 * it: it is a cache for *later* chapter changes, so it can wait for quiet.
 */
function whenIdle(fn: () => void, timeoutMs = 5000): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void })
    .requestIdleCallback;
  if (ric) ric(fn, { timeout: timeoutMs });
  else setTimeout(fn, timeoutMs); // Safari < 16.4
}

/**
 * Trigger a background lite download for a Bible translation.
 * Fire-and-forget — does nothing if the module is already downloaded or in progress.
 *
 * Deferred to browser idle; see `whenIdle`.
 */
export function triggerAutoDownload(abbreviation: string, name: string): void {
  if (!storageManager) return;
  if (offlineStore.isModuleDownloaded(abbreviation)) return;
  // Not a working translation (yet): a passing visit costs no download.
  if (countRead(abbreviation) < MIN_CHAPTER_READS) return;
  if (inProgressDownloads.has(abbreviation)) return;
  if (offlineStore.activeDownloads.has(abbreviation)) return;

  // Claimed now rather than inside the idle callback, so that repeated
  // navigation within the same chapter cannot queue the same download twice
  // while the first is still waiting for idle.
  inProgressDownloads.add(abbreviation);

  // Fire-and-forget — errors are swallowed
  whenIdle(() => void (async () => {
    try {
      const available = await checkOpfs();
      if (!available) return;

      await makeRoom(1);
      await storageManager!.downloadModuleLite(abbreviation, name);
    } catch {
      // Silent failure — user will just use server API
    } finally {
      inProgressDownloads.delete(abbreviation);
    }
  })());
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
