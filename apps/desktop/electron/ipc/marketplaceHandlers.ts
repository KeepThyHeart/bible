/**
 * Renderer-facing IPC for the extension marketplace.
 *
 *   extensions:catalog:listSources     -> CatalogSource[]
 *   extensions:catalog:addSource       -> { ok } | CatalogError
 *   extensions:catalog:acknowledgeRisk -> { ok } | CatalogError
 *   extensions:catalog:removeSource    -> void
 *   extensions:catalog:refresh         -> CatalogRefreshResult | CatalogError
 *   extensions:catalog:refreshAll      -> Array<result | error>
 *   extensions:catalog:listAvailable   -> CatalogListing[]
 *   extensions:catalog:install         -> InstallResult | InstallError
 *   extensions:blocklist:list          -> BlocklistEntry[]
 *   extensions:blocklist:checkInstalled -> Record<extensionId, BlockDecision>
 *
 * There is deliberately **no** `blocklist:refresh` channel. The blocklist is
 * fetched only as part of the user-initiated "Check for Updates" flow (see
 * `updateHandlers.ts`), because a renderer-callable refresh would be one
 * refactor away from becoming a startup or timer fetch - exactly the silent
 * phone-home the design rules out.
 *
 * Every handler here is a read or a user-initiated action. None of them runs
 * on a schedule, and none is invoked at startup.
 */

import { ipcMain } from 'electron';
import type { Extensions } from '@bible/core';

import type { ExtensionHost } from '../extensions/ExtensionHost';
import type {
  ExtensionCatalogService,
  CatalogSource,
  CatalogListing,
} from '../extensions/marketplace/ExtensionCatalogService';
import type {
  ExtensionBlocklistService,
  BlockDecision,
} from '../extensions/marketplace/ExtensionBlocklistService';
import { installExtensionFromCatalog } from '../extensions/marketplace/installFromCatalog';

export interface MarketplaceHandlerOptions {
  host: ExtensionHost;
  catalogService: ExtensionCatalogService;
  blocklist: ExtensionBlocklistService;
}

export function registerMarketplaceHandlers(opts: MarketplaceHandlerOptions): void {
  const { host, catalogService, blocklist } = opts;

  ipcMain.handle('extensions:catalog:listSources', async (): Promise<CatalogSource[]> => {
    return catalogService.listSources();
  });

  ipcMain.handle(
    'extensions:catalog:addSource',
    async (_e, url: string, label?: string, acknowledgeRisk?: boolean) => {
      // `acknowledgeRisk` is forwarded verbatim rather than defaulted to true:
      // the renderer must have actually shown the warning, and a source added
      // without it stays inert until the user confirms.
      return catalogService.addSource({
        url,
        ...(label !== undefined ? { label } : {}),
        ...(acknowledgeRisk !== undefined ? { acknowledgeRisk } : {}),
      });
    },
  );

  ipcMain.handle('extensions:catalog:acknowledgeRisk', async (_e, url: string) => {
    return catalogService.acknowledgeRisk(url);
  });

  ipcMain.handle('extensions:catalog:removeSource', async (_e, url: string): Promise<void> => {
    catalogService.removeSource(url);
  });

  ipcMain.handle('extensions:catalog:refresh', async (_e, url: string) => {
    return catalogService.refresh(url);
  });

  ipcMain.handle('extensions:catalog:refreshAll', async () => {
    return catalogService.refreshAll();
  });

  ipcMain.handle('extensions:catalog:listAvailable', async (): Promise<CatalogListing[]> => {
    return catalogService.listAvailable();
  });

  ipcMain.handle(
    'extensions:catalog:install',
    async (_e, extensionId: string, sourceUrl?: string) => {
      // Consent is NOT pre-supplied: the install runs the same renderer-driven
      // permission prompt a sideload gets. Browsing a catalog must not be able
      // to grant permissions on the user's behalf.
      return installExtensionFromCatalog(host.getContextForMarketplace(), {
        extensionId,
        catalogService,
        ...(sourceUrl !== undefined ? { sourceUrl } : {}),
      });
    },
  );

  ipcMain.handle('extensions:blocklist:list', async (): Promise<Extensions.BlocklistEntry[]> => {
    return blocklist.list();
  });

  /**
   * Which *installed* extensions are currently blocked, keyed by id.
   *
   * The renderer needs this to badge a row before the user tries to start it -
   * enforcement in `ExtensionHostLifecycle.activate` only surfaces a reason
   * once activation has already been refused.
   *
   * Deliberately resolved here rather than in the renderer: matching a rule
   * means evaluating a semver range, and a second implementation of that in the
   * UI is a second chance to disagree with the code that actually enforces the
   * block. The renderer gets the host's answer, not the inputs to it.
   */
  ipcMain.handle(
    'extensions:blocklist:checkInstalled',
    async (): Promise<Record<string, BlockDecision>> => {
      const out: Record<string, BlockDecision> = {};
      for (const ext of await host.listExtensions()) {
        const decision = blocklist.check(ext.manifest.id, ext.manifest.version);
        if (decision) out[ext.manifest.id] = decision;
      }
      return out;
    },
  );
}
