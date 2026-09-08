/**
 * IPC handlers for the manual "Check for Updates" feature.
 *
 * Two channels, both invoked ONLY as a direct result of the user clicking the
 * Help > Check for Updates... menu item:
 *
 *   - `update:get-info` - pre-flight. Returns the host that WOULD be contacted
 *     and whether offline mode blocks the check. Makes NO network request, so
 *     the renderer can show the host and ask for confirmation first.
 *   - `update:check` - performs the actual check via the single
 *     `NetworkGateway`. Call only after the user confirms the host.
 *
 * There is no launch-time or timed entry point here: nothing contacts an update
 * host unless the renderer invokes these in response to the user.
 */

import { BrowserWindow, type IpcMain } from 'electron';
import log from 'electron-log';
import { ipcHandler } from './handler-helper';
import {
  UpdateCheckService,
  type UpdateCheckInfo,
  type UpdateCheckOutcome,
} from '../services/UpdateCheckService';
import {
  UpdateInstallService,
  resolveUnsupportedReason,
  type UnsupportedReason,
  type UpdateDownloadOutcome,
} from '../services/UpdateInstallService';

let service: UpdateCheckService | null = null;
let installService: UpdateInstallService | null = null;

function getService(): UpdateCheckService {
  if (!service) service = new UpdateCheckService();
  return service;
}

function getInstallService(): UpdateInstallService {
  if (!installService) installService = new UpdateInstallService();
  return installService;
}

/**
 * The extension blocklist, refreshed alongside the app update check.
 *
 * **This is the blocklist's only fetch trigger.** Block rules arrive when the
 * user asks the app to check for updates, and never on a timer or at startup, because a scheduled fetch is a beacon that
 * tells an observer when the app is running. The accepted cost is that a user
 * who never checks for updates never receives block rules.
 *
 * Wired by `main.ts` once the extension host exists. When it is absent -
 * headless runs, tests, or a build with no marketplace - the update check
 * behaves exactly as it did before.
 */
let blocklistRefresher: (() => Promise<unknown>) | null = null;

/** Register the blocklist with the manual update check. */
export function setBlocklistRefresher(refresh: () => Promise<unknown>): void {
  blocklistRefresher = refresh;
}

export function registerUpdateHandlers(_ipcMain: IpcMain): void {
  ipcHandler<[], UpdateCheckInfo>('update:get-info', () => getService().getInfo());
  ipcHandler<[], UpdateCheckOutcome>('update:check', async () => {
    const outcome = await getService().check();
    // Piggy-backed rather than a separate user action: the user already
    // consented to contacting the network by running this check, and asking
    // twice for one intent is worse UX for no privacy gain.
    //
    // Failures are swallowed on purpose - a blocklist that cannot be reached
    // must not turn a successful app-update check into an error. The previous
    // rules stay in force; see `ExtensionBlocklistService.refresh`.
    if (blocklistRefresher) {
      try {
        await blocklistRefresher();
      } catch (err) {
        log.warn('[Update] Extension blocklist refresh failed:', err);
      }
    }
    return outcome;
  });

  // Whether this install can apply an update in place. Makes NO network
  // request, so the UI can decide between "Download and install" and "open the
  // download page" before anything is contacted.
  ipcHandler<[], { supported: boolean; reason?: UnsupportedReason }>(
    'update:can-install',
    () => {
      const reason = resolveUnsupportedReason();
      return reason ? { supported: false, reason } : { supported: true };
    }
  );

  // The second consented step. `ipcHandler` strips the IPC event, so progress
  // is broadcast to every window rather than replied to one sender. That is the
  // behaviour we want anyway: a detached pane should see the same progress as
  // the main window, and the payload is a byte count, not user data.
  ipcHandler<[], UpdateDownloadOutcome>('update:download', async () => {
    return getInstallService().download((progress) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('update:download-progress', progress);
      }
    });
  });

  // Third and last: quit and run the installer. Never returns on success.
  ipcHandler<[], void>('update:install', () => {
    // Close windows first so a renderer mid-write is not killed by the quit.
    for (const win of BrowserWindow.getAllWindows()) win.close();
    getInstallService().install();
  });
}
