/**
 * Host side of the extension-panel iframe RPC channel.
 *
 * The iframe runs `@bible/extension-ui`, whose `RpcClient` posts `RpcRequest`
 * envelopes to `window.parent`. A host (the desktop renderer today, the web app
 * later) creates one `IframeRpcBridge` per mounted panel iframe. The bridge:
 *
 *   1. listens for `message` events on the host window;
 *   2. accepts only messages whose `source` is the panel's own iframe window
 *      (identity check; the sandbox has no `allow-same-origin`, so
 *      `event.origin` is the string "null" and is deliberately not compared);
 *   3. validates the envelope, resolves the host-assembled {@link BridgeContext},
 *      runs the built-in `uikit.*` allowlist check and the optional
 *      `authorize` hook, and only then dispatches to the host's handler map;
 *   4. posts `RpcResponse` back to the same window, and `RpcEvent`s on demand.
 *
 * Identity (`extensionId`, `panelId`, manifest, grants) comes from the host's
 * mount props via `context`, never from the request. Handlers receive it as
 * their second argument.
 *
 * Core has no DOM lib, so the window/event shapes are structural interfaces.
 * Pure and platform-free: safe in `@bible/core/browser`.
 */

import type { ExtensionManifest } from './ExtensionManifest';
import type { ExtensionPermission } from './Permissions';
import { ExtensionApiError, PermissionDeniedError } from './ExtensionApiErrors';
import { isRpcEnvelope, type RpcEvent, type RpcResponse } from './RpcEnvelope';
import {
  UI_KIT_COMPONENTS,
  UI_KIT_METHOD_PREFIX,
  isUiKitMethodAllowed,
  type UiKitComponentSpec,
} from './UiKit';

// --- Structural host types (no DOM lib in core) ----------------------------

/** The panel iframe's `contentWindow`. */
export interface BridgePostTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}

/** The subset of `MessageEvent` the bridge reads. */
export interface BridgeMessageEvent {
  data: unknown;
  source: unknown;
}

