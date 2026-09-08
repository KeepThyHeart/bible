/**
 * Host-side implementation of `ICommandsApi` for one extension worker.
 *
 * Registers RPC method handlers under the `commands.*` namespace on the
 * worker's `ExtensionRpcRouter`. Each call from the worker is mapped to:
 *
 *   - `commands.register(spec)` -> `IExtensionCommandBridge.register(...)`,
 *     where the bridge wires the renderer-side handler to a reverse RPC
 *     into the worker's `handlerEndpoint`. The host returns an opaque
 *     `disposalId` so the worker can later call `commands.dispose(id)`.
 *
 *   - `commands.execute(commandId, args)` -> `bridge.execute(...)`. Routes
 *     through the same registry built-in commands use, so an extension can
 *     fire a built-in command (e.g. `bible.openVerse`) the same way the
 *     menu does.
 *
 *   - `commands.dispose(disposalId)` -> removes a previously registered
 *     command. Idempotent.
 *
 * On extension deactivate, `dispose()` here is called by the host, which
 * tears down every per-extension registration in one shot via
 * `bridge.disposeByOwner()`.
 */

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import type {
  ExtensionCommandSpec,
  IExtensionCommandBridge,
} from './IExtensionRegistryBridges';

const {
  ExtensionApiError,
  ExtensionNotActiveError,
  PermissionDeniedError,
  RpcProtocolError,
} = Extensions;

type ExtensionCommandRegistration = Extensions.ExtensionCommandRegistration;

/**
 * Default per-handler timeout for the reverse RPC into the worker. The RPC
 * envelope leaves this open; 10 s is generous enough for command
 * handlers that do real work (filesystem, network) without letting a hung
 * worker wedge the menu indefinitely.
 */
const COMMAND_HANDLER_TIMEOUT_MS = 10_000;

export interface CommandsApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  bridge: IExtensionCommandBridge;
}

/**
 * One instance per active worker. Owns the disposal table for commands
 * registered by that worker so the host can clean them up on deactivate
 * even if the worker forgot to call `dispose()` itself.
 */
export class CommandsApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly bridge: IExtensionCommandBridge;
  private readonly disposers = new Map<string, () => void>();
  private nextDisposalId = 1;
  private disposed = false;

  constructor(opts: CommandsApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.bridge = opts.bridge;
  }

  /** Wire the namespace into a router. Call once at activation time. */
  attach(): void {
    this.router.registerNamespace('commands', {
      register: (args) => this.handleRegister(args),
      execute: (args) => this.handleExecute(args),
      dispose: (args) => this.handleDispose(args),
    });
  }

  /**
   * Tear down every command this worker registered. Called from
   * `ExtensionHost.deactivate()` after the worker has been told to stop but
   * before the registry row flips back to `installed`.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Use the bridge's bulk dispose so we catch any registrations the
    // disposer table missed (defense in depth - the table should be the
    // authoritative source).
    this.bridge.disposeByOwner(this.extensionId);
    this.disposers.clear();
  }

  // --- RPC handlers ------------------------------------------------------

  private async handleRegister(args: unknown[]): Promise<{ disposalId: string }> {
    if (this.disposed) {
      throw new ExtensionNotActiveError('commandsApiImpl is disposed');
    }
    const reg = args[0];
    if (!isExtensionCommandRegistration(reg)) {
      throw new RpcProtocolError(
        'commands.register: expected ExtensionCommandRegistration as first arg',
      );
    }
    const spec: ExtensionCommandSpec = {
      id: reg.id,
      ownerExtensionId: this.extensionId,
      title: reg.title,
      ...(reg.category !== undefined ? { category: reg.category } : {}),
      ...(reg.shortcut !== undefined ? { shortcut: reg.shortcut } : {}),
      ...(reg.when !== undefined ? { when: reg.when } : {}),
      ...(reg.order !== undefined ? { order: reg.order } : {}),
      ...(reg.hidden !== undefined ? { hidden: reg.hidden } : {}),
    };
    const handlerEndpoint = reg.handlerEndpoint;
    if (typeof handlerEndpoint !== 'string' || handlerEndpoint.length === 0) {
      throw new RpcProtocolError(
        'commands.register: handlerEndpoint must be a non-empty string',
      );
    }

    // Build the reverse-RPC closure. When the user invokes the command, the
    // renderer-side handler dispatches into this closure, which sends a
    // request to the worker.
    const invoke = (commandArgs: unknown): Promise<unknown> =>
      this.router.request(handlerEndpoint, [commandArgs], {
        timeoutMs: COMMAND_HANDLER_TIMEOUT_MS,
      });

    let disposer: () => void;
    try {
      disposer = this.bridge.register(spec, invoke);
    } catch (err) {
      // The renderer-side `register` enforces the prefix rule and the
      // duplicate-id rule. Surface the same error code over RPC so the
      // worker can differentiate.
      throw mapBridgeError(err);
    }

    const disposalId = `cmd-${this.nextDisposalId++}`;
    this.disposers.set(disposalId, disposer);
    return { disposalId };
  }

  private async handleExecute(args: unknown[]): Promise<unknown> {
    if (this.disposed) {
      throw new ExtensionNotActiveError('commandsApiImpl is disposed');
    }
    const commandId = args[0];
    if (typeof commandId !== 'string' || commandId.length === 0) {
      throw new RpcProtocolError('commands.execute: commandId must be a non-empty string');
    }
    return this.bridge.execute(commandId, args[1]);
  }

  private async handleDispose(args: unknown[]): Promise<void> {
    const disposalId = args[0];
    if (typeof disposalId !== 'string') return;
    const disposer = this.disposers.get(disposalId);
    if (!disposer) return;
    this.disposers.delete(disposalId);
    try {
      disposer();
    } catch {
      /* best-effort */
    }
  }
}

// --- Helpers --------------------------------------------------------------

function isExtensionCommandRegistration(value: unknown): value is ExtensionCommandRegistration {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.handlerEndpoint !== 'string' || v.handlerEndpoint.length === 0) return false;
  // `title` is allowed to be a string OR a `{ key, params? }` object.
  if (typeof v.title !== 'string' && (typeof v.title !== 'object' || v.title === null)) {
    return false;
  }
  return true;
}

function mapBridgeError(err: unknown): Error {
  if (err instanceof Error) {
    // The renderer's `ExtensionCommandPrefixError` and `DuplicateCommandError`
    // both extend `Error`. We forward the message verbatim and tag the
    // error with the closest matching extension api code so the worker can
    // catch it via the `ExtensionApiError` hierarchy.
    if (err.name === 'ExtensionCommandPrefixError') {
      return new PermissionDeniedError(err.message);
    }
    if (err.name === 'DuplicateCommandError') {
      // Duplicate id is closest to a permission/ownership conflict from the
      // worker's perspective - built-ins always win, so the ext call lost.
      return new PermissionDeniedError(err.message);
    }
    return err;
  }
  return new ExtensionApiError('PermissionDeniedError', String(err));
}
