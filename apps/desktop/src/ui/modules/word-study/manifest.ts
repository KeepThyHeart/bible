/**
 * The Word study feature-module manifest (desktop; data only, task 0126). It has no
 * flag. Ids, orders and label keys are exactly what the host manifest
 * (`host/panels.ts`) declared: the `wordStudy` panel type is persisted in saved layouts, so
 * never rename it. The label stays in `ui.json` (it shows before the module's code loads).
 *
 * There is no new-tab tile (typing "word study" in the New Tab box opens it) and no app: the
 * entry points are the command palette (`wordStudy.open`), the Dictionary pane and Strong's
 * tooltip buttons, and the verse context menu's "Study word" entry.
 */
import type { FeatureModuleManifest } from '@bible/core/browser';

export const WORD_STUDY_MODULE_ID = 'word-study';

export const wordStudyManifest: FeatureModuleManifest = {
  id: WORD_STUDY_MODULE_ID,
  platforms: ['desktop'],
  // The verse context menu fires this on mount: the module then adds its "Study word" entry.
  activationEvents: ['onView:verseContextMenu'],
  contributes: {
    panelTypes: [{ id: 'wordStudy', title: { key: 'paneName.wordStudy', fallback: 'Word Study' }, order: 53 }],
    i18nNamespace: 'wordStudy',
  },
};
