/**
 * The Word study feature-module manifest (web): data only, loaded at boot.
 * Ids and label keys are persisted or shown before the module's code loads:
 * never rename them (`rightPaneMode: 'wordStudy'`, `/api/word-study`). The
 * server half (`server/modules/word-study`) mounts `/api/word-study`; with the
 * server reporting the module off, the client drops all of this.
 */
import type { FeatureModuleManifest, PaneModeContribution } from '@bible/core/browser';

export const WORD_STUDY_MODULE_ID = 'word-study';

/** The right-pane tab, the phone full-screen view and the header button that opens it. */
export const wordStudyPaneMode: PaneModeContribution = {
  id: 'wordStudy',
  title: { key: 'rightPane.wordStudy', fallback: 'Word study' },
  icon: { kind: 'builtin', name: 'fa-language' },
  order: 70,
  phoneView: true,
  headerButton: { title: { key: 'wordStudy.open', fallback: 'Word study' }, testId: 'header-word-study-btn' },
};

export const wordStudyManifest: FeatureModuleManifest = {
  id: WORD_STUDY_MODULE_ID,
  platforms: ['web'],
  contributes: {
    paneModes: [wordStudyPaneMode],
    i18nNamespace: 'wordStudy',
    // Informational: the server half mounts this.
    serverRoutes: [{ id: 'word-study-api', path: '/api/word-study' }],
  },
};
