/**
 * IPC handlers for the network privacy subsystem.
 *
 * Exposes the master **Allow web requests** switch to the renderer. The switch
 * is OFF on a fresh install; turning it ON requires the user to confirm a
 * native dialog raised by THIS process. The confirmation is deliberately not a
 * renderer-side modal: a renderer bug, an extension, or a future refactor that
 * calls the IPC channel directly must still not be able to put the app online
 * without the user seeing the prompt.
 *
 * Turning the switch OFF is never gated - the safe direction always applies
 * immediately.
 *
 * Every egress path in the app consults the flag this writes: the
 * `NetworkGateway` (catalog, downloads, diagnostics, extensions), the updater,
 * and `openExternalUrl`.
 */

import { dialog, type IpcMain } from 'electron';
import log from 'electron-log';
import { ipcHandler } from './handler-helper';
import { NetworkConfig } from '../services/NetworkConfig';
import { initNetworkGateway } from '../services/NetworkGateway';

let config: NetworkConfig | null = null;

/**
 * Initialize the network config + gateway singleton. Safe to call multiple
 * times; the first call wins. Must run before any egress path is used.
 */
export function initializeNetworkService(): { config: NetworkConfig } {
  if (!config) {
    config = new NetworkConfig();
    initNetworkGateway(config);
    log.info(
      `[network] gateway initialized; allowNetwork=${config.get().allowNetwork}`
    );
  }
  return { config };
}

export function getNetworkConfig(): NetworkConfig | null {
  return config;
}

/**
 * The one question every egress path asks.
 *
 * Fails closed when the service has not been initialised: a caller that runs
 * before `initializeNetworkService()` gets "not allowed" rather than an
 * unguarded request.
 */
export function isNetworkAllowed(): boolean {
  return config?.get().allowNetwork === true;
}

/**
 * Prompt for consent to enable network access.
 *
 * The wording is deliberately modest. It does not promise that the app is
 * otherwise silent, because that has not been audited end to end and a
 * confident claim is worse than no claim for a user whose safety depends on it.
 */
async function confirmEnable(): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Cancel', 'Allow web requests'],
    defaultId: 0,
    cancelId: 0,
    title: 'Allow this program to go online?',
    message: 'Are you sure you would like to allow this program to go online?',
    detail:
      'While this is on, the app can contact the internet to check for updates, ' +
      'browse and download modules, and open links in your browser. Those servers ' +
      'will see your IP address.\n\n' +
      'Turning this off stops the app from starting those requests. It is not a ' +
      'firewall, and it cannot control what the rest of your system does.\n\n' +
      'You can turn this back off at any time in Preferences.',
    noLink: true,
  });
  return response === 1;
}

export function registerNetworkHandlers(_ipcMain: IpcMain): void {
  const { config: cfg } = initializeNetworkService();

  ipcHandler<[], boolean>('network:get-allow-web-requests', () => {
    return cfg.get().allowNetwork;
  });

  ipcHandler<[boolean], boolean>(
    'network:set-allow-web-requests',
    async (allow) => {
      if (!allow) {
        const next = cfg.set({ allowNetwork: false });
        log.info('[network] allowNetwork set to false');
        return next.allowNetwork;
      }

      if (cfg.get().allowNetwork) return true;

      const confirmed = await confirmEnable();
      if (!confirmed) {
        log.info('[network] enable declined at the confirmation dialog');
        return false;
      }

      const next = cfg.set({ allowNetwork: true });
      log.info('[network] allowNetwork set to true (user confirmed)');
      return next.allowNetwork;
    }
  );

  // Retained so existing callers keep working, expressed in terms of the new
  // flag. `offlineMode` is the inverse of `allowNetwork`; enabling network
  // access through this path still raises the confirmation dialog.
  ipcHandler<[], boolean>('network:get-offline-mode', () => {
    return !cfg.get().allowNetwork;
  });

  ipcHandler<[boolean], boolean>('network:set-offline-mode', async (offline) => {
    if (offline) {
      cfg.set({ allowNetwork: false });
      return true;
    }
    if (cfg.get().allowNetwork) return false;
    const confirmed = await confirmEnable();
    if (confirmed) cfg.set({ allowNetwork: true });
    return !confirmed;
  });
}
