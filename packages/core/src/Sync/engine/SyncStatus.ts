/** Sync status store (contracts 0063 §8): a core ReadableStore, so both apps' hooks can read it. */
import type { ReadableStore } from '../../Ui/ReadableStore';
import type { ApiErrorCode } from '../api';

export interface SyncStatus {
  state: 'signed-out' | 'locked' | 'idle' | 'syncing' | 'offline' | 'error';
  accountEmail?: string; lastSyncedAt?: string; pending: number; opaque: number;
  error?: { code: ApiErrorCode | 'crypto' | 'network' | 'internal'; message: string };
}
export interface SyncStatusStore extends ReadableStore<SyncStatus> { set(patch: Partial<SyncStatus>): void }

function sameError(a: SyncStatus['error'], b: SyncStatus['error']): boolean {
  return a === b || (a !== undefined && b !== undefined && a.code === b.code && a.message === b.message);
}

/**
 * A small immutable store: `set` merges the patch into a NEW snapshot object and notifies listeners only when a
 * field actually changed, so `getSnapshot()` is stable between changes (the `useSyncExternalStore` rule). A key
 * present in the patch with the value `undefined` clears that field (e.g. `{ error: undefined }`).
 */
export function createSyncStatusStore(initial?: Partial<SyncStatus>): SyncStatusStore {
  let snapshot: SyncStatus = { state: 'signed-out', pending: 0, opaque: 0, ...initial };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(patch) {
      const next: SyncStatus = { ...snapshot };
      let changed = false;
      for (const key of Object.keys(patch) as Array<keyof SyncStatus>) {
        const value = patch[key];
        const same = key === 'error'
          ? sameError(snapshot.error, value as SyncStatus['error'])
          : snapshot[key] === value;
        if (same && (key in snapshot || value === undefined)) continue;
        changed = true;
        if (value === undefined) delete (next as unknown as Record<string, unknown>)[key];
        else (next as unknown as Record<string, unknown>)[key] = value;
      }
      if (!changed) return;
      snapshot = next;
      for (const l of [...listeners]) l();
    },
  };
}
