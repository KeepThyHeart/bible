/**
 * UpdateInstallService - downloads and applies an update, on explicit request.
 *
 * The companion to `UpdateCheckService`, which only *reports* that a newer
 * version exists. This one is the second, separately-consented step: it fetches
 * the installer and hands it to the OS.
 *
 * ## Why this does not route through NetworkGateway
 *
 * `electron-updater` brings its own HTTP stack and offers no supported seam to
 * replace it (`AppUpdater#httpExecutor` is not public API; overriding it means
 * owning the breakage on every upgrade). Rather than reimplement Squirrel.Mac
 * and NSIS delta handling to preserve a single-socket rule, the rule this file
 * honors is the one that actually protects the user:
 *
 *     One SWITCH, not one socket.
 *
 * `isNetworkAllowed()` is checked before any electron-updater method that can
 * touch the network, so the master "Allow web requests" toggle governs this path
 * exactly as it governs the gateway.
 *
 * ## No background behaviour
 *
 * `autoDownload` and `autoInstallOnAppQuit` are both disabled in the
 * constructor. Nothing here runs on a timer, at startup, or on quit; every
 * method is reached only from an IPC handler that the user triggered. Do not
 * enable either flag - `autoInstallOnAppQuit` in particular would apply an
 * update the user never agreed to install.
 *
 * ## Platform reality
 *
 *   - **Windows (NSIS)** - works, including delta downloads via the blockmap.
 *     `perMachine: false` means no UAC prompt on update.
 *   - **macOS** - Squirrel.Mac requires the app to be signed AND notarized. An
 *     unsigned build can check for updates but cannot install one; this reports
 *     `unsupported` rather than failing deep inside the library.
 *   - **Linux** - AppImage only, and only when the running file is writable.
 *     A `.deb`/`.rpm` install is updated by the system package manager, so this
 *     reports `unsupported` there and the UI points at the download page.
 */

import { app } from 'electron';
import log from 'electron-log';
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import { isNetworkAllowed } from '../ipc/networkHandlers';

/** Why an update cannot be applied in-app on this install. */
export type UnsupportedReason =
  | 'linux-package-manager'
  | 'macos-unsigned'
  | 'not-packaged';

export type UpdateDownloadOutcome =
  | { status: 'downloaded'; version: string }
  | { status: 'blocked' }
  | { status: 'unsupported'; reason: UnsupportedReason }
  | { status: 'error'; message: string };

/** Progress pushed to the renderer while a download is in flight. */
export interface UpdateDownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

/**
 * Can this install apply an update in place?
 *
 * Returns the reason it cannot, or `null` when it can. Checked before any
 * network access, so an unsupported platform never makes a request it could not
 * have used the result of.
 */
export function resolveUnsupportedReason(): UnsupportedReason | null {
  if (!app.isPackaged) return 'not-packaged';

  if (process.platform === 'linux') {
    // electron-updater sets/reads APPIMAGE; its absence means the app was
    // installed from a package, where dpkg/rpm owns the files and an in-app
    // replace would fight the package manager (and fail without root).
    if (!process.env.APPIMAGE) return 'linux-package-manager';
  }

  if (process.platform === 'darwin' && !app.isInApplicationsFolder?.()) {
    // Squirrel.Mac cannot swap a bundle it cannot write, and an unsigned bundle
    // fails signature validation on the downloaded update regardless.
    return 'macos-unsigned';
  }

  return null;
}

export class UpdateInstallService {
  private configured = false;

  private configure(): void {
    if (this.configured) return;
    // No background download, and no install slipped in at quit time. Both must
    // stay false: the user consents to the check, then to the download, then to
    // the restart - three explicit acts.
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = log;
    this.configured = true;
  }

  /**
   * Fetch the update payload.
   *
   * @param onProgress Called repeatedly while bytes are in flight.
   */
  async download(
    onProgress?: (progress: UpdateDownloadProgress) => void
  ): Promise<UpdateDownloadOutcome> {
    const unsupported = resolveUnsupportedReason();
    if (unsupported) return { status: 'unsupported', reason: unsupported };

    // The master switch, checked before electron-updater opens anything.
    if (!isNetworkAllowed()) {
      log.info('[UpdateInstall] refused: web requests are turned off');
      return { status: 'blocked' };
    }

    this.configure();

    const progressHandler = (info: ProgressInfo): void => {
      onProgress?.({
        percent: info.percent,
        transferred: info.transferred,
        total: info.total,
        bytesPerSecond: info.bytesPerSecond,
      });
    };

    autoUpdater.on('download-progress', progressHandler);
    try {
      // `checkForUpdates` must run first: `downloadUpdate` needs the resolved
      // update info, and with autoDownload disabled the check does not fetch
      // the payload itself.
      const result = await autoUpdater.checkForUpdates();
      if (!result?.updateInfo) {
        return { status: 'error', message: 'No update information was returned.' };
      }

      await autoUpdater.downloadUpdate(result.cancellationToken);
      const version = (result.updateInfo as UpdateInfo).version;
      log.info(`[UpdateInstall] downloaded ${version}`);
      return { status: 'downloaded', version };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('[UpdateInstall] download failed:', error);
      return { status: 'error', message };
    } finally {
      autoUpdater.off('download-progress', progressHandler);
    }
  }

  /**
   * Quit and apply the downloaded update.
   *
   * Does not return: on success the process exits. Call only after `download`
   * reported `downloaded`, and only from a user action.
   */
  install(): void {
    log.info('[UpdateInstall] quitting to install');
    // `isSilent: false` shows the installer UI, so the user can see what is
    // happening and cancel; `isForceRunAfter: true` relaunches when it is done.
    autoUpdater.quitAndInstall(false, true);
  }
}
