/**
 * End-to-end lazy-activation tests (task 0024 round 3, P1.5).
 *
 * Drives a real `ExtensionHost` (fake worker factory, like
 * `VersionCheckActivation.test.ts`) together with a real `DeclaredContributions`
 * wired to lightweight fake command/panel bridges (satisfying
 * `DeclaredCommandBridge`/`DeclaredPanelTypeBridge`, not the full
 * `RendererCommandBridge`/`RendererUiBridge` - see
 * `DeclaredContributionsBridges.test.ts` for the bridges' own placeholder
 * state machine, which this file does not re-test).
 *
 * Focus here: the parts that only exist once the pieces are wired together -
 * boot-time laziness, `syncDeclared`'s enabled/disabled/auto-disabled
 * eligibility gate against a real `ExtensionRegistry`, and
 * `ExtensionHostLifecycle.activate`'s coalescing (and its recovery: a failed
 * activation must not get stuck, so a later call retries for real).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Extensions } from '@bible/core';

import { ExtensionHost } from '../ExtensionHost';
import {
  DeclaredContributions,
  type DeclaredCommandBridge,
  type DeclaredPanelTypeBridge,
} from '../DeclaredContributions';
import {
  type IUtilityProcessFactory,
  type IUtilityProcessHandle,
  type WorkerEventListener,
  type WorkerEventName,
} from '../ExtensionWorkerProcess';
import { FakeSql } from './fakeSql';

type ContributedCommand = Extensions.ContributedCommand;
type ExtensionPanelTypeDef = Extensions.ExtensionPanelTypeDef;

// --- Fake worker process, with a configurable init outcome ----------------

class FakeChild implements IUtilityProcessHandle {
  pid = 9999;
  killed = false;
  postedMessages: unknown[] = [];
  /** Set per-instance before `spawn()`'s caller sends `runtime.init`. */
  initOutcome: 'ok' | 'fail' = 'ok';
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
        const ack: Extensions.RpcResponse =
          this.initOutcome === 'ok'
            ? { kind: 'response', id: env.id, result: { ok: true } }
            : {
                kind: 'response',
                id: env.id,
                error: { code: 'RpcProtocolError', message: 'simulated init failure' },
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

  /** Test-only: fire a non-zero exit directly, simulating a crash rather than a clean shutdown. */
  simulateCrash(code = 1): void {
    this.killed = true;
    for (const h of this.listeners.exit) h(code);
  }
}

let children: FakeChild[] = [];
/** Set before `host.activate(...)` to control the NEXT spawned child's init outcome. */
let nextInitOutcome: 'ok' | 'fail' = 'ok';

const fakeFactory: IUtilityProcessFactory = {
  fork() {
    const c = new FakeChild();
    c.initOutcome = nextInitOutcome;
    children.push(c);
    return c;
  },
};

interface FixtureOpts {
  id: string;
  activationEvents?: string[];
  commands?: ContributedCommand[];
  panelTypes?: ExtensionPanelTypeDef[];
}

function writeFixture(root: string, opts: FixtureOpts): void {
  const dir = join(root, opts.id);
  mkdirSync(dir, { recursive: true });
  const manifest: Record<string, unknown> = {
    id: opts.id,
    name: { key: 'extension.name' },
    version: '1.0.0',
    publisher: 'test',
    engines: { bibleApp: '^0.1.0' },
    main: './main.js',
    permissions: ['bible:read'],
  };
  if (opts.activationEvents) manifest.activationEvents = opts.activationEvents;
  if (opts.commands || opts.panelTypes) {
    manifest.contributes = {
      ...(opts.commands ? { commands: opts.commands } : {}),
      ...(opts.panelTypes ? { panelTypes: opts.panelTypes } : {}),
    };
  }
  writeFileSync(join(dir, 'extension.json'), JSON.stringify(manifest), 'utf8');
  writeFileSync(join(dir, 'main.js'), 'module.exports = { activate: () => {} };', 'utf8');
}

// --- Fake declared-contribution bridges (no electron/ipcMain involved) ----

function makeFakeCommandBridge(): {
  bridge: DeclaredCommandBridge;
  declared: Map<string, { extensionId: string; decl: ContributedCommand }>;
} {
  const declared = new Map<string, { extensionId: string; decl: ContributedCommand }>();
  return {
    declared,
    bridge: {
      registerDeclaredCommand: (extensionId, decl) => {
        declared.set(decl.id, { extensionId, decl });
      },
      unregisterDeclaredCommands: (extensionId) => {
        for (const [id, state] of declared) {
          if (state.extensionId === extensionId) declared.delete(id);
        }
      },
    },
  };
}

function makeFakeUiBridge(): {
  bridge: DeclaredPanelTypeBridge;
  declared: Map<string, { extensionId: string; def: ExtensionPanelTypeDef }>;
} {
  const declared = new Map<string, { extensionId: string; def: ExtensionPanelTypeDef }>();
  return {
    declared,
    bridge: {
      registerDeclaredPanelType: (extensionId, def) => {
        declared.set(`${extensionId}::${def.id}`, { extensionId, def });
      },
      unregisterDeclaredPanelTypes: (extensionId) => {
        for (const key of declared.keys()) {
          if (key.startsWith(`${extensionId}::`)) declared.delete(key);
        }
      },
    },
  };
}

