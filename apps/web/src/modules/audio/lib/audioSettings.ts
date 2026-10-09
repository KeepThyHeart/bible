/**
 * The simple "While playing" preferences of Settings > Audio, declared through the
 * shared settings registry so `SettingsForm` renders them. Voices, source and speed
 * stay in `AudioSettingsTab` (they depend on what the registered providers report).
 *
 * The values live where they always did: `audioStore.prefs` (localStorage key
 * `bible-audio-prefs`). This port maps between the registry's flat keys and those
 * prefs, so the player, shortcuts and stored data are unchanged.
 */
import { createSettingsStore, defineSettings } from '@bible/core/browser';
import type { AudioPrefs, SettingChange, SettingsStoragePort } from '@bible/core/browser';
import { audioStore } from '../audioStore';

export const AUDIO_SETTINGS = defineSettings([
  {
    key: 'followAlong',
    type: 'boolean',
    default: true,
    scope: 'device',
    group: 'audio',
    order: 1,
    labelKey: 'audio.settings.followAlong',
    label: 'Highlight the verse being read',
  },
  {
    key: 'autoScroll',
    type: 'boolean',
    default: true,
    scope: 'device',
    group: 'audio',
    order: 2,
    labelKey: 'audio.settings.autoScroll',
    label: 'Scroll to the verse being read',
  },
  {
    key: 'continueToNextChapter',
    type: 'boolean',
    default: true,
    scope: 'device',
    group: 'audio',
    order: 3,
    labelKey: 'audio.settings.continue',
    label: 'Continue to the next chapter (stops at the end of the book)',
  },
  {
    key: 'readChapterIntro',
    type: 'boolean',
    default: true,
    scope: 'device',
    group: 'audio',
    order: 4,
    labelKey: 'audio.settings.intro',
    label: 'Announce “Book, chapter N” at the start',
  },
]);

/** Storage port over the audio prefs held by `audioStore`. */
export const audioSettingsPort: SettingsStoragePort = {
  read() {
    const p = audioStore.prefs;
    return {
      followAlong: p.followAlong,
      autoScroll: p.autoScroll,
      continueToNextChapter: p.continueAfterChapter === 'next-chapter',
      readChapterIntro: p.readChapterIntro,
    };
  },
  write(changes: readonly SettingChange[]) {
    const patch: Partial<AudioPrefs> = {};
    for (const c of changes) {
      if (c.key === 'continueToNextChapter') patch.continueAfterChapter = c.value ? 'next-chapter' : 'stop';
      else if (c.key === 'followAlong' || c.key === 'autoScroll' || c.key === 'readChapterIntro') patch[c.key] = c.value === true;
    }
    audioStore.setPrefs(patch);
  },
};

/** A store over the port. Create one per open tab and `reload()` it when the prefs change elsewhere. */
export function createAudioSettingsStore() {
  return createSettingsStore(AUDIO_SETTINGS, audioSettingsPort);
}
