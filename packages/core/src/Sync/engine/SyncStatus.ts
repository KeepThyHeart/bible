/** Sync status store (contracts 0063 §8): a core ReadableStore, so both apps' hooks can read it. */
import type { ReadableStore } from '../../Ui/ReadableStore';
import type { ApiErrorCode } from '../api';
import { notImplemented } from '../notImplemented';

export interface SyncStatus {
  state: 'signed-out' | 'locked' | 'idle' | 'syncing' | 'offline' | 'error';
  accountEmail?: string; lastSyncedAt?: string; pending: number; opaque: number;
  error?: { code: ApiErrorCode | 'crypto' | 'network' | 'internal'; message: string };
}
export interface SyncStatusStore extends ReadableStore<SyncStatus> { set(patch: Partial<SyncStatus>): void }
export function createSyncStatusStore(initial?: Partial<SyncStatus>): SyncStatusStore {
  throw notImplemented(initial);
}
