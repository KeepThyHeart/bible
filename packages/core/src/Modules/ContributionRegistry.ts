/**
 * The base every contribution point is built on (`apps`, `verseActions` in M1;
 * `commands`, `panelTypes`, `newTabTiles`, ... later in task 0113).
 *
 * One registry holds the items of one `contributes` key from every source:
 * built-in feature modules and (M3) extensions. It owns the rules that must be
 * the same for every point:
 *
 * - ids are unique; registering a taken id throws (two features silently
 *   shadowing each other is a bug to see at boot, not a mystery later);
 * - an extension's item ids must start with `<extensionId>.` (the extension
 *   adapter qualifies short ids before registering), so an extension cannot
 *   claim or shadow a built-in id;
 * - `order` is clamped into the source's band (built-ins 0-99, extensions
 *   100-1000), and `list()` is sorted by order, then id;
 * - `disposeBySource(source)` removes everything one feature module or one
 *   extension contributed (the off switch, an uninstall);
 * - it is a `ReadableStore`: the snapshot is a stable sorted array, replaced
 *   only when something changes, so `useSyncExternalStore` works directly.
 */

import type { ReadableStore } from '../Ui/ReadableStore';
import { clampOrder, sourceKey, toDisposable } from './types';
import type { ContributionSource, Disposable } from './types';

/** What every contributed item has. */
export interface ContributionItem {
  readonly id: string;
  readonly order?: number;
}

/** A registered item with its source and normalised order. */
export interface ContributionEntry<T extends ContributionItem> {
  readonly item: T;
  readonly source: ContributionSource;
  /** `item.order` clamped into the source's band. */
  readonly order: number;
}

/**
 * The structural interface the feature-module host registers through, so a
 * point can be any object with these two methods (a subclass of the registry
 * below, or an adapter onto an existing store).
 */
export interface ContributionPoint<T extends ContributionItem = ContributionItem> {
  /** The `contributes` key this point serves (`apps`). */
  readonly key: string;
  register(item: T, source: ContributionSource): Disposable;
  disposeBySource(source: ContributionSource): void;
}

export class DuplicateContributionError extends Error {
  constructor(key: string, id: string) {
    super(`contributes.${key}: id "${id}" is already registered`);
    this.name = 'DuplicateContributionError';
  }
}

export class ContributionRegistry<T extends ContributionItem>
  implements ContributionPoint<T>, ReadableStore<readonly ContributionEntry<T>[]>
{
  private readonly entries = new Map<string, ContributionEntry<T>>();
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly ContributionEntry<T>[] = [];
  private batchDepth = 0;
  private dirty = false;

  constructor(public readonly key: string) {}

  register(item: T, source: ContributionSource): Disposable {
    if (typeof item.id !== 'string' || item.id === '') {
      throw new Error(`contributes.${this.key}: an item has no id`);
    }
    if (source.kind === 'extension' && !item.id.startsWith(`${source.extensionId}.`)) {
      throw new Error(
        `contributes.${this.key}: extension "${source.extensionId}" may only register ids under "${source.extensionId}."`,
      );
    }
    if (this.entries.has(item.id)) throw new DuplicateContributionError(this.key, item.id);
    const entry: ContributionEntry<T> = { item, source, order: clampOrder(item.order, source) };
    this.entries.set(item.id, entry);
    this.onDidAdd(entry);
    this.changed();
    // Dispose removes this exact entry only: a later re-registration of the
    // same id (after an off/on cycle) must not be removed by a stale handle.
    return toDisposable(() => {
      if (this.entries.get(item.id) === entry) this.remove(item.id);
    });
  }

  /** Remove one item by id. Returns false when it was not registered. */
  unregister(id: string): boolean {
    if (!this.entries.has(id)) return false;
    this.remove(id);
    return true;
  }

  disposeBySource(source: ContributionSource): void {
    const key = sourceKey(source);
    this.batch(() => {
      for (const [id, entry] of [...this.entries]) {
        if (sourceKey(entry.source) === key) this.remove(id);
      }
    });
  }

  get(id: string): T | undefined {
    return this.entries.get(id)?.item;
  }

  getEntry(id: string): ContributionEntry<T> | undefined {
    return this.entries.get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Items sorted by (clamped) order, then id. */
  list(): readonly T[] {
    return this.snapshot.map((e) => e.item);
  }

  getSnapshot(): readonly ContributionEntry<T>[] {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Coalesce the change events of several mutations into one. */
  batch(fn: () => void): void {
    this.batchDepth++;
    try {
      fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.dirty) this.flush();
    }
  }

  /** Subclass hook: an entry was added (before listeners run). */
  protected onDidAdd(_entry: ContributionEntry<T>): void {}

  /** Subclass hook: an entry was removed (before listeners run). */
  protected onDidRemove(_entry: ContributionEntry<T>): void {}

  /** Subclasses call this when their own extra state (badges, busy) changes. */
  protected changed(): void {
    this.dirty = true;
    if (this.batchDepth === 0) this.flush();
  }

  /** Subclasses may rebuild a richer snapshot; the default is the sorted entries. */
  protected buildSnapshot(sorted: readonly ContributionEntry<T>[]): void {
    void sorted;
  }

  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.onDidRemove(entry);
    this.changed();
  }

  private flush(): void {
    this.dirty = false;
    this.snapshot = [...this.entries.values()].sort(
      (a, b) => a.order - b.order || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0),
    );
    this.buildSnapshot(this.snapshot);
    for (const listener of [...this.listeners]) listener();
  }
}
