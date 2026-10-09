/**
 * The Keyword marks module (task 0065; module task 0127), web half: data only, loaded
 * at boot. The colour-safe setting and its `settings.keywords.*` labels are persisted or
 * shown before the module's code loads: never rename the key. There is no server half
 * (the built-in sets ship in core).
 */
import type { FeatureModuleManifest } from '@bible/core/browser';

export const KEYWORD_MARKS_MODULE_ID = 'keyword-marks';

export const keywordMarksManifest: FeatureModuleManifest = {
  id: KEYWORD_MARKS_MODULE_ID,
  platforms: ['web'],
  contributes: {
    settings: [
      {
        id: 'keywords',
        defs: [
          {
            key: 'keywordColorSafe',
            type: 'boolean',
            default: true,
            scope: 'device',
            group: 'keywords',
            order: 1,
            labelKey: 'settings.keywords.colorSafe',
            label: 'Colour-safe keyword marks (extra underline and symbol cues)',
            descriptionKey: 'settings.keywords.colorSafeHint',
            description: 'Adds an underline style and a symbol to each keyword mark so they do not rely on colour alone.',
          },
        ],
      },
    ],
    // Shown inside the Theme tab (first, before the measures fields), with no heading of its own.
    preferencesSections: [
      {
        id: 'keyword-marks',
        title: { key: 'keywordMarks.title', fallback: 'Keyword marks' },
        order: 100,
        parent: 'theme',
        settingsGroup: 'keywords',
      },
    ],
    i18nNamespace: 'keywordMarks',
  },
};
