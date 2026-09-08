/**
 * Host-side implementation of `IContextApi` for one extension worker.
 *
 * Registers RPC method handlers under the `context.*` namespace on the
 * worker's `ExtensionRpcRouter`. The bridge enforces the
 * `ext.<extensionId>.*` write namespace:
 *
 *   - Reads (`context.get`) are unrestricted - extensions may observe
 *     built-in keys like `editorFocused` so they can react to UI state.
 *   - Writes (`context.set`) are limited to `ext.<extensionId>.*`. Attempts
 *     to write a built-in key or another extension's key throw
 *     `PermissionDeniedError`, which the worker re-raises through the
 *     api proxy.
 *
 * `IContextApi` also declares an `onDidChange` event. **It is not wired up
 * yet** - nothing calls `router.emitEvent` for it, so a subscriber never
 * fires. The channel the contract implies is `onDidChange` ->
 * `context.onDidChange`. That is asserted against the type declarations by
 * `ApiSurfaceContract.test.ts`, which lists this event in
 * `DECLARED_BUT_NOT_EMITTED`.
 *
 * Wiring it needs a subscription to `WhenContextService.onDidChange`, which
 * is why it is not simply a line in `attach()`: the long-lived
 * `IWhenContextService` is not part of the per-call bridge surface.
 */

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import type { IExtensionContextBridge } from './IExtensionRegistryBridges';

const { ExtensionNotActiveError, PermissionDeniedError, RpcProtocolError } = Extensions;

type WhenContextValue = Extensions.WhenContextValue;

export interface ContextApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  bridge: IExtensionContextBridge;
}

export class ContextApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly bridge: IExtensionContextBridge;
  private disposed = false;

  constructor(opts: ContextApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.bridge = opts.bridge;
  }

  attach(): void {
    this.router.registerNamespace('context', {
      get: (args) => this.handleGet(args),
      set: (args) => this.handleSet(args),
    });
  }

  /**
   * Drop every key written by this extension. Called from
   * `ExtensionHost.deactivate()` so an extension's `when` contributions
   * cannot keep clauses true after its worker is gone.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.bridge.disposeExtensionKeys(this.extensionId);
  }

  // --- RPC handlers ------------------------------------------------------

  private async handleGet(args: unknown[]): Promise<WhenContextValue | undefined> {
    if (this.disposed) {
      throw new ExtensionNotActiveError('contextApiImpl is disposed');
    }
    const key = args[0];
    if (typeof key !== 'string' || key.length === 0) {
      throw new RpcProtocolError('context.get: key must be a non-empty string');
    }
    return this.bridge.get(key);
  }

  private async handleSet(args: unknown[]): Promise<void> {
    if (this.disposed) {
      throw new ExtensionNotActiveError('contextApiImpl is disposed');
    }
    const key = args[0];
    const value = args[1];
    if (typeof key !== 'string' || key.length === 0) {
      throw new RpcProtocolError('context.set: key must be a non-empty string');
    }
    if (!isWhenContextValue(value)) {
      throw new RpcProtocolError('context.set: value must be string | number | boolean | null');
    }
    try {
      this.bridge.setForExtension(this.extensionId, key, value);
    } catch (err) {
      // `WhenContextNamespaceError` carries the wire-stable
      // `PermissionDeniedError` code already, but it's not an instance of
      // the api error class (it lives in the renderer's service layer).
      // Translate by name so the worker sees the same error code regardless
      // of which side throws.
      if (err instanceof Error && err.name === 'WhenContextNamespaceError') {
        throw new PermissionDeniedError(err.message);
      }
      throw err;
    }
  }
}

function isWhenContextValue(value: unknown): value is WhenContextValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}
