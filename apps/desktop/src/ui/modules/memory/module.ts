/**
 * Lazy half of the Memory module (desktop, task 0114). Activated once the renderer is idle
 * (`onStartupFinished`) and again whenever the module is switched on; everything it sets up is
 * pushed to `ctx.subscriptions`, so switching the module off removes it without a reload:
 * the due badge and its refresh, the push-event subscription, one-time notices, and Memory's own
 * handling of notification clicks.
 */
import type { FeatureModuleContext } from '@bible/core/browser';
import { parseAppLink } from '@bible/core/browser';
import type { MemoryPush } from '@bible/memory/api';
import { MEMORY_APP_ID } from '@bible/memory/manifest';
import { appRegistry, bindAppLinkHandler, isAppActive, openApp } from '../../apps/appHost';
import { useToastStore } from '../../stores/useToastStore';
import { featureModules } from '../moduleHost';
import { notificationsClient } from '../notifications/notificationsAPI';
import { openMemoryRoute } from './cardsRequest';
import { memoryClient } from './memoryClient';
import { memoryT } from './memoryT';

/** Delay before the one-time status fetch, so it never competes with startup. */
export const INITIAL_STATUS_DELAY_MS = 2500;
/** How often the badge is re-read (also on window focus). */
export const STATUS_REFRESH_MS = 10 * 60_000;

/**
 * Memory's own handling of a notification click (`app:memory[/route]`), so it works whatever the
 * Notifications module's state. Main sends the click on the notifications event channel (a plain
 * IPC event). When Notifications' routing is listening it hands the link to the handler bound
 * here; otherwise this listens itself. "Listening" is asked when the click arrives, not whether the
 * module is merely enabled: it may not have activated yet. (The one-shot pickup of a click that
 * arrived during page load belongs to Notifications; with it off, main has no such handler.)
 */
export function startMemoryClickRouting(
  client: Pick<typeof notificationsClient, 'on'> = notificationsClient,
  notificationsListening: () => boolean = () => featureModules.isActive('notifications'),
): { dispose(): void } {
  // The one place Memory's links are acted on: open the app, then hand over the route once the app
  // is really open (a failed or superseded open must not leave a pending request that a later,
  // unrelated open would act on).
  const handle = (route: string): void => {
    void openApp(MEMORY_APP_ID).then((result) => {
      if (result.status === 'activated' || result.status === 'already') openMemoryRoute(route);
    });
  };
  const binding = bindAppLinkHandler(MEMORY_APP_ID, handle);
  const onTarget = (target: { kind: string; route?: string }): void => {
    if (notificationsListening() || target.kind !== 'route') return;
    const link = parseAppLink(target.route);
    if (link && link.segment === MEMORY_APP_ID) handle(link.route);
  };
  let off: (() => void) | undefined;
  try {
    off = client.on('open-target', onTarget);
  } catch {
    // no module bridge (not running in Electron)
  }
  return {
    dispose() {
      off?.();
      binding.dispose();
    },
  };
}

function badgeFor(due: number, waiting: number) {
  if (due <= 0 && waiting <= 0) return undefined;
  const parts: string[] = [];
  if (due > 0) parts.push(memoryT('memory.badge.due', '{count, plural, one {# verse due} other {# verses due}}', { count: due }));
  if (waiting > 0) parts.push(memoryT('memory.badge.waiting', '{count, plural, one {# card waiting} other {# cards waiting}}', { count: waiting }));
  // The number is the verses due; with none due, the push cards waiting.
  return { kind: 'count' as const, value: due > 0 ? due : waiting, tone: 'attention' as const, label: parts.join(', ') };
}

const windowVisible = (): boolean => typeof document === 'undefined' || document.visibilityState === 'visible';

/** Show the one-time notices main has queued, when a window is visible (a tray launch must not use them up). */
export async function collectNotices(client: Pick<typeof memoryClient, 'takeNotices'> = memoryClient): Promise<void> {
  if (!windowVisible()) return;
  const notices = await client.takeNotices();
  for (const n of notices) useToastStore.getState().addToast(memoryT(`memory.notice.${n.id}`, n.message), 'info');
}

export function activate(ctx: FeatureModuleContext): void {
  // Set on dispose: a status or notice reply that arrives after the module was switched off is dropped.
  let disposed = false;
  ctx.subscriptions.push(startMemoryClickRouting());

  const applyStatus = (due: number, waiting: number): void => {
    if (disposed) return;
    appRegistry.setBadge(MEMORY_APP_ID, badgeFor(due, waiting));
  };
  let warned = false;
  const warn = (what: string, error: unknown): void => {
    if (!warned) console.warn(`[memory] ${what} unavailable:`, error);
    warned = true;
  };
  const notices = (): void => {
    void (async () => {
      try {
        if (!disposed) await collectNotices();
      } catch (error) {
        warn('notices', error);
      }
    })();
  };
  const onPush = (push: MemoryPush): void => {
    if (push.type === 'status') {
      applyStatus(push.status.due, push.status.waiting);
      notices(); // retiring the old extension queues a notice and pushes a status
    } else if (push.type === 'notice' && !isAppActive(MEMORY_APP_ID)) {
      // Inside the open app the notice shows in its own status line; elsewhere as a toast.
      useToastStore.getState().addToast(push.message, 'info');
    }
  };
  try {
    const off = memoryClient.on('push', onPush);
    ctx.subscriptions.push({ dispose: off });
  } catch (error) {
    console.warn('[memory] push subscription unavailable:', error);
  }

  // Cards come due while the core is not running (it pushes status only while it runs), so the
  // badge is re-read now and then: two COUNTs in main, never a core start.
  const refresh = (): void => {
    // The module bridge is missing outside Electron (and in tests): the client throws synchronously.
    void (async () => {
      try {
        const s = await memoryClient.getStatus();
        applyStatus(s.due, s.waiting);
      } catch (error) {
        warn('status', error);
      }
      try {
        if (!disposed) await collectNotices();
      } catch (error) {
        warn('notices', error);
      }
    })();
  };
  const timer = setTimeout(refresh, INITIAL_STATUS_DELAY_MS);
  const interval = setInterval(refresh, STATUS_REFRESH_MS);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', notices);
  ctx.subscriptions.push({
    dispose() {
      disposed = true;
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', notices);
      appRegistry.setBadge(MEMORY_APP_ID, undefined);
    },
  });
}
