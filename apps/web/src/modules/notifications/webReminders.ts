/**
 * The web reminder host (tier 1): core's `ReminderScheduler` driven by a timer, shown through the
 * browser Notifications API while a tab is open. No push, no service-worker delivery (task 0085).
 *
 * `getWebReminders()` is the app's singleton; `createWebReminderHost()` builds an independent one
 * (tests). `startWebReminders()` is called at boot, lazily, only when the browser supports it.
 */
import {
  ReminderScheduler,
  createStore,
  createStringStatePort,
  createTimeoutTimer,
  normalizeNotificationSettings,
} from '@bible/core/browser';
import type {
  NotificationSettings,
  NotificationsViewState,
  PresentedNotification,
  ReadableStore,
  ReminderCapabilities,
  ReminderPermission,
  ReminderTarget,
} from '@bible/core/browser';
import i18n from '../../i18n';
import type { VotdData } from '../../providers/interfaces';
import {
  NOTIFICATION_STATE_KEY,
  NOTIFICATION_SETTINGS_KEY,
  loadNotificationSettings,
  safeStorage,
  saveNotificationSettings,
} from './notificationSettings';
import { createVotdSource, VOTD_SOURCE_ID } from './votdSource';

/** Where the click handler sends the app. Defaults to the reader. */
export interface WebReminderNavigation {
  openTarget(target: ReminderTarget): void;
}

export function defaultNavigation(): WebReminderNavigation {
  return {
    openTarget(target) {
      if (target.kind !== 'verse') return; // the web app knows no `route` or `extension` targets
      const book = Math.floor(target.verseId / 1_000_000);
      const chapter = Math.floor(target.verseId / 1000) % 1000;
      const verse = target.verseId % 1000;
      const end = target.endVerseId;
      const endVerse = end !== undefined && Math.floor(end / 1000) === Math.floor(target.verseId / 1000) ? end % 1000 : undefined;
      void import('../../stores/bibleStore').then(({ bibleStore }) =>
        bibleStore.navigateTo(book, chapter, verse, endVerse ? { endVerse } : undefined));
    },
  };
}

/** What this browser can do, right now (re-read on every call: permission changes live). */
export function webCapabilities(): ReminderCapabilities {
  const unsupported: ReminderCapabilities = { permission: 'unsupported', whenClosed: 'never', actions: false };
  if (typeof window === 'undefined' || !('Notification' in window) || !window.Notification) return unsupported;
  if (window.isSecureContext === false) return unsupported;
  const p = (window.Notification as { permission?: string }).permission;
  const permission: ReminderPermission = p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'prompt';
  return { permission, whenClosed: 'background-only', actions: false };
}

export function isWebNotificationsSupported(): boolean {
  return webCapabilities().permission !== 'unsupported';
}

/**
 * The one place the default verse-of-the-day fetcher lives, read at fire time. The shell installs a lazy getter for
 * the offline-first provider with `setVerseOfTheDayFetcher`; a host created earlier (by the settings
 * tab) still gets it, because it is looked up per fire, not captured at creation.
 */
let votdFetcher: () => Promise<VotdData | null> = () => Promise.resolve(null);

export function setVerseOfTheDayFetcher(fn: () => Promise<VotdData | null>): void {
  votdFetcher = fn;
}

/** The Web Locks name of the tab that runs the scheduler. */
export const REMINDER_LOCK_NAME = 'bible-reminders';

export interface WebReminderHost {
  readonly store: ReadableStore<NotificationsViewState>;
  /**
   * Registers the sources and installs the listeners, then runs the scheduler in one leader tab only
   * (a Web Lock; without `navigator.locks` every tab runs it). Idempotent.
   */
  start(): Promise<void>;
  stop(): void;
  setSettings(next: NotificationSettings): Promise<void>;
  /** Must be called from a user gesture. */
  requestPermission(): Promise<ReminderPermission>;
  sendTest(): Promise<void>;
  scheduler: ReminderScheduler;
}

export interface WebReminderHostOptions {
  navigation?: WebReminderNavigation;
  /** Fetches the verse of the day afresh (the store's copy is cached for the session, stale after midnight). */
  getVerseOfTheDay?: () => Promise<VotdData | null>;
}

