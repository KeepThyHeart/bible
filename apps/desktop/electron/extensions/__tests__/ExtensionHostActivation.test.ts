/**
 * ExtensionHost activate / deactivate / crash-loop integration test.
 *
 * Drives ExtensionHost end-to-end with a fake utility process factory and
 * an in-memory worker that speaks the RPC envelope protocol. Asserts:
 *
 *   - activate() spawns a worker, sends `runtime.init`, awaits the ack, and
 *     marks the registry status `active`;
 *   - a worker that exits with a non-zero code records a crash and is
 *     marked `failed`;
 *   - the third crash in a session flips the status to `auto-disabled`;
 *   - resetCrashState clears the auto-disable flag.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Extensions } from '@bible/core';

import { ExtensionHost } from '../ExtensionHost';
import {
  type IUtilityProcessFactory,
  type IUtilityProcessHandle,
  type WorkerEventListener,
  type WorkerEventName,
} from '../ExtensionWorkerProcess';
import { FakeSql } from './fakeSql';

/**
 * Fake child that auto-acks `runtime.init` so activate() can resolve. The
 * test can override `onInit` to throw or to simulate a delayed ack.
 */
class FakeChild implements IUtilityProcessHandle {
  pid = 9999;
  killed = false;
  postedMessages: unknown[] = [];
  onInit: ((arg?: unknown) => unknown) | null = null;
  exitMode: 'clean' | 'crash' | 'never' = 'clean';
  private listeners: Record<WorkerEventName, WorkerEventListener[]> = {
    message: [],
    exit: [],
    spawn: [],
  };

  constructor() {
    setImmediate(() => {
      for (const h of this.listeners.spawn) h(undefined);
    });
  }

  postMessage(msg: unknown): void {
    this.postedMessages.push(msg);
    // Echo handler for runtime.init: reply with success ack.
    const env = msg as Extensions.RpcEnvelope;
    if (env && env.kind === 'request' && env.method === 'runtime.init') {
      setImmediate(() => {
        let result: unknown = { ok: true };
        let error: { code: string; message: string } | undefined;
        if (this.onInit) {
          try {
            result = this.onInit(env.args[0]);
          } catch (e) {
            error = {
              code: 'Error',
              message: e instanceof Error ? e.message : String(e),
            };
          }
        }
        const ack: Extensions.RpcResponse = error
          ? { kind: 'response', id: env.id, error }
          : { kind: 'response', id: env.id, result };
        for (const h of this.listeners.message) h(ack);
      });
    }
  }

  kill(): boolean {
    if (this.killed) return false;
    this.killed = true;
    setImmediate(() => {
      const code = this.exitMode === 'crash' ? 1 : this.exitMode === 'never' ? null : 0;
      for (const h of this.listeners.exit) h(code);
    });
    return true;
  }

  on(event: WorkerEventName, handler: WorkerEventListener): void {
    this.listeners[event].push(handler);
  }

  /** Simulate the worker exiting on its own (crash). */
  emitExit(code: number | null): void {
    for (const h of this.listeners.exit) h(code);
  }
}

const children: FakeChild[] = [];

const fakeFactory: IUtilityProcessFactory = {
  fork() {
    const c = new FakeChild();
    children.push(c);
    return c;
  },
};

function writeFixtureExtension(root: string, id = 'ext.test.greek'): string {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'extension.json'),
    JSON.stringify({
      id,
      name: { key: 'extension.name' },
      version: '1.0.0',
      publisher: 'test',
      engines: { bibleApp: '^1.0.0' },
      main: './main.js',
      permissions: ['bible:read'],
    }),
    'utf8',
  );
  writeFileSync(join(dir, 'main.js'), 'module.exports = { activate: () => {} };', 'utf8');
  return dir;
}

