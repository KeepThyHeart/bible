/**
 * Live state bag for `when`-clause evaluation. See `IWhenContextService` for
 * the interface contract. Snapshots are frozen plain-object copies, safe to
 * pass to async command handlers without worrying about later mutations.
 */

import { Emitter } from '../types/Event';
import type { IEvent } from '../types/Event';
import type {
  IWhenContextService,
  WhenContextChangeEvent,
  WhenContextSnapshot,
  WhenContextValue,
} from './IWhenContextService';
import { WhenContextNamespaceError } from './IWhenContextService';
import { evaluateWhen } from './WhenExpressionParser';

class FrozenSnapshot implements WhenContextSnapshot {
  constructor(private readonly data: Readonly<Record<string, WhenContextValue>>) {}

  get(key: string): WhenContextValue | undefined {
    return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : undefined;
  }

  has(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.data, key);
  }

  toJSON(): Record<string, WhenContextValue> {
    return { ...this.data };
  }
}

export class WhenContextService implements IWhenContextService {
  private readonly bag: Map<string, WhenContextValue> = new Map();
  private readonly emitter = new Emitter<WhenContextChangeEvent>();
  /** Coalesces multiple `set()` calls in the same microtask into one event. */
  private pendingChangedKeys: Set<string> | null = null;
  /** Tracks which extension wrote a given key, for bulk-dispose on deactivate. */
  private readonly keyOwners: Map<string, string> = new Map();

  readonly onDidChange: IEvent<WhenContextChangeEvent> = this.emitter.event;

  set(key: string, value: WhenContextValue): void {
    const prev = this.bag.get(key);
    const had = this.bag.has(key);
    if (had && prev === value) return;
    this.bag.set(key, value);
    this.scheduleChange(key);
  }

  get(key: string): WhenContextValue | undefined {
    return this.bag.get(key);
  }

  setForExtension(extensionId: string, key: string, value: WhenContextValue): void {
    const expectedPrefix = `ext.${extensionId}.`;
    if (!key.startsWith(expectedPrefix)) {
      throw new WhenContextNamespaceError(key, extensionId);
    }
    const prevOwner = this.keyOwners.get(key);
    if (prevOwner !== undefined && prevOwner !== extensionId) {
      // Defensive: if a key is somehow owned by a different extension, refuse
      // to overwrite it. The prefix check above should make this impossible
      // unless two extensions share the same id, which the loader rejects.
      throw new WhenContextNamespaceError(key, extensionId);
    }
    this.keyOwners.set(key, extensionId);
    this.set(key, value);
  }

  disposeExtensionKeys(extensionId: string): number {
    const toRemove: string[] = [];
    for (const [key, owner] of this.keyOwners) {
      if (owner === extensionId) toRemove.push(key);
    }
    if (toRemove.length === 0) return 0;
    for (const key of toRemove) {
      this.keyOwners.delete(key);
      if (this.bag.delete(key)) this.scheduleChange(key);
    }
    return toRemove.length;
  }

  snapshot(): WhenContextSnapshot {
    const obj: Record<string, WhenContextValue> = {};
    for (const [k, v] of this.bag) obj[k] = v;
    return new FrozenSnapshot(Object.freeze(obj));
  }

  evaluate(expression: string): boolean {
    return evaluateWhen(expression, (k) => this.bag.get(k));
  }

  evaluateAgainst(expression: string, snapshot: WhenContextSnapshot): boolean {
    return evaluateWhen(expression, (k) => snapshot.get(k));
  }

  /**
   * Test-only: drain the pending change batch synchronously instead of waiting
   * for the microtask. Production code should never need this.
   */
  _flushPendingForTests(): void {
    this.flushChanges();
  }

  private scheduleChange(key: string): void {
    if (this.pendingChangedKeys === null) {
      this.pendingChangedKeys = new Set();
      queueMicrotask(() => this.flushChanges());
    }
    this.pendingChangedKeys.add(key);
  }

  private flushChanges(): void {
    if (this.pendingChangedKeys === null || this.pendingChangedKeys.size === 0) {
      this.pendingChangedKeys = null;
      return;
    }
    const keys = Array.from(this.pendingChangedKeys);
    this.pendingChangedKeys = null;
    this.emitter.fire({ keys });
  }
}

/** Singleton - there is one when-context bag per renderer. */
export const whenContextService = new WhenContextService();
