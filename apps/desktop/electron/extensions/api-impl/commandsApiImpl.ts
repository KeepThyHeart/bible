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
 *     Gated on `commands:register` (default-granted to every installed
 *     extension, so this is a floor check rather than a real access
 *     control decision today - but it stops a *revoked* extension, or one
 *     the manifest loader built with a stale grant snapshot, from
 *     registering anyway).
 *
 *   - `commands.execute(commandId, args)` -> `bridge.execute(...)`. An
 *     extension may always execute its own commands (those under its
 *     `ext.<extensionId>.` prefix - enforced structurally, not by a
 *     permission check, since `CommandRegistry.register` already refuses to
 *     register anything outside that prefix). Reaching a *built-in* command
 *     - the same registry the menu and command palette use - requires the
 *     `commands:execute-builtin` permission AND the command id being on
 *     `BUILTIN_COMMAND_ALLOWLIST` below. Without both, this was a
 *     confused-deputy hole: any installed extension, with zero permissions,
 *     could run `app.openPreferences`, write notes via a built-in, change
 *     the layout, etc. Another extension's command (also `ext.`-prefixed,
 *     but under a different id) is never reachable this way either - that
 *     is what `api.extensions.call` is for.
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
import {
  type ExtensionPermissionGrant,
  hasPermission,
  requirePermission,
} from '../ExtensionPermissionGuard';
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
 * Built-in command ids (and id prefixes, for dynamically-generated families)
 * that `commands:execute-builtin` is allowed to reach. Every built-in
 * command not on this list is refused even with the permission granted -
 * the permission opens the door, this list says which rooms are behind it.
 *
 * Deliberately excluded, and why:
 *   - `app.toggleDevTools`: exposes Chromium devtools; not something a
 *     background extension should be able to trigger.
 *   - `notes.export`: writes a file to disk; belongs behind an explicit
 *     filesystem permission if ever exposed, not a generic command bridge.
 *   - `network.toggleWebRequests`: a network-debugging/security toggle.
 *
 * This list is intentionally reviewed by hand rather than generated from
 * `list()` at runtime, so adding a new built-in command never silently
 * widens what every `commands:execute-builtin` extension can already do.
 */
const BUILTIN_COMMAND_ALLOWLIST: ReadonlySet<string> = new Set([
  'app.about',
  'app.checkForUpdates',
  'app.focusSearchBar',
  'app.openCommandMode',
  'app.openDocumentation',
  'app.openKeyboardShortcuts',
  'app.openPreferences',
  'app.reportIssue',
  'app.startTour',
  'bookmarks.manage',
  'help.reportIssue',
  'module.openManager',
  'search.openAdvanced',
  'search.openFindBar',
  'view.actualSize',
  'view.theme.dark',
  'view.theme.light',
  'view.theme.sepia',
  'view.zoomIn',
  'view.zoomOut',
]);

/** Dynamic id prefixes allowed under `commands:execute-builtin`, checked with `startsWith`. */
const BUILTIN_COMMAND_ALLOWLIST_PREFIXES: readonly string[] = ['layout.applyPreset.'];

function isAllowlistedBuiltin(commandId: string): boolean {
  if (BUILTIN_COMMAND_ALLOWLIST.has(commandId)) return true;
  return BUILTIN_COMMAND_ALLOWLIST_PREFIXES.some((p) => commandId.startsWith(p));
}

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
  grant: ExtensionPermissionGrant;
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
  private readonly grant: ExtensionPermissionGrant;
  private readonly ownCommandPrefix: string;
  private readonly disposers = new Map<string, () => void>();
  private nextDisposalId = 1;
  private disposed = false;

  constructor(opts: CommandsApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.bridge = opts.bridge;
    this.grant = opts.grant;
    // `CommandRegistry.register` normalizes an unprefixed owner id to
    // `ext.<id>` before deriving the required `ext.<id>.` command prefix -
    // mirror that here so ownership checks agree with what the registry
    // will actually accept, regardless of which form `extensionId` arrives in.
    const owner = this.extensionId.startsWith('ext.')
      ? this.extensionId
      : `ext.${this.extensionId}`;
    this.ownCommandPrefix = `${owner}.`;
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
    requirePermission(this.grant, 'commands:register');
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
    if (!commandId.startsWith(this.ownCommandPrefix)) {
      // Not this extension's own command. Only a reviewed, permissioned
      // subset of built-ins is reachable from here - anything else
      // (built-in but not allowlisted, or another extension's command) is
      // refused regardless of permission.
      if (!isAllowlistedBuiltin(commandId) || !hasPermission(this.grant, 'commands:execute-builtin')) {
        throw new PermissionDeniedError(
          `Extension '${this.extensionId}' cannot execute '${commandId}': it is neither the ` +
            "extension's own command nor an allowlisted built-in reachable with " +
            "'commands:execute-builtin'.",
          { extensionId: this.extensionId, permission: 'commands:execute-builtin' },
        );
      }
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
