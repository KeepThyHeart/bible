/**
 * `ITasksApi` tests.
 *
 * Same paired-router transport pattern as the other api-impl tests: each test mounts
 * a host-side `TasksApiImpl` on a router whose transport is paired with a
 * worker-side router that the test drives directly. The worker-side router
 * registers a reverse-RPC handler for the task's `workEndpoint` so the host
 * can `router.request(workEndpoint, [handle])` and the test can simulate the
 * extension's work loop.
 *
 * Coverage:
 *
 *   1. Permission gate.
 *   2. id-prefix enforcement.
 *   3. Happy path: run -> reportProgress -> complete, with status-bridge
 *      fan-out and notifier on completion.
 *   4. Cancellation: cancel flips state to `cancelling`,
 *      `isCancellationRequested` returns true, the worker handler bails, and
 *      the final state is `cancelled`.
 *   5. Singleton + concurrency:reject - second run rejects.
 *   6. Singleton + concurrency:join - second run shares the first promise.
 *   7. dispose() cancels in-flight tasks and waits within the drain budget.
 *   8. dispose() drain budget expiry doesn't hang the host indefinitely.
 *   9. list() returns the live snapshot.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { Extensions } from '@bible/core';

import { ExtensionRpcRouter, type IRpcTransport } from '../ExtensionRpcRouter';
import { buildGrant } from '../ExtensionPermissionGuard';
import {
  TasksApiImpl,
  InMemoryTaskStatusBridge,
  type TaskNotifier,
} from '../api-impl';

type RpcEnvelope = Extensions.RpcEnvelope;
type RpcRequest = Extensions.RpcRequest;
type RpcResponse = Extensions.RpcResponse;
type BackgroundTaskDescriptor = Extensions.BackgroundTaskDescriptor;
type BackgroundTaskInfo = Extensions.BackgroundTaskInfo;

// --- Paired transports ----------------------------------------------------

interface Pair {
  hostSide: IRpcTransport;
  workerSide: IRpcTransport;
  hostSent: unknown[];
  workerSent: unknown[];
}

function pairedTransports(): Pair {
  let hostHandler: ((env: unknown) => void) | null = null;
  let workerHandler: ((env: unknown) => void) | null = null;
  const hostSent: unknown[] = [];
  const workerSent: unknown[] = [];
  const hostSide: IRpcTransport = {
    send(env) {
      hostSent.push(env);
      // Defer so host's send doesn't reentrantly invoke worker handlers
      // before the host-side `await router.request(...)` returns its promise.
      queueMicrotask(() => workerHandler?.(env));
    },
    onMessage(h) {
      hostHandler = h;
    },
    close() {
      hostHandler = null;
    },
  };
  const workerSide: IRpcTransport = {
    send(env) {
      workerSent.push(env);
      queueMicrotask(() => hostHandler?.(env));
    },
    onMessage(h) {
      workerHandler = h;
    },
    close() {
      workerHandler = null;
    },
  };
  return { hostSide, workerSide, hostSent, workerSent };
}

let nextWorkerReqId = 1;

async function workerCall(
  workerSide: IRpcTransport,
  hostSent: unknown[],
  method: string,
  args: unknown[],
): Promise<RpcResponse> {
  const startLen = hostSent.length;
  const id = `w-${nextWorkerReqId++}`;
  const req: RpcRequest = { kind: 'request', id, method, args };
  workerSide.send(req);
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setImmediate(r));
    for (let j = startLen; j < hostSent.length; j++) {
      const env = hostSent[j];
      if (
        env &&
        typeof env === 'object' &&
        (env as RpcResponse).kind === 'response' &&
        (env as RpcResponse).id === id
      ) {
        return env as RpcResponse;
      }
    }
  }
  throw new Error(`workerCall: no response received for ${method}`);
}

/**
 * Run an envelope-pump tick - give microtasks + setImmediate a chance to
 * flush so that paired transports settle into a stable state.
 */
async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

// --- Test harness ---------------------------------------------------------

interface Harness {
  pair: Pair;
  api: TasksApiImpl;
  bridge: InMemoryTaskStatusBridge;
  notifier: { calls: { extensionId: string; message: unknown }[] };
  /** Worker-side reverse handler for `descriptor.workEndpoint`. */
  registerWorkHandler(
    method: string,
    handler: (handle: string) => Promise<unknown>,
  ): void;
}

