import type { FeatureModuleBinding } from '@bible/core/browser';

/** Lazy loaders only: the pane and the activation code load on use. */
export const genealogyBinding: FeatureModuleBinding = {
  id: 'genealogy',
  load: () => import('./module'),
  views: {
    'panel:genealogy': () => import('./GenealogyPane'),
  },
};
