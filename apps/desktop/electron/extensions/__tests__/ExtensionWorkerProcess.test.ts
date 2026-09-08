import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  ExtensionWorkerProcess,
  type IUtilityProcessFactory,
  type IUtilityProcessHandle,
  type WorkerEventListener,
  type WorkerEventName,
} from '../ExtensionWorkerProcess';

/**
 * Fake utility process. The constructor schedules `spawn` on the next tick
 * (so the wrapper's spawn() promise resolves), and then routes any messages
 * the wrapper sends through `postMessage`. Tests can drive incoming
 * messages via `emitMessage` and crash the worker via `emitExit`.
 */
class FakeChild implements IUtilityProcessHandle {
  pid = 12345;
  killed = false;
  postedMessages: unknown[] = [];
  private listeners: Record<WorkerEventName, WorkerEventListener[]> = {
    message: [],
    exit: [],
    spawn: [],
  };

  constructor() {
    // Schedule spawn on next tick.
    setImmediate(() => {
      for (const h of this.listeners.spawn) h(undefined);
    });
  }

  postMessage(msg: unknown): void {
    this.postedMessages.push(msg);
  }

  kill(): boolean {
    this.killed = true;
    setImmediate(() => this.emitExit(143));
    return true;
  }

  on(event: WorkerEventName, handler: WorkerEventListener): void {
    this.listeners[event].push(handler);
  }

  emitMessage(msg: unknown): void {
    for (const h of this.listeners.message) h(msg);
  }

  emitExit(code: number | null): void {
    for (const h of this.listeners.exit) h(code);
  }
}

function makeFactory(refSink: { last?: FakeChild }): IUtilityProcessFactory {
  return {
    fork() {
      const child = new FakeChild();
      refSink.last = child;
      return child;
    },
  };
}

describe('ExtensionWorkerProcess', () => {
  let ref: { last?: FakeChild };
  let factory: IUtilityProcessFactory;

  beforeEach(() => {
    ref = {};
    factory = makeFactory(ref);
  });

  it('spawn() resolves once the child emits "spawn"', async () => {
    const onExit = vi.fn();
    const w = new ExtensionWorkerProcess(factory, {
      extensionId: 'ext.test',
      scriptPath: '/fake/script.js',
      heartbeatIntervalMs: 0,
      onExit,
    });
    await w.spawn();
    expect(ref.last).toBeDefined();
  });

  it('forwards non-heartbeat messages to transport listeners', async () => {
    const w = new ExtensionWorkerProcess(factory, {
      extensionId: 'ext.test',
      scriptPath: '/fake/script.js',
      heartbeatIntervalMs: 0,
      onExit: () => {},
    });
    await w.spawn();
    const transport = w.getTransport();
    const seen: unknown[] = [];
    transport.onMessage((env) => seen.push(env));

    ref.last!.emitMessage({ kind: 'response', id: 'r1', result: 42 });
    expect(seen).toHaveLength(1);
  });

  it('intercepts heartbeat replies without forwarding them', async () => {
    const w = new ExtensionWorkerProcess(factory, {
      extensionId: 'ext.test',
      scriptPath: '/fake/script.js',
      heartbeatIntervalMs: 0,
      onExit: () => {},
    });
    await w.spawn();
    const transport = w.getTransport();
    const seen: unknown[] = [];
    transport.onMessage((env) => seen.push(env));

    ref.last!.emitMessage({ kind: 'heartbeat', ts: Date.now() });
    expect(seen).toHaveLength(0);
  });

  it('onExit fires with the buffered stderr tail and exit code', async () => {
    const onExit = vi.fn();
    const w = new ExtensionWorkerProcess(factory, {
      extensionId: 'ext.test',
      scriptPath: '/fake/script.js',
      heartbeatIntervalMs: 0,
      onExit,
    });
    await w.spawn();
    ref.last!.emitExit(7);
    expect(onExit).toHaveBeenCalledWith(
      expect.objectContaining({ code: 7, hung: false, killed: false }),
    );
    expect(w.isExited()).toBe(true);
  });

  it('terminate() kills the worker and resolves once exit fires', async () => {
    const w = new ExtensionWorkerProcess(factory, {
      extensionId: 'ext.test',
      scriptPath: '/fake/script.js',
      heartbeatIntervalMs: 0,
      onExit: () => {},
    });
    await w.spawn();
    await w.terminate();
    expect(ref.last!.killed).toBe(true);
    expect(w.isExited()).toBe(true);
  });

  it('flags the worker as hung after consecutive missed heartbeats', async () => {
    const onExit = vi.fn();
    const w = new ExtensionWorkerProcess(factory, {
      extensionId: 'ext.test',
      scriptPath: '/fake/script.js',
      heartbeatIntervalMs: 5, // tick every 5 ms
      heartbeatMaxMissed: 2,
      onExit,
    });
    await w.spawn();

    // Wait long enough for >2 ticks to elapse without any heartbeat reply.
    await new Promise((r) => setTimeout(r, 50));
    // Allow the kill()'s setImmediate-scheduled exit to flush.
    await new Promise((r) => setImmediate(r));

    expect(w.wasHung()).toBe(true);
    expect(onExit).toHaveBeenCalled();
  });
});
