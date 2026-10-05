/** Read a contribution registry's sorted items as React state (re-renders when modules register or unregister). */
import { useMemo, useSyncExternalStore } from 'react';
import type { ContributionItem, ContributionRegistry } from '@bible/core/browser';

export function useRegistryItems<T extends ContributionItem>(registry: ContributionRegistry<T>): readonly T[] {
  const snapshot = useSyncExternalStore(
    (listener) => registry.subscribe(listener),
    () => registry.getSnapshot(),
    () => registry.getSnapshot(),
  );
  return useMemo(() => snapshot.map((e) => e.item), [snapshot]);
}
