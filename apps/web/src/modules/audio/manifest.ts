/**
 * The Audio Bible feature-module manifest (web): data only, loaded at boot.
 * Ids, orders and label keys are persisted or shown before the module's code
 * loads: never rename them. The server half (`server/modules/audio`) serves
 * `/audio`; with the server reporting the module off, the client drops all of this.
 *
 * Off by default: the `audio` flag (`features.audio` in site-config.json). With the flag
 * off the module contributes nothing and none of its code or strings is fetched.
 *
 * Its UI sits in host views through generic slots (see `module.ts`). There is no Settings
 * tab: every audio setting is in the player's gear. Its strings are in the `audio` namespace.
 */
import type { FeatureModuleManifest } from '@bible/core/browser';
import { READER_BOOT_EVENT } from '../host/readerHooks';

export const AUDIO_MODULE_ID = 'audio';

export const audioManifest: FeatureModuleManifest = {
  id: AUDIO_MODULE_ID,
  flag: 'audio',
  platforms: ['web'],
  // Study's boot fires this once the reader's Bible provider exists: the module wires the
  // player to it and adds its reader UI. Nothing is loaded before that, and nothing at all with the flag off.
  activationEvents: [READER_BOOT_EVENT],
  contributes: {
    i18nNamespace: 'audio',
    // Informational: the server half mounts this.
    serverRoutes: [{ id: 'audio-files', path: '/audio' }],
  },
};
