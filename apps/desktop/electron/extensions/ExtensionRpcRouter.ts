/**
 * Host-side RPC router.
 *
 * One router instance is created per active extension worker. The router:
 *
 *   - validates every envelope arriving from the worker via `isRpcEnvelope`,
 *     dropping malformed messages with a structured `RpcProtocolError`;
 *   - dispatches `RpcRequest` envelopes to a registered method handler table
 *     (`bible.getVerse`, `storage.set`, ...), wrapping the result or error in
 *     an `RpcResponse`;
 *   - tracks active subscriptions raised via `RpcSubscribe`, so the host can
 *     fan extension-point fires only at workers that asked to listen, and
 *     drops the subscription on `RpcUnsubscribe` or worker exit;
 *   - lets the host send forward events via `emitEvent(channel, payload)`,
 *     which writes an `RpcEvent` envelope to the transport iff the worker
 *     has at least one subscription on that channel;
 *   - lets the host issue *reverse* requests via `request(method, args)` -
 *     used to invoke command handlers and provider endpoints
 *     registered by the extension. Reverse requests resolve when the worker
 *     replies with a matching `RpcResponse`, or reject on
 *     `RpcTimeoutError` / `RpcCancelledError`.
 *
 * The router is intentionally transport-agnostic - it talks to whatever
 * `IRpcTransport` it is constructed with. Production code passes a transport
 * backed by Electron's `utilityProcess` MessagePort; tests pass an in-memory
 * pair so the routing logic can be exercised without spawning a real worker.
 */

import { Extensions } from '@bible/core';

type RpcEnvelope = Extensions.RpcEnvelope;
type RpcEvent = Extensions.RpcEvent;
type RpcRequest = Extensions.RpcRequest;
type RpcRequestId = Extensions.RpcRequestId;
type RpcResponse = Extensions.RpcResponse;
type RpcSubscribe = Extensions.RpcSubscribe;
type RpcUnsubscribe = Extensions.RpcUnsubscribe;

const { ExtensionApiError, RpcCancelledError, RpcProtocolError, RpcTimeoutError } = Extensions;

// Value import for `serializeError`'s reserved-method branch below. No runtime
// cycle: ExtensionHostTypes.ts imports this module with `import type` only.
import { MethodNotImplementedYet } from './ExtensionHostTypes';

/** Minimal transport contract the router needs. */
export interface IRpcTransport {
  send(envelope: RpcEnvelope): void;
  onMessage(handler: (envelope: unknown) => void): void;
  /** Tear down the transport. Idempotent. */
  close(): void;
}

/** Function the router invokes when an `RpcRequest` arrives from the worker. */
export type RpcMethodHandler = (args: unknown[]) => unknown | Promise<unknown>;

/**
 * Reasons the router emits a structured protocol error. The corresponding
 * error code is logged so the desktop UI can surface it under the extension's
 * crash panel.
 */
export interface RpcProtocolViolation {
  reason: 'malformed-envelope' | 'unknown-kind' | 'unknown-method' | 'duplicate-subscription';
  detail?: unknown;
}

/**
 * Reserved channel prefix for worker->host diagnostic events. Everything else
 * is still host->worker only; see `handleRaw`'s `event` case.
 */
export const RUNTIME_EVENT_CHANNEL_PREFIX = '__runtime.';

/** Channel the worker's error boundary reports uncaught errors/rejections on. */
export const RUNTIME_ERROR_CHANNEL = '__runtime.error';

/**
 * Channel the realm supervisor forwards the extension's `console.*` calls on.
 * The guest has no stdio of its own, so this is the extension's only route to
 * `extension.log`.
 */
export const RUNTIME_LOG_CHANNEL = '__runtime.log';

