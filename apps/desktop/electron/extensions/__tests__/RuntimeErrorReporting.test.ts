/**
 * Regression tests for BUG C - the worker's error boundary was dead-ended.
 *
 * `ExtensionErrorBoundary` (worker side) reports uncaught exceptions and
 * unhandled rejections to the host as an `RpcEvent` on the reserved
 * `__runtime.error` channel. `ExtensionRpcRouter` dropped ALL worker->host
 * events with `{ reason: 'unknown-kind', detail: 'event from worker' }`, so
 * nothing an extension threw asynchronously ever reached `extension.log` and
 * extension authors had no diagnostics whatsoever.
 *
 * Two layers are pinned here:
 *   1. the router routes `__runtime.*` events to `onRuntimeEvent` while still
 *      rejecting every other worker-originated event (v1 invariant);
 *   2. `ExtensionHost` writes those reports into the per-extension log, so
 *      `extensions.getLog(id)` surfaces them in the UI.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Extensions } from '@bible/core';

import { ExtensionHost } from '../ExtensionHost';
import {
  ExtensionRpcRouter,
  RUNTIME_ERROR_CHANNEL,
  type IRpcTransport,
  type RpcProtocolViolation,
} from '../ExtensionRpcRouter';
import {
  type IUtilityProcessFactory,
  type IUtilityProcessHandle,
  type WorkerEventListener,
  type WorkerEventName,
} from '../ExtensionWorkerProcess';
import { FakeSql } from './fakeSql';

// --- Router layer -----------------------------------------------------------

function makeRouter(callbacks: {
  onRuntimeEvent?: (channel: string, payload: unknown) => void;
} = {}): {
  router: ExtensionRpcRouter;
  fromWorker: (env: Extensions.RpcEnvelope) => void;
  violations: RpcProtocolViolation[];
} {
  let inbound: ((raw: unknown) => void) | null = null;
  const violations: RpcProtocolViolation[] = [];
  const transport: IRpcTransport = {
    send() {
      /* host -> worker not needed here */
    },
    onMessage(h) {
      inbound = h;
    },
    close() {
      /* noop */
    },
  };
  const router = new ExtensionRpcRouter(transport, {
    onProtocolViolation: (v) => violations.push(v),
    ...callbacks,
  });
  return { router, fromWorker: (env) => inbound?.(env), violations };
}

describe('ExtensionRpcRouter runtime events (bug C)', () => {
  it('routes __runtime.error events from the worker to onRuntimeEvent', async () => {
    const onRuntimeEvent = vi.fn();
    const { fromWorker, violations } = makeRouter({ onRuntimeEvent });

    fromWorker({
      kind: 'event',
      channel: RUNTIME_ERROR_CHANNEL,
      payload: { source: 'unhandledRejection', message: 'boom', stack: 'at foo()' },
    });
    await new Promise((r) => setImmediate(r));

    expect(onRuntimeEvent).toHaveBeenCalledWith(RUNTIME_ERROR_CHANNEL, {
      source: 'unhandledRejection',
      message: 'boom',
      stack: 'at foo()',
    });
    // Not a protocol violation any more.
    expect(violations).toHaveLength(0);
  });

  it('still rejects worker events on non-reserved channels', async () => {
    const onRuntimeEvent = vi.fn();
    const { fromWorker, violations } = makeRouter({ onRuntimeEvent });

    fromWorker({ kind: 'event', channel: 'evil.channel', payload: { hack: true } });
    await new Promise((r) => setImmediate(r));

    expect(onRuntimeEvent).not.toHaveBeenCalled();
    expect(violations.some((v) => v.reason === 'unknown-kind')).toBe(true);
  });

  it('reports a violation when a __runtime.* event has no consumer wired', async () => {
    const { fromWorker, violations } = makeRouter();
    fromWorker({ kind: 'event', channel: RUNTIME_ERROR_CHANNEL, payload: {} });
    await new Promise((r) => setImmediate(r));
    expect(violations.some((v) => v.reason === 'unknown-kind')).toBe(true);
  });
});

// --- Host layer -------------------------------------------------------------

/** Worker that acks `runtime.init` then pushes an error-boundary report. */
class FakeChild implements IUtilityProcessHandle {
  pid = 4242;
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

  /** Push an error-boundary report exactly as `ExtensionErrorBoundary` does. */
  reportError(source: string, message: string, stack: string): void {
    const env: Extensions.RpcEvent = {
      kind: 'event',
      channel: RUNTIME_ERROR_CHANNEL,
      payload: { source, message, stack },
    };
    for (const h of this.listeners.message) h(env);
  }

  kill(): boolean {
    setImmediate(() => {
      for (const h of this.listeners.exit) h(0);
    });
    return true;
  }

  on(event: WorkerEventName, handler: WorkerEventListener): void {
    this.listeners[event].push(handler);
  }
}

describe('ExtensionHost surfaces worker runtime errors in extension.log (bug C)', () => {
  let tmpRoot: string;
  let host: ExtensionHost;
  const children: FakeChild[] = [];

  const factory: IUtilityProcessFactory = {
    fork() {
      const c = new FakeChild();
      children.push(c);
      return c;
    },
  };

  beforeEach(async () => {
    children.length = 0;
    tmpRoot = mkdtempSync(join(tmpdir(), 'ext-runtime-err-'));
    const dir = join(tmpRoot, 'ext.test.boomer');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'extension.json'),
      JSON.stringify({
        id: 'ext.test.boomer',
        name: { key: 'extension.name' },
        version: '1.0.0',
        publisher: 'test',
        engines: { bibleApp: '^1.0.0' },
        main: './main.js',
        permissions: [],
      }),
      'utf8',
    );
    writeFileSync(join(dir, 'main.js'), 'exports.activate = () => {};', 'utf8');

    host = new ExtensionHost({
      db: new FakeSql(),
      extensionsRoot: tmpRoot,
      workerFactory: factory,
      workerScriptPath: '/fake/extension-runtime.js',
      workerHeartbeatIntervalMs: 0,
    });
    await host.loadAll();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('writes an uncaught worker error to the extension log', async () => {
    await host.activate('ext.test.boomer');

    children[0]!.reportError('unhandledRejection', 'kaboom in a promise', 'at activate (main.js:3)');
    await new Promise((r) => setImmediate(r));

    const entries = await host.getLog('ext.test.boomer', 50);
    const errEntry = entries.find((e) => e.level === 'error' && e.message.includes('kaboom'));
    expect(errEntry, `no runtime error in log: ${JSON.stringify(entries)}`).toBeDefined();
    expect(errEntry!.message).toContain('unhandledRejection');
    expect(errEntry!.fields?.stack).toContain('main.js:3');
  });
});
