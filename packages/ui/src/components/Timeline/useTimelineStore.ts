import { useSyncExternalStore } from 'react';
import type { ReadableStore } from '@bible/core/browser';

/** Subscribe to a core `ReadableStore` and return its current snapshot. */
export function useTimelineStore<T>(store: ReadableStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
