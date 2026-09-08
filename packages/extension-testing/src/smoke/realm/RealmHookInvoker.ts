/**
 * Hook invoker for realm mode.
 *
 * Event hooks delegate to the in-process invoker, which is not a shortcut:
 * `createRealmSmokeHarness` records a synthetic subscriber for every channel
 * the guest subscribes to, and calling that subscriber pushes a real `event`
 * envelope into the realm. The in-process invoker's timeout and error
 * classification then apply to the realm round trip unchanged.
 *
 * Endpoint hooks (hover, decorator, command, providers) are still reported as
 * `not-invokable`, and realm mode does not change that. The reason is worth
 * stating precisely because it is easy to assume the sandbox is at fault:
 *
 *   `ExtensionRuntime` has `registerReverseHandler`, but nothing calls it.
 *   An extension registers a hover by passing a *function* to
 *   `api.ui.registerVerseHover(...)`, and functions do not survive the RPC
 *   envelope — the host receives a descriptor with the handler missing. Until
 *   the API surface assigns each registration a reverse-RPC endpoint and the
 *   guest runtime binds the author's callback to it, there is no address for
 *   the host to call back on. That work belongs to the API-surface pass, not
 *   to the sandbox.
 *
 * Reporting these as `not-invokable` (which `runSmokeSuite` classifies as a
 * skip) rather than inventing a pass keeps the smoke report honest about what
 * it actually exercised.
 */

import type { HookDescriptor, HookInvocationResult } from '../types';
import {
  InProcessHookInvoker,
  type HookInvoker,
  type InvokeOptions,
} from '../hookInvoker';

export class RealmHookInvoker implements HookInvoker {
  constructor(private readonly events: InProcessHookInvoker) {}

  async invoke(
    hook: HookDescriptor,
    input: unknown,
    opts?: InvokeOptions,
  ): Promise<HookInvocationResult> {
    if (hook.kind === 'event') {
      return this.events.invoke(hook, input, opts);
    }
    return {
      hookId: hook.hookId,
      status: 'not-invokable',
      durationMs: 0,
      reason:
        hook.endpoint !== undefined
          ? `Endpoint "${hook.endpoint}" has no reverse-RPC binding: the extension's callback ` +
            'does not cross the RPC boundary, so the host has nothing to call back on.'
          : `Static contribution "${hook.kind}" has no runtime invocation path.`,
    };
  }
}
