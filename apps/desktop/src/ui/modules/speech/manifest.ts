/**
 * The Speech feature-module manifest (desktop renderer half, task 0151): the "Speech"
 * preferences section and the activation that installs the bridge answering main's speech calls.
 * Gated by the `recite` flag, like the main-process half. Data only; no engine code is imported.
 */
import type { FeatureModuleManifest } from '@bible/core/browser';

export const SPEECH_MODULE_ID = 'speech';

export const speechManifest: FeatureModuleManifest = {
  id: SPEECH_MODULE_ID,
  platforms: ['desktop'],
  flag: 'recite',
  // Loads module.ts at startup (tiny): it installs the bridge host. The engine loads on the first call.
  activationEvents: ['onStartupFinished'],
  contributes: {
    preferencesSections: [
      {
        id: 'speech',
        title: { key: 'preferencesDialog.sectionSpeech', fallback: 'Speech' },
        order: 36,
      },
    ],
    i18nNamespace: 'speech',
  },
};
