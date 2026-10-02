/**
 * `api.reminders` host side (task 0083):
 *
 *   - `RemindersApiImpl`: permission gate on every method, `replaceAll` hands
 *     the label and items to the bridge, `takeActivations` drains.
 *   - `ExtensionHost.deliverReminderActivation` / `deliverReminderMissed`:
 *     targeted activation (only `onReminder` extensions, only the owner),
 *     the queue-or-emit rule, and that a missed batch never wakes anyone.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Extensions } from '@bible/core';

import { ExtensionHost } from '../ExtensionHost';
import { ExtensionRpcRouter, type IRpcTransport } from '../ExtensionRpcRouter';
import { buildGrant } from '../ExtensionPermissionGuard';
import { pickPlainName } from '../ExtensionHostRpc';
import { RemindersApiImpl, type IRemindersBridge } from '../api-impl';
import {
  type IUtilityProcessFactory,
  type IUtilityProcessHandle,
  type WorkerEventListener,
  type WorkerEventName,
} from '../ExtensionWorkerProcess';
import { FakeSql } from './fakeSql';

type ReminderItem = Extensions.ReminderItem;
type RpcResponse = Extensions.RpcResponse;

// --- RemindersApiImpl over a paired transport -------------------------------

function pairedTransports(): {
  hostSide: IRpcTransport;
  workerSide: IRpcTransport;
  hostSent: unknown[];
} {
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
async function call(
  pair: ReturnType<typeof pairedTransports>,
  method: string,
  args: unknown[] = [],
): Promise<RpcResponse> {
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

function fakeBridge() {
  const calls: { method: string; args: unknown[] }[] = [];
  const bridge: IRemindersBridge = {
    replaceAll: async (extensionId, label, items) => {
      calls.push({ method: 'replaceAll', args: [extensionId, label, items] });
      return { accepted: Array.isArray(items) ? items.length : 0 };
    },
    list: async (extensionId) => {
      calls.push({ method: 'list', args: [extensionId] });
      return [{ key: 'a', fireAt: 1, title: 't', body: 'b' }] as ReminderItem[];
    },
    capabilities: async () => ({ permission: 'granted', whenClosed: 'fires', actions: true }),
    requestPermission: async () => 'granted',
  };
  return { bridge, calls };
}

describe('RemindersApiImpl', () => {
  function setup(permissions: string[], queue: Extensions.ReminderActivationEvent[] = []) {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const { bridge, calls } = fakeBridge();
    new RemindersApiImpl({
      extensionId: 'ext.test.rem',
      router,
      bridge,
      grant: buildGrant('ext.test.rem', permissions),
      label: 'Reminder Ext',
      takeActivations: () => queue.splice(0, queue.length),
    }).attach();
    return { pair, calls, queue };
  }

  it('rejects every method without notifications:schedule', async () => {
    const { pair, calls } = setup(['bible:read']);
    for (const [method, args] of [
      ['reminders.replaceAll', [[]]],
      ['reminders.list', []],
      ['reminders.capabilities', []],
      ['reminders.requestPermission', []],
      ['reminders.takeActivations', []],
    ] as const) {
      const res = await call(pair, method, [...args]);
      expect(res.error?.code, method).toBe('PermissionDeniedError');
    }
    expect(calls).toEqual([]);
  });

  it('replaceAll passes the extension id, display label and items to the bridge', async () => {
    const { pair, calls } = setup(['notifications:schedule']);
    const items = [{ key: 'a', fireAt: 1, title: 't', body: 'b' }];
    const res = await call(pair, 'reminders.replaceAll', [items]);
    expect(res.result).toEqual({ accepted: 1 });
    expect(calls[0]).toEqual({ method: 'replaceAll', args: ['ext.test.rem', 'Reminder Ext', items] });
  });

  it('replaceAll rejects a non-array without calling the bridge', async () => {
    const { pair, calls } = setup(['notifications:schedule']);
    const res = await call(pair, 'reminders.replaceAll', ['nope']);
    expect(res.error).toBeDefined();
    expect(calls).toEqual([]);
  });

  it('list, capabilities and requestPermission go through the bridge', async () => {
    const { pair } = setup(['notifications:schedule']);
    expect((await call(pair, 'reminders.list')).result).toHaveLength(1);
    expect((await call(pair, 'reminders.capabilities')).result).toEqual({
      permission: 'granted',
      whenClosed: 'fires',
      actions: true,
    });
    expect((await call(pair, 'reminders.requestPermission')).result).toBe('granted');
  });

  it('takeActivations drains the queue', async () => {
    const q = [{ key: 'a', keys: ['a'], firedAt: 1 }];
    const { pair } = setup(['notifications:schedule'], q);
    expect((await call(pair, 'reminders.takeActivations')).result).toEqual([
      { key: 'a', keys: ['a'], firedAt: 1 },
    ]);
    expect((await call(pair, 'reminders.takeActivations')).result).toEqual([]);
  });
});

describe('pickPlainName', () => {
  it('prefers a plain displayName, then name, then the id; ignores key references', () => {
    expect(pickPlainName({ displayName: 'Memory', name: 'mem' }, 'id')).toBe('Memory');
    expect(pickPlainName({ displayName: { key: 'x' }, name: 'mem' }, 'id')).toBe('mem');
    expect(pickPlainName({ name: { key: 'x' } }, 'ext.a.b')).toBe('ext.a.b');
  });
});

// --- ExtensionHost delivery -------------------------------------------------

class FakeChild implements IUtilityProcessHandle {
  pid = 1;
  killed = false;
  posted: unknown[] = [];
  private listeners: Record<WorkerEventName, WorkerEventListener[]> = {
    message: [],
    exit: [],
    spawn: [],
  };
  constructor() {
    setImmediate(() => this.listeners.spawn.forEach((h) => h(undefined)));
  }
  postMessage(msg: unknown): void {
    this.posted.push(msg);
    const env = msg as Extensions.RpcEnvelope;
    if (env.kind === 'request' && env.method === 'runtime.init') {
      setImmediate(() =>
        this.listeners.message.forEach((h) =>
          h({ kind: 'response', id: env.id, result: { ok: true } }),
        ),
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
  /** Simulate the worker subscribing to a channel. */
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

