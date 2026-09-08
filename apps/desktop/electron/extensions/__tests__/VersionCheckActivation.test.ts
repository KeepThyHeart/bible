/**
 * Integration test - version compatibility check + activation events.
 * Drives `ExtensionHost` end-to-end with the same fake utility-process
 * factory `ExtensionHostActivation.test.ts` uses, then asserts:
 *
 *   - `engines.bibleApp` mismatches abort `activate()` with
 *     `IncompatibleApiVersionError` *before* a worker is forked.
 *   - `fireActivationEvent('onStartup')` activates only the extensions whose
 *     manifest opted into the event.
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

class FakeChild implements IUtilityProcessHandle {
  pid = 9999;
  killed = false;
  postedMessages: unknown[] = [];
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
    const env = msg as Extensions.RpcEnvelope;
    if (env && env.kind === 'request' && env.method === 'runtime.init') {
      setImmediate(() => {
        const ack: Extensions.RpcResponse = {
          kind: 'response',
          id: env.id,
          result: { ok: true },
        };
        for (const h of this.listeners.message) h(ack);
      });
    }
  }

  kill(): boolean {
    if (this.killed) return false;
    this.killed = true;
    setImmediate(() => {
      for (const h of this.listeners.exit) h(0);
    });
    return true;
  }

  on(event: WorkerEventName, handler: WorkerEventListener): void {
    this.listeners[event].push(handler);
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

interface FixtureOpts {
  id: string;
  engines?: string;
  activationEvents?: string[];
}

function writeFixture(root: string, opts: FixtureOpts): void {
  const dir = join(root, opts.id);
  mkdirSync(dir, { recursive: true });
  const manifest: Record<string, unknown> = {
    id: opts.id,
    name: { key: 'extension.name' },
    version: '1.0.0',
    publisher: 'test',
    engines: { bibleApp: opts.engines ?? '^1.0.0' },
    main: './main.js',
    permissions: ['bible:read'],
  };
  if (opts.activationEvents) manifest.activationEvents = opts.activationEvents;
  writeFileSync(join(dir, 'extension.json'), JSON.stringify(manifest), 'utf8');
  writeFileSync(join(dir, 'main.js'), 'module.exports = { activate: () => {} };', 'utf8');
}

describe('Version check + activation events', () => {
  let tmpRoot: string;
  let host: ExtensionHost;

  beforeEach(() => {
    children.length = 0;
    tmpRoot = mkdtempSync(join(tmpdir(), 'ext-host-6a-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('rejects an extension whose engines.bibleApp does not include the host version', async () => {
    writeFixture(tmpRoot, { id: 'ext.test.too-new', engines: '^2.0.0' });
    host = new ExtensionHost({
      db: new FakeSql(),
      extensionsRoot: tmpRoot,
      workerFactory: fakeFactory,
      workerScriptPath: '/fake/runtime.js',
      workerHeartbeatIntervalMs: 0,
    });
    await host.loadAll();

    await expect(host.activate('ext.test.too-new')).rejects.toBeInstanceOf(
      Extensions.IncompatibleApiVersionError,
    );
    // Crucially: no worker should have been forked.
    expect(children.length).toBe(0);
    const state = (await host.getExtension('ext.test.too-new'))!;
    expect(state.status).toBe('failed');
  });

  it('accepts an extension whose engines.bibleApp matches the host version', async () => {
    writeFixture(tmpRoot, { id: 'ext.test.compat', engines: '^1.0.0' });
    host = new ExtensionHost({
      db: new FakeSql(),
      extensionsRoot: tmpRoot,
      workerFactory: fakeFactory,
      workerScriptPath: '/fake/runtime.js',
      workerHeartbeatIntervalMs: 0,
    });
    await host.loadAll();

    await host.activate('ext.test.compat');
    expect(children.length).toBe(1);
    expect((await host.getExtension('ext.test.compat'))!.status).toBe('active');
  });

  it('fireActivationEvent activates only matching extensions', async () => {
    writeFixture(tmpRoot, {
      id: 'ext.test.startup',
      activationEvents: ['onStartup'],
    });
    writeFixture(tmpRoot, {
      id: 'ext.test.lazy',
      activationEvents: ['onCommand:ext.test.lazy.go'],
    });
    host = new ExtensionHost({
      db: new FakeSql(),
      extensionsRoot: tmpRoot,
      workerFactory: fakeFactory,
      workerScriptPath: '/fake/runtime.js',
      workerHeartbeatIntervalMs: 0,
    });
    await host.loadAll();

    await host.fireActivationEvent('onStartup');

    expect(host.isActive('ext.test.startup')).toBe(true);
    expect(host.isActive('ext.test.lazy')).toBe(false);

    await host.fireActivationEvent('onCommand:ext.test.lazy.go');
    expect(host.isActive('ext.test.lazy')).toBe(true);
  });

  it('fireActivationEvent skips disabled and auto-disabled extensions', async () => {
    writeFixture(tmpRoot, {
      id: 'ext.test.disabled',
      activationEvents: ['onStartup'],
    });
    host = new ExtensionHost({
      db: new FakeSql(),
      extensionsRoot: tmpRoot,
      workerFactory: fakeFactory,
      workerScriptPath: '/fake/runtime.js',
      workerHeartbeatIntervalMs: 0,
    });
    await host.loadAll();
    await host.disable('ext.test.disabled');

    await host.fireActivationEvent('onStartup');
    expect(host.isActive('ext.test.disabled')).toBe(false);
  });
});
