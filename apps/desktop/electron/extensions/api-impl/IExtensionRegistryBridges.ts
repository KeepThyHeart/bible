/**
 * Bridge interfaces between the main-process extension api-impls and the
 * `CommandRegistry` / `WhenContextService`, both of which live in the
 * renderer.
 *
 * The renderer is the single source of truth for commands and `when`-context
 * (built-in commands are registered there at boot, the command palette and
 * menu builder query it, the menu builder pushes its `MenuSpec` from there to
 * the main-process menu host). When an extension worker - a `utilityProcess`
 * spawned by main - calls `api.commands.register(...)`, the request lands in
 * the main process via the RPC router. To avoid teaching the api-impls about
 * the IPC channel shape, they depend on these bridge interfaces instead. A
 * production bridge sends an `ipcMain.handle` round-trip into the focused
 * window; the unit-test bridge calls into a renderer service directly.
 *
 * This separation also means the api-impls can land without designing every
 * IPC envelope between main and renderer in one go - the production bridge
 * is wired once the renderer has a settled IPC surface for command and
 * context contributions.
 */

import type { Extensions } from '@bible/core';

type LocalizedString = Extensions.LocalizedString;
type KeybindingDescriptor = Extensions.KeybindingDescriptor;
type WhenContextValue = Extensions.WhenContextValue;

/**
 * Subset of `CommandRegistration` shape the host needs to forward into the
 * renderer. Mirrors the renderer's `CommandRegistration` minus the live `handler`
 * function (the bridge constructs the handler closure on the renderer side
 * because functions cannot be sent over IPC).
 */
export interface ExtensionCommandSpec {
  id: string;
  ownerExtensionId: string;
  title: LocalizedString;
  category?: LocalizedString;
  shortcut?: KeybindingDescriptor | KeybindingDescriptor[];
  when?: string;
  order?: number;
  hidden?: boolean;
}

/**
 * Bridge for the renderer-side `CommandRegistry`.
 *
 * `register` returns a synchronous removal function so the host can dispose
 * the registration on extension deactivate. Errors thrown by the underlying
 * registry (`DuplicateCommandError`, `ExtensionCommandPrefixError`, ...) are
 * propagated as-is so the api-impl can surface them to the worker via the
 * RPC error channel.
 */
export interface IExtensionCommandBridge {
  /**
   * Register an extension command. The host supplies an `invoke` callback
   * that the bridge wires to the renderer-side handler - when the user runs
   * the command, the renderer dispatches into this callback, which the host
   * forwards to the worker via reverse RPC.
   *
   * Returns a disposer that removes the registration from the renderer
   * registry. Idempotent.
   */
  register(
    spec: ExtensionCommandSpec,
    invoke: (args: unknown) => Promise<unknown>,
  ): () => void;

  /**
   * Bulk-dispose every command owned by `extensionId`. Used by
   * `ExtensionHost.deactivate()` to clean up after a worker exits. Returns
   * the number of commands removed.
   */
  disposeByOwner(extensionId: string): number;

  /**
   * Synchronously execute a command by id. Used to implement
   * `api.commands.execute(...)` from inside an extension worker. Resolves
   * with whatever the underlying handler returned.
   */
  execute(commandId: string, args?: unknown): Promise<unknown>;
}

/**
 * Bridge for the renderer-side `WhenContextService`. The host calls
 * `setForExtension` so the renderer can enforce the `ext.<id>.*` namespace
 * rule and tag the key with its owner for later cleanup.
 */
export interface IExtensionContextBridge {
  /**
   * Read any context key (built-in or extension). Reads are unrestricted per
   * Enforced by the renderer-side context service.
   */
  get(key: string): WhenContextValue | undefined;

  /**
   * Write an `ext.<extensionId>.*` key. Throws
   * `WhenContextNamespaceError` (which the api-impl maps to a
   * `PermissionDeniedError` over RPC) when the key falls outside the
   * caller's namespace.
   */
  setForExtension(extensionId: string, key: string, value: WhenContextValue): void;

  /**
   * Drop every key written via `setForExtension(extensionId, ...)`. Returns
   * the number of keys removed.
   */
  disposeExtensionKeys(extensionId: string): number;
}
