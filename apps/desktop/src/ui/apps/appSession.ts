/**
 * Session persistence for the app host (task 0080): the active app and routes are
 * saved next to `dockviewState` in the session blob, and restored after the session
 * loaded (see `restoreActiveApp`). `appHost.restore()` ignores garbage, so older
 * sessions need nothing.
 */
import { registerSessionSerializer } from '../stores/helpers/sessionRegistry';
import { markSessionDirty } from '../stores/helpers/sessionNotifier';
import { appHost, appHostStore } from './appHost';

let installed = false;

export function installAppSession(): void {
  if (installed) return;
  installed = true;
  registerSessionSerializer('appHost', () => appHost.serialize());
  let last = JSON.stringify(appHost.serialize());
  appHostStore.subscribe(() => {
    const json = JSON.stringify(appHost.serialize());
    if (json === last) return;
    last = json;
    markSessionDirty();
  });
}
