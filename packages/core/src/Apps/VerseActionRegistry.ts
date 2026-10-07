/**
 * The `verseActions` contribution point (task 0080): contributions (data) plus
 * the platform's lazily loaded handlers.
 */

import { ContributionRegistry } from '../Modules/ContributionRegistry';
import type { ContributionEntry } from '../Modules/ContributionRegistry';
import { toDisposable } from '../Modules/types';
import type { Disposable } from '../Modules/types';
import type {
  IVerseActionRegistry,
  VerseActionBinding,
  VerseActionContext,
  VerseActionContribution,
  VerseActionHandler,
} from './VerseActions';

export interface VerseActionRegistryOptions {
  /** The feature-module host's activation-event firer. */
  activate?: (event: string) => Promise<void> | void;
}

export class VerseActionRegistry
  extends ContributionRegistry<VerseActionContribution>
  implements IVerseActionRegistry
{
  private readonly bindings = new Map<string, VerseActionBinding>();
  private readonly handlers = new Map<string, Promise<VerseActionHandler>>();
  private readonly activate?: (event: string) => Promise<void> | void;

  constructor(options: VerseActionRegistryOptions = {}) {
    super('verseActions');
    this.activate = options.activate;
  }

  bindHandler(binding: VerseActionBinding): Disposable {
    if (this.bindings.has(binding.id)) {
      throw new Error(`verseActions: a handler for "${binding.id}" is already bound`);
    }
    this.bindings.set(binding.id, binding);
    return toDisposable(() => {
      if (this.bindings.get(binding.id) === binding) {
        this.bindings.delete(binding.id);
        this.handlers.delete(binding.id);
      }
    });
  }

  async run(id: string, ctx: VerseActionContext): Promise<void> {
    if (!this.has(id)) throw new Error(`verseActions: unknown action "${id}"`);
    const binding = this.bindings.get(id);
    if (!binding) throw new Error(`verseActions: action "${id}" has no handler on this platform`);
    await this.activate?.(`onVerseAction:${id}`);
    let pending = this.handlers.get(id);
    if (!pending) {
      const p: Promise<VerseActionHandler> = Promise.resolve()
        .then(() => binding.load())
        .catch((err: unknown) => {
          if (this.handlers.get(id) === p) this.handlers.delete(id);
          throw err;
        });
      this.handlers.set(id, p);
      pending = p;
    }
    const handler = await pending;
    await handler.run(ctx);
  }

  protected override onDidRemove(entry: ContributionEntry<VerseActionContribution>): void {
    this.handlers.delete(entry.item.id);
  }
}

export interface SelectVerseActionsOptions {
  evalWhen?: (expr: string) => boolean;
  platform?: never;
  /** Only a field on items; selection never reorders by group. */
  group?: string;
}

/** Apply `when` and return items by (clamped) order, then id. `group` keeps only that group when given. */
export function selectVerseActions(
  entries: readonly ContributionEntry<VerseActionContribution>[],
  opts: SelectVerseActionsOptions = {},
): VerseActionContribution[] {
  return entries
    .filter(({ item }) => {
      if (opts.group !== undefined && (item.group ?? 'app') !== opts.group) return false;
      return !(item.when && opts.evalWhen && !opts.evalWhen(item.when));
    })
    .slice()
    .sort((a, b) => a.order - b.order || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0))
    .map((e) => e.item);
}
