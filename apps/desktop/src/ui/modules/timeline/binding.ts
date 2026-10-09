import type { FeatureModuleBinding } from '@bible/core/browser';

/** Lazy loaders only: the pane and the activation code load on use. */
export const timelineBinding: FeatureModuleBinding = {
  id: 'timeline',
  load: () => import('./module'),
  views: {
    'panel:timeline': () => import('./TimelinePane'),
  },
};
