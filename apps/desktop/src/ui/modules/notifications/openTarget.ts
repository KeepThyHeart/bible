/**
 * Routes a notification click (main sends `open-target` on the module's event channel after
 * showing and focusing the window) to the right place in the renderer. Started by `module.ts`,
 * so it exists only while the Notifications module is on; `App.tsx` knows nothing about it.
 */

import { parseAppLink } from '@bible/core/browser';
import type { ReminderTarget } from '@bible/core/browser';
import { openApp } from '../../apps/appHost';
import { useBibleStore } from '../../stores/useBibleStore';
import { openMemoryRoute } from '../memory/memoryModule';
import { notificationsClient } from './notificationsAPI';

export interface NotificationOpenTargetHandlers {
  navigateToVerse(verseId: number, endVerseId?: number): void;
  openNotificationPreferences(): void;
  /** A desktop app link (`app:<id>[/route]`) was clicked. Optional so older callers keep working. */
  openAppRoute?(appId: string, route: string): void;
}

/** The window event the host listens for to open Preferences at a section (`App.tsx`). */
export const OPEN_PREFERENCES_SECTION_EVENT = 'open-preferences-section';

/** Pure router, exported for tests. Unknown targets and routes are ignored. */
export function routeNotificationTarget(
  target: ReminderTarget,
  handlers: NotificationOpenTargetHandlers
): void {
  if (target.kind === 'verse') {
    handlers.navigateToVerse(target.verseId, target.endVerseId);
  } else if (target.kind === 'route' && target.route === 'settings/notifications') {
    handlers.openNotificationPreferences();
  } else if (target.kind === 'route') {
    const link = parseAppLink(target.route);
    if (link) handlers.openAppRoute?.(link.segment, link.route);
  }
}

/** The host's own navigation: Study's dockview takes the verse, Preferences opens through a window event. */
export const hostOpenTargetHandlers: NotificationOpenTargetHandlers = {
  navigateToVerse(verseId, endVerseId) {
    void openApp('study');
    void useBibleStore.getState().navigateToVerseInPrimary(verseId, endVerseId);
  },
  openNotificationPreferences() {
    window.dispatchEvent(new CustomEvent(OPEN_PREFERENCES_SECTION_EVENT, { detail: 'notifications' }));
  },
  openAppRoute(appId, route) {
    // The route is handed to the app only once it is really open (a failed open must not leave
    // a pending request that a later, unrelated open would act on).
    void openApp(appId).then((result) => {
      if (appId === 'memory' && (result.status === 'activated' || result.status === 'already')) openMemoryRoute(route);
    });
  },
};

/**
 * Subscribe to click-throughs, then pick up one that arrived while the page was loading (waiting in
 * main) exactly once. Returns the unsubscribe.
 */
export function startNotificationOpenTargetRouting(
  handlers: NotificationOpenTargetHandlers = hostOpenTargetHandlers,
  client: Pick<typeof notificationsClient, 'on' | 'takeOpenTarget'> = notificationsClient
): { dispose(): void } {
  let off: (() => void) | undefined;
  try {
    off = client.on('open-target', (target) => routeNotificationTarget(target, handlers));
  } catch {
    return { dispose() {} }; // no module bridge (not running in Electron)
  }
  void client
    .takeOpenTarget()
    .then((target) => {
      if (target) routeNotificationTarget(target, handlers);
    })
    .catch(() => undefined);
  return {
    dispose() {
      off?.();
    },
  };
}
