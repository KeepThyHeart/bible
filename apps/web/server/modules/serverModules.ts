/**
 * The server's feature-module table (task 0113). One entry per module that
 * contributes server routes. `load` imports the route file, which registers
 * itself through `registerRoute` exactly as the side-effect imports in
 * `server/index.ts` do today. A module must declare
 * `activationEvents: ['onStartupFinished']`; the loader fires it before routes
 * are mounted. A disabled module's route code is never imported.
 *
 * Empty until Phase 2 moves the existing route files here.
 */

import type { FeatureModuleManifest } from '../core.js';
import { presentManifest } from './present/manifest.js';

export interface ServerModuleEntry {
  readonly manifest: FeatureModuleManifest;
  readonly load: () => Promise<unknown>;
}

export const serverModules: readonly ServerModuleEntry[] = [
  {
    manifest: presentManifest,
    load: async () => {
      await import('./present/presentRoutes.js');
      await import('./present/hymnRoutes.js');
      await import('./present/presentPages.js');
    },
  },
];
