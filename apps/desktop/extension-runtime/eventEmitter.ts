/**
 * Worker-side event emitter, implementing `IEventApi<T>`.
 *
 * The proxy layer exposes `api.bible.onDidChangeActiveVerse.subscribe(handler)` style events;
 * this emitter implements the local fan-out and the bookkeeping that lets the
 * host stop sending events on a channel once the worker drops its last
 * subscription.
 *
 * Wire protocol:
 *
 *   1. First subscriber to a channel triggers an `RpcSubscribe` envelope so
 *      the host knows to start emitting `RpcEvent` envelopes on it.
 *   2. Subsequent subscribers are local-only - the host already knows.
 *   3. Last subscriber dropping triggers an `RpcUnsubscribe` so the host can
 *      stop firing events the worker isn't going to use.
 *
 * Events arriving while the channel has zero local subscribers are dropped
 * silently - that's a host bug we don't want to crash on.
 */

import type { Extensions } from '@bible/core';

type DisposableHandle = Extensions.DisposableHandle;
type RpcEvent = Extensions.RpcEvent;
type RpcRequestId = Extensions.RpcRequestId;

import { type IRpcChannel, makeDisposableHandle, sendSubscribe, sendUnsubscribe } from './apiProxy';

interface ChannelState {
  /** Wire-level subscription id used in the `RpcSubscribe` envelope. */
  wireSubId: RpcRequestId;
  /** Local handler set. */
  handlers: Set<(payload: unknown) => void | Promise<void>>;
}

export class ExtensionEventEmitter {
  private readonly channels = new Map<string, ChannelState>();
  private nextSubId = 1;
  private readonly onHandlerError: ((channel: string, err: unknown) => void) | undefined;

  constructor(
    private readonly channel: IRpcChannel,
    /**
     * Called when a subscriber throws or rejects. Under Node this was left to
     * `process.on('unhandledRejection')` in the error boundary, but the guest
     * realm has no such hook - without this the error would vanish entirely.
     */
    onHandlerError?: (channel: string, err: unknown) => void,
  ) {
    this.onHandlerError = onHandlerError;
  }

  /**
   * Subscribe to a channel. Returns a `DisposableHandle` that detaches the
   * handler and (if it was the last one) tells the host to stop fanning out.
   */
  async subscribe<T>(
    channelName: string,
    handler: (payload: T) => void | Promise<void>,
  ): Promise<DisposableHandle> {
    const wrapped = handler as (payload: unknown) => void | Promise<void>;
    let state = this.channels.get(channelName);
    if (!state) {
      const wireSubId: RpcRequestId = `sub-${this.nextSubId++}`;
      state = { wireSubId, handlers: new Set() };
      this.channels.set(channelName, state);
      try {
        sendSubscribe(this.channel, wireSubId, channelName);
      } catch {
        this.channels.delete(channelName);
        throw new Error(`failed to subscribe to ${channelName}`);
      }
    }
    state.handlers.add(wrapped);

    const channelRef = state;
    return makeDisposableHandle(() => {
      channelRef.handlers.delete(wrapped);
      if (channelRef.handlers.size === 0) {
        this.channels.delete(channelName);
        try {
          sendUnsubscribe(this.channel, channelRef.wireSubId);
        } catch {
          /* host already gone - nothing to do */
        }
      }
    });
  }

  /** Dispatch an `RpcEvent` envelope to local handlers. Called by the runtime. */
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
    for (const [, state] of this.channels) {
      try {
        sendUnsubscribe(this.channel, state.wireSubId);
      } catch {
        /* ignore */
      }
    }
    this.channels.clear();
  }
}
