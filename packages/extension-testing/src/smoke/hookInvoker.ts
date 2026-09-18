/**
 * `HookInvoker` is the seam between the harness's hook enumeration and the
 * mechanism that actually *runs* a hook against an input.
 *
 * `InProcessHookInvoker` drives the extension in the same Node process as the
 * test. It fires event subscribers directly, and it calls endpoint-based
 * hooks (commands, hovers, decorators, providers, and the context-menu and
 * status-bar items that route through a command) on the endpoint table the
 * extension filled in with `api.runtime.expose(...)` during `activate`.
 *
 * ── Why endpoints used to be skipped, and why that no longer holds ──────────
 * The original version of this file reported every endpoint-based hook as
 * `not-invokable`, on the grounds that extensions had no way to register
 * reverse-RPC handlers. That was true once; it is not now. `api.runtime.
 * expose(endpoint, handler)` is part of `IRuntimeApi`, the guest runtime binds
 * it into a worker-local endpoint table (`extension-runtime/apiProxy.ts`), and
 * `createMockApi` implements the same table with a driver behind
 * `getMockRuntimeEndpoints(api)`. So there *is* an address to call, and a
 * smoke run that skips these is skipping most of what an extension does.
 *
 * ── The pass / fail / skip rule ─────────────────────────────────────────────
 * The rule this invoker implements, stated once:
 *
 *   1. A handler that runs and returns              → `ok`     → pass.
 *   2. A handler that runs and throws               → `threw`  → fail.
 *   3. A handler that runs and hangs                → `timeout`→ fail.
 *   4. A declared hook whose endpoint nothing bound → `unbound-endpoint`
 *                                                             → **fail**.
 *   5. A contribution with no invocation semantics  → `not-invokable`
 *                                                             → skip.
 *
 * Case 4 is the one worth arguing for. It is tempting to call an unbound
 * endpoint "not exercised" and skip it, because the harness did not get to run
 * any extension code. But the extension declared the command; the host will
 * show it; and clicking it will do nothing at all. That is a defect the author
 * shipped, not a gap in the harness, and it is invisible in production —
 * nothing logs, nothing throws, the menu item just sits there. A tool that
 * stays quiet about it is worse than no tool, because it certifies the bug.
 *
 * Case 5 is kept narrow on purpose: panel types and highlight styles, plus a
 * status-bar item that declares no command. Anything else that cannot be
 * reached is case 4.
 */

import type { MockRuntimeEndpoints } from '../createMockApi';
import type {
  HookDescriptor,
  HookInvocationResult,
  CapturedRegistrations,
} from './types';

export interface InvokeOptions {
  /** Per-invocation timeout. Default 2000 ms. */
  timeoutMs?: number;
}

export interface HookInvoker {
  invoke(
    hook: HookDescriptor,
    input: unknown,
    opts?: InvokeOptions,
  ): Promise<HookInvocationResult>;
}

const DEFAULT_TIMEOUT_MS = 2_000;

export class InProcessHookInvoker implements HookInvoker {
  /**
   * @param captured   registrations recorded during `activate(api)`.
   * @param endpoints  the mock api's `runtime.expose` table. Optional so the
   *                   realm harness can reuse this class for events alone;
   *                   without it, endpoint hooks report as not-invokable
   *                   rather than being blamed on the extension.
   */
  constructor(
    private readonly captured: CapturedRegistrations,
    private readonly endpoints?: MockRuntimeEndpoints,
  ) {}

