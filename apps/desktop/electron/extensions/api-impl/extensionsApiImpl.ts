/**
 * Host-side implementation of `IExtensionsApi` for one extension worker.
 *
 *   - `call(extensionId, method, args)` - narrow worker A -> host -> worker B
 *     RPC mediator. Validates `method` against the callee's manifest
 *     `contributes.apiExports`. Default 10 s timeout, manifest override up
 *     to 60 s. Permission: `extensions:call`.
 *   - `isActive(extensionId)` - true if installed and active.
 *   - `listProviders()` - list extensions that export at least one API method.
 *   - `onDidActivate` / `onDidDeactivate` - events.
 *
 * The host mediates every cross-extension call so neither extension can crash
 * the other. Arguments and return values must be JSON-serializable.
 */

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import {
  type ExtensionPermissionGrant,
  requirePermission,
} from '../ExtensionPermissionGuard';

const {
  ExtensionNotActiveError,
  ApiExportNotFoundError,
  RpcProtocolError,
} = Extensions;

type ExtensionManifest = Extensions.ExtensionManifest;
type ExtensionProviderInfo = Extensions.ExtensionProviderInfo;
type ContributedApiExport = Extensions.ContributedApiExport;

// --- Default / max timeouts ------------------------------------------------

export const DEFAULT_CALL_TIMEOUT_MS = 10_000;
export const MAX_CALL_TIMEOUT_MS = 60_000;

// --- Host delegate --------------------------------------------------------

/**
 * Narrow interface the api-impl uses to interact with the ExtensionHost.
 * Keeps the api-impl decoupled from the full host (testable with fakes).
 */
export interface IExtensionsHostDelegate {
  /** Check if an extension's worker is currently active. */
  isActive(extensionId: string): boolean;
  /**
   * Activate an extension on demand (e.g. before an inter-extension call).
   * Throws if activation fails.
   */
  activate(extensionId: string): Promise<void>;
  /** Get the router for an active extension's worker. */
  getRouter(extensionId: string): ExtensionRpcRouter | undefined;
  /** Get the manifest for an installed extension. */
  getManifest(extensionId: string): ExtensionManifest | undefined;
  /**
   * List all installed extensions. Returns `{ id, manifest }` pairs for
   * every extension that has a manifest attached.
   */
  listInstalled(): { id: string; manifest: ExtensionManifest }[];
}

// --- Options ----------------------------------------------------------------

export interface ExtensionsApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  grant: ExtensionPermissionGrant;
  host: IExtensionsHostDelegate;
}

// --- Implementation ---------------------------------------------------------

export class ExtensionsApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly grant: ExtensionPermissionGrant;
  private readonly host: IExtensionsHostDelegate;
  private disposed = false;

  constructor(opts: ExtensionsApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.grant = opts.grant;
    this.host = opts.host;
  }

  attach(): void {
    this.router.registerNamespace('extensions', {
      call: (args) => this.handleCall(args),
      isActive: (args) => this.handleIsActive(args),
      listProviders: () => this.handleListProviders(),
    });
  }

  dispose(): void {
    this.disposed = true;
  }

  // --- Event emission (called from ExtensionHost) ---------------------

  /**
   * Push an `extensions.onDidActivate` event to the worker if it's
   * subscribed. Called by the host after any extension activates.
   */
  emitDidActivate(extensionId: string): void {
    if (this.disposed) return;
    this.router.emitEvent('extensions.onDidActivate', { extensionId });
  }

  /**
   * Push an `extensions.onDidDeactivate` event to the worker if it's
   * subscribed. Called by the host after any extension deactivates.
   */
  emitDidDeactivate(extensionId: string): void {
    if (this.disposed) return;
    this.router.emitEvent('extensions.onDidDeactivate', { extensionId });
  }

  // ---- Handlers --------------------------------------------------------

  private async handleCall(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'extensions:call');

    const targetExtId = args[0];
    const method = args[1];
    const callArgs = args[2];

    if (typeof targetExtId !== 'string' || targetExtId.length === 0) {
      throw new RpcProtocolError('extensions.call: extensionId must be a non-empty string');
    }
    if (typeof method !== 'string' || method.length === 0) {
      throw new RpcProtocolError('extensions.call: method must be a non-empty string');
    }
    if (callArgs !== undefined && !Array.isArray(callArgs)) {
      throw new RpcProtocolError('extensions.call: args must be an array when provided');
    }

    // Cannot call yourself.
    if (targetExtId === this.extensionId) {
      throw new RpcProtocolError('extensions.call: cannot call your own extension');
    }

    // Validate the callee's manifest declares this method in apiExports.
    const manifest = this.host.getManifest(targetExtId);
    if (!manifest) {
      throw new ExtensionNotActiveError(
        `Extension '${targetExtId}' is not installed.`,
      );
    }

    const apiExports: ContributedApiExport[] = manifest.contributes?.apiExports ?? [];
    const exportDef = apiExports.find((e) => e.method === method);
    if (!exportDef) {
      throw new ApiExportNotFoundError(
        `Extension '${targetExtId}' does not export method '${method}'.`,
        { extensionId: targetExtId, method },
      );
    }

    // Activate callee on demand if it isn't running yet.
    if (!this.host.isActive(targetExtId)) {
      await this.host.activate(targetExtId);
    }

    const targetRouter = this.host.getRouter(targetExtId);
    if (!targetRouter) {
      throw new ExtensionNotActiveError(
        `Extension '${targetExtId}' failed to activate for inter-extension call.`,
      );
    }

    // Issue reverse-RPC to the callee worker using the handler endpoint
    // declared in its manifest.
    const timeoutMs = Math.min(
      Math.max(DEFAULT_CALL_TIMEOUT_MS, 0),
      MAX_CALL_TIMEOUT_MS,
    );
    return targetRouter.request(exportDef.handlerEndpoint, callArgs ?? [], {
      timeoutMs,
    });
  }

  private async handleIsActive(args: unknown[]): Promise<boolean> {
    this.assertActive();
    const extensionId = args[0];
    if (typeof extensionId !== 'string' || extensionId.length === 0) {
      throw new RpcProtocolError('extensions.isActive: extensionId must be a non-empty string');
    }
    return this.host.isActive(extensionId);
  }

  private async handleListProviders(): Promise<ExtensionProviderInfo[]> {
    this.assertActive();
    const result: ExtensionProviderInfo[] = [];
    for (const { id, manifest } of this.host.listInstalled()) {
      const exports = manifest.contributes?.apiExports;
      if (!exports || exports.length === 0) continue;
      result.push({
        extensionId: id,
        displayName: manifest.displayName ?? manifest.id,
        exports: exports.map((e) => ({
          method: e.method,
          ...(e.description ? { description: e.description } : {}),
        })),
      });
    }
    return result;
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new ExtensionNotActiveError(`extensionsApiImpl for ${this.extensionId} is disposed`);
    }
  }
}
