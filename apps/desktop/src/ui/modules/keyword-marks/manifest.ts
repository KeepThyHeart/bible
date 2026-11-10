/**
 * The Keyword marks feature-module manifest (desktop): data only, loaded at boot (task 0127).
 *
 * Keyword marks paint chosen words and phrases in the chapter on screen (task 0065). The module
 * contributes: the toolbar button, the word items of the verse context menu and the Strong's
 * tooltip, the Ctrl+Shift+K command and the paint controller. The session key `keywordMarks` is persisted. (There is no colour-safe setting: marks always keep their
 * underline and symbol cues; an old stored `keywordColorSafe` value is ignored, B-075.)
 *
 * No `reader.*` hook: the chapter the module paints (verses, surface, language) comes with the
 * `readerPaintControllers` slot props, which the Bible pane renders only while the module is on.
 */
import type { FeatureModuleManifest } from '@bible/core/browser';

export const KEYWORD_MARKS_MODULE_ID = 'keyword-marks';

/** Session key (`sessionData.ui.keywordMarks`) of the per-tab switches. Persisted: never rename. */
export const KEYWORD_SESSION_KEY = 'keywordMarks';

export const keywordMarksManifest: FeatureModuleManifest = {
  id: KEYWORD_MARKS_MODULE_ID,
  platforms: ['desktop'],
  activationEvents: ['onView:bible'],
  contributes: {
    i18nNamespace: 'keywords',
  },
};