  async invoke(
    hook: HookDescriptor,
    input: unknown,
    opts: InvokeOptions = {},
  ): Promise<HookInvocationResult> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    switch (hook.target.via) {
      case 'event':
        return this.invokeEvent(hook, input, timeoutMs);
      case 'endpoint':
        return this.invokeEndpoint(
          hook,
          hook.target.endpoint,
          hook.target.commandId,
          input,
          timeoutMs,
        );
      case 'broken':
        return {
          hookId: hook.hookId,
          status: 'unbound-endpoint',
          durationMs: 0,
          reason: hook.target.reason,
        };
      case 'declarative':
        return {
          hookId: hook.hookId,
          status: 'not-invokable',
          durationMs: 0,
          reason: hook.target.reason,
        };
    }
  }

  private async invokeEndpoint(
    hook: HookDescriptor,
    endpoint: string,
    commandId: string | undefined,
    input: unknown,
    timeoutMs: number,
  ): Promise<HookInvocationResult> {
    if (!this.endpoints) {
      return {
        hookId: hook.hookId,
        status: 'not-invokable',
        durationMs: 0,
        reason:
          `This harness was built without an endpoint table, so "${endpoint}" cannot be ` +
          'called. That is a harness limitation, not an extension defect.',
      };
    }
    const bound = this.endpoints.list();
    if (!bound.includes(endpoint)) {
      return {
        hookId: hook.hookId,
        status: 'unbound-endpoint',
        durationMs: 0,
        reason: describeUnbound(endpoint, commandId, bound),
      };
    }

    const start = Date.now();
    try {
      // One argument, matching the host: `commandsApiImpl` dispatches a
      // command as `router.request(handlerEndpoint, [commandArgs])`, and the
      // guest proxy spreads that array into the author's handler. Passing the
      // corpus input as a single argument is the same shape the extension
      // will see in the app.
      const value = await raceTimeout(
        Promise.resolve(this.endpoints.invoke(endpoint, input)),
        timeoutMs,
      );
      return {
        hookId: hook.hookId,
        status: 'ok',
        durationMs: Date.now() - start,
        value,
      };
    } catch (err) {
      return failureResult(hook.hookId, err, Date.now() - start);
    }
  }

  private async invokeEvent(
    hook: HookDescriptor,
    input: unknown,
    timeoutMs: number,
  ): Promise<HookInvocationResult> {
    const handlers = this.captured.eventSubscribers.get(hook.localId);
    if (!handlers || handlers.length === 0) {
      return {
        hookId: hook.hookId,
        status: 'not-invokable',
        durationMs: 0,
        reason: `No subscribers recorded for event "${hook.localId}".`,
      };
    }
    const start = Date.now();
    try {
      const work = Promise.all(handlers.map((h) => Promise.resolve(h(input))));
      await raceTimeout(work, timeoutMs);
      return {
        hookId: hook.hookId,
        status: 'ok',
        durationMs: Date.now() - start,
        value: undefined,
      };
    } catch (err) {
      return failureResult(hook.hookId, err, Date.now() - start);
    }
  }
}

/**
 * Say what is missing *and* what is present. An author reading "endpoint
 * 'practiceDue' is not bound" reaches for the manifest; an author reading
 * that alongside "bound: practise_due" fixes a typo in ten seconds.
 */
function describeUnbound(
  endpoint: string,
  commandId: string | undefined,
  bound: readonly string[],
): string {
  const via = commandId !== undefined ? ` (reached through command "${commandId}")` : '';
  return (
    `Nothing bound the endpoint "${endpoint}"${via}. The contribution is declared, so ` +
    'the host will show it, but invoking it will do nothing. Bind it during activate ' +
    `with api.runtime.expose('${endpoint}', handler). Currently bound: ` +
    `${bound.length > 0 ? bound.join(', ') : '(nothing)'}.`
  );
}

function failureResult(
  hookId: string,
  err: unknown,
  durationMs: number,
): HookInvocationResult {
  if (err instanceof TimeoutError) {
    return {
      hookId,
      status: 'timeout',
      durationMs,
      error: { message: err.message },
    };
  }
  const e = err as Error;
  return {
    hookId,
    status: 'threw',
    durationMs,
    error: {
      message: e?.message ?? String(err),
      ...(e?.stack !== undefined ? { stack: e.stack } : {}),
    },
  };
}

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Hook invocation timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
