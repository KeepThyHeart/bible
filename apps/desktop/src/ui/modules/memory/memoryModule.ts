/**
 * The Scripture Memory feature module in the desktop renderer (task 0114). Eager and tiny:
 * the manifest/binding pair, the host-side wiring (app binding, "Memorize" verse action,
 * due badge, notices) and the notification-click request. The app view and `@bible/memory/ui`
 * are lazy chunks, loaded only when the Memory app opens.
 */
import { MEMORIZE_ACTION_ID, MEMORY_APP_ID, memoryManifest } from '@bible/memory/manifest';
import type { MemoryPush } from '@bible/memory/api';
import type { FeatureModuleBinding, FeatureModuleManifest } from '@bible/core/browser';
import { parseAppLink } from '@bible/core/browser';
import { addAppBinding, appRegistry, bindAppLinkHandler, isAppActive, openApp, verseActions } from '../../apps/appHost';
import { i18nService } from '../../services/I18nService';
import { useToastStore } from '../../stores/useToastStore';
import { featureModules } from '../moduleHost';
import { notificationsClient } from '../notifications/notificationsAPI';
import { memoryClient } from './memoryClient';

export const memoryModule: readonly [FeatureModuleManifest, FeatureModuleBinding] = [memoryManifest, { id: 'memory' }];

/** Delay before the one-time status fetch, so it never competes with startup. */
export const INITIAL_STATUS_DELAY_MS = 2500;
/** How often the badge is re-read (also on window focus). */
export const STATUS_REFRESH_MS = 10 * 60_000;

// --- "open the card stack" requests (notification click) -------------------

type CardsListener = () => void;
let cardsListener: CardsListener | null = null;
let cardsPending = false;

/** The mounted view registers here; returns the unregister function. */
export function onMemoryCardsRequest(listener: CardsListener): () => void {
  cardsListener = listener;
  return () => {
    if (cardsListener === listener) cardsListener = null;
  };
}

/** Ask the Memory app to show its push cards: now if mounted, otherwise when it next mounts. */
export function requestMemoryCards(): void {
  if (cardsListener) cardsListener();
  else cardsPending = true;
}

/** Read and clear a request that arrived before the view mounted. */
export function takePendingMemoryCards(): boolean {
  const pending = cardsPending;
  cardsPending = false;
  return pending;
}

/** Open the Memory app (or its cards) from a notification route such as `cards`. */
export function openMemoryRoute(route: string): void {
  if (route === 'cards') requestMemoryCards();
}

/**
 * Memory's own handling of a notification click (`app:memory[/route]`), so it works whatever the
 * Notifications module's state. Main sends the click on the notifications event channel (a plain
 * IPC event); this listens to it directly and acts on Memory's routes only. The one-shot pickup of
 * a click that arrived during page load is left to the Notifications module when it is on.
 */
export function startMemoryClickRouting(
  client: Pick<typeof notificationsClient, 'on' | 'takeOpenTarget'> = notificationsClient,
  notificationsOn: () => boolean = () => featureModules.isEnabled('notifications')
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
  // With Notifications on, its click routing hands the link to the handler above (once). With it
  // off, this listener is the only receiver.
  const onTarget = (target: { kind: string; route?: string }): void => {
    if (notificationsOn() || target.kind !== 'route') return;
    const link = parseAppLink(target.route);
    if (link && link.segment === MEMORY_APP_ID) handle(link.route);
  };
  let off: (() => void) | undefined;
  try {
    off = client.on('open-target', onTarget);
  } catch {
    return { dispose: () => binding.dispose() }; // no module bridge (not running in Electron)
  }
  if (!notificationsOn()) {
    void client.takeOpenTarget().then((t) => t && onTarget(t)).catch(() => undefined);
  }
  return {
    dispose() {
      off?.();
      binding.dispose();
    },
  };
}

// --- host wiring -----------------------------------------------------------

const t = (key: string, params?: Record<string, unknown>): string => i18nService.t(key, params);

function badgeFor(due: number, waiting: number) {
  if (due <= 0 && waiting <= 0) return undefined;
  const parts: string[] = [];
  if (due > 0) parts.push(t('memory.badge.due', { count: due }));
  if (waiting > 0) parts.push(t('memory.badge.waiting', { count: waiting }));
  // The number is the verses due; with none due, the push cards waiting.
  return { kind: 'count' as const, value: due > 0 ? due : waiting, tone: 'attention' as const, label: parts.join(', ') };
}

let installed = false;

/** Wire the memory module into the app host. A no-op unless the module is enabled. */
export function installMemoryHost(): () => void {
  if (installed || !featureModules.isEnabled('memory')) return () => undefined;
  installed = true;

  const disposables: Array<{ dispose(): void }> = [];
  disposables.push(
    addAppBinding({
      id: MEMORY_APP_ID,
      load: async () => ({ View: (await import('./MemoryAppView')).MemoryAppView }),
    }),
    verseActions.bindHandler({ id: MEMORIZE_ACTION_ID, load: () => import('./memorize') }),
  );

  disposables.push(startMemoryClickRouting());

  const applyStatus = (due: number, waiting: number): void => {
    appRegistry.setBadge(MEMORY_APP_ID, badgeFor(due, waiting));
  };
  const onPush = (push: MemoryPush): void => {
    if (push.type === 'status') applyStatus(push.status.due, push.status.waiting);
    // Inside the open app the notice shows in its own status line; elsewhere as a toast.
    else if (push.type === 'notice' && !isAppActive(MEMORY_APP_ID)) useToastStore.getState().addToast(push.message, 'info');
  };

  let off: (() => void) | undefined;
  try {
    off = memoryClient.on('push', onPush);
  } catch (error) {
    console.warn('[memory] push subscription unavailable:', error);
  }

  // Cards come due while the core is not running (it pushes status only while it runs), so the
  // badge is re-read now and then: two COUNTs in main, never a core start.
  let warned = false;
  const refresh = (): void => {
    memoryClient
      .getStatus()
      .then((s) => applyStatus(s.due, s.waiting))
      .catch((error) => {
        if (!warned) console.warn('[memory] status unavailable:', error);
        warned = true;
      });
  };
  const timer = setTimeout(refresh, INITIAL_STATUS_DELAY_MS);
  const interval = setInterval(refresh, STATUS_REFRESH_MS);
  const onFocus = (): void => refresh();
  window.addEventListener('focus', onFocus);

  return () => {
    installed = false;
    clearTimeout(timer);
    clearInterval(interval);
    window.removeEventListener('focus', onFocus);
    off?.();
    for (const d of disposables) d.dispose();
    appRegistry.setBadge(MEMORY_APP_ID, undefined);
  };
}
