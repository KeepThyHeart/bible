/**
 * `api.apps` host side (task 0080, M3):
 *
 *   - `AppsApiImpl`: permission gate, own-apps-only ids (declared or qualified),
 *     badge validation, the user-gesture gate on `open` (clock injectable) with
 *     one log line per refusal, and `dispose()` clearing badges.
 *   - `ExtensionHost`: `app.visibilityChanged` reaches only the active,
 *     subscribed owner; a literal `userGesture: true` on `panelInvoke`
 *     (and a notification action) feeds the gate; a permission change re-runs
 *     the declared resync.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Extensions } from '@bible/core';

import { ExtensionHost } from '../ExtensionHost';
import { ExtensionRpcRouter, type IRpcTransport } from '../ExtensionRpcRouter';
import { buildGrant } from '../ExtensionPermissionGuard';
import { AppsApiImpl, InMemoryUiBridge, UiApiImpl } from '../api-impl';
import { UserGestureTracker } from '../UserGestureTracker';
import { DESKTOP_API_NAMESPACES } from '../DeclaredApiGuard';
import {
  type IUtilityProcessFactory,
  type IUtilityProcessHandle,
  type WorkerEventListener,
  type WorkerEventName,
} from '../ExtensionWorkerProcess';
import { FakeSql } from './fakeSql';

type RpcResponse = Extensions.RpcResponse;
const EXT = 'ext.test.counter';
const PERM = 'ui:contribute-app';

function paired(): { hostSide: IRpcTransport; workerSide: IRpcTransport; hostSent: unknown[] } {
  let hostHandler: ((env: unknown) => void) | null = null;
  let workerHandler: ((env: unknown) => void) | null = null;
  const hostSent: unknown[] = [];
  return {
    hostSent,
    hostSide: {
      send(env) {
        hostSent.push(env);
        workerHandler?.(env);
      },
      onMessage(h) {
        hostHandler = h;
      },
      close() {
        hostHandler = null;
      },
    },
    workerSide: {
      send(env) {
        hostHandler?.(env);
      },
      onMessage(h) {
        workerHandler = h;
      },
      close() {
        workerHandler = null;
      },
    },
  };
}

let reqId = 1;
async function call(pair: ReturnType<typeof paired>, method: string, args: unknown[] = []): Promise<RpcResponse> {
  const start = pair.hostSent.length;
  const id = `r-${reqId++}`;
  pair.workerSide.send({ kind: 'request', id, method, args });
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setImmediate(r));
    for (let j = start; j < pair.hostSent.length; j++) {
      const env = pair.hostSent[j] as RpcResponse;
      if (env.kind === 'response' && env.id === id) return env;
    }
  }
  throw new Error(`no response for ${method}`);
}

const app = (id: string): Extensions.ContributedApp => ({ id: `${EXT}.${id}`, title: id, uiEntry: 'ui/app.html' });

describe('AppsApiImpl', () => {
  function setup(permissions: string[]) {
    const pair = paired();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryUiBridge();
    const gestures = new UserGestureTracker(() => now);
    const logs: [string, string][] = [];
    let now = 10_000;
    const impl = new AppsApiImpl({
      extensionId: EXT,
      router,
      bridge,
      grant: buildGrant(EXT, permissions),
      apps: [app('counts'), app('other')],
      gestures,
      log: (level, message) => logs.push([level, message]),
    });
    impl.attach();
    return { pair, bridge, gestures, logs, impl, tick: (ms: number) => (now += ms) };
  }

  it('rejects every method without ui:contribute-app', async () => {
    const { pair, bridge } = setup(['bible:read']);
    expect((await call(pair, 'apps.setBadge', ['counts', null])).error?.code).toBe('PermissionDeniedError');
    expect((await call(pair, 'apps.open', ['counts'])).error?.code).toBe('PermissionDeniedError');
    expect(bridge.appBadges).toEqual([]);
    expect(bridge.appOpens).toEqual([]);
  });

  it('accepts the declared or the qualified id and rejects anything else', async () => {
    const { pair, bridge } = setup([PERM]);
    const badge = { kind: 'text', value: '342', label: '342 words' };
    expect((await call(pair, 'apps.setBadge', ['counts', badge])).error).toBeUndefined();
    expect((await call(pair, 'apps.setBadge', [`${EXT}.other`, badge])).error).toBeUndefined();
    expect(bridge.appBadges.map((b) => b.appId)).toEqual([`${EXT}.counts`, `${EXT}.other`]);
    for (const bad of ['nope', 'ext.other.ext.counts', 5, '']) {
      expect((await call(pair, 'apps.setBadge', [bad, badge])).error, String(bad)).toBeDefined();
      expect((await call(pair, 'apps.open', [bad])).error, String(bad)).toBeDefined();
    }
    expect(bridge.appBadges).toHaveLength(2);
  });

  it('validates the badge and forwards the trimmed form; null clears', async () => {
    const { pair, bridge } = setup([PERM]);
    const bad: unknown[] = [
      'str',
      [],
      { kind: 'big', label: 'x' },
      { kind: 'dot' },
      { kind: 'dot', label: '   ' },
      { kind: 'dot', label: 'x'.repeat(81) },
      { kind: 'dot', label: 'x', tone: 'loud' },
      { kind: 'count', value: 'n', label: 'x' },
      { kind: 'count', value: Number.POSITIVE_INFINITY, label: 'x' },
      { kind: 'text', value: '12345', label: 'x' },
      { kind: 'text', value: 7, label: 'x' },
      { kind: 'text', value: '', label: 'x' },
      { kind: 'text', value: 'a‮b', label: 'x' },
      { kind: 'dot', label: 'a\nb' },
    ];
    for (const b of bad) {
      expect((await call(pair, 'apps.setBadge', ['counts', b])).error, JSON.stringify(b)).toBeDefined();
    }
    expect(bridge.appBadges).toEqual([]);

    await call(pair, 'apps.setBadge', ['counts', { kind: 'text', value: ' 1.2k ', label: ' 1,200 words ', tone: 'live', extra: 1 }]);
    await call(pair, 'apps.setBadge', ['counts', { kind: 'count', value: 120, label: '120' }]);
    await call(pair, 'apps.setBadge', ['counts', null]);
    expect(bridge.appBadges.map((b) => b.badge)).toEqual([
      { kind: 'text', value: '1.2k', label: '1,200 words', tone: 'live' },
      { kind: 'count', value: 120, label: '120' },
      null,
    ]);
  });

  it('open declines (false, one log line each) without a recent gesture, opens with one', async () => {
    const { pair, bridge, gestures, logs, tick } = setup([PERM]);
    expect((await call(pair, 'apps.open', ['counts'])).result).toBe(false);
    expect(logs).toHaveLength(1);
    expect(logs[0]![0]).toBe('warn');
    expect(logs[0]![1]).toContain("apps.open('counts')");
    expect((await call(pair, 'apps.open', ['counts'])).result).toBe(false);
    expect(logs).toHaveLength(2);
    expect(bridge.appOpens).toEqual([]);

    gestures.grant(EXT);
    expect((await call(pair, 'apps.open', ['counts'])).result).toBe(true);
    expect(bridge.appOpens).toEqual([{ extensionId: EXT, appId: `${EXT}.counts` }]);

    tick(5001);
    expect((await call(pair, 'apps.open', ['counts'])).result).toBe(false);
    expect(bridge.appOpens).toHaveLength(1);
  });

  it("another extension's gesture does not count", async () => {
    const { pair, gestures } = setup([PERM]);
    gestures.grant('ext.test.someone-else');
    expect((await call(pair, 'apps.open', ['counts'])).result).toBe(false);
  });

  it('dispose clears the badges it set, and only those', async () => {
    const { pair, bridge, impl } = setup([PERM]);
    await call(pair, 'apps.setBadge', ['counts', { kind: 'dot', label: 'live' }]);
    await call(pair, 'apps.setBadge', ['other', { kind: 'dot', label: 'live' }]);
    await call(pair, 'apps.setBadge', ['other', null]);
    bridge.appBadges.length = 0;
    impl.dispose();
    expect(bridge.appBadges).toEqual([{ extensionId: EXT, appId: `${EXT}.counts`, badge: null }]);
    expect((await call(pair, 'apps.open', ['counts'])).error).toBeDefined();
  });
});

describe('UiApiImpl notification action', () => {
  it('grants a gesture only when an action was clicked', async () => {
    const pair = paired();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryUiBridge();
    const gestures = new UserGestureTracker();
    new UiApiImpl({
      extensionId: EXT,
      router,
      bridge,
      grant: buildGrant(EXT, ['ui:notification']),
      gestures,
    }).attach();
    await call(pair, 'ui.showNotification', ['hello']);
    expect(gestures.hasRecent(EXT)).toBe(false);
    bridge.notificationActionResponse = 'open';
    const res = await call(pair, 'ui.showNotification', ['hello', { actions: [{ id: 'open', label: 'Open' }] }]);
    expect(res.result).toBe('open');
    expect(gestures.hasRecent(EXT)).toBe(true);
  });
});

describe('desktop serves the apps namespace', () => {
  it('is marked served', () => {
    expect(DESKTOP_API_NAMESPACES.apps).toBe(true);
  });
});

// --- ExtensionHost ------------------------------------------------------------

class FakeChild implements IUtilityProcessHandle {
  pid = 1;
  killed = false;
  posted: unknown[] = [];
  private listeners: Record<WorkerEventName, WorkerEventListener[]> = { message: [], exit: [], spawn: [] };
  constructor() {
    setImmediate(() => this.listeners.spawn.forEach((h) => h(undefined)));
  }
  postMessage(msg: unknown): void {
    this.posted.push(msg);
    const env = msg as Extensions.RpcEnvelope;
    if (env.kind === 'request' && env.method === 'runtime.init') {
      setImmediate(() =>
        this.listeners.message.forEach((h) => h({ kind: 'response', id: env.id, result: { ok: true } })),
      );
    }
  }
  kill(): boolean {
    if (this.killed) return false;
    this.killed = true;
    setImmediate(() => this.listeners.exit.forEach((h) => h(0)));
    return true;
  }
  on(event: WorkerEventName, handler: WorkerEventListener): void {
    this.listeners[event].push(handler);
  }
  subscribe(channel: string): void {
    this.listeners.message.forEach((h) => h({ kind: 'subscribe', id: `sub-${channel}`, channel }));
  }
  events(channel: string): unknown[] {
    return this.posted
      .filter((m) => (m as { kind?: string; channel?: string }).kind === 'event')
      .filter((m) => (m as { channel: string }).channel === channel)
      .map((m) => (m as { payload: unknown }).payload);
  }
}

let spawnOrder: FakeChild[];
const factory: IUtilityProcessFactory = {
  fork() {
    const c = new FakeChild();
    spawnOrder.push(c);
    return c;
  },
};

function writeFixture(root: string, id: string): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'extension.json'),
    JSON.stringify({
      id,
      name: id,
      version: '1.0.0',
      publisher: 'test',
      engines: { bibleApp: '^0.2.1' },
      main: './main.js',
      permissions: ['bible:read', PERM],
      activationEvents: ['onApp:counts'],
      contributes: { apps: [{ id: 'counts', title: 'Counts', uiEntry: 'ui/app.html' }] },
    }),
    'utf8',
  );
  writeFileSync(join(dir, 'main.js'), 'module.exports = { activate: () => {} };', 'utf8');
}

describe('ExtensionHost app delivery', () => {
  let root: string;
  let host: ExtensionHost;
  let now: number;

  beforeEach(async () => {
    spawnOrder = [];
    now = 1000;
    root = mkdtempSync(join(tmpdir(), 'ext-host-apps-'));
    writeFixture(root, 'ext.test.counter');
    writeFixture(root, 'ext.test.other');
    host = new ExtensionHost({
      db: new FakeSql(),
      extensionsRoot: root,
      workerFactory: factory,
      workerScriptPath: '/fake/runtime.js',
      workerHeartbeatIntervalMs: 0,
      gestureTracker: new UserGestureTracker(() => now),
      uiBridge: new InMemoryUiBridge(),
    });
    await host.loadAll();
    for (const id of ['ext.test.counter', 'ext.test.other']) await host.updatePermissions(id, [PERM]);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('emits app.visibilityChanged to the subscribed owner only, with the id as declared', async () => {
    await host.activate('ext.test.counter');
    await host.activate('ext.test.other');
    const [a, b] = spawnOrder as [FakeChild, FakeChild];
    a.subscribe('app.visibilityChanged');
    b.subscribe('app.visibilityChanged');
    host.deliverAppVisibility('ext.test.counter', 'counts', true);
    expect(a.events('app.visibilityChanged')).toEqual([{ appId: 'counts', visible: true }]);
    expect(b.events('app.visibilityChanged')).toEqual([]);
  });

  it('never wakes a worker, ignores unknown apps, and needs the grant', async () => {
    host.deliverAppVisibility('ext.test.counter', 'counts', false);
    expect(spawnOrder).toHaveLength(0);

    await host.activate('ext.test.counter');
    const a = spawnOrder[0]!;
    a.subscribe('app.visibilityChanged');
    host.deliverAppVisibility('ext.test.counter', 'not-mine', true);
    expect(a.events('app.visibilityChanged')).toEqual([]);
    await host.updatePermissions('ext.test.counter', []);
    host.deliverAppVisibility('ext.test.counter', 'counts', true);
    expect(a.events('app.visibilityChanged')).toEqual([]);
  });

  it('panelInvoke grants a gesture only for a literal userGesture: true', async () => {
    await host.activate('ext.test.counter');
    const ctx = host.getContextForMarketplace();
    const sender = { extensionId: 'ext.test.counter', panelId: 'app:counts', panelTypeId: 'app:counts', appId: 'counts' };
    // No handler is registered worker-side, so the delivery itself may reject; only the grant matters here.
    await host.panelInvoke(sender, {}, { userGesture: 'yes' as never }).catch(() => undefined);
    await host.panelInvoke(sender, {}).catch(() => undefined);
    expect(ctx.gestures.hasRecent('ext.test.counter')).toBe(false);
    await host.panelInvoke(sender, {}, { userGesture: true }).catch(() => undefined);
    expect(ctx.gestures.hasRecent('ext.test.counter')).toBe(true);
    expect(ctx.gestures.hasRecent('ext.test.other')).toBe(false);
    now += 6000;
    expect(ctx.gestures.hasRecent('ext.test.counter')).toBe(false);
  });

  it('a permission change re-runs the declared resync for that extension', async () => {
    const synced: string[] = [];
    host.setDeclaredResync((id) => synced.push(id));
    await host.updatePermissions('ext.test.counter', []);
    expect(synced).toEqual(['ext.test.counter']);
  });
});
