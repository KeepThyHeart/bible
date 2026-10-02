/**
 * Pack installers for the web app (task 0075): modules go through the module asset manager, every
 * other pack item through the main asset manager. Both install pinned (an explicit user action).
 * Abort rejects with the asset manager's own `aborted` AssetError, which PackRun understands.
 *
 * Licence: GPL-3.0-or-later.
 */

import type { IAssetManager, IPackInstaller } from '@bible/core/browser';
import { getAssetManager } from '../assets/webAssets';
import { installModuleAsset } from './moduleAssets';

export interface WebPackInstallerDeps {
  installModule?: typeof installModuleAsset;
  assetManager?: () => IAssetManager;
}

export function createWebPackInstallers(deps: WebPackInstallerDeps = {}): { module: IPackInstaller; asset: IPackInstaller } {
  const installModule = deps.installModule ?? installModuleAsset;
  const assetManager = deps.assetManager ?? getAssetManager;
  return {
    module: {
      async install(step, ctx) {
        await installModule(step.offer.ref.id, {
          pinned: true,
          signal: ctx.signal,
          onProgress: (loaded, total) => ctx.onBytes(loaded, total),
        });
      },
    },
    asset: {
      async install(step, ctx) {
        await assetManager().install(step.offer.ref.id, {
          pinned: true,
          signal: ctx.signal,
          onProgress: (p) => ctx.onBytes(p.loaded, p.total),
        });
      },
    },
  };
}
