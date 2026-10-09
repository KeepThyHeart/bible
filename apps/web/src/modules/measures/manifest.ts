/**
 * The Weights, measures and money notes module (task 0069; module task 0127), web half:
 * data only, loaded at boot. The setting definitions are core's (`measureSettingsRegistry`),
 * contributed here so they exist only while the module is on. Setting keys, the settings
 * section id (`measures`, which the popup's Units button deep-links) and the `settings.measures.*`
 * labels are persisted or shown before the module's code loads: never rename them.
 */
import { measureSettingsRegistry } from '@bible/core/browser';
import type { FeatureModuleManifest } from '@bible/core/browser';

export const MEASURES_MODULE_ID = 'measures';

export const measuresManifest: FeatureModuleManifest = {
  id: MEASURES_MODULE_ID,
  platforms: ['web'],
  contributes: {
    settings: [{ id: 'measures', defs: measureSettingsRegistry.definitions }],
    // Shown inside the Theme tab, below the keyword marks fields, as it always was.
    preferencesSections: [
      {
        id: 'measures',
        title: { key: 'settings.measures.title', fallback: 'Weights and measures' },
        order: 200,
        parent: 'theme',
        settingsGroup: 'measures',
      },
    ],
    i18nNamespace: 'measures',
  },
};
