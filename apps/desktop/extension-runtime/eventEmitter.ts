/**
 * Worker-side event emitter, implementing the local half of
 * `api.events.subscribe(channel, handler, opts?)` for every channel kind.
 *
 * The proxy layer routes `api.events.subscribe(...)` here; this emitter
 * implements the local fan-out and the bookkeeping that lets the host stop
 * sending events on a channel once the worker drops its last subscription.
 *
 * Wire protocol, **event**-kind channels (unchanged from before task 0024
 * round 3's event-system unification):
 *
 *   1. First subscriber to a channel triggers an `RpcSubscribe` envelope so
 *      the host knows to start emitting `RpcEvent` envelopes on it.
 *   2. Subsequent subscribers are local-only - the host already knows.
 *   3. Last subscriber dropping triggers an `RpcUnsubscribe` so the host can
 *      stop firing events the worker isn't going to use.
 *
 * Events arriving while the channel has zero local subscribers are dropped
 * silently - that's a host bug we don't want to crash on.
 *
 * Wire protocol, `filter`/`provider`-kind channels (new): the worker
 * cannot *return* a value from a fire-and-forget `RpcEvent`, so alongside the
 * same `RpcSubscribe` envelope (which is how `hasSubscription` lets the host
 * skip workers that do not care, and how `order` reaches the host), the
 * emitter registers a reverse handler under `hook:${channel}` the first time
 * a handler for that channel is added. The host calls that reverse endpoint
 * (`router.request('hook:<channel>', [payload], {timeoutMs})`) instead of
 * sending an event, and whatever this emitter's handler(s) compute becomes
 * the RPC response: a filter waterfalls multiple local handlers in
 * registration order (short-circuiting on the first `'cancel'` for a
 * cancelable channel - see `EXTENSION_POINT_CANCELABLE`); a provider runs
 * them in parallel and concatenates their array results. The reverse handler
 * is unregistered when the last local handler for that channel is disposed.
 */

import type { Extensions } from '@bible/core';
// Deep value import (see `apiProxy.ts`'s note on this pattern) - a small,
// fixed-size table, well within the runtime bundle's size budget.
import {
  EXTENSION_POINT_CANCELABLE,
  EXTENSION_POINT_KINDS,
} from '@bible/core/Extensions/ExtensionPointTypes';

type DisposableHandle = Extensions.DisposableHandle;
type RpcEvent = Extensions.RpcEvent;
type RpcRequestId = Extensions.RpcRequestId;
type ExtensionPointKind = Extensions.ExtensionPointKind;

import { type IRpcChannel, makeDisposableHandle, sendSubscribe, sendUnsubscribe } from './apiProxy';

/**
 * Reverse-RPC registration capability the emitter needs for `filter`/
 * `provider` channels. Mirrors `IReverseEndpointTable` in `apiProxy.ts`
 * (which is the same table `ExtensionRuntime` hands to both), kept as its
 * own minimal interface here so this file does not have to import that one
 * just for a type.
 */
export interface IHookEndpointTable {
  register(endpoint: string, handler: (args: unknown[]) => unknown | Promise<unknown>): void;
  unregister(endpoint: string): void;
}

export interface SubscribeOpts {
  /** Forwarded to the host as `RpcSubscribe.order`. Ignored for `event` channels. */
  order?: number;
}

interface ChannelState {
  /** Wire-level subscription id used in the `RpcSubscribe` envelope. */
  wireSubId: RpcRequestId;
  /** Local handler set, in registration order (a `Set` preserves insertion order). */
  handlers: Set<(payload: unknown) => unknown | Promise<unknown>>;
  kind: ExtensionPointKind;
  /** True once a `hook:${channel}` reverse handler has been registered. */
  hookRegistered: boolean;
}

/**
 * A channel not in `EXTENSION_POINT_KINDS` is an `ext.<id>.*` scoped channel
 * (P1.8's `events.publish`), which is always `event`-kind by construction -
 * fire-and-forget, no cancel, no collect.
 */
function kindOf(channel: string): ExtensionPointKind {
  return (
    (EXTENSION_POINT_KINDS as Record<string, ExtensionPointKind | undefined>)[channel] ?? 'event'
  );
}

function isCancelable(channel: string): boolean {
  return (EXTENSION_POINT_CANCELABLE as ReadonlySet<string>).has(channel);
}

export class ExtensionEventEmitter {
  private readonly channels = new Map<string, ChannelState>();
  private nextSubId = 1;
  private readonly onHandlerError: ((channel: string, err: unknown) => void) | undefined;
  private readonly endpoints: IHookEndpointTable | undefined;

