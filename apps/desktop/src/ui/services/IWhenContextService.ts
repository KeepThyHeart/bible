/**
 * `IWhenContextService` is the live state bag against which `when` clauses are
 * evaluated. Stores publish into it; the command registry, keybinding service,
 * menus, and (later) the search bar read from it.
 *
 * Snapshots are frozen point-in-time copies used to capture invocation context
 * - when a command runs, its handler should see the state that existed at the
 * moment the user triggered it, not whatever races into the bag while it's
 * running.
 */

import type { IEvent } from '../types/Event';

export type WhenContextValue = string | number | boolean | null;

export interface WhenContextSnapshot {
  get(key: string): WhenContextValue | undefined;
  has(key: string): boolean;
  toJSON(): Record<string, WhenContextValue>;
}

export interface WhenContextChangeEvent {
  /** Keys whose values changed in this batch. */
  keys: string[];
}

/**
 * Thrown when an extension-originated `set` targets a key outside its own
 * `ext.<extensionId>.*` namespace. Built-in keys are read-only to extensions;
 * extensions cannot fight over each other's keys either.
 */
export class WhenContextNamespaceError extends Error {
  readonly code = 'PermissionDeniedError';
  constructor(public readonly key: string, public readonly extensionId: string) {
    super(
      `Extension '${extensionId}' may only write context keys under 'ext.${extensionId}.*' (attempted: '${key}')`,
    );
    this.name = 'WhenContextNamespaceError';
  }
}

export interface IWhenContextService {
  set(key: string, value: WhenContextValue): void;
  get(key: string): WhenContextValue | undefined;

  /**
   * Extension-scoped setter. Enforces the `ext.<extensionId>.*` namespace
   * rule and tags the resulting key with its owner so
   * `disposeExtensionKeys()` can clean it up on deactivate.
   */
  setForExtension(extensionId: string, key: string, value: WhenContextValue): void;

  /**
   * Drop every key written via `setForExtension(extensionId, ...)`. Returns
   * the number of keys removed. Called on extension deactivate / disable so
   * stale keys cannot keep `when` clauses true after their owner is gone.
   */
  disposeExtensionKeys(extensionId: string): number;

  /** Frozen copy of the current bag. */
  snapshot(): WhenContextSnapshot;

  /** Evaluate a when-expression against the live context. */
  evaluate(expression: string): boolean;

  /** Evaluate a when-expression against a captured snapshot. */
  evaluateAgainst(expression: string, snapshot: WhenContextSnapshot): boolean;

  onDidChange: IEvent<WhenContextChangeEvent>;
}
