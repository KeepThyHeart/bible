/**
 * Hook invoker for realm mode.
 *
 * Event hooks delegate to the in-process invoker, which is not a shortcut:
 * `createRealmSmokeHarness` records a synthetic subscriber for every channel
 * the guest subscribes to, and calling that subscriber pushes a real `event`
 * envelope into the realm. The in-process invoker's timeout and error
 * classification then apply to the realm round trip unchanged. Hooks with
 * nothing to invoke (`broken`, `declarative`) are delegated too, because the
 * verdict is a property of the contribution, not of the execution mode.
 *
 * Endpoint hooks are the part realm mode has to do itself, and it can: the
 * host reaches an extension's `api.runtime.expose(...)` handler by sending a
 * `request` envelope whose `method` is the endpoint name. `ExtensionRuntime`
 * looks it up in its reverse-handler table and answers with a `response` —
 * a result, or an `RpcProtocolError` reading `Unknown reverse RPC method`
 * when nothing is bound. That last case is the one worth catching: it is
 * exactly the silent do-nothing command the smoke tool exists to find, and it
 * is reported as a failure rather than a skip.
 *
 * (An earlier version of this file skipped every endpoint hook on the grounds
 * that an extension's callback could not cross the RPC boundary. That was
 * true when registrations took a bare function; it stopped being true when
 * the API surface moved to named endpoints bound through `runtime.expose`.)
 */

import type { HookDescriptor, HookInvocationResult } from '../types';
import {
  InProcessHookInvoker,
  type HookInvoker,
  type InvokeOptions,
} from '../hookInvoker';

/** What a reverse-RPC round trip into the realm came back with. */
export type RealmEndpointOutcome =
  /** The guest's handler returned. */
  | { outcome: 'result'; value: unknown }
  /** The guest has no handler bound to that endpoint. */
  | { outcome: 'unbound'; message: string }
  /** The guest's handler threw, or the host rejected the call. */
  | { outcome: 'error'; message: string }
  /** The realm never answered inside the budget. */
  | { outcome: 'timeout'; message: string };

/**
 * Sends one reverse-RPC request into the realm and resolves with what came
 * back. Supplied by `createRealmSmokeHarness`, which owns the envelope pump.
 */
export type RealmEndpointCaller = (
  endpoint: string,
  args: readonly unknown[],
  timeoutMs: number,
) => Promise<RealmEndpointOutcome>;

const DEFAULT_TIMEOUT_MS = 2_000;

export class RealmHookInvoker implements HookInvoker {
  constructor(
    private readonly events: InProcessHookInvoker,
    private readonly callEndpoint: RealmEndpointCaller,
  ) {}

  async invoke(
    hook: HookDescriptor,
    input: unknown,
    opts?: InvokeOptions,
  ): Promise<HookInvocationResult> {
    if (hook.target.via !== 'endpoint') {
      return this.events.invoke(hook, input, opts);
    }
    const { endpoint, commandId } = hook.target;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const start = Date.now();
    // A single argument, matching `commandsApiImpl`: the host dispatches a
    // command as `router.request(handlerEndpoint, [commandArgs])` and the
    // guest proxy spreads that array into the author's handler.
    const result = await this.callEndpoint(endpoint, [input], timeoutMs);
    const durationMs = Date.now() - start;
    const via = commandId !== undefined ? ` (reached through command "${commandId}")` : '';

    switch (result.outcome) {
      case 'result':
        return { hookId: hook.hookId, status: 'ok', durationMs, value: result.value };
      case 'unbound':
        return {
          hookId: hook.hookId,
          status: 'unbound-endpoint',
          durationMs,
          reason:
            `Nothing bound the endpoint "${endpoint}"${via}. The contribution is ` +
            'declared, so the host will show it, but invoking it will do nothing. ' +
            `Bind it during activate with api.runtime.expose('${endpoint}', handler). ` +
            `Guest said: ${result.message}`,
        };
      case 'timeout':
        return {
          hookId: hook.hookId,
          status: 'timeout',
          durationMs,
          error: { message: result.message },
        };
      case 'error':
        return {
          hookId: hook.hookId,
          status: 'threw',
          durationMs,
          error: { message: result.message },
        };
    }
  }
}
