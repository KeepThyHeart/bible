/**
 * The Quiz feature module's manifest (desktop; data only, task 0125). It has no
 * flag: the desktop never gated Quiz on the web flag. Ids, orders and label keys
 * are exactly what the host manifests (`host/panels.ts`, `host/ui.ts`) declared.
 * The labels stay in `ui.json` (they show before the module's code loads).
 */
import type { FeatureModuleManifest } from '@bible/core/browser';

export const quizManifest: FeatureModuleManifest = {
  id: 'quiz',
  platforms: ['desktop'],
  contributes: {
    panelTypes: [{ id: 'quiz', title: { key: 'paneName.quiz', fallback: 'Quiz' }, order: 63 }],
    newTabTiles: [
      {
        id: 'quiz',
        title: { key: 'newTabPage.type.quiz', fallback: 'Quiz' },
        icon: { kind: 'builtin', name: 'quiz' },
        order: 60,
        target: { panelType: 'quiz' },
        keywords: ['quiz'],
      },
    ],
    apps: [
      {
        id: 'quiz',
        title: { key: 'apps.quiz.title', fallback: 'Quiz' },
        icon: { kind: 'builtin', name: 'circle-question' },
        order: 20,
        platforms: ['desktop'],
        lifecycle: { keepAlive: 'while-busy', restore: 'default' },
      },
    ],
    i18nNamespace: 'quizPane',
  },
};
