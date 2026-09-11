/**
 * Host-side implementation of `IPanelsApi` for one extension worker.
 *
 * This is the host half of the panel-to-worker channel. Its job is small and
 * the shape of it is the point:
 *
 *   - `panels.setMessageHandler(bool)` — the worker tells the host whether
 *     `api.panels.onMessage(...)` has been called. Nothing is enforced by it;
 *     it exists so a message arriving at a panel-less extension fails with
 *     "this extension has no panel message handler" instead of the bare
 *     `Unknown reverse RPC method` the router would otherwise produce.
 *
 *   - `panels.postMessage(message, opts)` — worker to panel, no reply. Goes
 *     out through the UI bridge as a renderer notification.
 *
 *   - `deliver(message, sender)` — *not* an RPC method. The host calls this
 *     when a panel iframe posts a message, and it reverse-RPCs into the
 *     worker's bound `panels.onMessage` endpoint.
 *
 * **Why an opaque channel rather than exposing `api.*` to the iframe.**
 * Handing the renderer a permission-gated slice of the API surface would mean
 * enforcing permissions in two places, and the second place would be the
 * renderer — the least appropriate host for that decision. Here the panel
 * posts an opaque payload, the extension's own worker receives it, and any
 * `api.*` call it then makes runs through `ExtensionPermissionGuard` exactly
 * as it always did. The extension author decides what its panel may ask for.
 *
 * **The security property to preserve:** `sender.extensionId` is resolved by
 * the host from the closure that mounted the iframe. It never comes from the
 * message payload, so a panel cannot name another extension and spend its
 * grants. `RpcFuzzing.test.ts` and `PanelChannel.test.ts` both assert this.
 *
 * No permission gates this namespace. A panel talking to its own worker is not
 * a capability — the capabilities are whatever the worker does in response,
 * and those are gated where they always were.
 */

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import type { IExtensionUiBridge } from './IExtensionDataBridges';

const { ExtensionNotActiveError, RpcProtocolError } = Extensions;

type PanelMessageSender = Extensions.PanelMessageSender;

/**
 * Endpoint the worker binds through `api.panels.onMessage`. Must match
 * `PANEL_MESSAGE_ENDPOINT` in `extension-runtime/apiProxy.ts`; the two are
 * pinned together by `PanelChannel.test.ts`.
 */
export const PANEL_MESSAGE_ENDPOINT = 'panels.onMessage';

/**
 * How long a panel will wait for its worker to answer.
 *
 * Matches the command-handler budget. The worker is a QuickJS realm doing
 * storage and API calls, so 10s is generous for anything a panel should be
 * asking synchronously, and short enough that a wedged worker does not leave
 * the panel spinning forever.
 */
export const PANEL_MESSAGE_TIMEOUT_MS = 10_000;

/**
 * Largest panel message accepted, in bytes of JSON.
 *
 * The worker is a QuickJS-in-WASM realm with a bounded heap. A panel that can
 * post unbounded payloads into it at will is a denial-of-service surface
 * against the extension host, so both directions are capped. 256 KB is far
 * above any plausible control message and far below anything that threatens
 * the realm; a panel needing to move more than this wants a database, not a
 * message.
 */
export const MAX_PANEL_MESSAGE_BYTES = 256 * 1024;

export interface PanelsApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  /** Optional: without it, `panels.postMessage` rejects rather than no-oping. */
  uiBridge?: IExtensionUiBridge;
}

/** Thrown when a message exceeds `MAX_PANEL_MESSAGE_BYTES`. */
export class PanelMessageTooLargeError extends Error {
  readonly code = 'PanelMessageTooLarge';
  constructor(bytes: number) {
    super(
      `Panel message is ${bytes} bytes, over the ${MAX_PANEL_MESSAGE_BYTES}-byte limit`,
    );
    this.name = 'PanelMessageTooLargeError';
  }
}

