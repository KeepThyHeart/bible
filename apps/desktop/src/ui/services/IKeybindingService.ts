/**
 * Resolves keystrokes to command IDs through `KeybindingResolver`, dispatches
 * the resulting command via `ICommandRegistry`, and persists user-defined
 * overrides to the user DB.
 *
 * Source priority (highest first): `user` > `extension` > `builtin`. Within
 * the same source, more-specific `when` clauses (longer expression) win, then
 * registration order.
 */

import type { IDisposable } from '../types/Command';
import type { IEvent } from '../types/Event';
import type { WhenContextSnapshot } from './IWhenContextService';

export type KeybindingSource = 'builtin' | 'user' | 'extension';

export interface KeybindingRegistration {
  command: string;
  /** Cross-platform binding token, e.g. `Ctrl+J`. */
  key: string;
  /** Optional macOS override. */
  mac?: string;
  /** Optional `when` clause beyond the command's own. */
  when?: string;
  source: KeybindingSource;
}

export interface IKeybindingService {
  register(binding: KeybindingRegistration): IDisposable;
  unregister(command: string, key: string): void;

  /** All bindings for a given command, in priority order (highest first). */
  getBindingsForCommand(command: string): KeybindingRegistration[];

  /** Resolve a key event to the winning command, or null. */
  resolve(event: KeyboardEvent, ctx: WhenContextSnapshot): string | null;

  /** Persist a user-rebind. */
  rebind(command: string, newKey: string): Promise<void>;

  /**
   * Attach a global keydown listener to the supplied target (defaults to
   * `window`) that resolves keystrokes to commands and dispatches them
   * through the registry. Returns a disposable for the unsubscribe path.
   */
  attachToWindow(target?: Window | EventTarget): IDisposable;

  onDidChange: IEvent<void>;
}
