/**
 * IPC surface for the asset store (task 0090, design §5.7).
 *
 * The renderer passes asset ids only. Manifests (urls, digests, sizes) are looked up in the
 * main process from the enabled catalogs, so a compromised renderer cannot point the
 * downloader at a url of its choosing. `install` is fire-and-forget: the renderer polls
 * `assets:list` while `active > 0`, and a failure lands in the entry's `error`.
 */

import { IpcMain } from 'electron';
import log from 'electron-log';
import type { AssetListSnapshot } from '@bible/core/browser';
import { ipcHandler, IpcKnownError } from './handler-helper';
import { getAssetService } from '../services/assets/AssetService';
import { validateString } from '../utils/validation';

export function registerAssetHandlers(_ipc: IpcMain): void {
  log.info('[IPC] Registering asset handlers...');

  ipcHandler<[], AssetListSnapshot>('assets:list', () => getAssetService().list());

  ipcHandler<[string], { started: true }>('assets:install', async (id) => {
    validateString(id, 'id', 100);
    const service = getAssetService();
    if (!(await service.knows(id))) {
      throw new IpcKnownError('not_found', `No downloadable asset "${id}" in any enabled catalog.`);
    }
    // Not awaited: a download must not hold an IPC reply open.
    void service.install(id);
    return { started: true };
  });

  ipcHandler<[string], { cancelled: boolean }>('assets:cancel', async (id) => {
    validateString(id, 'id', 100);
    return { cancelled: await getAssetService().cancel(id) };
  });

  ipcHandler<[string], { removed: boolean }>('assets:remove', async (id) => {
    validateString(id, 'id', 100);
    return { removed: await getAssetService().remove(id) };
  });

  ipcHandler<[], AssetListSnapshot>('assets:refresh', () => getAssetService().refresh());

  log.info('[IPC] Asset handlers registered successfully');
}
