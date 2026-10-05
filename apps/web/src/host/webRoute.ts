/**
 * Where apps live in the URL: `#/@present` etc. (`formatAppLink`). Generalises
 * the old presenter-only route. Evaluated at module load from the entry, so its
 * popstate listener runs before the one `MobileApp` adds.
 *
 * - Entering a non-Study app pushes `#/@id` and remembers the reader's hash.
 * - Leaving replaces the app hash with the reader's own hash (no re-navigation)
 *   and activates Study.
 * - Back/Forward/hand-edited hashes map onto `appHost.activate`.
 * - The URL is written at request time (last request wins), never when an
 *   activation completes. The hash belongs to Study only while Study is the
 *   target app (see hashGate).
 */
import { isAppHash, parseAppLink, appLinkSegment, formatAppLink, STUDY_APP_ID } from '@bible/core/browser';
import type { AppId } from '@bible/core/browser';
import { setStudyOwnsHash, takeStudyHash } from './hashGate';
import {
  activateWithRecovery, appHost, appRegistry, consumeAppPop, isAppActive, noteAppPop, setAppNavigator,
} from './appHost';

export { consumeAppPop, isAppActive };

/** Fired on `window` whenever these helpers open or close an app. */
export const APP_ROUTE_EVENT = 'app-route';

let hashBeforeOpen = '';

function announce(): void {
  window.dispatchEvent(new Event(APP_ROUTE_EVENT));
}

/** The app a URL hash names: a registered `#/@seg`, else Study. */
export function appIdForHash(hash: string = window.location.hash): AppId {
  const link = parseAppLink(hash);
  if (!link) return STUDY_APP_ID;
  const desc = appRegistry.list().find((d) => appLinkSegment(d) === link.segment);
  return desc ? desc.id : STUDY_APP_ID;
}

/** The app being shown, or the one about to be. */
function targetApp(): AppId | null {
  const s = appHost.getSnapshot();
  return s.pendingId ?? s.activeId;
}

function writeUrl(mode: 'push' | 'replace', url: string): void {
  try {
    if (mode === 'push') history.pushState(null, '', url);
    else history.replaceState(null, '', url);
  } catch {
    if (mode === 'push') window.location.hash = url.startsWith('#') ? url : `#${url.split('#')[1] ?? ''}`;
  }
}

/** Open an app, remembering the reader's hash for the way back. */
export async function activateApp(id: AppId, route = ''): Promise<void> {
  if (id === STUDY_APP_ID) return backFromApp();
  const current = targetApp();
  const link = formatAppLink(appLinkSegmentFor(id), route);
  if (current === id && window.location.hash === link) {
    await activateWithRecovery(id, { route, source: 'nav' });
    return;
  }
  if (current === STUDY_APP_ID || current === null) {
    hashBeforeOpen = isAppHash(window.location.hash) ? '' : window.location.hash;
    takeStudyHash();
  }
  setStudyOwnsHash(false);
  writeUrl('push', link);
  announce();
  const result = await activateWithRecovery(id, { route, source: 'nav' });
  if ((result.status === 'failed' || result.status === 'unavailable') && isAppActive(STUDY_APP_ID)) {
    // Never got there: put the reader's URL back.
    restoreReaderUrl();
    setStudyOwnsHash(true);
  }
}

function appLinkSegmentFor(id: AppId): string {
  const desc = appRegistry.get(id);
  return desc ? appLinkSegment(desc) : id;
}

function restoreReaderUrl(): void {
  const remembered = takeStudyHash() ?? hashBeforeOpen;
  hashBeforeOpen = '';
  if (isAppHash(window.location.hash)) {
    writeUrl('replace', remembered || window.location.pathname + window.location.search);
  }
}

/** Back to Study, restoring the reader's own hash without re-navigating it. */
export async function backFromApp(): Promise<void> {
  restoreReaderUrl();
  setStudyOwnsHash(true);
  announce();
  await activateWithRecovery(STUDY_APP_ID, { source: 'back' });
}

function onPop(event: Event): void {
  const target = appIdForHash();
  const current = targetApp();
  if (event.type === 'popstate') noteAppPop(current !== null && target !== current);
  if (current === null || target === current) return;
  // Flip ownership first: Study's own hashchange handler runs right after this.
  if (target === STUDY_APP_ID) {
    takeStudyHash(); // drop a stale remembered hash; the URL is the truth now
    setStudyOwnsHash(true);
  } else {
    setStudyOwnsHash(false);
  }
  announce();
  void activateWithRecovery(target, { source: 'link' });
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', onPop);
  window.addEventListener('hashchange', onPop);
  setAppNavigator({ open: (id, route) => activateApp(id, route), back: () => backFromApp() });
}

/** Test hook. */
export function resetWebRouteForTest(): void {
  hashBeforeOpen = '';
}
