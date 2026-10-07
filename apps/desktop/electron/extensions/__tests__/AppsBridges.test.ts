/**
 * Declared extension apps (task 0080, M3): `DeclaredContributions` registers
 * `contributes.apps` only for an eligible extension holding `ui:contribute-app`
 * and prunes without bouncing apps that stay; `RendererUiBridge` builds the
 * `ExtensionAppInfo` payload and its four notifications; `RendererCommandBridge`
 * turns a renderer-reported gesture into a grant for the command's owner only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Extensions } from '@bible/core';

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    }),
    on: vi.fn(),
  },
}));

import { RendererCommandBridge } from '../bridges/RendererCommandBridge';
import { RendererUiBridge } from '../bridges/RendererUiBridge';
import { DeclaredContributions, type DeclaredContributionsEntry } from '../DeclaredContributions';

const EXT = 'ext.test.counter';

interface Sent {
  op: string;
  args: unknown[];
}

function fakeWindow(): { window: unknown; sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    window: { isDestroyed: () => false, webContents: { send: (_c: string, p: unknown) => sent.push(p as Sent) } },
  };
}

const app = (over: Partial<Extensions.ContributedApp> = {}): Extensions.ContributedApp => ({
  id: `${EXT}.counts`,
  title: 'Word Count',
  uiEntry: 'ui/app.html',
  ...over,
});

const meta = { publisher: 'acme', extensionName: 'Counter', hasSettings: false };

beforeEach(() => handlers.clear());

describe('RendererUiBridge declared apps', () => {
  it('sends appRegistered with the full ExtensionAppInfo', () => {
    const { window, sent } = fakeWindow();
    const bridge = new RendererUiBridge(() => window as never);
    bridge.registerDeclaredApp(
      EXT,
      app({ shortTitle: 'Words', icon: 'ui/icon.svg', order: 5000, mobile: 'sheet', title: '%app.title%' }),
      { publisher: 'acme', extensionName: { key: 'ext.name' }, hasSettings: true },
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.op).toBe('appRegistered');
    expect(sent[0]!.args[0]).toEqual({
      extensionId: EXT,
      app: {
        id: `${EXT}.counts`,
        shortId: 'counts',
        title: '%app.title%',
        shortTitle: 'Words',
        iconUrl: `ext-ui://${EXT}/ui/icon.svg`,
        order: 900,
        mobile: 'sheet',
        publisher: 'acme',
        extensionName: { key: 'ext.name' },
        hasSettings: true,
      },
    });
  });

  it('omits iconUrl without an icon and defaults order to 0', () => {
    const { window, sent } = fakeWindow();
    new RendererUiBridge(() => window as never).registerDeclaredApp(EXT, app(), meta);
    const info = (sent[0]!.args[0] as { app: Record<string, unknown> }).app;
    expect(info.iconUrl).toBeUndefined();
    expect(info.order).toBe(0);
    expect('mobile' in info).toBe(false);
  });

  it('getApp finds only the owner\'s registered app', () => {
    const { window } = fakeWindow();
    const bridge = new RendererUiBridge(() => window as never);
    bridge.registerDeclaredApp(EXT, app(), meta);
    expect(bridge.getApp(EXT, 'counts')?.app.uiEntry).toBe('ui/app.html');
    expect(bridge.getApp('ext.test.other', 'counts')).toBeUndefined();
    expect(bridge.getApp(EXT, 'nope')).toBeUndefined();
  });

  it('badge and open notifications go out only for the owner\'s registered apps', () => {
    const { window, sent } = fakeWindow();
    const bridge = new RendererUiBridge(() => window as never);
    bridge.registerDeclaredApp(EXT, app(), meta);
    sent.length = 0;
    const badge = { kind: 'dot' as const, label: 'live' };
    bridge.setAppBadge(EXT, `${EXT}.counts`, badge);
    bridge.requestOpenApp(EXT, `${EXT}.counts`);
    bridge.setAppBadge('ext.test.other', `${EXT}.counts`, badge);
    bridge.requestOpenApp(EXT, `${EXT}.missing`);
    expect(sent).toEqual([
      { requestId: 0, op: 'appBadge', args: [{ extensionId: EXT, appId: `${EXT}.counts`, badge }] },
      { requestId: 0, op: 'appOpen', args: [{ extensionId: EXT, appId: `${EXT}.counts` }] },
    ]);
  });

  it('unregister sends appUnregistered with the qualified id, honouring keep', () => {
    const { window, sent } = fakeWindow();
    const bridge = new RendererUiBridge(() => window as never);
    bridge.registerDeclaredApp(EXT, app(), meta);
    bridge.registerDeclaredApp(EXT, app({ id: `${EXT}.two` }), meta);
    sent.length = 0;
    bridge.unregisterDeclaredApps(EXT, [`${EXT}.counts`]);
    expect(sent.map((m) => [m.op, m.args[0]])).toEqual([['appUnregistered', { extensionId: EXT, appId: `${EXT}.two` }]]);
    expect(bridge.getApp(EXT, 'two')).toBeUndefined();
    bridge.unregisterDeclaredApps(EXT);
    expect(bridge.getApp(EXT, 'counts')).toBeUndefined();
  });
});

describe('DeclaredContributions apps', () => {
  function setup(entry: Partial<DeclaredContributionsEntry> & { apps?: Extensions.ContributedApp[] }) {
    const registered: string[] = [];
    const unregistered: [string, readonly string[] | undefined][] = [];
    let current: DeclaredContributionsEntry = {
      enabled: true,
      status: 'installed',
      grantedPermissions: ['ui:contribute-app'],
      manifest: {
        id: EXT,
        name: 'Counter',
        publisher: 'acme',
        contributes: { apps: entry.apps ?? [app(), app({ id: `${EXT}.two` })] },
      } as unknown as Extensions.ExtensionManifest,
      ...entry,
    };
    const dc = new DeclaredContributions({
      listEntries: () => [{ id: EXT, entry: current }],
      commandBridge: { registerDeclaredCommand: () => undefined, unregisterDeclaredCommands: () => undefined },
      uiBridge: { registerDeclaredPanelType: () => undefined, unregisterDeclaredPanelTypes: () => undefined },
      appBridge: {
        registerDeclaredApp: (_e, a, m) => {
          registered.push(a.id);
          expect(m).toEqual({ publisher: 'acme', extensionName: 'Counter', hasSettings: false });
        },
        unregisterDeclaredApps: (e, keep) => unregistered.push([e, keep]),
      },
      log: () => undefined,
    });
    return { dc, registered, unregistered, set: (e: Partial<DeclaredContributionsEntry>) => (current = { ...current, ...e }) };
  }

  it('registers every app when eligible and granted, pruning only the rest', () => {
    const { dc, registered, unregistered } = setup({});
    dc.syncDeclared(EXT);
    expect(registered).toEqual([`${EXT}.counts`, `${EXT}.two`]);
    expect(unregistered).toEqual([[EXT, [`${EXT}.counts`, `${EXT}.two`]]]);
  });

  it('registers nothing and unregisters everything without the grant', () => {
    const { dc, registered, unregistered } = setup({ grantedPermissions: ['bible:read'] });
    dc.syncDeclared(EXT);
    expect(registered).toEqual([]);
    expect(unregistered).toEqual([[EXT, undefined]]);
  });

  it('a revoke followed by a resync drops the apps; a re-grant brings them back', () => {
    const { dc, registered, unregistered, set } = setup({});
    dc.syncDeclared(EXT);
    set({ grantedPermissions: [] });
    dc.syncDeclared(EXT);
    expect(unregistered.at(-1)).toEqual([EXT, undefined]);
    registered.length = 0;
    set({ grantedPermissions: ['ui:contribute-app'] });
    dc.syncDeclared(EXT);
    expect(registered).toHaveLength(2);
  });

  it('unregisters when the extension is disabled or auto-disabled', () => {
    const { dc, registered, unregistered, set } = setup({});
    set({ enabled: false });
    dc.syncDeclared(EXT);
    set({ enabled: true, status: 'auto-disabled' });
    dc.syncDeclared(EXT);
    expect(registered).toEqual([]);
    expect(unregistered).toEqual([[EXT, undefined], [EXT, undefined]]);
  });
});

describe('RendererCommandBridge userGesture', () => {
  async function invoke(registrationId: string, userGesture?: unknown): Promise<unknown> {
    return handlers.get('ext-bridge:command:invoke')!({}, { registrationId, args: {}, userGesture });
  }

  function setup() {
    const { window, sent } = fakeWindow();
    const onUserGesture = vi.fn();
    const bridge = new RendererCommandBridge(() => window as never, {
      activate: async () => undefined,
      callWorkerEndpoint: async () => undefined,
      log: () => undefined,
      onUserGesture,
    });
    bridge.register({ id: 'ext.a.b.go', ownerExtensionId: 'ext.a.b', title: 'Go' }, async () => 'a');
    bridge.register({ id: 'ext.c.d.go', ownerExtensionId: 'ext.c.d', title: 'Go' }, async () => 'c');
    const ids = sent.filter((m) => m.op === 'register').map((m) => (m.args[0] as { registrationId: string }).registrationId);
    return { onUserGesture, ids };
  }

  it('grants the owning extension, only for a literal true', async () => {
    const { onUserGesture, ids } = setup();
    expect(await invoke(ids[0]!)).toBe('a');
    await invoke(ids[0]!, false);
    await invoke(ids[0]!, 'true');
    expect(onUserGesture).not.toHaveBeenCalled();
    expect(await invoke(ids[1]!, true)).toBe('c');
    expect(onUserGesture).toHaveBeenCalledTimes(1);
    expect(onUserGesture).toHaveBeenCalledWith('ext.c.d');
  });
});
