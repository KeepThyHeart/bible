/**
 * Web settings registry (task 0087).
 *
 * New web settings are declared here (or in a registry merged in with `mergeSettings`)
 * and render through `@bible/ui`'s `SettingsForm`; no store field, no save/load line and
 * no settings-tab row needs hand-wiring.
 *
 * Storage: `webSettingsPort` reads and writes the same `localStorage` blob the legacy
 * `settingsStore` has always used (`bible-reader-settings`), merging only the keys it is
 * given, so the two coexist on one blob and existing users' saved values carry over
 * unchanged. This port is the seam for the web user-data store (task 0084): its
 * replacement implements `SettingsStoragePort` and routes `synced` settings there, and
 * only the `createSettingsStore(...)` call below changes.
 *
 * Migrated as the proof: the Gestures group (swipe to change chapters, and the two
 * swipe thresholds).
 */
import {
  createSettingsStore,
  defineSettings,
  mergeSettings,
  measureSettingsRegistry,
  type SettingChange,
  type SettingsStoragePort,
} from '@bible/core/browser';

export const STORAGE_KEY = 'bible-reader-settings';

const WEB_OWN_SETTINGS = defineSettings([
  {
    key: 'swipeChaptersEnabled',
    type: 'boolean',
    default: true,
    scope: 'device',
    group: 'gestures',
    order: 1,
    labelKey: 'settings.gestures.swipeChaptersEnabled',
    label: 'Swipe to change chapters',
    descriptionKey: 'settings.gestures.swipeChaptersHint',
    description:
      'When enabled, horizontal swipes on the Bible pane navigate to the previous or next chapter.',
  },
  {
    key: 'swipeChapterThresholdPx',
    type: 'integer',
    default: 100,
    min: 20,
    max: 400,
    step: 10,
    widget: 'slider',
    scope: 'device',
    group: 'gestures',
    order: 2,
    labelKey: 'settings.gestures.swipeChapterThreshold',
    label: 'Chapter swipe threshold',
    descriptionKey: 'settings.gestures.swipeChapterThresholdHint',
    description: 'How far you must swipe across the Bible pane before a chapter change is committed.',
  },
  {
    key: 'swipeCommentaryVerseThresholdPx',
    type: 'integer',
    default: 100,
    min: 20,
    max: 400,
    step: 10,
    widget: 'slider',
    scope: 'device',
    group: 'gestures',
    order: 3,
    labelKey: 'settings.gestures.swipeCommentaryVerseThreshold',
    label: 'Commentary verse swipe threshold',
    descriptionKey: 'settings.gestures.swipeCommentaryVerseThresholdHint',
    description:
      'How far you must swipe across the Commentary pane before navigating to the previous or next verse.',
  },
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
]);

/** The web's own settings plus the weights-and-measures group core declares (task 0069). */
export const WEB_SETTINGS = mergeSettings(WEB_OWN_SETTINGS, measureSettingsRegistry);

function readBlob(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Storage port over the legacy settings blob. Device and synced scopes both land here today. */
export const webSettingsPort: SettingsStoragePort = {
  read: readBlob,
  write(changes: readonly SettingChange[]) {
    try {
      const blob = readBlob();
      for (const change of changes) blob[change.key] = change.value;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
    } catch {
      /* localStorage not available */
    }
  },
};

export const webSettings = createSettingsStore(WEB_SETTINGS, webSettingsPort);
