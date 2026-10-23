/**
 * The Presenter feature module's manifest (desktop; data only, task 0198): the Presenter app, a
 * controller for a presentation page that the main process serves on localhost. The main half is
 * `electron/modules/present/`. The app title stays in `ui.json` (it shows before the code loads).
 */
import type { FeatureModuleManifest } from '@bible/core/browser';

export const PRESENT_APP_ID = 'present';

export const presentManifest: FeatureModuleManifest = {
  id: 'present',
  platforms: ['desktop'],
  contributes: {
    apps: [
      {
        id: PRESENT_APP_ID,
        title: { key: 'apps.present.title', fallback: 'Presenter' },
        icon: { kind: 'builtin', name: 'presentation' },
        order: 40,
        platforms: ['desktop'],
        // The presentation lives in the main process; the view re-reads it from there when opened.
        lifecycle: { keepAlive: 'never', restore: 'default' },
      },
    ],
    i18nNamespace: 'present',
  },
};
