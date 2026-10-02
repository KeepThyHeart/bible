/**
 * In-memory pack spec store (task 0075) -> packages/core/src/offline/memoryPackSpecStore.ts
 *
 * STAND-IN for the user-data pack specs of task 0084. Specs live only for the
 * lifetime of the object. The web app must NOT back this with browser storage
 * (localStorage, IndexedDB, ...): no personal content is persisted in the
 * browser until accounts exist.
 *
 * Licence: GPL-3.0-or-later.
 */

import type { IPackSpecStore, OfflinePackSpec } from './PackTypes';

const copy = (s: OfflinePackSpec): OfflinePackSpec => ({
  ...s,
  items: s.items.map((i) => ({ ...i })),
  ...(s.fromPreset ? { fromPreset: { ...s.fromPreset } } : {}),
});

export class MemoryPackSpecStore implements IPackSpecStore {
  private readonly specs = new Map<string, OfflinePackSpec>();

  async list(): Promise<OfflinePackSpec[]> {
    return [...this.specs.values()].map(copy);
  }

  async save(s: OfflinePackSpec): Promise<void> {
    this.specs.set(s.packId, copy(s));
  }

  async remove(id: string): Promise<void> {
    this.specs.delete(id);
  }
}
