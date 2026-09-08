import { useEffect } from 'react';
import { useSessionStore } from '../../../stores/useSessionStore';

/**
 * Triggers `loadInitialData()` the first time the user's session is loaded and
 * the panel still has no passage.
 *
 * Skipped when the panel is going to be seeded from somewhere else - a staged
 * session entry or an encoded `contentKey` - otherwise the default John 3 load
 * would race the restore and could win.
 */
export function useInitialDataLoader(args: {
  panelId: string;
  initialLoadComplete: boolean;
  openTabsLength: number;
  hasStagedSession: boolean;
  hasContentKey: boolean;
  loadInitialData: (panelId?: string) => void;
}) {
  const {
    panelId, initialLoadComplete, openTabsLength,
    hasStagedSession, hasContentKey, loadInitialData,
  } = args;
  const isSessionLoaded = useSessionStore(state => state.isSessionLoaded);

  useEffect(() => {
    if (hasStagedSession || hasContentKey) return;
    if (!initialLoadComplete && openTabsLength === 0 && isSessionLoaded) {
      loadInitialData(panelId);
    }
  }, [
    panelId, initialLoadComplete, openTabsLength, loadInitialData,
    isSessionLoaded, hasStagedSession, hasContentKey,
  ]);
}
