/**
 * Host-side implementation of `IEventsApi` for one extension worker.
 *
 * `subscribe(channel, handler, opts?)` never round-trips through here - the
 * worker-side `apiProxy`/`ExtensionEventEmitter` sends an `RpcSubscribe`
 * envelope straight to the router, and the host fan-out happens via
 * `dispatchExtensionPoint` (`ExtensionPointWiring.ts`), which iterates every
 * active worker's router and calls `router.emitEvent`/`router.request`
 * depending on the channel's kind. There is no host RPC method to register
 * for `subscribe` - see `eventsApiImpl.ts`'s old (pre task-0024-round-3)
 * header comment if reviewing history; that half of this file's job never
 * changed.
 *
 * `publish(channel, payload)` (P1.8) is different: it **is** a real RPC
 * method, because the worker cannot fan a payload out to other workers by
 * itself. `handlePublish` validates that `channel` starts with the caller's
 * own `ext.<id>.` namespace - the same structural rule
 * `commandsApiImpl.ts` already uses for command ids - then delegates to the
 * `publish` fan-out function `ExtensionHostRpc.attachApiImpls` supplies
 * (the one place that can see every other active worker's router). No
 * permission gate beyond owning the namespace, no wildcard subscriptions, no
 * replay, and the publisher never receives its own message - `publishFn`
 * loops every *other* active worker and calls `router.emitEvent`, which
 * already no-ops for a worker with no subscription on that exact channel
 * string. This keeps `Extensions/README.md`'s "no free-form pub/sub event
 * bus" prohibition intact: the namespace is owned, not free-form.
 */

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';

const { ExtensionNotActiveError, RpcProtocolError } = Extensions;

export interface EventsApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  /**
   * Fan `payload` out to every *other* active worker on `channel`. Supplied
   * by `ExtensionHostRpc.attachApiImpls`, which is the one place that can
   * see `ExtensionHostContext.activeWorkers` - this class deliberately does
   * not hold a reference to the whole host context, the same narrowing
   * `IExtensionsHostDelegate` applies to `extensionsApiImpl.ts`.
   */
  publish: (channel: string, payload: unknown) => void;
}

export class EventsApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly publishFn: (channel: string, payload: unknown) => void;
  private readonly ownChannelPrefix: string;
  private disposed = false;

  constructor(opts: EventsApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.publishFn = opts.publish;
    // Mirror `commandsApiImpl.ts`'s normalization: `extensionId` already
    // looks like `ext.<publisher>.<name>` in production, but a test may pass
    // a bare id.
    const owner = this.extensionId.startsWith('ext.')
      ? this.extensionId
      : `ext.${this.extensionId}`;
    this.ownChannelPrefix = `${owner}.`;
  }

  attach(): void {
    this.router.registerNamespace('events', {
      publish: (args) => this.handlePublish(args),
    });
  }

  dispose(): void {
    this.disposed = true;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  private async handlePublish(args: unknown[]): Promise<void> {
    if (this.disposed) {
      throw new ExtensionNotActiveError(`eventsApiImpl for ${this.extensionId} is disposed`);
    }
    const channel = args[0];
    if (typeof channel !== 'string' || channel.length === 0) {
      throw new RpcProtocolError('events.publish: channel must be a non-empty string');
    }
    if (!channel.startsWith(this.ownChannelPrefix)) {
      throw new RpcProtocolError(
        `events.publish: channel must start with '${this.ownChannelPrefix}' (got '${channel}')`,
      );
    }
    const payload = args[1];
    this.publishFn(channel, payload);
  }
}
