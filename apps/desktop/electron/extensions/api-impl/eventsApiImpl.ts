/**
 * Host-side shim for `IEventsApi` for one extension worker.
 *
 * The actual subscription model
 * lives entirely on the worker side: the runtime's `apiProxy` special-cases
 * `api.events.subscribe(channel, handler)` and routes the call to the
 * worker's `ExtensionEventEmitter`, which in turn sends an `RpcSubscribe`
 * envelope to the host's router. The host fan-out happens via
 * `IExtensionHost.dispatchExtensionPoint(pointId, payload)`, which iterates
 * every active worker's router and calls `router.emitEvent(pointId, ...)`.
 *
 * This file exists so the api-impl wiring stays uniform across namespaces:
 * `ExtensionHost.activate()` builds an `EventsApiImpl` next to the others
 * and stores it on the `ActiveWorker` record. There are no host RPC methods
 * to register - calling `api.events.subscribe(...)` from the worker never
 * round-trips through `events.subscribe` on the wire - but the dispose
 * hook still gets called on deactivate so future host-side bookkeeping
 * (rate-limiting, audit logging, etc.) has a place to live.
 */

export interface EventsApiImplOptions {
  extensionId: string;
}

export class EventsApiImpl {
  private readonly extensionId: string;
  private disposed = false;

  constructor(opts: EventsApiImplOptions) {
    this.extensionId = opts.extensionId;
  }

  attach(): void {
    // Intentionally empty - see file header.
    // Touch the field so strict unused-locals checking doesn't trip.
    void this.extensionId;
  }

  dispose(): void {
    this.disposed = true;
  }

  isDisposed(): boolean {
    return this.disposed;
  }
}