describe('ExtensionHost activation', () => {
  let tmpRoot: string;
  let host: ExtensionHost;

  beforeEach(async () => {
    children.length = 0;
    tmpRoot = mkdtempSync(join(tmpdir(), 'ext-host-'));
    writeFixtureExtension(tmpRoot);
    host = new ExtensionHost({
      db: new FakeSql(),
      extensionsRoot: tmpRoot,
      workerFactory: fakeFactory,
      workerScriptPath: '/fake/extension-runtime.js',
      workerHeartbeatIntervalMs: 0,
    });
    await host.loadAll();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('activate() spawns a worker and sends runtime.init', async () => {
    await host.activate('ext.test.greek');
    const child = children[0]!;
    const initMsg = child.postedMessages.find(
      (m) => (m as Extensions.RpcRequest).method === 'runtime.init',
    ) as Extensions.RpcRequest;
    expect(initMsg).toBeDefined();
    const payload = initMsg.args[0] as Extensions.ExtensionInitPayload;
    expect(payload.manifest.id).toBe('ext.test.greek');
    expect(payload.hostApiVersion).toBe(Extensions.EXTENSION_API_VERSION);

    const state = (await host.getExtension('ext.test.greek'))!;
    expect(state.status).toBe('active');
    expect(host.isActive('ext.test.greek')).toBe(true);
  });

  it('failed runtime.init marks status failed and tears down the worker', async () => {
    children.length = 0;
    // Patch the next-fork's onInit to throw.
    const failingFactory: IUtilityProcessFactory = {
      fork() {
        const c = new FakeChild();
        c.onInit = () => {
          throw new Error('boom in activate');
        };
        children.push(c);
        return c;
      },
    };
    host = new ExtensionHost({
      db: new FakeSql(),
      extensionsRoot: tmpRoot,
      workerFactory: failingFactory,
      workerScriptPath: '/fake/extension-runtime.js',
      workerHeartbeatIntervalMs: 0,
    });
    await host.loadAll();

    await expect(host.activate('ext.test.greek')).rejects.toThrow(/boom in activate/);
    const state = (await host.getExtension('ext.test.greek'))!;
    expect(state.status).toBe('failed');
    expect(host.isActive('ext.test.greek')).toBe(false);
  });

  it('three crashes within one session auto-disable the extension', async () => {
    for (let i = 0; i < 3; i++) {
      await host.activate('ext.test.greek');
      const child = children[i]!;
      // Crash the worker without going through deactivate().
      child.emitExit(1);
      // Yield so the host's onExit handler runs.
      await new Promise((r) => setImmediate(r));
    }
    const state = (await host.getExtension('ext.test.greek'))!;
    expect(state.status).toBe('auto-disabled');
    expect(state.crashCountSession).toBe(3);
  });

  it('clean exit (code 0) does not count as a crash', async () => {
    await host.activate('ext.test.greek');
    children[0]!.emitExit(0);
    await new Promise((r) => setImmediate(r));
    const state = (await host.getExtension('ext.test.greek'))!;
    expect(state.status).toBe('installed');
    expect(state.crashCountSession).toBe(0);
  });

  it('deactivate() terminates the worker and reverts status to installed', async () => {
    await host.activate('ext.test.greek');
    expect(host.isActive('ext.test.greek')).toBe(true);
    await host.deactivate('ext.test.greek');
    expect(host.isActive('ext.test.greek')).toBe(false);
    const state = (await host.getExtension('ext.test.greek'))!;
    expect(state.status).toBe('installed');
  });

  it('resetCrashState restores an auto-disabled extension', async () => {
    for (let i = 0; i < 3; i++) {
      await host.activate('ext.test.greek');
      children[i]!.emitExit(1);
      await new Promise((r) => setImmediate(r));
    }
    let state = (await host.getExtension('ext.test.greek'))!;
    expect(state.status).toBe('auto-disabled');
    await host.resetCrashState('ext.test.greek');
    state = (await host.getExtension('ext.test.greek'))!;
    expect(state.status).toBe('installed');
    expect(state.crashCountSession).toBe(0);
  });
});

/**
 * Panel-iframe egress runs on the extension's own network api-impl, so it inherits that impl's permission gate rather than getting a
 * second, weaker one. The fixture declares only `bible:read`, which makes it
 * exactly the "UI asks for network it never declared" case.
 */
describe('ExtensionHost.uiFetch', () => {
  let tmpRoot: string;
  let host: ExtensionHost;

  beforeEach(async () => {
    children.length = 0;
    tmpRoot = mkdtempSync(join(tmpdir(), 'ext-host-uifetch-'));
    writeFixtureExtension(tmpRoot);
    host = new ExtensionHost({
      db: new FakeSql(),
      extensionsRoot: tmpRoot,
      workerFactory: fakeFactory,
      workerScriptPath: '/fake/extension-runtime.js',
      workerHeartbeatIntervalMs: 0,
    });
    await host.loadAll();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('refuses when the extension is not active', async () => {
    await expect(
      host.uiFetch('ext.test.greek', 'https://api.example.com/x'),
    ).rejects.toThrow(/not active/);
  });

  it('refuses when the extension never declared the network permission', async () => {
    await host.activate('ext.test.greek');
    await expect(
      host.uiFetch('ext.test.greek', 'https://api.example.com/x'),
    ).rejects.toThrow(/network/);
  });

  it('refuses for an extension id that was never installed', async () => {
    await expect(host.uiFetch('ext.not.installed', 'https://api.example.com/x')).rejects.toThrow(
      /not active/,
    );
  });
});
