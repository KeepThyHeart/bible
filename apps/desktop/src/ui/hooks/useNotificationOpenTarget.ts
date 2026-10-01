/**
 * Routes a notification click (main sends `notifications:open-target` after
 * showing and focusing the window) to the right place in the renderer.
 */

import { useEffect } from 'react';
import type { ReminderTarget } from '@bible/core/browser';

export interface NotificationOpenTargetHandlers {
  navigateToVerse(verseId: number, endVerseId?: number): void;
  openNotificationPreferences(): void;
}

/** Pure router, exported for tests. Unknown targets and routes are ignored. */
export function routeNotificationTarget(
  target: ReminderTarget,
  handlers: NotificationOpenTargetHandlers
): void {
  if (target.kind === 'verse') {
    handlers.navigateToVerse(target.verseId, target.endVerseId);
  } else if (target.kind === 'route' && target.route === 'settings/notifications') {
    handlers.openNotificationPreferences();
  }
}

export function useNotificationOpenTarget(handlers: NotificationOpenTargetHandlers): void {
  const { navigateToVerse, openNotificationPreferences } = handlers;
  useEffect(() => {
    const api = window.electron?.notifications;
    if (!api?.onOpenTarget) return;
    return api.onOpenTarget((target) =>
      routeNotificationTarget(target, { navigateToVerse, openNotificationPreferences })
    );
  }, [navigateToVerse, openNotificationPreferences]);
}
