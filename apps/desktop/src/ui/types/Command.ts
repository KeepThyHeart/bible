/**
 * Core types for the command registry.
 *
 * Every action in the app - menu items, keyboard shortcuts, palette entries,
 * extension contributions - is a `CommandRegistration` registered into the
 * central `ICommandRegistry`. Handlers receive a `CommandContext` that
 * contains both a frozen `WhenContextSnapshot` (taken at invocation time) and
 * a live `IWhenContextService` reference for opt-in current-state reads.
 */

import type { LocalizedString } from './LocalizedString';
import type { KeybindingDescriptor } from './KeybindingDescriptor';
import type {
  IWhenContextService,
  WhenContextSnapshot,
} from '../services/IWhenContextService';
import type { II18nService } from '../services/II18nService';

export type { LocalizedString } from './LocalizedString';
export type { KeybindingDescriptor } from './KeybindingDescriptor';
export type { IDisposable } from './Event';

export interface CommandRegistration {
  /** Namespaced ID; format `<package>.<verb>[.<noun>]`. See spec sectionID rules. */
  id: string;
  title: LocalizedString;
  category?: LocalizedString;
  /** Icon name resolved by the app's icon set. */
  icon?: string;
  shortcut?: KeybindingDescriptor | KeybindingDescriptor[];
  /** when-expression evaluated against the active context. */
  when?: string;
  handler: (ctx: CommandContext) => void | Promise<void>;
  /** 0-1000 sort order; lower sorts first. Default 500. */
  order?: number;
  /** Alternate search terms (built-in commands only). */
  aliases?: LocalizedString[];
  /** Registered but never shown in palette/menu. Still callable. */
  hidden?: boolean;
  /**
   * If set, the command was contributed by an extension. The registry uses
   * this to (a) enforce the `ext.<id>.` prefix rule and (b) bulk-dispose all
   * commands owned by an extension when it deactivates. Built-in commands
   * leave this undefined.
   */
  ownerExtensionId?: string;
}

/**
 * Regex enforced for `id` when `ownerExtensionId` is set. The extension's
 * own id (kebab-case) must appear immediately after the `ext.` prefix.
 */
export const EXTENSION_COMMAND_ID_REGEX = /^ext\.[a-z0-9][a-z0-9-]*\./;

export class ExtensionCommandPrefixError extends Error {
  constructor(public readonly commandId: string, public readonly extensionId: string) {
    super(
      `Extension command id '${commandId}' must start with 'ext.${extensionId}.' (owner: ${extensionId})`,
    );
    this.name = 'ExtensionCommandPrefixError';
  }
}

export interface CommandContext {
  commandId: string;
  args?: unknown;
  /** Frozen snapshot captured at command invocation. */
  invocationContext: WhenContextSnapshot;
  /** Live (possibly newer) context. Opt-in only. */
  liveContext: IWhenContextService;
  i18n: II18nService;
}

export interface CommandQueryResult {
  id: string;
  /** Already-localized title. */
  title: string;
  /** Already-localized category. */
  category?: string;
  /** Displayable shortcut form, e.g. "Ctrl+Shift+P". */
  shortcut?: string;
  icon?: string;
  order: number;
}

export class CommandNotFoundError extends Error {
  constructor(public readonly commandId: string) {
    super(`Command not found: ${commandId}`);
    this.name = 'CommandNotFoundError';
  }
}