function buildHarness(opts?: {
  perms?: string[];
  extensionId?: string;
  disposeDrainMs?: number;
  clock?: () => number;
}): Harness {
  const pair = pairedTransports();
  const router = new ExtensionRpcRouter(pair.hostSide);

  // Worker-side: a small dispatcher that handles incoming `request`
  // envelopes (reverse RPC from host) by looking up a registered handler
  // and routing the response back through the worker transport.
  const workHandlers = new Map<string, (handle: string) => Promise<unknown>>();
  pair.workerSide.onMessage((raw) => {
    if (
      raw &&
      typeof raw === 'object' &&
      (raw as RpcEnvelope).kind === 'request'
    ) {
      const req = raw as RpcRequest;
      const handler = workHandlers.get(req.method);
      if (!handler) {
        const res: RpcResponse = {
          kind: 'response',
          id: req.id,
          error: { code: 'RpcProtocolError', message: `no worker handler for ${req.method}` },
        };
        pair.workerSide.send(res);
        return;
      }
      const handle = (req.args[0] ?? '') as string;
      handler(handle).then(
        (result) => {
          pair.workerSide.send({ kind: 'response', id: req.id, result } as RpcResponse);
        },
        (err: Error) => {
          pair.workerSide.send({
            kind: 'response',
            id: req.id,
            error: { code: 'Error', message: err.message },
          } as RpcResponse);
        },
      );
    }
  });

  const extensionId = opts?.extensionId ?? 'test.tasks';
  const bridge = new InMemoryTaskStatusBridge();
  const notifierCalls: { extensionId: string; message: unknown }[] = [];
  const notifier: TaskNotifier = (extId, msg) => {
    notifierCalls.push({ extensionId: extId, message: msg });
  };

  const apiOpts: ConstructorParameters<typeof TasksApiImpl>[0] = {
    extensionId,
    router,
    grant: buildGrant(extensionId, opts?.perms ?? ['tasks']),
    statusBridge: bridge,
    notifier,
  };
  if (opts?.disposeDrainMs !== undefined) apiOpts.disposeDrainMs = opts.disposeDrainMs;
  if (opts?.clock !== undefined) apiOpts.clock = opts.clock;
  const api = new TasksApiImpl(apiOpts);
  api.attach();

  return {
    pair,
    api,
    bridge,
    notifier: { calls: notifierCalls },
    registerWorkHandler(method, handler) {
      workHandlers.set(method, handler);
    },
  };
}

function descriptor(
  overrides: Partial<BackgroundTaskDescriptor> = {},
  extensionId = 'test.tasks',
): BackgroundTaskDescriptor {
  return {
    id: `ext.${extensionId}.bake`,
    title: 'Baking',
    workEndpoint: 'work.bake',
    ...overrides,
  };
}

beforeEach(() => {
  nextWorkerReqId = 1;
});

// --- Tests ----------------------------------------------------------------

describe('TasksApiImpl — permission gate', () => {
  it('rejects every method without the tasks permission', async () => {
    const h = buildHarness({ perms: [] });
    const r = await workerCall(h.pair.workerSide, h.pair.hostSent, 'tasks.run', [
      descriptor(),
    ]);
    expect(r.error?.code).toBe('PermissionDeniedError');

    const c = await workerCall(h.pair.workerSide, h.pair.hostSent, 'tasks.cancel', [
      'ext.test.tasks.bake',
    ]);
    expect(c.error?.code).toBe('PermissionDeniedError');

    const l = await workerCall(h.pair.workerSide, h.pair.hostSent, 'tasks.list', []);
    expect(l.error?.code).toBe('PermissionDeniedError');
  });
});

describe('TasksApiImpl — id prefix', () => {
  it('rejects ids that do not start with ext.<extensionId>.', async () => {
    const h = buildHarness();
    const r = await workerCall(h.pair.workerSide, h.pair.hostSent, 'tasks.run', [
      { id: 'wrong.prefix.bake', title: 'x', workEndpoint: 'work.bake' },
    ]);
    expect(r.error?.code).toBe('RpcProtocolError');
    expect(r.error?.message).toContain('must start with');
  });
});