describe('Lazy activation (task 0024 round 3, P1.5)', () => {
  let tmpRoot: string;
  let host: ExtensionHost;

  beforeEach(() => {
    children = [];
    nextInitOutcome = 'ok';
    tmpRoot = mkdtempSync(join(tmpdir(), 'ext-host-lazy-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('an extension declaring only onCommand: does not activate at boot', async () => {
    writeFixture(tmpRoot, {
      id: 'ext.test.lazy',
      activationEvents: ['onCommand:ext.test.lazy.go'],
      commands: [{ id: 'ext.test.lazy.go', title: { key: 'cmd.go' }, handlerEndpoint: 'go' }],
    });
    host = new ExtensionHost({
      db: new FakeSql(),
      extensionsRoot: tmpRoot,
      workerFactory: fakeFactory,
      workerScriptPath: '/fake/runtime.js',
      workerHeartbeatIntervalMs: 0,
    });
    await host.loadAll();
    await host.fireActivationEvent(Extensions.ACT_ON_STARTUP_FINISHED);

    expect(host.isActive('ext.test.lazy')).toBe(false);
    expect(children).toHaveLength(0);

    // Its declared command is nonetheless pre-registered before it ever ran.
    const { bridge: commandBridge, declared } = makeFakeCommandBridge();
    const { bridge: uiBridge } = makeFakeUiBridge();
    const dc = new DeclaredContributions({
      listEntries: () => host.listEntries(),
      commandBridge,
      uiBridge,
      log: () => undefined,
    });
    dc.syncAll();
    expect(declared.has('ext.test.lazy.go')).toBe(true);
  });

  it('syncDeclared drops placeholders for a disabled extension and restores them on enable', async () => {
    writeFixture(tmpRoot, {
      id: 'ext.test.toggle',
      activationEvents: ['onCommand:ext.test.toggle.go'],
      commands: [{ id: 'ext.test.toggle.go', title: { key: 'cmd.go' }, handlerEndpoint: 'go' }],
    });
    host = new ExtensionHost({
      db: new FakeSql(),
      extensionsRoot: tmpRoot,
      workerFactory: fakeFactory,
      workerScriptPath: '/fake/runtime.js',
      workerHeartbeatIntervalMs: 0,
    });
    const { bridge: commandBridge, declared } = makeFakeCommandBridge();
    const { bridge: uiBridge } = makeFakeUiBridge();
    const dc = new DeclaredContributions({
      listEntries: () => host.listEntries(),
      commandBridge,
      uiBridge,
      log: () => undefined,
    });
    host.setDeclaredResync((id) => dc.syncDeclared(id));
    await host.loadAll();
    dc.syncAll();
    expect(declared.has('ext.test.toggle.go')).toBe(true);

    await host.disable('ext.test.toggle');
    expect(declared.has('ext.test.toggle.go')).toBe(false);

    await host.enable('ext.test.toggle');
    expect(declared.has('ext.test.toggle.go')).toBe(true);
  });

  it('syncDeclared drops placeholders once an extension auto-disables after repeated crashes', async () => {
    writeFixture(tmpRoot, {
      id: 'ext.test.crashy',
      activationEvents: ['onCommand:ext.test.crashy.go'],
      commands: [{ id: 'ext.test.crashy.go', title: { key: 'cmd.go' }, handlerEndpoint: 'go' }],
    });
    host = new ExtensionHost({
      db: new FakeSql(),
      extensionsRoot: tmpRoot,
      workerFactory: fakeFactory,
      workerScriptPath: '/fake/runtime.js',
      workerHeartbeatIntervalMs: 0,
      crashThreshold: 1,
    });
    const { bridge: commandBridge, declared } = makeFakeCommandBridge();
    const { bridge: uiBridge } = makeFakeUiBridge();
    const dc = new DeclaredContributions({
      listEntries: () => host.listEntries(),
      commandBridge,
      uiBridge,
      log: () => undefined,
    });
    host.setDeclaredResync((id) => dc.syncDeclared(id));
    await host.loadAll();
    dc.syncAll();
    expect(declared.has('ext.test.crashy.go')).toBe(true);

    await host.activate('ext.test.crashy');
    const child = children[0]!;
    child.simulateCrash(1); // crashThreshold: 1 - this single crash auto-disables
    await new Promise((r) => setImmediate(r));

    expect((await host.getExtension('ext.test.crashy'))?.status).toBe('auto-disabled');
    // An auto-disabled extension's command must not be invocable from the
    // palette - a restored placeholder there would only ever reject.
    expect(declared.has('ext.test.crashy.go')).toBe(false);
  });

  it('coalesces two concurrent activations into a single spawned worker', async () => {
    writeFixture(tmpRoot, { id: 'ext.test.concurrent' });
    host = new ExtensionHost({
      db: new FakeSql(),
      extensionsRoot: tmpRoot,
      workerFactory: fakeFactory,
      workerScriptPath: '/fake/runtime.js',
      workerHeartbeatIntervalMs: 0,
    });
    await host.loadAll();

    const [a, b] = await Promise.all([
      host.activate('ext.test.concurrent'),
      host.activate('ext.test.concurrent'),
    ]);
    void a;
    void b;

    expect(children).toHaveLength(1);
    expect(host.isActive('ext.test.concurrent')).toBe(true);
  });

  it('a failed activation does not get stuck - a later call retries with a fresh spawn', async () => {
    writeFixture(tmpRoot, { id: 'ext.test.retry' });
    host = new ExtensionHost({
      db: new FakeSql(),
      extensionsRoot: tmpRoot,
      workerFactory: fakeFactory,
      workerScriptPath: '/fake/runtime.js',
      workerHeartbeatIntervalMs: 0,
    });
    await host.loadAll();

    nextInitOutcome = 'fail';
    await expect(host.activate('ext.test.retry')).rejects.toThrow();
    expect(children).toHaveLength(1);
    expect(host.isActive('ext.test.retry')).toBe(false);

    nextInitOutcome = 'ok';
    await host.activate('ext.test.retry');
    expect(children).toHaveLength(2);
    expect(host.isActive('ext.test.retry')).toBe(true);
  });
});