/** The host window (`window` on desktop). */
export interface BridgeEventSource {
  addEventListener(type: 'message', listener: (e: BridgeMessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (e: BridgeMessageEvent) => void): void;
}

// --- Context, handlers, options --------------------------------------------

/** Who the host believes this iframe to be. Host-assembled, NEVER from the iframe. */
export interface BridgeContext {
  readonly extensionId: string;
  /** Optional: panels mounted without identity cannot `panel.invoke`. */
  readonly panelId?: string;
  readonly panelTypeId?: string;
  /** `null`/`undefined` means no UI kit is allowed. */
  readonly manifest?: Pick<ExtensionManifest, 'uiKit'> | null;
  /** Permissions granted to the extension; `[]` when unknown. */
  readonly grants: readonly ExtensionPermission[];
}

export type BridgeHandler = (
  args: readonly unknown[],
  ctx: BridgeContext,
) => unknown | Promise<unknown>;

export type BridgeHandlers = Readonly<Record<string, BridgeHandler>>;

export type AuthorizeResult = { ok: true } | { ok: false; reason: string };

export interface IframeRpcBridgeOptions {
  /** A getter is allowed: grants/manifest may arrive asynchronously. Read once per request. */
  context: BridgeContext | (() => BridgeContext);
  handlers: BridgeHandlers;
  /** Where `message` events arrive (desktop: `window`). */
  hostWindow: BridgeEventSource;
  /**
   * The panel iframe's window, read lazily at message and send time (the iframe
   * may mount after the bridge attaches). Desktop: `() => iframeRef.current?.contentWindow`.
   */
  getTarget: () => (BridgePostTarget & object) | null | undefined;
  /** Extra host policy; runs AFTER the built-in `uikit.*` check. */
  authorize?: (method: string, ctx: BridgeContext) => AuthorizeResult;
  /** Optional logging hook for handler failures (denials included). */
  onError?: (err: unknown, method: string) => void;
}

// --- Authorization ----------------------------------------------------------

/**
 * Built-in, deny-by-default gate for `uikit.*` methods: allowed only when the
 * manifest's `uiKit` declares a component (of a known version) that lists the
 * method in `hostMethods` and whose `requiresPermissions` are all granted.
 * A registered handler does not make a method allowed. Every non-`uikit.*`
 * method passes here (those keep their own checks).
 */
export function authorizeBridgeMethod(
  method: string,
  ctx: BridgeContext,
  specs: Readonly<Record<string, readonly UiKitComponentSpec[]>> = UI_KIT_COMPONENTS,
): AuthorizeResult {
  if (!method.startsWith(UI_KIT_METHOD_PREFIX)) return { ok: true };
  if (isUiKitMethodAllowed(ctx.manifest?.uiKit, method, ctx.grants, specs)) return { ok: true };
  return { ok: false, reason: `UI kit method "${method}" is not allowed for this extension` };
}

// --- Bridge -----------------------------------------------------------------

const hasOwn = (obj: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

export class IframeRpcBridge {
  private readonly opts: IframeRpcBridgeOptions;
  private attached = false;
  private disposed = false;

  constructor(opts: IframeRpcBridgeOptions) {
    this.opts = opts;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Idempotent. Adds exactly one `message` listener. */
  attach(): void {
    if (this.disposed || this.attached) return;
    this.attached = true;
    this.opts.hostWindow.addEventListener('message', this.onMessage);
  }

  /** Idempotent. Removes the listener; replies still in flight are dropped. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; // first, so a re-entrant call from a handler sees it
    if (this.attached) {
      this.attached = false;
      this.opts.hostWindow.removeEventListener('message', this.onMessage);
    }
  }

  /** Push an `RpcEvent` to the panel. No-op when disposed or the iframe is gone. */
  emit(channel: string, payload: unknown): void {
    const event: RpcEvent = { kind: 'event', channel, payload };
    this.send(event);
  }

  // A single bound arrow field so `removeEventListener` matches `addEventListener`.
  private readonly onMessage = (e: BridgeMessageEvent): void => {
    if (this.disposed) return;
    // The sandbox has no allow-same-origin, so event.origin is "null" and
    // cannot be checked; identify the sender by window identity instead.
    const target = this.opts.getTarget();
    if (e.source == null || e.source !== target) return;

    const data = e.data;
    if (!isRpcEnvelope(data) || data.kind !== 'request') return;
    const { id, method, args } = data as { id: unknown; method: unknown; args: unknown };
    if (typeof id !== 'string') return; // cannot correlate a reply
    if (typeof method !== 'string' || !Array.isArray(args)) {
      this.send({ kind: 'response', id, error: { code: 'BridgeError', message: 'Malformed request' } });
      return;
    }

    this.dispatch(method, args).then(
      (result) => {
        if (this.disposed) return;
        this.send({ kind: 'response', id, result });
      },
      (err: unknown) => {
        this.opts.onError?.(err, method);
        if (this.disposed) return;
        const code = err instanceof ExtensionApiError ? err.code : 'BridgeError';
        const message = err instanceof Error ? err.message : String(err);
        this.send({ kind: 'response', id, error: { code, message } });
      },
    );
  };

  /** Async so a synchronous throw anywhere below becomes an error response. */
  private async dispatch(method: string, args: readonly unknown[]): Promise<unknown> {
    const { context, handlers, authorize } = this.opts;
    const ctx = typeof context === 'function' ? context() : context;

    let verdict = authorizeBridgeMethod(method, ctx);
    if (verdict.ok && authorize) verdict = authorize(method, ctx);
    if (!verdict.ok) throw new PermissionDeniedError(verdict.reason);

    if (!hasOwn(handlers, method)) {
      throw new Error(`Unknown iframe bridge method: ${method}`);
    }
    return handlers[method](args, ctx);
  }

  private send(envelope: RpcResponse | RpcEvent): void {
    if (this.disposed) return;
    const target = this.opts.getTarget();
    if (!target) return;
    // '*' is required: the sandboxed iframe's origin is opaque. It is safe
    // because the target is the specific iframe window, never a broadcast.
    target.postMessage(envelope, '*');
  }
}