/** Optional hooks to observe traffic - used by ExtensionHost for logging + crash diagnostics. */
export interface ExtensionRpcRouterCallbacks {
  /** Called immediately before every method handler runs. Used to record `lastRpcMethod` for crash logs. */
  onRequestDispatch?: (method: string) => void;
  /**
   * Called for a worker->host event on a reserved `__runtime.*` channel - in
   * practice `__runtime.error`, which the worker's `ExtensionErrorBoundary`
   * uses to report uncaught exceptions and unhandled rejections. Without a
   * consumer these are dropped as `unknown-kind` violations and extension
   * authors get no diagnostics at all.
   */
  onRuntimeEvent?: (channel: string, payload: unknown) => void;
  /** Called whenever an envelope fails validation or routing. */
  onProtocolViolation?: (violation: RpcProtocolViolation) => void;
  /** Called when a reverse RPC request times out. */
  onTimeout?: (method: string, timeoutMs: number) => void;
  /** Called when a reverse RPC request receives a response (success or error). */
  onResponseReceived?: (method: string) => void;
}

interface PendingReverseRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  method: string;
}

export class ExtensionRpcRouter {
  private readonly methods = new Map<string, RpcMethodHandler>();
  private readonly subscriptions = new Map<string, Set<RpcRequestId>>();
  private readonly subscriptionChannels = new Map<RpcRequestId, string>();
  private readonly pending = new Map<RpcRequestId, PendingReverseRequest>();
  private nextReverseId = 1;
  private closed = false;

  constructor(
    private readonly transport: IRpcTransport,
    private readonly callbacks: ExtensionRpcRouterCallbacks = {},
  ) {
    this.transport.onMessage((raw) => {
      void this.handleRaw(raw);
    });
  }

  // --- Method handler registration ----------------------------------------

  /** Register a method handler the worker may call via `RpcRequest`. */
  registerMethod(method: string, handler: RpcMethodHandler): void {
    this.methods.set(method, handler);
  }

  /** Bulk-register a namespace's worth of methods at once. */
  registerNamespace(namespace: string, methods: Record<string, RpcMethodHandler>): void {
    for (const [name, handler] of Object.entries(methods)) {
      this.methods.set(`${namespace}.${name}`, handler);
    }
  }

  // --- Forward events (host -> worker) ------------------------------------

  /**
   * Push an event to the worker iff it has at least one subscription on the
   * channel. Channels with no subscribers are no-ops, so the host can fire
   * extension-point events freely without checking who's listening.
   */
  emitEvent(channel: string, payload: unknown): void {
    if (this.closed) return;
    const subs = this.subscriptions.get(channel);
    if (!subs || subs.size === 0) return;
    const env: RpcEvent = { kind: 'event', channel, payload };
    this.transport.send(env);
  }

  private readonly subscribeListeners = new Map<string, Set<() => void>>();