export function createWebReminderHost(opts: WebReminderHostOptions = {}): WebReminderHost {
  const nav = opts.navigation ?? defaultNavigation();
  const t = (key: string, opts?: Record<string, unknown>): string => String(i18n.t(key, opts as never));
  let settings = loadNotificationSettings();
  const storage = safeStorage();

  const showWith = async (n: PresentedNotification): Promise<void> => {
    if (webCapabilities().permission !== 'granted') return;
    const title = n.title;
    const options: NotificationOptions = { body: n.body, tag: n.tag ?? n.sourceId, silent: n.silent };
    let notification: Notification;
    try {
      notification = new Notification(title, options);
    } catch {
      // Android Chrome refuses the constructor; a service-worker registration can still show it.
      const reg = await navigator.serviceWorker?.getRegistration?.();
      if (reg?.active) {
        await reg.showNotification(title, options);
      }
      return;
    }
    notification.onclick = () => {
      try { window.focus(); } catch { /* ignore */ }
      const activation = scheduler.activate(n.id);
      if (activation?.target) nav.openTarget(activation.target);
      notification.close();
    };
  };

  function buildState(): NotificationsViewState {
    return {
      settings,
      sources: scheduler.listSources(),
      capabilities: webCapabilities(),
      timeZone: scheduler.timeZone(),
    };
  }

  const scheduler: ReminderScheduler = new ReminderScheduler({
    timer: createTimeoutTimer(),
    presenter: { show: showWith },
    state: storage ? createStringStatePort(storage, NOTIFICATION_STATE_KEY) : undefined,
    settings: () => settings,
    strings: {
      collapsed: (label, count) => ({ title: label, body: t('notifications.collapsed', { count }) }),
    },
    onChange: () => publish(),
    onError: (err, ctx) => console.warn(`[Notifications] ${ctx}`, err),
  });

  const state = createStore<NotificationsViewState>(buildState());
  const publish = (): void => state.setState(buildState());

  let started: Promise<void> | null = null;
  let removeListeners: (() => void) | null = null;
  /** True while this tab runs the scheduler. */
  let leader = false;
  let releaseLock: (() => void) | null = null;
  let abortLock: AbortController | null = null;

  const install = (): (() => void) => {
    const wake = (): void => { if (leader) void scheduler.wake().then(publish); };
    const onVisible = (): void => { if (document.visibilityState === 'visible') wake(); };
    const onStorage = (e: StorageEvent): void => {
      if (e.key !== NOTIFICATION_SETTINGS_KEY) return;
      settings = loadNotificationSettings();
      publish();
      wake(); // only the leader plans; the others just show the new state
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    window.addEventListener('storage', onStorage);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('storage', onStorage);
    };
  };

  return {
    store: state,
    scheduler,
    start() {
      started ??= (async () => {
        scheduler.registerSource(
          createVotdSource({
            getVerseOfTheDay: opts.getVerseOfTheDay ?? (() => votdFetcher()),
            bookName: (book) => String(i18n.t(String(book), { ns: 'books' })),
            t: (key, params) => t(key, params),
          }),
        );
        removeListeners = install();
        const begin = async (): Promise<void> => {
          leader = true;
          await scheduler.start();
          publish();
        };
        const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
        if (!locks || typeof locks.request !== 'function') {
          await begin();
        } else {
          abortLock = new AbortController();
          // The holder is the leader; the request stays queued in the other tabs until the leader goes.
          locks
            .request(REMINDER_LOCK_NAME, { mode: 'exclusive', signal: abortLock.signal }, () => {
              if (!started) return undefined; // stopped while queued
              return new Promise<void>((resolve) => {
                releaseLock = resolve;
                void begin().catch((err) => console.warn('[Notifications] start failed', err));
              });
            })
            .catch(() => { /* aborted by stop() */ });
          publish();
        }
      })();
      return started;
    },
    stop() {
      abortLock?.abort();
      abortLock = null;
      releaseLock?.();
      releaseLock = null;
      leader = false;
      scheduler.stop();
      removeListeners?.();
      removeListeners = null;
      started = null;
    },
    async setSettings(next) {
      settings = normalizeNotificationSettings(next);
      saveNotificationSettings(settings);
      publish();
      if (leader) await scheduler.refresh(); // other tabs pick the change up through the `storage` event
      publish();
    },
    async requestPermission() {
      if (!isWebNotificationsSupported()) return 'unsupported';
      try {
        await Notification.requestPermission();
      } catch {
        /* older Safari uses a callback form; the permission is re-read below either way */
      }
      const caps = webCapabilities();
      publish();
      if (caps.permission === 'granted' && leader) void scheduler.wake().then(publish);
      return caps.permission;
    },
    async sendTest() {
      await scheduler.presentNow(VOTD_SOURCE_ID, {
        title: t('notifications.test.title'),
        body: t('notifications.test.body'),
        tag: 'notifications-test',
      });
    },
  };
}

let singleton: WebReminderHost | null = null;

export function getWebReminders(opts?: WebReminderHostOptions): WebReminderHost {
  singleton ??= createWebReminderHost(opts);
  return singleton;
}

/** Boot hook: starts the host only when the browser can show notifications. */
export async function startWebReminders(opts?: WebReminderHostOptions): Promise<void> {
  if (!isWebNotificationsSupported()) return;
  await getWebReminders(opts).start();
}
