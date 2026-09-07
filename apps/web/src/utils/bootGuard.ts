/**
 * Guards for anything that navigates or reloads the page automatically.
 *
 * Every automatic navigation is a potential infinite loop, because the code that
 * decides to navigate runs again from scratch on the other side. In-memory flags
 * cannot see that pattern — they are wiped by the very navigation they are meant
 * to bound — so the guards here live in sessionStorage, which survives a reload
 * but not a tab close.
 *
 * The boot-loop detector in index.html is the outer net; these are the inner
 * ones, placed at each site that can trigger a navigation on its own.
 */

/** One automatic navigation of a given kind per this many milliseconds. */
const COOLDOWN_MS = 30_000;

const LOGIN_NAV_KEY = 'br_nav_login';
const UPDATE_RELOAD_KEY = 'br_nav_update';

/**
 * True when index.html's boot-loop detector has already stopped this page.
 * Callers must not boot the app or navigate when this is set.
 */
export function isBootLoopTripped(): boolean {
  return (window as { __bibleBootLoopTripped?: boolean }).__bibleBootLoopTripped === true;
}

/**
 * Consume a one-shot allowance for an automatic navigation.
 * Returns false when one was already spent inside the cooldown.
 */
function claim(key: string): boolean {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(key)) || 0;
  } catch {
    // Private browsing with storage disabled: fall through and allow once. The
    // boot-loop detector has the same limitation and the same fallback.
  }
  if (last && Date.now() - last < COOLDOWN_MS) return false;
  try {
    sessionStorage.setItem(key, String(Date.now()));
  } catch { /* best effort */ }
  return true;
}

/**
 * Navigate to the server-rendered login page after an auth failure.
 *
 * Returns false if this page already tried recently, in which case the caller
 * should show the session-expired UI and let the user click. A user-initiated
 * navigation cannot loop; an automatic one can, and did.
 */
export function navigateToLoginOnce(): boolean {
  if (isBootLoopTripped()) return false;
  if (!claim(LOGIN_NAV_KEY)) return false;
  // A cache-busting param keeps any intermediate HTTP cache out of the way. The
  // service worker no longer needs bypassing — src/sw.ts sends navigations to
  // the network — but an older worker may still be in control during rollout.
  window.location.assign(`/?login=${Date.now().toString(36)}`);
  return true;
}

/** Reload to pick up a newly activated service worker. Returns false if already used. */
export function reloadForUpdateOnce(): boolean {
  if (isBootLoopTripped()) return false;
  if (!claim(UPDATE_RELOAD_KEY)) return false;
  window.location.reload();
  return true;
}

/**
 * Show the built-in error screen from index.html.
 * Used when a guard has been spent and the next move has to be the user's.
 */
export function showBootError(message: string): void {
  const show = (window as { showAppError?: (msg: string) => void }).showAppError;
  if (typeof show === 'function') show(message);
  else console.error('[Boot]', message);
}
