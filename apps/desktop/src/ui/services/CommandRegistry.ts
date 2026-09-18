/**
 * Default `ICommandRegistry` implementation.
 *
 * Behavior worth highlighting:
 *
 *  - **First-wins on duplicate IDs.** Built-ins always register before any
 *    plugin code, so a plugin cannot silently shadow a built-in. The second
 *    registration is rejected (logged + thrown) - the extension loader
 *    catches the throw and surfaces it as a load error in the extensions
 *    panel.
 *  - **Invocation context capture.** `execute()` snapshots the live
 *    when-context the moment it fires, so async handlers see the state that
 *    existed when the user triggered them, not whatever races into the bag
 *    while the handler runs.
 *  - **Recency biasing.** A `CommandHistorySink` (wired by the host to the
 *    user DB via IPC) records successful invocations and supplies the bias
 *    used by `query()` to rank recently/often-used commands higher.
 */

import { Emitter } from '../types/Event';
import type { IEvent } from '../types/Event';
import type {
  CommandContext,
  CommandQueryResult,
  CommandRegistration,
  IDisposable,
} from '../types/Command';
import { CommandNotFoundError, EXTENSION_COMMAND_ID_REGEX, ExtensionCommandPrefixError } from '../types/Command';
import type { II18nService } from './II18nService';
import type {
  IWhenContextService,
  WhenContextSnapshot,
} from './IWhenContextService';
import {
  DuplicateCommandError,
  type CommandHistorySink,
  type ICommandRegistry,
} from './ICommandRegistry';
import type { KeybindingDescriptor } from '../types/KeybindingDescriptor';

const DEFAULT_ORDER = 500;

export interface CommandRegistryOptions {
  i18n: II18nService;
  whenContext: IWhenContextService;
  history?: CommandHistorySink;
  /** Platform tag used to pick the right shortcut binding for display. */
  isMac?: boolean;
}

export class CommandRegistry implements ICommandRegistry {
  private readonly commands: Map<string, CommandRegistration> = new Map();
  /** Insertion order, kept stable for `list()` and tie-breaking. */
  private readonly order: string[] = [];
  private readonly emitter = new Emitter<void>();
  private readonly i18n: II18nService;
  private readonly whenContext: IWhenContextService;
  private readonly history: CommandHistorySink | undefined;
  private readonly isMac: boolean;

  readonly onDidChange: IEvent<void> = this.emitter.event;

