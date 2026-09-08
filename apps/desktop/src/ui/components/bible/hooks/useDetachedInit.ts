import { useEffect, useRef } from 'react';
import { useBibleStore } from '../../../stores/useBibleStore';

/**
 * Seed a popped-out Bible window from the state the main window handed over.
 *
 * A detached renderer runs none of the app's startup path - no session load, so
 * `useInitialDataLoader` (which waits for `isSessionLoaded`) never fires and the
 * window would open on "No Bible translation open" even though `WindowManager`
 * had already shipped it the passage.
 *
 * The handover payload from `useBibleTabActions.handleDetachPane` is
 * deliberately shaped like a v1 session blob (`openTabs` / `activeTabIndex` /
 * `current*`), so it restores through exactly the same migration as a saved
 * session and comes out as this window's single passage - including its
 * display mode, navigation history and interlinear/notes toggles.
 *
 * Runs at most once per mount; a failure falls through to the pane's empty
 * state with a translation picker rather than throwing.
 */
export function useDetachedInit(args: {
  panelId: string;
  isDetached: boolean;
  seed: unknown;
}): void {
  const { panelId, isDetached, seed } = args;
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!isDetached || initializedRef.current) return;
    if (!seed || typeof seed !== 'object') return;
    initializedRef.current = true;
    // allow-getstate: mount effect - one-shot imperative restore
    void useBibleStore.getState().restoreFromSession(panelId, seed);
  }, [panelId, isDetached, seed]);
}
