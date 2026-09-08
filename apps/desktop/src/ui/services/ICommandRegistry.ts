/**
 * The central registry through which every action in the app is invoked.
 *
 * Built-in commands and (later) extension commands share the exact same
 * registration API. The registry stores the raw `LocalizedString` titles and
 * resolves them through `II18nService` at query time, so locale changes
 * re-render without re-registering anything.
 *
 * `query()` is the read path used by menus and the search palette: it returns
 * commands whose `when` clause is currently satisfied, fuzzy-matched against
 * the supplied prefix, sorted by recency x use-count x explicit `order`.
 */

import type {
  CommandQueryResult,
  CommandRegistration,
  IDisposable,
} from '../types/Command';
import type { IEvent } from '../types/Event';
import type { WhenContextSnapshot } from './IWhenContextService';

export class DuplicateCommandError extends Error {
  constructor(public readonly commandId: string) {
    super(`Duplicate command id: ${commandId}`);
    this.name = 'DuplicateCommandError';
  }
}

export interface ICommandRegistry {
  /** Register a command. Returns a disposable that removes it. First-wins on duplicate IDs. */
  register(cmd: CommandRegistration): IDisposable;

  /** Programmatic unregister; usually prefer disposing the registration. */
  unregister(id: string): void;

  /**
   * Bulk-remove every command whose `ownerExtensionId` matches. Called by
   * `ExtensionHost.deactivate()` to clean up an extension's contributions in
   * one shot. Built-in commands (no owner) are never affected. Returns the
   * number of commands removed.
   */
  disposeByOwner(ownerExtensionId: string): number;

  /**
   * Return commands matching `prefix` (fuzzy match against title + aliases),
   * filtered by the supplied `when` context. Already localized.
   */
  query(prefix: string, ctx: WhenContextSnapshot): CommandQueryResult[];

  /** Execute a command by ID. Throws `CommandNotFoundError` if missing. */
  execute(id: string, args?: unknown): Promise<unknown>;

  /** Look up a single command (no `when` filtering). */
  get(id: string): CommandRegistration | undefined;

  /** All registered commands, in registration order. Read-only snapshot. */
  list(): readonly CommandRegistration[];

  /** Fired whenever the registry contents change. */
  onDidChange: IEvent<void>;
}

/**
 * Hooks called by `CommandRegistry.execute()` to record usage in the user DB
 * and bias subsequent `query()` results. Provided by the host (the renderer
 * boot code wires it to an IPC call into the main process).
 */
export interface CommandHistorySink {
  /** Persist a successful invocation. */
  record(commandId: string, when: number): void | Promise<void>;
  /**
   * Synchronously fetch in-memory recency data. The host is expected to
   * preload this on startup so `query()` doesn't need an async hop.
   */
  getRecency(commandId: string): { lastUsed: number; useCount: number } | undefined;
}