describe('TasksApiImpl — happy path', () => {
  it('runs a task end-to-end with progress + status fan-out + notifier', async () => {
    const h = buildHarness();
    h.registerWorkHandler('work.bake', async (handle) => {
      // Worker-side: report progress twice, then return.
      const p1 = await workerCall(h.pair.workerSide, h.pair.hostSent, 'tasks.reportProgress', [
        handle,
        { increment: 25, total: 100, message: 'mixing' },
      ]);
      expect(p1.error).toBeUndefined();
      const p2 = await workerCall(h.pair.workerSide, h.pair.hostSent, 'tasks.reportProgress', [
        handle,
        { increment: 75, message: 'baking' },
      ]);
      expect(p2.error).toBeUndefined();
      return 42;
    });

    const res = await workerCall(h.pair.workerSide, h.pair.hostSent, 'tasks.run', [
      descriptor({ notifyOnComplete: true }),
    ]);
    expect(res.error).toBeUndefined();
    expect(res.result).toBe(42);

    // Status fan-out should include the start, two progress updates, and the
    // terminal removal - at least four snapshots.
    const snaps = h.bridge.snapshots.filter((s) => s.extensionId === 'test.tasks');
    expect(snaps.length).toBeGreaterThanOrEqual(4);
    // Progress should have advanced to 100 in some intermediate snapshot.
    const withFinalProgress = snaps.find(
      (s) =>
        s.snapshot[0]?.progress?.current === 100 &&
        s.snapshot[0]?.progress?.message === 'baking',
    );
    expect(withFinalProgress).toBeDefined();
    // Final snapshot is empty because the task is removed on settle.
    expect(snaps[snaps.length - 1]!.snapshot).toEqual([]);

    // Notifier fired exactly once on completion.
    expect(h.notifier.calls).toHaveLength(1);
    expect(h.notifier.calls[0]!.extensionId).toBe('test.tasks');
    expect(h.notifier.calls[0]!.message).toBe('Baking');
  });

  it('list() returns the live snapshot mid-flight', async () => {
    const h = buildHarness();
    let listResult: BackgroundTaskInfo[] | undefined;
    h.registerWorkHandler('work.bake', async (handle) => {
      const r = await workerCall(h.pair.workerSide, h.pair.hostSent, 'tasks.list', []);
      listResult = r.result as BackgroundTaskInfo[];
      // Use the handle so it's not flagged unused.
      expect(handle).toBe('ext.test.tasks.bake');
      return 'ok';
    });
    await workerCall(h.pair.workerSide, h.pair.hostSent, 'tasks.run', [descriptor()]);
    expect(listResult).toBeDefined();
    expect(listResult!).toHaveLength(1);
    expect(listResult![0]!.id).toBe('ext.test.tasks.bake');
    expect(listResult![0]!.state).toBe('running');
  });
});

describe('TasksApiImpl — cancellation', () => {
  it('cancel flips the worker poll and the task settles as cancelled', async () => {
    const h = buildHarness();
    let observed = false;
    h.registerWorkHandler('work.bake', async (handle) => {
      // Spin: poll cancellation up to 50 times, settling once requested.
      for (let i = 0; i < 50; i++) {
        const r = await workerCall(
          h.pair.workerSide,
          h.pair.hostSent,
          'tasks.isCancellationRequested',
          [handle],
        );
        if (r.result === true) {
          observed = true;
          return 'aborted';
        }
        await new Promise((res) => setImmediate(res));
      }
      throw new Error('cancellation never observed');
    });

    // Kick off run() but don't await.
    const runReqId = `w-${nextWorkerReqId++}`;
    h.pair.workerSide.send({
      kind: 'request',
      id: runReqId,
      method: 'tasks.run',
      args: [descriptor()],
    });
    await flush();

    // Task should be visible.
    expect(h.api.activeCount).toBe(1);

    // Cancel it.
    const cancelRes = await workerCall(
      h.pair.workerSide,
      h.pair.hostSent,
      'tasks.cancel',
      ['ext.test.tasks.bake'],
    );
    expect(cancelRes.error).toBeUndefined();

    // Wait for the run() response.
    let runResponse: RpcResponse | undefined;
    for (let i = 0; i < 200 && !runResponse; i++) {
      await new Promise((r) => setImmediate(r));
      runResponse = h.pair.hostSent.find(
        (env) =>
          env &&
          typeof env === 'object' &&
          (env as RpcResponse).kind === 'response' &&
          (env as RpcResponse).id === runReqId,
      ) as RpcResponse | undefined;
    }
    expect(runResponse).toBeDefined();
    expect(runResponse!.error).toBeUndefined();
    expect(runResponse!.result).toBe('aborted');
    expect(observed).toBe(true);
    expect(h.api.activeCount).toBe(0);
  });

  it('cancel rejects on a non-cancellable task', async () => {
    const h = buildHarness();
    let releaseTask: () => void = () => {};
    h.registerWorkHandler('work.bake', () => {
      return new Promise<string>((resolve) => {
        releaseTask = () => resolve('done');
      });
    });
    // Start the task without awaiting.
    const runId = `w-${nextWorkerReqId++}`;
    h.pair.workerSide.send({
      kind: 'request',
      id: runId,
      method: 'tasks.run',
      args: [descriptor({ cancellable: false })],
    });
    await flush();

    const r = await workerCall(h.pair.workerSide, h.pair.hostSent, 'tasks.cancel', [
      'ext.test.tasks.bake',
    ]);
    expect(r.error?.code).toBe('RpcProtocolError');
    expect(r.error?.message).toContain('not cancellable');

    releaseTask();
    await flush();
  });
});

