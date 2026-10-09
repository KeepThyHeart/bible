/**
 * The Weights, measures and money feature-module manifest (desktop): data only, loaded at boot
 * (task 0127; the feature is task 0069).
 *
 * Contributes the `measures*` setting defs (declared in core as `MEASURE_SETTINGS`; the values live in
 * the measure store and the session blob, key `measures`, as before), the "Weights and measures"
 * preferences section (same id, order and label as the host declared), the paint controller (marks and
 * the hover/click popup) and the Study pane section. `measures` is also the Study section's persisted
 * collapse key and the preferences section id: never rename.
 *
 * No `reader.*` hook: the chapter the module paints comes with the `readerPaintControllers` slot props,
 * which the Bible pane renders only while the module is on.
 */
import { MEASURE_SETTINGS } from '@bible/core/browser';
import type { FeatureModuleManifest, PreferencesSectionContribution, SettingsContribution } from '@bible/core/browser';

export const MEASURES_MODULE_ID = 'measures';

/** Session key (`sessionData.ui.measures`) of the reader's measure preferences. Persisted: never rename. */
export const MEASURES_SESSION_KEY = 'measures';

export const measuresSettings: SettingsContribution = { id: 'measures', defs: MEASURE_SETTINGS };

export const measuresPreferencesSection: PreferencesSectionContribution = {
  id: 'measures',
  title: { key: 'preferencesDialog.sectionMeasures', fallback: 'Weights and measures' },
  icon: { kind: 'builtin', name: 'measures' },
  order: 50,
};

export const measuresManifest: FeatureModuleManifest = {
  id: MEASURES_MODULE_ID,
  platforms: ['desktop'],
  activationEvents: ['onView:bible'],
  contributes: {
    settings: [measuresSettings],
    preferencesSections: [measuresPreferencesSection],
    i18nNamespace: 'measures',
  },
};
