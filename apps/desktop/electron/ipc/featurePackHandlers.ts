/**
 * IPC surface for optional feature packs - currently just semantic search.
 *
 * ## Shape of the API
 *
 * Install is fire-and-forget from the renderer's point of view: `install`
 * validates, kicks the download off and returns immediately, and the UI polls
 * `get-status` for progress. That mirrors how module downloads already work
 * (`download:get-progress`) and avoids adding a main->renderer event channel for
 * one screen. A pack is hundreds of megabytes, so an install that outlives the
 * dialog being closed is a feature, not a leak.
 *
 * ## What the renderer is trusted with
 *
 * Only a `packId`. The pack definition - URLs, digests, sizes, artifact paths -
 * is looked up in the enabled catalogs in the main process and validated there.
 * A compromised renderer therefore cannot point the installer at a URL of its
 * choosing; the worst it can do is install a pack the user's own catalogs
 * already offer.
 *
 * Sideloading holds the same line from the other direction: the renderer asks
 * for a picker, not for a path. The dialog is shown by the main process, so the
 * only file that can be installed is one the user selected themselves.
 */

import { BrowserWindow, dialog, IpcMain, type OpenDialogOptions } from 'electron';
import { basename } from 'path';
import log from 'electron-log';

import { ipcHandler, IpcKnownError } from './handler-helper';
import { ModuleCatalogService } from '../services/ModuleCatalogService';
import {
  getSemanticPackService,
  SemanticPackInstallError,
  type SemanticPackStatus,
} from '../services/SemanticPackService';
import { resetSemanticSearch } from './searchHandlers';
import { getSharedMainDb } from '../services/sharedMainDb';
import { validateString } from '../utils/validation';
import { t } from '../services/MainI18n';

let catalogService: ModuleCatalogService | null = null;

function getCatalogService(): ModuleCatalogService {
  if (!catalogService) {
    catalogService = new ModuleCatalogService(getSharedMainDb());
  }
  return catalogService;
}

function service(): ReturnType<typeof getSemanticPackService> {
  // `resetSemanticSearch` is what makes an install usable without restarting:
  // the search handlers cache the index connection and the ONNX embedder, and
  // both must be dropped around the directory swap.
  return getSemanticPackService(resetSemanticSearch);
}

export function registerFeaturePackHandlers(_ipc: IpcMain): void {
  log.info('[IPC] Registering feature pack handlers...');

  /**
   * Feature packs offered by the user's enabled catalogs. Already validated -
   * every entry here is safe to display and to pass back to `install`.
   */
  ipcHandler<[], unknown[]>('featurePack:list-available', () => {
    return getCatalogService().getAvailableFeaturePacks();
  });

  /** Installed pack (if any) plus live install progress. Safe to poll. */
  ipcHandler<[], SemanticPackStatus>('featurePack:get-status', () => {
    return service().getStatus();
  });

  /**
   * Begin installing a pack. Returns once the download has *started*; the
   * renderer polls `get-status` for the rest.
   */
  ipcHandler<[string], { started: true }>('featurePack:install', (packId) => {
    validateString(packId, 'packId', 200);

    const pack = getCatalogService().getFeaturePack(packId);
    if (!pack) {
      throw new IpcKnownError(
        'not_found',
        `No feature pack "${packId}" in any enabled catalog. Refresh the catalog and try again.`
      );
    }

    const semanticPacks = service();
    if (semanticPacks.isInstalling()) {
      throw new IpcKnownError('conflict', 'A feature pack install is already running.');
    }

    // Deliberately not awaited: a several-hundred-megabyte transfer must not
    // hold an IPC reply open. Failures are surfaced through `get-status`, which
    // is why the rejection is logged rather than propagated.
    void semanticPacks.install(pack).catch((error: unknown) => {
      const message = error instanceof SemanticPackInstallError
        ? `${error.code}: ${error.message}`
        : (error as Error).message;
      log.error(`[FeaturePack] Install of ${packId} failed — ${message}`);
    });

    return { started: true };
  });

  /**
   * Install from a local package the user picks in a native dialog.
   *
   * The renderer supplies no path - only which kind of picker to show. The
   * dialog runs in the main process, so the only paths this can ever install
   * from are ones the user chose in person; there is no channel through which a
   * compromised renderer could name a file. That is also why nothing here
   * consults the blessed-path registry: the path never leaves the main process
   * to need re-authorising.
   */
  ipcHandler<['file' | 'folder'], { started: true; fileName: string } | null>(
    'featurePack:install-from-file',
    async (kind) => {
      if (kind !== 'file' && kind !== 'folder') {
        throw new IpcKnownError('invalid_input', 'Pick either a package file or a package folder.');
      }

      const semanticPacks = service();
      if (semanticPacks.isInstalling()) {
        throw new IpcKnownError('conflict', 'A feature pack install is already running.');
      }

      const parent = BrowserWindow.getFocusedWindow();
      const options: OpenDialogOptions = kind === 'folder'
        ? {
          title: t('main.dialog.selectFeaturePackFolder'),
          properties: ['openDirectory'],
        }
        : {
          title: t('main.dialog.selectFeaturePackFile'),
          properties: ['openFile'],
          filters: [
            { name: t('main.filter.featurePack'), extensions: ['biblepack', 'zip'] },
            { name: t('main.filter.allFiles'), extensions: ['*'] },
          ],
        };

      const picked = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);

      if (picked.canceled || picked.filePaths.length === 0) {
        return null; // Cancelling a picker is not an error.
      }

      const sourcePath = picked.filePaths[0];

      // Not awaited, for the same reason as a download: copying and verifying
      // well over a gigabyte must not hold an IPC reply open. Failures surface
      // through `get-status`.
      void semanticPacks.installFromPackage(sourcePath).catch((error: unknown) => {
        const message = error instanceof SemanticPackInstallError
          ? `${error.code}: ${error.message}`
          : (error as Error).message;
        log.error(`[FeaturePack] Sideload from ${sourcePath} failed — ${message}`);
      });

      return { started: true, fileName: basename(sourcePath) };
    }
  );

  /** Abort an in-flight install. Idempotent. */
  ipcHandler<[], { cancelled: boolean }>('featurePack:cancel', () => {
    const semanticPacks = service();
    const wasRunning = semanticPacks.isInstalling();
    semanticPacks.cancel();
    return { cancelled: wasRunning };
  });

  /** Remove the installed semantic pack and free its memory. */
  ipcHandler<[], { removed: boolean }>('featurePack:uninstall', () => {
    const semanticPacks = service();
    if (semanticPacks.isInstalling()) {
      throw new IpcKnownError(
        'conflict',
        'Cancel the running install before removing the pack.'
      );
    }

    try {
      return { removed: semanticPacks.uninstall() };
    } catch (error) {
      if (error instanceof SemanticPackInstallError) {
        throw new IpcKnownError('unavailable', error.message);
      }
      throw error;
    }
  });

  log.info('[IPC] Feature pack handlers registered successfully');
}

export function closeFeaturePackHandlers(): void {
  catalogService = null;
}