describe('TasksApiImpl — singleton + concurrency', () => {
  it('rejects a second run by default', async () => {
    const h = buildHarness();
    let release: (v: string) => void = () => {};
    h.registerWorkHandler('work.bake', () => new Promise<string>((r) => (release = r)));

    // First run - fire and don't await.
    const id1 = `w-${nextWorkerReqId++}`;
    h.pair.workerSide.send({
      kind: 'request',
      id: id1,
      method: 'tasks.run',
      args: [descriptor({ singleton: true })],
    });
    await flush();

    // Second run - should reject immediately.
    const dup = await workerCall(h.pair.workerSide, h.pair.hostSent, 'tasks.run', [
      descriptor({ singleton: true }),
    ]);
    expect(dup.error?.code).toBe('RpcProtocolError');
    expect(dup.error?.message).toContain('already running');

    release('ok');
    await flush();
  });

  it('joins a second run when concurrency:join', async () => {
    const h = buildHarness();
    let release: (v: string) => void = () => {};
    h.registerWorkHandler('work.bake', () => new Promise<string>((r) => (release = r)));

    const desc: BackgroundTaskDescriptor = descriptor({ singleton: true, concurrency: 'join' });
    const id1 = `w-${nextWorkerReqId++}`;
    const id2 = `w-${nextWorkerReqId++}`;
    h.pair.workerSide.send({ kind: 'request', id: id1, method: 'tasks.run', args: [desc] });
    h.pair.workerSide.send({ kind: 'request', id: id2, method: 'tasks.run', args: [desc] });
    await flush();

    expect(h.api.activeCount).toBe(1);

    release('shared-result');

    // Wait for both responses.
    const responses = new Map<string, RpcResponse>();
    for (let i = 0; i < 200 && responses.size < 2; i++) {
      await new Promise((r) => setImmediate(r));
      for (const env of h.pair.hostSent) {
        if (env && typeof env === 'object' && (env as RpcResponse).kind === 'response') {
          const r = env as RpcResponse;
          if (r.id === id1 || r.id === id2) responses.set(r.id, r);
        }
      }
    }
    expect(responses.get(id1)?.result).toBe('shared-result');
    expect(responses.get(id2)?.result).toBe('shared-result');
  });
});

describe('TasksApiImpl — dispose drain', () => {
  it('cancels in-flight tasks and waits within the drain budget', async () => {
    const h = buildHarness({ disposeDrainMs: 500 });
    h.registerWorkHandler('work.bake', async (handle) => {
      // Cooperative loop - exits as soon as cancellation is observed.
      for (let i = 0; i < 100; i++) {
        const r = await workerCall(
          h.pair.workerSide,
          h.pair.hostSent,
          'tasks.isCancellationRequested',
          [handle],
        );
        if (r.result === true) return 'bailed';
        await new Promise((res) => setImmediate(res));
      }
      return 'finished';
    });
    h.pair.workerSide.send({
      kind: 'request',
      id: `w-${nextWorkerReqId++}`,
      method: 'tasks.run',
      args: [descriptor()],
    });
    await flush();
    expect(h.api.activeCount).toBe(1);

    const t0 = Date.now();
    await h.api.dispose();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(1500);
    expect(h.api.activeCount).toBe(0);
    expect(h.bridge.cleared).toContain('test.tasks');
  });

  it('does not hang if a task ignores cancellation — drain budget caps the wait', async () => {
    const h = buildHarness({ disposeDrainMs: 100 });
    let release: (v: string) => void = () => {};
    h.registerWorkHandler(
      'work.bake',
      () => new Promise<string>((r) => (release = r)),
    );
    h.pair.workerSide.send({
      kind: 'request',
      id: `w-${nextWorkerReqId++}`,
      method: 'tasks.run',
      args: [descriptor()],
    });
    await flush();
    expect(h.api.activeCount).toBe(1);

    const t0 = Date.now();
    await h.api.dispose();
    const elapsed = Date.now() - t0;
    // Drain budget is 100 ms; allow some scheduler slack but assert the cap.
    expect(elapsed).toBeLessThan(1000);

    // The task is now orphaned at the api-impl level. Resolve it so the
    // pending router promise doesn't leak into the next test.
    release('late');
    await flush();
  });
});
