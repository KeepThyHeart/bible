/**
 * Hook returning the live `ICommandRegistry`. Re-renders the calling
 * component whenever the registry contents change so menus and palettes
 * stay in sync with extension activation/deactivation.
 *
 * `useSyncExternalStore` requires a stable snapshot reference between
 * change events; we use a monotonically increasing version counter as the
 * snapshot, while the actual return value is the registry itself.
 */

import { useSyncExternalStore } from 'react';
import { useAppServices } from './ContextProvider';
import type { ICommandRegistry } from '../services/ICommandRegistry';

export function useCommands(): ICommandRegistry {
  const { registry } = useAppServices();
  useSyncExternalStore(
    (cb) => {
      const sub = registry.onDidChange(cb);
      return () => sub.dispose();
    },
    () => versionFor(registry),
    () => versionFor(registry),
  );
  return registry;
}

// Per-registry monotonic version counter, bumped lazily on read after a
// change event. Stored on the registry itself to avoid leaking a Map.
const VERSION = new WeakMap<ICommandRegistry, number>();
const SUBSCRIBED = new WeakSet<ICommandRegistry>();

function versionFor(registry: ICommandRegistry): number {
  if (!SUBSCRIBED.has(registry)) {
    SUBSCRIBED.add(registry);
    registry.onDidChange(() => {
      VERSION.set(registry, (VERSION.get(registry) ?? 0) + 1);
    });
  }
  return VERSION.get(registry) ?? 0;
}
