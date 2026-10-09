import type { FeatureModuleManifest } from '@bible/core/browser';

/**
 * Timeline pane. Data only: ids, orders and label keys are exactly what the host declared before
 * the module existed (persisted layouts name the `timeline` panel type).
 *
 * No flag: the pane is available on desktop regardless of flags. `onStartupFinished` loads the
 * small `module.ts` at startup so the `timeline.open` command is in the palette.
 */
export const timelineManifest: FeatureModuleManifest = {
  id: 'timeline',
  platforms: ['desktop'],
  activationEvents: ['onStartupFinished'],
  contributes: {
    panelTypes: [{ id: 'timeline', title: { key: 'paneName.timeline', fallback: 'Timeline' }, order: 61 }],
    newTabTiles: [
      {
        id: 'timeline',
        title: { key: 'newTabPage.type.timeline', fallback: 'Timeline' },
        icon: { kind: 'builtin', name: 'timeline' },
        order: 50,
        target: { panelType: 'timeline' },
        keywords: ['timeline'],
      },
    ],
    i18nNamespace: 'timeline',
  },
};
