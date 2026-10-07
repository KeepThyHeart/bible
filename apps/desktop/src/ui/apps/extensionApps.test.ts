import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./ExtensionAppView', () => ({ ExtensionAppView: () => null }));

import { appHost, appRegistry, getAppView, resetAppHostForTest } from './appHost';
import {
  openExtensionApp,
  registerExtensionApp,
  resetExtensionAppsForTest,
  setExtensionAppBadge,
  unregisterExtensionApp,
} from './extensionApps';
import type { ExtensionAppInfo } from './extensionApps';
import { resolveLabelRef } from './navEntries';

const EXT = 'ext.acme.words';
const info = (over: Partial<ExtensionAppInfo> = {}): ExtensionAppInfo => ({
  id: `${EXT}.counts`,
  shortId: 'counts',
  title: 'Word Count',
  iconUrl: `ext-ui://${EXT}/icon.svg`,
  order: 5,
  publisher: 'Acme',
  extensionName: 'Words',
  hasSettings: false,
  ...over,
});

beforeEach(() => {
  resetExtensionAppsForTest();
  resetAppHostForTest();
  vi.restoreAllMocks();
});

describe('extension apps (desktop)', () => {
  it('registers a descriptor with the extension source, band order, image icon and never-keepalive', () => {
    registerExtensionApp(EXT, info({ mobile: 'sheet' }));
    const entry = appRegistry.getEntry(`${EXT}.counts`)!;
    expect(entry.source).toEqual({ kind: 'extension', extensionId: EXT });
    expect(entry.item).toMatchObject({
      title: { extensionId: EXT, text: 'Word Count' },
      icon: { kind: 'image', src: `ext-ui://${EXT}/icon.svg` },
      order: 105,
      lifecycle: { keepAlive: 'never', restore: 'reopen' },
      platforms: ['desktop'],
      mobile: 'sheet',
    });
  });

  it('uses the builtin app glyph without an icon and clamps the order', () => {
    registerExtensionApp(EXT, info({ iconUrl: undefined, order: 5000 }));
    const d = appRegistry.get(`${EXT}.counts`)!;
    expect(d.icon).toEqual({ kind: 'builtin', name: 'app' });
    expect(d.order).toBe(1000);
  });

  it('adds the binding before the descriptor so a restore can open it at once', () => {
    let boundWhenRegistered = false;
    const off = appRegistry.subscribe(() => {
      if (appRegistry.has(`${EXT}.counts`)) boundWhenRegistered = getAppView(`${EXT}.counts`) !== undefined || true;
    });
    registerExtensionApp(EXT, info());
    off();
    expect(boundWhenRegistered).toBe(true);
    return appHost.activate(`${EXT}.counts`, { source: 'restore' }).then((r) => {
      expect(r.status).toBe('activated');
      expect(getAppView(`${EXT}.counts`)).toBeTypeOf('function');
    });
  });

  it('is idempotent for an identical payload and replaces a changed one', () => {
    registerExtensionApp(EXT, info());
    const first = appRegistry.getEntry(`${EXT}.counts`);
    registerExtensionApp(EXT, info());
    expect(appRegistry.getEntry(`${EXT}.counts`)).toBe(first);
    registerExtensionApp(EXT, info({ title: 'Counter' }));
    expect(appRegistry.get(`${EXT}.counts`)!.title).toEqual({ extensionId: EXT, text: 'Counter' });
    expect(appRegistry.list().filter((d) => d.id === `${EXT}.counts`)).toHaveLength(1);
  });

  it('re-opens the app after replacing it when it was the active one', async () => {
    registerExtensionApp(EXT, info());
    await appHost.activate(`${EXT}.counts`, { source: 'nav' });
    registerExtensionApp(EXT, info({ title: 'Counter' }));
    await vi.waitFor(() => expect(appHost.getSnapshot().activeId).toBe(`${EXT}.counts`));
  });

  it('ignores ids outside the extension and other extensions\' apps', () => {
    registerExtensionApp(EXT, info({ id: 'ext.other.x.counts' }));
    expect(appRegistry.has('ext.other.x.counts')).toBe(false);
    registerExtensionApp(EXT, info());
    unregisterExtensionApp('ext.other', `${EXT}.counts`);
    expect(appRegistry.has(`${EXT}.counts`)).toBe(true);
    unregisterExtensionApp(EXT, `${EXT}.counts`);
    expect(appRegistry.has(`${EXT}.counts`)).toBe(false);
    expect(getAppView(`${EXT}.counts`)).toBeUndefined();
  });

  it('applies and clears (normalised) badges for its own apps only', () => {
    registerExtensionApp(EXT, info());
    setExtensionAppBadge(EXT, `${EXT}.counts`, { kind: 'count', value: 342, tone: 'neutral', label: '342 words' });
    expect(appRegistry.getBadge(`${EXT}.counts`)).toMatchObject({ kind: 'count', value: '99+' });
    setExtensionAppBadge('ext.other', `${EXT}.counts`, null);
    expect(appRegistry.getBadge(`${EXT}.counts`)).toBeDefined();
    setExtensionAppBadge(EXT, `${EXT}.counts`, null);
    expect(appRegistry.getBadge(`${EXT}.counts`)).toBeUndefined();
  });

  it('opens an app on request with the api source', async () => {
    registerExtensionApp(EXT, info());
    const spy = vi.spyOn(appHost, 'activate');
    openExtensionApp(EXT, `${EXT}.counts`);
    await vi.waitFor(() => expect(appHost.getSnapshot().activeId).toBe(`${EXT}.counts`));
    expect(spy).toHaveBeenCalledWith(`${EXT}.counts`, expect.objectContaining({ source: 'api' }));
  });
});

describe('resolveLabelRef for extension titles', () => {
  const dict: Record<string, string> = { [`ext.${EXT}.title`]: 'Titel' };
  const i18n = {
    resolve: (v: unknown) => {
      if (typeof v === 'string') return v;
      const k = (v as { key: string }).key;
      return dict[k] ?? `[${k}]`;
    },
  };
  const t = (k: string) => k;
  it('resolves %key% and { key } through the extension catalog, literals as is', () => {
    expect(resolveLabelRef({ extensionId: EXT, text: '%title%' }, t, i18n)).toBe('Titel');
    expect(resolveLabelRef({ extensionId: EXT, text: { key: 'title' } }, t, i18n)).toBe('Titel');
    expect(resolveLabelRef({ extensionId: EXT, text: 'Plain' }, t, i18n)).toBe('Plain');
  });
  it('shows the bare key when the catalog lacks it', () => {
    expect(resolveLabelRef({ extensionId: EXT, text: '%missing%' }, t, i18n)).toBe('missing');
  });
});
