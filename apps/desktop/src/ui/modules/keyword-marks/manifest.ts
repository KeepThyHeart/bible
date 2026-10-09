/**
 * The Keyword marks feature-module manifest (desktop): data only, loaded at boot (task 0127).
 *
 * Keyword marks paint chosen words and phrases in the chapter on screen (task 0065). The module
 * contributes: the colour-safe setting (shown at the end of the Advanced tab through a child
 * preferences section), the toolbar button, the word items of the verse context menu and the Strong's
 * tooltip, the Ctrl+Shift+K command and the paint controller. Ids and setting keys are what the host
 * declared before the migration: `keywordColorSafe` and the session key `keywordMarks` are persisted.
 *
 * No `reader.*` hook: the chapter the module paints (verses, surface, language) comes with the
 * `readerPaintControllers` slot props, which the Bible pane renders only while the module is on.
 */
import type { FeatureModuleManifest, PreferencesSectionContribution, SettingsContribution } from '@bible/core/browser';

export const KEYWORD_MARKS_MODULE_ID = 'keyword-marks';

/** Session key (`sessionData.ui.keywordMarks`) of the per-tab switches. Persisted: never rename. */
export const KEYWORD_SESSION_KEY = 'keywordMarks';

export const keywordSettings: SettingsContribution = {
  id: 'advanced',
  defs: [
    {
      key: 'keywordColorSafe',
      type: 'boolean',
      default: true,
      scope: 'device',
      group: 'advanced',
      labelKey: 'keywords.settings.colorSafe',
      label: 'Colour-safe marks (extra underline and symbol cues)',
    },
  ],
};

/** Rendered under the Advanced tab's own fields, with no heading of its own. */
export const keywordSettingsSection: PreferencesSectionContribution = {
  id: 'keyword-marks',
  title: { key: 'preferencesDialog.sectionAdvanced', fallback: 'Advanced' },
  order: 56,
  parent: 'advanced',
};

export const keywordMarksManifest: FeatureModuleManifest = {
  id: KEYWORD_MARKS_MODULE_ID,
  platforms: ['desktop'],
  activationEvents: ['onView:bible'],
  contributes: {
    settings: [keywordSettings],
    preferencesSections: [keywordSettingsSection],
    i18nNamespace: 'keywords',
  },
};
