import type { FeatureModuleManifest } from '@bible/core/browser';

/**
 * Family Tree (genealogy) pane. Data only: ids, orders and label keys are exactly what the host
 * declared before the module existed (persisted layouts name the `genealogy` panel type).
 *
 * No flag: the pane is available on desktop regardless of flags. `onStartupFinished` loads the
 * small `module.ts` at startup so the Topics pane's "Show family tree" button is registered.
 */
export const genealogyManifest: FeatureModuleManifest = {
  id: 'genealogy',
  platforms: ['desktop'],
  activationEvents: ['onStartupFinished'],
  contributes: {
    panelTypes: [{ id: 'genealogy', title: { key: 'paneName.genealogy', fallback: 'Family Tree' }, order: 60 }],
    newTabTiles: [
      {
        id: 'genealogy',
        title: { key: 'newTabPage.type.genealogy', fallback: 'Family Tree' },
        icon: { kind: 'builtin', name: 'genealogy' },
        order: 45,
        target: { panelType: 'genealogy' },
        keywords: ['genealogy', 'family'],
      },
    ],
    i18nNamespace: 'genealogy',
  },
};
