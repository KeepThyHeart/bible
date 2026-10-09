import { useMemo } from 'preact/hooks';
import { useSyncExternalStore } from 'preact/compat';
import type { PaneModeContribution } from '@bible/core/browser';
import { modulePoints } from '../moduleHost';
import { CORE_PANE_MODES } from './panes';

/** The registered right-pane modes in tab order; re-renders when a module is switched on or off. */
export function usePaneModes(): readonly PaneModeContribution[] {
  const entries = useSyncExternalStore(
    (cb) => modulePoints.paneModes.subscribe(cb),
    () => modulePoints.paneModes.getSnapshot(),
  );
  return useMemo(() => entries.map((e) => e.item), [entries]);
}

/**
 * Whether a pane mode exists right now (its module is on). Before any module is
 * registered (unit tests, very early boot) the core list stands in, as it does
 * for `renderablePaneModes`.
 */
export function usePaneAvailable(paneId: string): boolean {
  const modes = usePaneModes();
  return modes.length === 0 ? (CORE_PANE_MODES as readonly string[]).includes(paneId) : modes.some((m) => m.id === paneId);
}
