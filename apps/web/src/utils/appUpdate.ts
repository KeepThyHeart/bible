/**
 * Service-worker registration and the update handshake.
 *
 * The handshake is deliberately "check first, render second": before the app
 * commits to running, it asks the server which build it is serving and compares
 * that with the build compiled into this bundle. A mismatch means the code about
 * to run is stale, so it updates the worker and reloads once instead of letting a
 * stale client talk to a newer server.
 */

import { registerSW } from 'virtual:pwa-register';
import { reloadForUpdateOnce } from './bootGuard';

/** Build identifier compiled in by vite.config.ts. */
declare const __BUILD_ID__: string;

/** Whether this build shipped a service worker at all — see vite.config.ts. */
declare const __PWA_ENABLED__: boolean;

export const CLIENT_BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/**
 * False unless the build opted in with `ENABLE_PWA=1`. When false there is no
 * `sw.js` to register — `dist/client/sw.js` is instead a self-destroying worker
 * that removes any leftover registration from an earlier PWA build.
 *
 * The build ID handshake below still runs: it is cheap, it is the only thing that
 * catches a tab left open across a deploy, and it no longer has a cached shell
 * working against it.
 */
export const PWA_BUILD_ENABLED: boolean = typeof __PWA_ENABLED__ === 'boolean' ? __PWA_ENABLED__ : false;

/** How long to wait for a new worker to take control before reloading anyway. */
const ACTIVATION_TIMEOUT_MS = 4000;

let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;

/**
 * Register the service worker.
 *
 * `onNeedRefresh` applies the update silently rather than asking. The old
 * confirm() prompt had a failure mode of its own: dismiss it once and the browser
 * stayed on the old build indefinitely, which is how clients drifted far enough
 * from the server to break in the first place.
 */
export function registerServiceWorker(): void {
  if (!PWA_BUILD_ENABLED) return;
  updateSW = registerSW({
    onNeedRefresh() {
      void applyUpdate();
    },
    onOfflineReady() {
      console.log('[PWA] App ready for offline use');
    },
  });
}

/**
 * Remote kill switch: tear down any installed worker and its caches.
 *
 * Without this, disabling the PWA server-side only stops *new* registrations —
 * every browser that already has a worker keeps running it forever, with no way
 * to reach them. The large content caches are kept; they are plain content
 * and re-downloading ~130 MB to disable a feature flag would be its own problem.
 *
 * This is the in-app half of the teardown and only reaches browsers that get far
 * enough to run it. The other half is `dist/client/sw.js`, which in a non-PWA
 * build is a self-destroying worker — that one reaches clients too wedged to boot.
 */
export async function unregisterServiceWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(r => r.unregister()));
    if ('caches' in window) {
      // 'transformers-cache' is written by @huggingface/transformers from the search
      // worker, not by any service worker. It holds the ~130 MB embedding model and
      // survives on its own — dropping it here would cost a full re-download.
      const preserve = new Set(['embedding-model', 'semantic-index', 'transformers-cache']);
      const names = await caches.keys();
      await Promise.all(names.filter(n => !preserve.has(n)).map(n => caches.delete(n)));
    }
  } catch (err) {
    console.warn('[PWA] Failed to unregister service worker:', err);
  }
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
  if (updateSW) {
    // Let workbox tear down its own state; ignore failures, the reload follows.
    await updateSW(false).catch(() => {});
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
