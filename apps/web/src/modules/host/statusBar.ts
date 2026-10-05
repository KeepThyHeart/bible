/**
 * `useStatusBarItems()` (task 0113): the status-bar contribution point as a
 * hook. The web app has no status bar yet; this is the point support only, so
 * a future bar (or a module test) can render the contributed items.
 */
import { useSyncExternalStore } from 'preact/compat';
import type { ContributionEntry, ContributionRegistry, StatusBarItemContribution } from '@bible/core/browser';
import { modulePoints } from '../moduleHost';

type Point = Pick<ContributionRegistry<StatusBarItemContribution>, 'subscribe' | 'getSnapshot'>;

/** Items in order, left or right aligned (all when `alignment` is omitted). Re-renders when modules enable or disable. */
export function useStatusBarItems(
  alignment?: 'left' | 'right',
  point: Point = modulePoints.statusBarItems,
): StatusBarItemContribution[] {
  const snapshot: readonly ContributionEntry<StatusBarItemContribution>[] = useSyncExternalStore(
    point.subscribe.bind(point),
    point.getSnapshot.bind(point),
  );
  return snapshot.map((e) => e.item).filter((i) => !alignment || i.alignment === alignment);
}
