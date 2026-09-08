/**
 * `HookInvoker` is the seam between the harness's hook enumeration and the
 * mechanism that actually *runs* a hook against an input.
 *
 * Work Item 1 ships one implementation, `InProcessHookInvoker`, which drives
 * the extension's `activate(api)` in the same Node process as the test and
 * fires event subscribers directly. Endpoint-based hooks (hover, decorator,
 * commands, providers) can't be dispatched in-process because extensions
 * have no public API today for registering reverse-RPC handlers; those
 * return `{ status: 'not-invokable' }` until the future `--full` mode
 * (Work Item TBD) wraps a real `ExtensionRuntime` + `utilityProcess`.
 *
 * Keeping this behind an interface means items 2–7 can swap implementations
 * without touching the enumeration or reporter layers.
 */

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
  constructor(private readonly captured: CapturedRegistrations) {}

  async invoke(
    hook: HookDescriptor,
    input: unknown,
    opts: InvokeOptions = {},
  ): Promise<HookInvocationResult> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (hook.kind === 'event') {
      return this.invokeEvent(hook, input, timeoutMs);
    }
    return {
      hookId: hook.hookId,
      status: 'not-invokable',
      durationMs: 0,
      reason:
        hook.endpoint !== undefined
          ? `Endpoint-based hook "${hook.endpoint}" requires --full worker mode; not available in Work Item 1.`
          : `Static contribution "${hook.kind}" has no runtime invocation path.`,
    };
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
      const duration = Date.now() - start;
      if (err instanceof TimeoutError) {
        return {
          hookId: hook.hookId,
          status: 'timeout',
          durationMs: duration,
          error: { message: err.message },
        };
      }
      const e = err as Error;
      return {
        hookId: hook.hookId,
        status: 'threw',
        durationMs: duration,
        error: {
          message: e.message ?? String(err),
          ...(e.stack !== undefined ? { stack: e.stack } : {}),
        },
      };
    }
  }
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
