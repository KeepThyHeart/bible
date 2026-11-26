/**
 * The Audio feature-module manifest (desktop renderer half, task 0223): the "Audio" preferences
 * section and the activation that wires the Listen button, transport bar, pop-up and shortcuts.
 * Gated by the `audio` flag (off by default); data only, no engine code is imported.
 */
import type { FeatureModuleManifest } from '@bible/core/browser';

export const AUDIO_MODULE_ID = 'audio';

/** Session key (`sessionData.ui.audio`) of the per-pane resume points. Persisted: never rename. */
export const AUDIO_SESSION_KEY = 'audio';

export const audioManifest: FeatureModuleManifest = {
  id: AUDIO_MODULE_ID,
  platforms: ['desktop'],
  flag: 'audio',
  // module.ts loads at startup (small): it reads the config and, only if something can play, adds the UI.
  activationEvents: ['onStartupFinished'],
  contributes: {
    preferencesSections: [
      {
        id: 'audio',
        title: { key: 'audio.settings.title', fallback: 'Audio' },
        order: 37,
      },
    ],
    i18nNamespace: 'audio',
  },
};
