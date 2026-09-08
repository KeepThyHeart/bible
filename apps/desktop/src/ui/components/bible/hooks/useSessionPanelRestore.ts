import { useEffect } from 'react';
import { useBibleStore } from '../../../stores/useBibleStore';

/**
 * Adopt the passage that session restore staged for this panel.
 *
 * Every Bible panel restores itself rather than being pushed to from startup
 * code, because a session can describe any number of Bible panels - including
 * ones the layout only creates after startup has finished (passages that used
 * to be sub-tabs). Staying subscribed rather than reading once covers the case
 * where the panel mounts before the session has been loaded.
 *
 * @returns true while this panel still has session state waiting to be adopted,
 *          so the caller can hold off on default/contentKey seeding.
 */
export function useSessionPanelRestore(panelId: string): boolean {
  const hasStagedSession = useBibleStore(s => s.sessionPanelStates.has(panelId));

  useEffect(() => {
    if (!hasStagedSession) return;
    // allow-getstate: mount effect - one-shot imperative restore
    void useBibleStore.getState().restorePanelFromSession(panelId);
  }, [panelId, hasStagedSession]);

  return hasStagedSession;
}
