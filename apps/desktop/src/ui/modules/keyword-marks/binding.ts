/**
 * Keyword marks binding (entry-chunk code): lazy loaders only. The module code, the stores and the
 * settings section are imported by nobody else.
 */
import type { DesktopFeatureModule } from '../moduleHost';
import { keywordMarksManifest, KEYWORD_MARKS_MODULE_ID, KEYWORD_SESSION_KEY } from './manifest';
import { registerKeywordCommands } from './keywordCommands';

export const keywordMarksModule: DesktopFeatureModule = {
  manifest: keywordMarksManifest,
  binding: {
    id: KEYWORD_MARKS_MODULE_ID,
    load: () => import('./module'),
    views: { 'preferences:keyword-marks': () => import('./KeywordSettingsSection') },
  },
  commands: registerKeywordCommands,
  sessionKeys: [KEYWORD_SESSION_KEY],
};