  constructor(opts: CommandRegistryOptions) {
    this.i18n = opts.i18n;
    this.whenContext = opts.whenContext;
    if (opts.history) this.history = opts.history;
    this.isMac = opts.isMac ?? (typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform));
  }

  register(cmd: CommandRegistration): IDisposable {
    if (cmd.ownerExtensionId !== undefined) {
      // Extension contributions must use the `ext.<extensionId>.` prefix so
      // built-in commands cannot be shadowed and disposal-on-deactivate is
      // unambiguous.
      //
      // `ownerExtensionId` arrives in two forms and both are legitimate. A
      // manifest id is always fully qualified - `ID_PATTERN` in
      // `ExtensionManifestValidator` requires the `ext.` prefix - and that is
      // what `commandsApiImpl` passes for a real extension. Host-side callers
      // that predate extensions, and this file's own tests, pass the bare
      // publisher-and-name (`demo`).
      //
      // Concatenating unconditionally is what broke this: a real extension
      // `ext.acme.plan` produced the expected prefix `ext.ext.acme.plan.`, so
      // the correctly named command `ext.acme.plan.start` was rejected with
      // `ExtensionCommandPrefixError` and every extension command was
      // unregisterable. Normalising first accepts both spellings and still
      // enforces exactly one `ext.` segment.
      const owner = cmd.ownerExtensionId.startsWith('ext.')
        ? cmd.ownerExtensionId
        : `ext.${cmd.ownerExtensionId}`;
      const expectedPrefix = `${owner}.`;
      if (!EXTENSION_COMMAND_ID_REGEX.test(cmd.id) || !cmd.id.startsWith(expectedPrefix)) {
        throw new ExtensionCommandPrefixError(cmd.id, cmd.ownerExtensionId);
      }
    }
    if (this.commands.has(cmd.id)) {
      // eslint-disable-next-line no-console
      console.warn(`[commands] duplicate registration for ${cmd.id} (rejected)`);
      throw new DuplicateCommandError(cmd.id);
    }
    this.commands.set(cmd.id, cmd);
    this.order.push(cmd.id);
    this.emitter.fire();
    return {
      dispose: () => {
        if (this.commands.get(cmd.id) === cmd) {
          this.commands.delete(cmd.id);
          const idx = this.order.indexOf(cmd.id);
          if (idx >= 0) this.order.splice(idx, 1);
          this.emitter.fire();
        }
      },
    };
  }

  unregister(id: string): void {
    if (!this.commands.delete(id)) return;
    const idx = this.order.indexOf(id);
    if (idx >= 0) this.order.splice(idx, 1);
    this.emitter.fire();
  }

  disposeByOwner(ownerExtensionId: string): number {
    const toRemove: string[] = [];
    for (const [id, cmd] of this.commands) {
      if (cmd.ownerExtensionId === ownerExtensionId) toRemove.push(id);
    }
    if (toRemove.length === 0) return 0;
    for (const id of toRemove) {
      this.commands.delete(id);
      const idx = this.order.indexOf(id);
      if (idx >= 0) this.order.splice(idx, 1);
    }
    this.emitter.fire();
    return toRemove.length;
  }

  get(id: string): CommandRegistration | undefined {
    return this.commands.get(id);
  }

  list(): readonly CommandRegistration[] {
    return this.order.map((id) => this.commands.get(id)!).filter(Boolean);
  }

  query(prefix: string, ctx: WhenContextSnapshot): CommandQueryResult[] {
    const trimmed = prefix.trim().toLowerCase();
    const results: Array<{ result: CommandQueryResult; score: number }> = [];

    for (const id of this.order) {
      const cmd = this.commands.get(id)!;
      if (cmd.hidden) continue;
      if (cmd.when && !this.whenContext.evaluateAgainst(cmd.when, ctx)) continue;

      const title = this.i18n.resolve(cmd.title);
      const category = cmd.category ? this.i18n.resolve(cmd.category) : undefined;
      const aliases = this.collectAliases(cmd);

      let score = 0;
      if (trimmed.length === 0) {
        // No prefix -> recency-only ordering, biased by `order`.
        score = 1;
      } else {
        score = this.fuzzyScore(trimmed, title, category, aliases);
        if (score <= 0) continue;
      }

      // Recency bias: more-recent and more-frequent commands rank higher.
      const rec = this.history?.getRecency(id);
      if (rec) {
        // Logarithmic so a few uses doesn't drown out match quality.
        score += Math.log10(rec.useCount + 1) * 0.5;
        // Recency in hours, decayed.
        const ageHours = (Date.now() - rec.lastUsed) / 36e5;
        score += Math.max(0, 1 - ageHours / 168) * 0.5; // ~1 week decay
      }

      results.push({
        score,
        result: {
          id: cmd.id,
          title,
          ...(category !== undefined ? { category } : {}),
          ...(this.formatShortcutForDisplay(cmd.shortcut) !== undefined
            ? { shortcut: this.formatShortcutForDisplay(cmd.shortcut)! }
            : {}),
          ...(cmd.icon !== undefined ? { icon: cmd.icon } : {}),
          order: cmd.order ?? DEFAULT_ORDER,
        },
      });
    }

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.result.order !== b.result.order) return a.result.order - b.result.order;
      return a.result.title.localeCompare(b.result.title);
    });

    return results.map((r) => r.result);
  }

  async execute(id: string, args?: unknown): Promise<unknown> {
    const cmd = this.commands.get(id);
    if (!cmd) throw new CommandNotFoundError(id);

    const snapshot = this.whenContext.snapshot();
    if (cmd.when && !this.whenContext.evaluateAgainst(cmd.when, snapshot)) {
      // The keybinding/menu should already have filtered this out, but the
      // direct execute() path has no such filter. Reject silently to match
      // VS Code's behavior - throwing here would punish callers for racing
      // against state changes.
      return undefined;
    }

    const ctx: CommandContext = {
      commandId: id,
      ...(args !== undefined ? { args } : {}),
      invocationContext: snapshot,
      liveContext: this.whenContext,
      i18n: this.i18n,
    };

    try {
      const result = await cmd.handler(ctx);
      // Fire-and-forget history update.
      if (this.history) {
        try {
          void this.history.record(id, Date.now());
        } catch {
          // ignored - history is best-effort
        }
      }
      return result;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[commands] handler for ${id} threw:`, err);
      throw err;
    }
  }

  private collectAliases(cmd: CommandRegistration): string[] {
    const out: string[] = [];
    if (cmd.aliases) {
      for (const a of cmd.aliases) out.push(this.i18n.resolve(a));
    }
    // Also pull alias.0, alias.1, ... from the catalog when title is a key.
    if (typeof cmd.title === 'object' && 'key' in cmd.title) {
      out.push(...this.i18n.tAliases(cmd.title.key));
    }
    return out;
  }

  /**
   * Cheap subsequence-based fuzzy match. Returns 0 if no match.
   * Higher = better. Exact-prefix > word-prefix > subsequence; title beats
   * category beats alias.
   */
  private fuzzyScore(query: string, title: string, category: string | undefined, aliases: string[]): number {
    const q = query;
    const t = title.toLowerCase();
    if (t === q) return 100;
    if (t.startsWith(q)) return 80;
    const tw = t.split(/\s+/);
    if (tw.some((w) => w.startsWith(q))) return 60;
    if (t.includes(q)) return 50;
    if (subsequenceMatch(t, q)) return 30;
    if (category) {
      const c = category.toLowerCase();
      if (c.startsWith(q)) return 25;
      if (c.includes(q)) return 18;
    }
    for (const a of aliases) {
      const al = a.toLowerCase();
      if (al === q) return 70;
      if (al.startsWith(q)) return 55;
      if (al.includes(q)) return 22;
      if (subsequenceMatch(al, q)) return 15;
    }
    return 0;
  }

  private formatShortcutForDisplay(shortcut: CommandRegistration['shortcut']): string | undefined {
    if (!shortcut) return undefined;
    const list = Array.isArray(shortcut) ? shortcut : [shortcut];
    if (list.length === 0) return undefined;
    const first = list[0]!;
    return this.isMac && first.mac ? first.mac : first.key;
  }
}

function subsequenceMatch(haystack: string, needle: string): boolean {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}

/** Helper used by tests to construct a registry with stub services. */
export function _createCommandRegistry(opts: CommandRegistryOptions): CommandRegistry {
  return new CommandRegistry(opts);
}

/** Re-export so callers can `import { KeybindingDescriptor } from '../services/CommandRegistry'`. */
export type { KeybindingDescriptor };