  constructor(
    private readonly channel: IRpcChannel,
    /**
     * Called when a subscriber throws or rejects. Under Node this was left to
     * `process.on('unhandledRejection')` in the error boundary, but the guest
     * realm has no such hook - without this the error would vanish entirely.
     */
    onHandlerError?: (channel: string, err: unknown) => void,
    /**
     * Reverse-RPC registration, for `filter`/`provider` channels. Omitted
     * only by tests that never exercise one - those channels then behave as
     * "subscribed, but always fails open" (the host's reverse request to a
     * worker with no `hook:` handler registered comes back
     * `Unknown reverse RPC method`, which the dispatcher treats as a throw:
     * skipped, never as a veto - see `dispatchExtensionPoint`'s "fail open"
     * rule).
     */
    endpoints?: IHookEndpointTable,
  ) {
    this.onHandlerError = onHandlerError;
    this.endpoints = endpoints;
  }

  /**
   * Subscribe to a channel. Returns a `DisposableHandle` that detaches the
   * handler and (if it was the last one) tells the host to stop fanning out
   * / unregisters the `hook:` reverse handler.
   */
  async subscribe<T>(
    channelName: string,
    handler: (payload: T) => unknown | Promise<unknown>,
    opts?: SubscribeOpts,
  ): Promise<DisposableHandle> {
    const wrapped = handler as (payload: unknown) => unknown | Promise<unknown>;
    let state = this.channels.get(channelName);
    if (!state) {
      const wireSubId: RpcRequestId = `sub-${this.nextSubId++}`;
      const kind = kindOf(channelName);
      state = { wireSubId, handlers: new Set(), kind, hookRegistered: false };
      this.channels.set(channelName, state);
      try {
        sendSubscribe(this.channel, wireSubId, channelName, opts?.order);
      } catch {
        this.channels.delete(channelName);
        throw new Error(`failed to subscribe to ${channelName}`);
      }
      if (kind !== 'event') {
        this.registerHook(channelName, state);
      }
    }
    state.handlers.add(wrapped);

    const channelRef = state;
    return makeDisposableHandle(() => {
      channelRef.handlers.delete(wrapped);
      if (channelRef.handlers.size === 0) {
        this.channels.delete(channelName);
        if (channelRef.hookRegistered) {
          this.endpoints?.unregister(`hook:${channelName}`);
        }
        try {
          sendUnsubscribe(this.channel, channelRef.wireSubId);
        } catch {
          /* host already gone - nothing to do */
        }
      }
    });
  }

  private registerHook(channelName: string, state: ChannelState): void {
    if (!this.endpoints) return;
    state.hookRegistered = true;
    this.endpoints.register(`hook:${channelName}`, (args: unknown[]) =>
      this.runLocalHook(channelName, state, args[0]),
    );
  }

  /**
   * Answer one `hook:${channelName}` reverse request by running every local
   * handler for that channel and combining their results per §3.4's rules.
   */
  private async runLocalHook(
    channelName: string,
    state: ChannelState,
    payload: unknown,
  ): Promise<unknown> {
    const handlers = [...state.handlers];

    if (state.kind === 'provider') {
      const results = await Promise.all(
        handlers.map(async (h) => {
          try {
            return await h(payload);
          } catch (err) {
            this.reportHandlerError(channelName, err);
            return undefined;
          }
        }),
      );
      const out: unknown[] = [];
      for (const r of results) {
        if (Array.isArray(r)) out.push(...r);
      }
      return out;
    }

    // filter: sequential waterfall, in registration order.
    const cancelable = isCancelable(channelName);
    let current = payload;
    for (const h of handlers) {
      let result: unknown;
      try {
        result = await h(current);
      } catch (err) {
        this.reportHandlerError(channelName, err);
        continue; // fail open - a throwing local handler is skipped
      }
      if (cancelable) {
        if (result === 'cancel') return 'cancel';
        continue;
      }
      if (result !== undefined) current = result;
    }
    return cancelable ? 'continue' : current;
  }

  /**
   * Dispatch an `RpcEvent` envelope to local handlers. Called by the runtime.
   * `event`-kind channels only - `filter`/`provider` channels never arrive
   * this way, they arrive as a reverse `request` the runtime routes to the
   * `hook:` handler registered above.
   */
  dispatch(event: RpcEvent): void {
    const state = this.channels.get(event.channel);
    if (!state) return;
    for (const handler of state.handlers) {
      try {
        const out = handler(event.payload);
        // We don't await - handlers run independently. An error in one
        // handler must not block the others or crash the worker.
        if (out && typeof (out as Promise<void>).then === 'function') {
          (out as Promise<void>).catch((err: unknown) => {
            this.reportHandlerError(event.channel, err);
          });
        }
      } catch (err) {
        this.reportHandlerError(event.channel, err);
      }
    }
  }

  private reportHandlerError(channelName: string, err: unknown): void {
    try {
      this.onHandlerError?.(channelName, err);
    } catch {
      /* a reporter that throws must not take down the dispatch loop */
    }
  }

  /** Drop every subscription. Called from `runtime.dispose()`. */
  clear(): void {
    for (const [channelName, state] of this.channels) {
      if (state.hookRegistered) {
        this.endpoints?.unregister(`hook:${channelName}`);
      }
      try {
        sendUnsubscribe(this.channel, state.wireSubId);
      } catch {
        /* ignore */
      }
    }
    this.channels.clear();
  }
}
