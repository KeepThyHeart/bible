/**
 * Service-worker registration and the update handshake.
 *
 * The handshake is deliberately "check first, render second": before the app
 * commits to running, it asks the server which build it is serving and compares
 * that with the build compiled into this bundle. A mismatch means the code about
 * to run is stale, so it updates the worker and reloads once instead of letting a
 * stale client talk to a newer server.
 */

import { reloadForUpdateOnce } from './bootGuard';
import { CACHE_RULES } from '../sw/rules';
import { preservedOnReset } from '../sw/cacheRules';
import { updateStore } from '../stores/updateStore';

/** Build identifier compiled in by vite.config.ts. */
declare const __BUILD_ID__: string;

export const CLIENT_BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/**
 * How a newer build reaches a running page:
 *  - `silent` (default): reload once, automatically, under the loop guard.
 *  - `prompt`: show the update banner and let the user choose when to reload.
 * A new *launch* always picks the update up silently before rendering
 * (`applyUpdateIfStale`); this only concerns a page that stays open.
 */
export type UpdateMode = 'silent' | 'prompt';

/** How long to wait for a new worker to take control before reloading anyway. */
const ACTIVATION_TIMEOUT_MS = 4000;

/** How often a long-lived page re-checks for a new worker while visible. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

let updateMode: UpdateMode = 'silent';

/** Base URL the worker is served under (`/` unless the app is mounted below it). */
function workerUrl(): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return `${base}sw.js`;
}

/**
 * Register the service worker (a no-op where service workers do not exist).
 *
 * The caller decides *whether* to call this from `features.pwa`; the server
 * decides which script `/sw.js` actually is, so a flag flipped off after the
 * registration was made turns the next update check into the kill switch.
 */
export function registerServiceWorker(options: { updateMode?: UpdateMode } = {}): void {
  if (!('serviceWorker' in navigator)) return;
  updateMode = options.updateMode === 'prompt' ? 'prompt' : 'silent';

  // Set only when a worker already controlled this page: on the very first
  // install `controllerchange` also fires, and that is not an update.
  let hadController = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    onNewVersionActive();
  });

  navigator.serviceWorker.register(workerUrl(), { scope: workerUrl().replace(/sw\.js$/, '') })
    .then(registration => {
      // A tab can stay open for days; ask the server for a newer worker whenever
      // it comes back to the foreground, and at most hourly.
      let lastCheck = Date.now();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
        lastCheck = Date.now();
        registration.update().catch(() => {});
      });
    })
    .catch(err => console.warn('[PWA] Service worker registration failed:', err));
}

/** A newer worker has taken control of this page. */
function onNewVersionActive(): void {
  if (updateMode === 'prompt') updateStore.setAvailable(true);
  else reloadForUpdateOnce();
}

/**
 * Caches a full reset must leave alone: `transformers-cache` (not ours) and
 * the rule caches flagged `keepOnReset` (the ~130 MB search model and index).
 */
export function cachesPreservedOnReset(): string[] {
  return preservedOnReset(CACHE_RULES);
}

/**
 * Tear down every installed worker and delete Cache Storage entries.
 *
 * Without this, disabling the PWA server-side only stops *new* registrations:
 * every browser that already has a worker keeps running it. This is the in-app
 * half of the teardown (it reaches browsers that boot); the other half is the
 * kill worker the server hands out at `/sw.js`, which reaches browsers too
 * wedged to boot. Large content caches are kept unless `includeLarge` is set.
 */
export async function unregisterServiceWorkers(options: { includeLarge?: boolean } = {}): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(r => r.unregister()));
    if ('caches' in window) {
      const preserve = new Set(options.includeLarge ? [] : cachesPreservedOnReset());
      // transformers-cache is never ours to delete, even on a full reset.
      preserve.add('transformers-cache');
      const names = await caches.keys();
      await Promise.all(names.filter(n => !preserve.has(n)).map(n => caches.delete(n)));
    }
  } catch (err) {
    console.warn('[PWA] Failed to unregister service worker:', err);
  }
}

/**
 * "Reset app cache": unregister the worker, clear the app's caches, reload.
 *
 * The way out of any stale-cache state. It touches Cache Storage and worker
 * registrations only: OPFS module downloads, settings, and user data are left
 * alone. The reload is user-initiated, so it bypasses the boot-loop guard, and
 * the next boot re-registers a fresh worker if the site still has the PWA on.
 */
export async function resetAppCache(options: { includeLarge?: boolean } = {}): Promise<void> {
  await unregisterServiceWorkers(options);
  window.location.reload();
}

/**
 * Pull the newest worker into control, then reload once so the page is running
 * the build the server is serving. Resolves only if the reload was suppressed by
 * the loop guard — otherwise the page is already navigating away.
 */
async function applyUpdate(): Promise<void> {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        // The worker skips waiting on install, so this is usually enough on its
        // own; postMessage covers a worker built before that behaviour existed.
        registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
        await registration.update();
        await waitForController();
      }
    } catch (err) {
      console.warn('[PWA] Update failed, reloading anyway:', err);
    }
  }
  reloadForUpdateOnce();
}

/** Resolve when a new worker takes control, or when the timeout expires. */
function waitForController(): Promise<void> {
  return new Promise(resolve => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', done);
      resolve();
    };
    navigator.serviceWorker.addEventListener('controllerchange', done);
    setTimeout(done, ACTIVATION_TIMEOUT_MS);
  });
}

/**
 * Compare this bundle's build against the server's and update if they differ.
 * Returns true when the page is being replaced, so the caller must stop.
 */
export async function applyUpdateIfStale(serverBuildId: string | undefined): Promise<boolean> {
  if (!serverBuildId || serverBuildId === CLIENT_BUILD_ID) return false;
  console.log(`[PWA] Build mismatch (client ${CLIENT_BUILD_ID}, server ${serverBuildId}) — updating`);
  await applyUpdate();
  // applyUpdate only returns here if the loop guard suppressed the reload; in
  // that case carrying on with the stale build beats a reload loop.
  return false;
}
