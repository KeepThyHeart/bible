/**
 * The Audio Bible feature-module manifest (web): data only, loaded at boot.
 * Ids, orders and label keys are persisted or shown before the module's code
 * loads: never rename them. The server half (`server/modules/audio`) serves
 * `/audio`; with the server reporting the module off, the client drops all of this.
 *
 * Off by default: the `audio` flag (`features.audio` in site-config.json). With the flag
 * off the module contributes nothing and none of its code or strings is fetched.
 *
 * Its UI sits in host views through generic slots (see `module.ts`), so the only
 * declarative contribution is the Settings tab. The tab's label stays in `ui.json`
 * (`settings.tabs.audio`); the strings the code renders are in the `audio` namespace.
 */
import type { FeatureModuleManifest, PreferencesSectionContribution } from '@bible/core/browser';
import { READER_BOOT_EVENT } from '../host/readerHooks';

export const AUDIO_MODULE_ID = 'audio';

/** Settings > Audio (its content is the lazy view `preferences:audio`). */
export const audioSettingsSection: PreferencesSectionContribution = {
  id: 'audio',
  title: { key: 'settings.tabs.audio', fallback: 'Audio' },
  icon: { kind: 'builtin', name: 'fa-headphones' },
  order: 50,
};

export const audioManifest: FeatureModuleManifest = {
  id: AUDIO_MODULE_ID,
  flag: 'audio',
  platforms: ['web'],
  // Study's boot fires this once the reader's Bible provider exists: the module wires the
  // player to it and adds its reader UI. Nothing is loaded before that, and nothing at all with the flag off.
  activationEvents: [READER_BOOT_EVENT],
  contributes: {
    preferencesSections: [audioSettingsSection],
    i18nNamespace: 'audio',
    // Informational: the server half mounts this.
    serverRoutes: [{ id: 'audio-files', path: '/audio' }],
  },
};
