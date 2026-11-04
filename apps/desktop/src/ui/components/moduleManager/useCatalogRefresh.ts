/**
 * Visible busy state for the Module Manager's Refresh button (task 0197).
 *
 * `idle` -> `busy` (spinner, button disabled, "Refreshing...") -> `done` ("Updated", then back to
 * `idle` after a moment) or `error` (stays until the next click). The module store swallows refresh
 * failures into its `error` field instead of throwing, so the outcome is read through `getError`.
 *
 * Licence: GPL-3.0-or-later.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type CatalogRefreshStatus = 'idle' | 'busy' | 'done' | 'error';

export const REFRESH_DONE_VISIBLE_MS = 2500;

export function useCatalogRefresh(
  refresh: () => Promise<void>,
  getError: () => string | null
): { status: CatalogRefreshStatus; run: () => Promise<void> } {
  const [status, setStatus] = useState<CatalogRefreshStatus>('idle');
  const busyRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const run = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    if (timer.current) clearTimeout(timer.current);
    setStatus('busy');
    let failed = false;
    try {
      await refresh();
      failed = getError() !== null;
    } catch {
      failed = true;
    }
    busyRef.current = false;
    if (failed) {
      setStatus('error');
      return;
    }
    setStatus('done');
    timer.current = setTimeout(() => setStatus('idle'), REFRESH_DONE_VISIBLE_MS);
  }, [refresh, getError]);

  return { status, run };
}