let children: Map<string, FakeChild>;
let spawnOrder: FakeChild[];
const factory: IUtilityProcessFactory = {
  fork(opts) {
    const c = new FakeChild();
    spawnOrder.push(c);
    children.set(opts.serviceName, c);
    return c;
  },
};

function writeFixture(root: string, id: string, activationEvents: string[]): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'extension.json'),
    JSON.stringify({
      id,
      name: id,
      version: '1.0.0',
      publisher: 'test',
      engines: { bibleApp: '^0.2.0' },
      main: './main.js',
      permissions: ['bible:read', 'notifications:schedule'],
      activationEvents,
    }),
    'utf8',
  );
  writeFileSync(join(dir, 'main.js'), 'module.exports = { activate: () => {} };', 'utf8');
}

const evt = (key: string): Extensions.ReminderActivationEvent => ({ key, keys: [key], firedAt: 1 });

describe('ExtensionHost reminder delivery', () => {
  let root: string;
  let host: ExtensionHost;

  beforeEach(async () => {
    children = new Map();
    spawnOrder = [];
    root = mkdtempSync(join(tmpdir(), 'ext-host-reminders-'));
    writeFixture(root, 'ext.test.wake', ['onReminder']);
    writeFixture(root, 'ext.test.also', ['onReminder']);
    writeFixture(root, 'ext.test.plain', ['onView:bible']);
    const bridge = fakeBridge().bridge;
    host = new ExtensionHost({
      db: new FakeSql(),
      extensionsRoot: root,
      workerFactory: factory,
      workerScriptPath: '/fake/runtime.js',
      workerHeartbeatIntervalMs: 0,
      remindersBridge: bridge,
    });
    await host.loadAll();
    for (const id of ['ext.test.wake', 'ext.test.also', 'ext.test.plain']) {
      await host.updatePermissions(id, ['notifications:schedule']);
    }
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('activates exactly the target extension, not every extension declaring onReminder', async () => {
    await host.deliverReminderActivation('ext.test.wake', evt('a'));
    expect(host.isActive('ext.test.wake')).toBe(true);
    expect(host.isActive('ext.test.also')).toBe(false);
    expect(spawnOrder).toHaveLength(1);
  });

  it('does not wake an inactive extension that does not declare onReminder', async () => {
    await host.deliverReminderActivation('ext.test.plain', evt('a'));
    expect(host.isActive('ext.test.plain')).toBe(false);
    expect(spawnOrder).toHaveLength(0);
  });

  it('does nothing for an unknown or disabled extension', async () => {
    await host.deliverReminderActivation('ext.test.nope', evt('a'));
    await host.disable('ext.test.wake');
    await host.deliverReminderActivation('ext.test.wake', evt('a'));
    expect(spawnOrder).toHaveLength(0);
  });

  it('does nothing without the notifications:schedule grant', async () => {
    await host.updatePermissions('ext.test.wake', []);
    await host.deliverReminderActivation('ext.test.wake', evt('a'));
    expect(spawnOrder).toHaveLength(0);
  });

  it('queues the click for takeActivations when no onActivated handler is subscribed, and the queue drains once', async () => {
    await host.deliverReminderActivation('ext.test.wake', evt('a'));
    await host.deliverReminderActivation('ext.test.wake', evt('b'));
    const child = spawnOrder[0]!;
    expect(child.events('reminder.activated')).toEqual([]);

    const ctx = host.getContextForMarketplace();
    expect(ctx.reminderActivationQueues.get('ext.test.wake')!.map((e) => e.key)).toEqual(['a', 'b']);
  });

  it('emits to the onActivated handler instead of queuing when one is subscribed', async () => {
    await host.activate('ext.test.wake');
    const child = spawnOrder[0]!;
    child.subscribe('reminder.activated');
    await host.deliverReminderActivation('ext.test.wake', evt('a'));
    expect(child.events('reminder.activated')).toEqual([evt('a')]);
    expect(host.getContextForMarketplace().reminderActivationQueues.get('ext.test.wake')).toBeUndefined();
  });

  it('caps the queue at 20, dropping the oldest', async () => {
    for (let i = 0; i < 25; i++) await host.deliverReminderActivation('ext.test.wake', evt(`k${i}`));
    const q = host.getContextForMarketplace().reminderActivationQueues.get('ext.test.wake')!;
    expect(q).toHaveLength(20);
    expect(q[0]!.key).toBe('k5');
  });

  it('deliverReminderMissed reaches only an active, subscribed owner and never wakes anyone', async () => {
    host.deliverReminderMissed('ext.test.wake', { keys: ['a'], dropped: [] });
    expect(spawnOrder).toHaveLength(0);

    await host.activate('ext.test.wake');
    await host.activate('ext.test.also');
    const [wake, also] = spawnOrder as [FakeChild, FakeChild];
    wake.subscribe('reminder.missed');
    also.subscribe('reminder.missed');
    host.deliverReminderMissed('ext.test.wake', { keys: ['a'], dropped: ['z'] });
    expect(wake.events('reminder.missed')).toEqual([{ keys: ['a'], dropped: ['z'] }]);
    expect(also.events('reminder.missed')).toEqual([]);
  });
});
