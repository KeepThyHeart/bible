/**
 * Module-scoped holder for the current pack run (task 0075). The Offline packs panel unmounts when the
 * user switches tabs; the run must keep going, so the panel re-attaches to this holder on mount and
 * never cancels on unmount. Only the explicit Cancel button cancels.
 *
 * Licence: GPL-3.0-or-later.
 */

import type { PackRun } from '@bible/core/browser';

let current: PackRun | null = null;

export function getCurrentPackRun(): PackRun | null {
  return current;
}

export function setCurrentPackRun(run: PackRun | null): void {
  current = run;
}

/** True while the held run is still going. */
export function isPackRunActive(): boolean {
  return current !== null && current.getSnapshot().state === 'running';
}
