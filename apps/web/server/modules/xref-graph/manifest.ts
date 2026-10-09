/** The Cross-ref graph server feature-module manifest. Data only; no flag, so the module override is the off switch. */

import type { FeatureModuleManifest } from '../../core.js';

export const xrefGraphManifest: FeatureModuleManifest = {
  id: 'xref-graph',
  platforms: ['web'],
  activationEvents: ['onStartupFinished'],
  contributes: {
    serverRoutes: [{ id: 'xref-graph-api', path: '/api/xref-graph' }],
  },
};
