/**
 * The Timeline feature module, web half: data only, loaded at boot. The
 * `timeline` flag is the off switch (it also gates the server route). Ids are
 * persisted (`rightPaneMode: 'timeline'`, `/api/timeline`): never rename them.
 */
import type { FeatureModuleManifest } from '@bible/core/browser';

export const timelineManifest: FeatureModuleManifest = {
  id: 'timeline',
  flag: 'timeline',
  platforms: ['web'],
  contributes: {
    paneModes: [{ id: 'timeline', title: { key: 'rightPane.timeline', fallback: 'Timeline' }, order: 40 }],
    i18nNamespace: 'timeline',
    // Informational: the server half (`server/modules/timeline`) mounts this.
    serverRoutes: [{ id: 'timeline-api', path: '/api/timeline' }],
  },
};
