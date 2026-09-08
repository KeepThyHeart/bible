/**
 * Hook returning the live `IWhenContextService` plus a snapshot that is
 * re-taken whenever the bag changes. The snapshot reference is cached so
 * `useSyncExternalStore`'s identity check stays stable between events.
 */

import { useSyncExternalStore } from 'react';
import { useAppServices } from './ContextProvider';
import type {
  IWhenContextService,
  WhenContextSnapshot,
} from '../services/IWhenContextService';

export interface UseWhenContextResult {
  service: IWhenContextService;
  snapshot: WhenContextSnapshot;
  evaluate(expression: string): boolean;
}

// Cached snapshot per service, refreshed only when the bag actually changes.
const SNAPSHOT_CACHE = new WeakMap<IWhenContextService, WhenContextSnapshot>();
const SUBSCRIBED = new WeakSet<IWhenContextService>();

function snapshotFor(service: IWhenContextService): WhenContextSnapshot {
  if (!SUBSCRIBED.has(service)) {
    SUBSCRIBED.add(service);
    SNAPSHOT_CACHE.set(service, service.snapshot());
    service.onDidChange(() => {
      SNAPSHOT_CACHE.set(service, service.snapshot());
    });
  }
  return SNAPSHOT_CACHE.get(service)!;
}

export function useWhenContext(): UseWhenContextResult {
  const { whenContext } = useAppServices();
  const snapshot = useSyncExternalStore(
    (cb) => {
      const sub = whenContext.onDidChange(cb);
      return () => sub.dispose();
    },
    () => snapshotFor(whenContext),
    () => snapshotFor(whenContext),
  );
  return {
    service: whenContext,
    snapshot,
    evaluate: (expression: string) => whenContext.evaluateAgainst(expression, snapshot),
  };
}
