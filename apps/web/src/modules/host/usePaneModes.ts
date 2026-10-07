import { useMemo } from 'preact/hooks';
import { useSyncExternalStore } from 'preact/compat';
import type { PaneModeContribution } from '@bible/core/browser';
import { modulePoints } from '../moduleHost';

/** The registered right-pane modes in tab order; re-renders when a module is switched on or off. */
export function usePaneModes(): readonly PaneModeContribution[] {
  const entries = useSyncExternalStore(
    (cb) => modulePoints.paneModes.subscribe(cb),
    () => modulePoints.paneModes.getSnapshot(),
  );
  return useMemo(() => entries.map((e) => e.item), [entries]);
}