  /**
   * Run `listener` each time the worker subscribes to `channel`. For
   * state-like channels (the active verse) whose current value a new
   * subscriber needs at once rather than at the next change. Returns a
   * disposer.
   */
  onSubscribe(channel: string, listener: () => void): () => void {
    let set = this.subscribeListeners.get(channel);
    if (!set) {
      set = new Set();
      this.subscribeListeners.set(channel, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  /** True iff the worker is currently listening to the given channel. */
  hasSubscription(channel: string): boolean {
    const subs = this.subscriptions.get(channel);
    return !!subs && subs.size > 0;
  }

  // --- Reverse RPC (host -> worker) ---------------------------------------

  /**
   * Send an `RpcRequest` envelope to the worker and resolve when the worker
   * responds. Used to invoke command handlers and provider endpoints, and
   * by tests.
   */
  request<T = unknown>(method: string, args: unknown[], opts: { timeoutMs?: number } = {}): Promise<T> {
    if (this.closed) {
      return Promise.reject(new RpcCancelledError(`router closed before request ${method}`));
    }
    const id: RpcRequestId = `host-${this.nextReverseId++}`;
    return new Promise<T>((resolve, reject) => {
      const pending: PendingReverseRequest = {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      const timeoutMs = opts.timeoutMs ?? 5000;
      if (timeoutMs > 0) {
        pending.timer = setTimeout(() => {
          this.pending.delete(id);
          this.callbacks.onTimeout?.(method, timeoutMs);
          reject(new RpcTimeoutError(`reverse RPC ${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }
      this.pending.set(id, pending);
      const env: RpcRequest = { kind: 'request', id, method, args };
      try {
        this.transport.send(env);
      } catch (err) {
        this.pending.delete(id);
        if (pending.timer) clearTimeout(pending.timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // --- Lifecycle ----------------------------------------------------------

  /**
   * Drop all subscriptions, cancel pending reverse requests, and close the
   * transport. After `close()`, no envelopes are sent or accepted. Idempotent.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [id, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new RpcCancelledError(`router closed during ${pending.method}`));
      this.pending.delete(id);
    }
    this.subscriptions.clear();
    this.subscriptionChannels.clear();
    try {
      this.transport.close();
    } catch {
      /* ignore */
    }
  }

  // --- Private - incoming envelope handling -------------------------------

  private async handleRaw(raw: unknown): Promise<void> {
    if (this.closed) return;
    if (!Extensions.isRpcEnvelope(raw)) {
      this.notifyViolation({ reason: 'malformed-envelope', detail: raw });
      return;
    }
    const env: RpcEnvelope = raw;
    switch (env.kind) {
      case 'request':
        await this.handleRequest(env);
        return;
      case 'response':
        this.handleResponse(env);
        return;
      case 'subscribe':
        this.handleSubscribe(env);
        return;
      case 'unsubscribe':
        this.handleUnsubscribe(env);
        return;
      case 'event':
        // Application events are host->worker only in v1. The one exception is
        // the reserved `__runtime.*` namespace, which the worker's error
        // boundary uses to report uncaught errors - those must reach the host
        // or extension authors debug blind. Anything else is still a bug and
        // still drops with a violation.
        if (env.channel.startsWith(RUNTIME_EVENT_CHANNEL_PREFIX)) {
          this.handleRuntimeEvent(env);
          return;
        }
        this.notifyViolation({ reason: 'unknown-kind', detail: 'event from worker' });
        return;
      case 'heartbeat':
        // Workers reply to host heartbeats by echoing the same envelope. The
        // worker process wrapper consumes those at a higher level - by the
        // time the router sees one in `handleRaw`, the wrapper has already
        // accounted for it. Nothing to do here.
        return;
    }
  }

  private async handleRequest(req: RpcRequest): Promise<void> {
    const handler = this.methods.get(req.method);
    if (!handler) {
      this.notifyViolation({ reason: 'unknown-method', detail: req.method });
      this.sendResponse({
        kind: 'response',
        id: req.id,
        error: {
          code: 'RpcProtocolError',
          message: `Unknown RPC method: ${req.method}`,
        },
      });
      return;
    }
    this.callbacks.onRequestDispatch?.(req.method);
    try {
      const result = await handler(req.args);
      this.sendResponse({ kind: 'response', id: req.id, result });
    } catch (err) {
      this.sendResponse({
        kind: 'response',
        id: req.id,
        error: serializeError(err),
      });
    }
  }

  private handleRuntimeEvent(env: RpcEvent): void {
    const handler = this.callbacks.onRuntimeEvent;
    if (!handler) {
      // No consumer wired (older embedding / a test router). Surface it the
      // old way rather than silently swallowing.
      this.notifyViolation({ reason: 'unknown-kind', detail: `unhandled runtime event ${env.channel}` });
      return;
    }
    try {
      handler(env.channel, env.payload);
    } catch {
      /* swallow callback errors - a broken logger must not kill the router */
    }
  }

  private handleResponse(res: RpcResponse): void {
    const pending = this.pending.get(res.id);
    if (!pending) {
      // Late response after timeout/cancel - drop quietly. (A protocol
      // violation here would be too noisy: timeouts are normal.)
      return;
    }
    this.pending.delete(res.id);
    if (pending.timer) clearTimeout(pending.timer);
    this.callbacks.onResponseReceived?.(pending.method);
    if (res.error) {
      pending.reject(reviveOrWrap(res.error));
    } else {
      pending.resolve(res.result);
    }
  }

  private handleSubscribe(sub: RpcSubscribe): void {
    if (this.subscriptionChannels.has(sub.id)) {
      this.notifyViolation({ reason: 'duplicate-subscription', detail: sub.id });
      return;
    }
    let set = this.subscriptions.get(sub.channel);
    if (!set) {
      set = new Set<RpcRequestId>();
      this.subscriptions.set(sub.channel, set);
    }
    set.add(sub.id);
    this.subscriptionChannels.set(sub.id, sub.channel);
    // After the subscription is recorded, so a listener's `emitEvent` reaches
    // the worker that just asked.
    for (const listener of this.subscribeListeners.get(sub.channel) ?? []) {
      try {
        listener();
      } catch {
        /* a listener's failure must not break subscription bookkeeping */
      }
    }
  }

  private handleUnsubscribe(unsub: RpcUnsubscribe): void {
    const channel = this.subscriptionChannels.get(unsub.id);
    if (!channel) return;
    this.subscriptionChannels.delete(unsub.id);
    const set = this.subscriptions.get(channel);
    if (!set) return;
    set.delete(unsub.id);
    if (set.size === 0) this.subscriptions.delete(channel);
  }

  private sendResponse(res: RpcResponse): void {
    if (this.closed) return;
    try {
      this.transport.send(res);
    } catch {
      /* transport gone - wrapper already noticed */
    }
  }

  private notifyViolation(violation: RpcProtocolViolation): void {
    try {
      this.callbacks.onProtocolViolation?.(violation);
    } catch {
      /* swallow callback errors */
    }
  }
}

// --- Helpers --------------------------------------------------------------

function serializeError(err: unknown): { code: string; message: string; data?: unknown } {
  if (err instanceof ExtensionApiError) {
    return err.data !== undefined
      ? { code: err.code, message: err.message, data: err.data }
      : { code: err.code, message: err.message };
  }
  // `MethodNotImplementedYet` is deliberately NOT an `ExtensionApiError`: its
  // code is a host-internal "declared but not built yet" marker and does not
  // belong in the closed `ExtensionApiErrorCode` union that forms the extension
  // API's stable error contract. It still has to survive the wire, though -
  // without this branch it fell into the `Error` case below and arrived as the
  // opaque `{ code: 'Error' }`, which is exactly the "no usable signal" outcome
  // the stable code exists to prevent. The worker's `reviveExtensionApiError`
  // has no constructor for the code and wraps it in the base `ExtensionApiError`
  // with the code preserved, so `catch (e) { e.code === 'MethodNotImplementedYet' }`
  // works in extension code.
  //
  // Matched by class, not by sniffing `err.code`: a blanket "any Error with a
  // string code" rule would also push Node and SQLite codes (ENOENT,
  // SQLITE_BUSY) at extensions as though they were API contract.
  if (err instanceof MethodNotImplementedYet) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof Error) {
    return { code: 'Error', message: err.message };
  }
  return { code: 'Error', message: String(err) };
}

function reviveOrWrap(payload: { code: string; message: string; data?: unknown }): Error {
  // We deliberately don't import the full constructor map here because the
  // host already knows the error codes - we want to throw the same shape
  // back into pending.reject without dragging in the worker-side proxy.
  if (payload.code === 'RpcTimeoutError') return new RpcTimeoutError(payload.message, payload.data);
  if (payload.code === 'RpcCancelledError') return new RpcCancelledError(payload.message, payload.data);
  if (payload.code === 'RpcProtocolError') return new RpcProtocolError(payload.message, payload.data);
  return new ExtensionApiError(payload.code as never, payload.message, payload.data);
}
