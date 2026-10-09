/**
 * The Downloads feature-module manifest (desktop; data only, task 0128): the "Downloads &
 * storage" preferences section. The asset and feature-pack IPC it calls (assetsAPI,
 * featurePackAPI) is host: the module manager and semantic search use it too, so no main-process
 * module was warranted. Id, order and label key are what `host/ui.ts` declared (label stays in `ui.json`).
 */
import type { FeatureModuleManifest } from '@bible/core/browser';

export const downloadsManifest: FeatureModuleManifest = {
  id: 'downloads',
  platforms: ['desktop'],
  // The preferences dialog fires this when the section is shown, so the module's strings are loaded first.
  activationEvents: ['onView:preferences.downloads'],
  contributes: {
    preferencesSections: [
      {
        id: 'downloads',
        title: { key: 'preferencesDialog.sectionDownloads', fallback: 'Downloads & storage' },
        icon: { kind: 'builtin', name: 'downloads' },
        order: 35,
      },
    ],
    i18nNamespace: 'downloads',
  },
};