/**
 * Measure a message as the JSON the transport will carry, and refuse it if it
 * is over the cap.
 *
 * Serialising to measure is the honest way to do it: the payload crosses the
 * wire as JSON, so its JSON length is its real cost. A value that cannot be
 * serialised at all (a cycle, a function) is rejected here with a clear
 * message rather than failing opaquely deeper in the transport.
 */
export function assertPanelMessageWithinCap(message: unknown, label: string): void {
  let json: string;
  try {
    json = JSON.stringify(message ?? null);
  } catch (err) {
    throw new RpcProtocolError(
      `${label}: message is not serialisable (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  // `JSON.stringify` returns undefined for a bare function or symbol.
  if (json === undefined) {
    throw new RpcProtocolError(`${label}: message is not serialisable`);
  }
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > MAX_PANEL_MESSAGE_BYTES) {
    throw new PanelMessageTooLargeError(bytes);
  }
}

export class PanelsApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly uiBridge: IExtensionUiBridge | undefined;
  /** Set by the worker via `panels.setMessageHandler`. */
  private hasHandler = false;
  private disposed = false;

  constructor(opts: PanelsApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.uiBridge = opts.uiBridge;
  }

  attach(): void {
    this.router.registerNamespace('panels', {
      setMessageHandler: (args) => this.handleSetMessageHandler(args),
      postMessage: (args) => this.handlePostMessage(args),
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.hasHandler = false;
  }

  /** True once the worker has called `api.panels.onMessage(...)`. */
  hasMessageHandler(): boolean {
    return this.hasHandler;
  }

  // --- Host-called (not an RPC method) -----------------------------------

  /**
   * Deliver a panel iframe's message to the worker and resolve with whatever
   * the worker's handler returned.
   *
   * `sender` is built by the caller from trusted host state. Nothing in
   * `message` is inspected here beyond its size — interpreting it is the
   * extension's own business.
   */
  async deliver(message: unknown, sender: PanelMessageSender): Promise<unknown> {
    if (this.disposed) {
      throw new ExtensionNotActiveError('panelsApiImpl is disposed');
    }
    if (!this.hasHandler) {
      throw new RpcProtocolError(
        `Extension '${this.extensionId}' has no panel message handler — ` +
          'call api.panels.onMessage(handler) in activate() before the panel posts.',
      );
    }
    assertPanelMessageWithinCap(message, 'panels.deliver');
    return this.router.request(PANEL_MESSAGE_ENDPOINT, [message, sender], {
      timeoutMs: PANEL_MESSAGE_TIMEOUT_MS,
    });
  }

  // --- RPC handlers ------------------------------------------------------

  private async handleSetMessageHandler(args: unknown[]): Promise<void> {
    if (this.disposed) {
      throw new ExtensionNotActiveError('panelsApiImpl is disposed');
    }
    const on = args[0];
    if (typeof on !== 'boolean') {
      throw new RpcProtocolError('panels.setMessageHandler: expected a boolean');
    }
    this.hasHandler = on;
  }

  private async handlePostMessage(args: unknown[]): Promise<void> {
    if (this.disposed) {
      throw new ExtensionNotActiveError('panelsApiImpl is disposed');
    }
    const message = args[0];
    assertPanelMessageWithinCap(message, 'panels.postMessage');

    const opts = args[1];
    let panelId: string | undefined;
    if (opts !== undefined && opts !== null) {
      if (typeof opts !== 'object') {
        throw new RpcProtocolError('panels.postMessage: opts must be an object when provided');
      }
      const raw = (opts as { panelId?: unknown }).panelId;
      if (raw !== undefined) {
        if (typeof raw !== 'string' || raw.length === 0) {
          throw new RpcProtocolError(
            'panels.postMessage: opts.panelId must be a non-empty string when provided',
          );
        }
        panelId = raw;
      }
    }

    if (!this.uiBridge?.postPanelMessage) {
      throw new RpcProtocolError(
        'panels.postMessage: this host has no UI bridge, so no panel can receive it',
      );
    }
    this.uiBridge.postPanelMessage(this.extensionId, message, panelId);
  }
}
