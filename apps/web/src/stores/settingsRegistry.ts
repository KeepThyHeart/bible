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
  APP_NAV_SETTINGS,
  createSettingsStore,
  defineSettings,
  mergeSettings,
  measureSettingsRegistry,
  type SettingChange,
  type ContributionRegistry,
  type SettingsContribution,
  type SettingsRegistry,
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

/** The web's own settings plus the weights-and-measures group (task 0069) and Preferences > Apps (task 0080) core declares. */
export const WEB_SETTINGS = mergeSettings(WEB_OWN_SETTINGS, measureSettingsRegistry, APP_NAV_SETTINGS);

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

/**
 * The registry including settings contributed by enabled feature modules
 * (`contributes.settings`, task 0113), merged on top of the hand-merged
 * `WEB_SETTINGS` (which keeps working unchanged). Takes the contribution
 * point as a parameter so this file stays free of the module host (and so
 * tests can pass a fixture); callers pass `modulePoints.settings`.
 * Cached per registry snapshot.
 */
const contributedCache = new WeakMap<object, SettingsRegistry>();
export function contributedSettings(
  point?: Pick<ContributionRegistry<SettingsContribution>, 'list' | 'getSnapshot'>,
): SettingsRegistry {
  if (!point) return WEB_SETTINGS;
  const snapshot = point.getSnapshot();
  const cached = contributedCache.get(snapshot);
  if (cached) return cached;
  const existing = new Set(WEB_SETTINGS.definitions.map((d) => d.key));
  const defs = point
    .list()
    .flatMap((g) => g.defs)
    .filter((d) => !existing.has(d.key));
  const merged = defs.length ? mergeSettings(WEB_SETTINGS, defineSettings(defs)) : WEB_SETTINGS;
  contributedCache.set(snapshot, merged);
  return merged;
}

/** A settings store over `contributedSettings(point)` (same blob as `webSettings`), for generic contributed sections. Cached per registry. */
const contributedStores = new WeakMap<SettingsRegistry, ReturnType<typeof createSettingsStore>>();
export function contributedSettingsStore(
  point: Pick<ContributionRegistry<SettingsContribution>, 'list' | 'getSnapshot'>,
): ReturnType<typeof createSettingsStore> {
  const registry = contributedSettings(point);
  if (registry === WEB_SETTINGS) return webSettings;
  let store = contributedStores.get(registry);
  if (!store) {
    store = createSettingsStore(registry, webSettingsPort);
    contributedStores.set(registry, store);
  }
  return store;
}
