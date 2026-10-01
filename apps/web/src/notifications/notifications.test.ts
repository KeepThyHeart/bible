import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const navigateTo = vi.fn(async () => {});
vi.mock('../stores/bibleStore', () => ({
  bibleStore: { navigateTo: (...a: unknown[]) => navigateTo(...(a as [])), getVerseOfTheDay: vi.fn(async () => null) },
}));
vi.mock('../i18n', () => ({
  default: { t: (key: string, o?: { count?: number }) => (o?.count !== undefined ? `${key}:${o.count}` : key), language: 'en' },
}));

import { webCapabilities, createWebReminderHost } from './webReminders';
import { loadNotificationSettings, saveNotificationSettings, NOTIFICATION_SETTINGS_KEY } from './notificationSettings';
import { createVotdSource, plainText } from './votdSource';

class FakeNotification {
  static permission: string = 'granted';
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  static instances: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(public title: string, public options: NotificationOptions) { FakeNotification.instances.push(this); }
}

function setNotification(api: unknown): void {
  if (api === undefined) delete (window as unknown as Record<string, unknown>).Notification;
  else (window as unknown as Record<string, unknown>).Notification = api;
  (globalThis as unknown as Record<string, unknown>).Notification = api;
}

beforeEach(() => {
  localStorage.clear();
  navigateTo.mockClear();
  FakeNotification.instances = [];
  FakeNotification.permission = 'granted';
  setNotification(FakeNotification);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('webCapabilities', () => {
  it.each([
    ['granted', 'granted'],
    ['denied', 'denied'],
    ['default', 'prompt'],
  ])('maps %s to %s', (perm, expected) => {
    FakeNotification.permission = perm;
    expect(webCapabilities()).toEqual({ permission: expected, whenClosed: 'background-only', actions: false });
  });

  it('is unsupported without the Notification API', () => {
    setNotification(undefined);
    expect(webCapabilities()).toEqual({ permission: 'unsupported', whenClosed: 'never', actions: false });
  });

  it('is unsupported outside a secure context', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    try {
      expect(webCapabilities().permission).toBe('unsupported');
    } finally {
      if (original) Object.defineProperty(window, 'isSecureContext', original);
      else delete (window as unknown as Record<string, unknown>).isSecureContext;
    }
  });
});

describe('notification settings storage', () => {
  it('round trips', () => {
    const s = { version: 1 as const, enabled: true, quiet: { start: '22:00', end: '06:00' }, sources: { 'app:verse-of-the-day': { enabled: true } } };
    expect(saveNotificationSettings(s)).toBe(true);
    expect(loadNotificationSettings()).toEqual(s);
  });

  it('falls back to defaults on a corrupt value', () => {
    localStorage.setItem(NOTIFICATION_SETTINGS_KEY, '{not json');
    expect(loadNotificationSettings().sources).toEqual({});
    localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify({ enabled: 'maybe', sources: 7 }));
    expect(() => loadNotificationSettings()).not.toThrow();
  });
});

describe('verse of the day source', () => {
  const deps = {
    getVerseOfTheDay: async () => ({ book: 43, chapter: 3, verse: 16, text: 'For God so loved', text_html: '<p>For God so <i>loved</i> &amp; more</p>' }),
    bookName: () => 'John',
    t: (k: string) => k,
  };

  it('is opt-in, editable, daily 08:00', () => {
    const s = createVotdSource(deps);
    expect(s.defaultEnabled).toBe(false);
    expect(s.userEditable).toBe(true);
    expect(s.plan()?.slots[0]).toMatchObject({ kind: 'fixed', time: '08:00', days: [0, 1, 2, 3, 4, 5, 6] });
  });

  it('renders plain text with a verse target', async () => {
    const out = await createVotdSource(deps).render({} as never);
    expect(out).toEqual({
      title: 'notifications.votd.title',
      body: 'John 3:16 — For God so loved',
      tag: 'votd',
      target: { kind: 'verse', verseId: 43003016 },
    });
  });

  it('truncates long text and strips html', async () => {
    const long = 'word '.repeat(100);
    const out = await createVotdSource({ ...deps, getVerseOfTheDay: async () => ({ book: 1, chapter: 1, verse: 1, text: long, text_html: '' }) }).render({} as never);
    expect(out!.body.length).toBeLessThan(200);
    expect(out!.body.endsWith('…')).toBe(true);
    expect(plainText('<b>a</b>&nbsp;&lt;b')).toBe('a <b');
  });
});

describe('web reminder host', () => {
  it('presents with new Notification; click activates, navigates and closes', async () => {
    const host = createWebReminderHost();
    await host.scheduler.presentNow('app:verse-of-the-day', {
      title: 'T', body: 'B', tag: 'votd', target: { kind: 'verse', verseId: 43003016 },
    });
    expect(FakeNotification.instances).toHaveLength(1);
    const n = FakeNotification.instances[0];
    expect(n.title).toBe('T');
    expect(n.options).toMatchObject({ body: 'B', tag: 'votd' });
    n.onclick!();
    expect(navigateTo).toHaveBeenCalledWith(43, 3, 16, undefined);
    expect(n.close).toHaveBeenCalled();
  });

  it('does not present when permission is not granted', async () => {
    FakeNotification.permission = 'default';
    const host = createWebReminderHost();
    await host.sendTest();
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it('sendTest shows a notification', async () => {
    await createWebReminderHost().sendTest();
    expect(FakeNotification.instances[0].title).toBe('notifications.test.title');
  });

  it('setSettings persists and updates the store', async () => {
    const host = createWebReminderHost();
    await host.start();
    const snap = host.store.getSnapshot();
    expect(snap.sources.find(s => s.id === 'app:verse-of-the-day')?.enabled).toBe(false);
    await host.setSettings({ ...snap.settings, sources: { 'app:verse-of-the-day': { enabled: true } } });
    expect(loadNotificationSettings().sources['app:verse-of-the-day']?.enabled).toBe(true);
    expect(host.store.getSnapshot().sources.find(s => s.id === 'app:verse-of-the-day')?.enabled).toBe(true);
    host.stop();
  });

  it('requestPermission asks the browser and refreshes the state', async () => {
    FakeNotification.permission = 'default';
    FakeNotification.requestPermission.mockImplementation(async () => { FakeNotification.permission = 'granted'; return 'granted'; });
    const host = createWebReminderHost();
    expect(host.store.getSnapshot().capabilities.permission).toBe('prompt');
    expect(await host.requestPermission()).toBe('granted');
    expect(host.store.getSnapshot().capabilities.permission).toBe('granted');
  });
});
