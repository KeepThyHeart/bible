/**
 * The Quiz feature-module manifest (web): data only, loaded at boot.
 * Ids, orders and label keys are persisted or shown before the module's code
 * loads: never rename them. The server half (`server/modules/quiz`) mounts
 * `/api/quiz`; with the server reporting the module off, the client drops all of this.
 */
import type { AppDescriptor, FeatureModuleManifest, PaneModeContribution } from '@bible/core/browser';

export const QUIZ_MODULE_ID = 'quiz';

/** Fired by the phone Study pane on mount: the module adds its "Quiz this chapter" section then. */
export const STUDY_PANE_SECTIONS_EVENT = 'onView:studyPane.sections';

/** The right-pane tab. Kept mounted while another tab shows, so a quiz in progress survives tab switches. */
export const quizPaneMode: PaneModeContribution = {
  id: 'quiz',
  title: { key: 'rightPane.quiz', fallback: 'Quiz' },
  order: 50,
  keepMounted: true,
};

/** The full-width Quiz page (rail entry and home tile come from the descriptor). */
export const quizDescriptor: AppDescriptor = {
  id: 'quiz',
  title: { key: 'apps.quiz.title', fallback: 'Quiz' },
  icon: { kind: 'builtin', name: 'fa-circle-question' },
  order: 20,
  platforms: ['web'],
  deepLink: { segment: 'quiz' },
  lifecycle: { keepAlive: 'while-busy', restore: 'default' },
};

export const quizManifest: FeatureModuleManifest = {
  id: QUIZ_MODULE_ID,
  flag: 'quiz',
  platforms: ['web'],
  activationEvents: [STUDY_PANE_SECTIONS_EVENT],
  contributes: {
    paneModes: [quizPaneMode],
    apps: [quizDescriptor],
    i18nNamespace: 'quiz',
    // Informational: the server half mounts this.
    serverRoutes: [{ id: 'quiz-api', path: '/api/quiz' }],
  },
};
