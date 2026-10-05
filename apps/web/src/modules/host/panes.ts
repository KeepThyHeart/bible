/**
 * The web right-pane modes as feature-module data (task 0113, phase 1).
 *
 * `hostPanesManifest` declares the panes that exist for everybody; the flagged
 * ones (timeline, quiz) are separate small manifests so their flag keeps gating
 * exactly the contribution that is flag-specific. Phase 2 splits the rest.
 *
 * Ids are persisted (`rightPaneMode`): never rename. 'search' is not a pane
 * mode: its tab exists only while a search is open and it is never restored.
 *
 * Entry-chunk code: no component is imported statically; each view is a lazy
 * loader. A view module's default export is a component taking `PaneViewProps`.
 */
import { createElement } from 'preact';
import type { FeatureModuleBinding, FeatureModuleManifest } from '@bible/core/browser';
import type { IDataProviders } from '../../providers/interfaces';

/** What every pane view receives from the shell. */
export interface PaneViewProps {
  providers: IDataProviders;
  showTagGraph: boolean;
  onStrongsClick: (strongsNumber: string) => void;
  onStrongsHover: (...args: never[]) => void;
  onStrongsLeave: () => void;
  onOpenSettings: (section?: string) => void;
}

export type PaneViewComponent = (props: PaneViewProps) => unknown;

/** The pane ids of today's shell, in tab order. Used for typing, as the pre-boot fallback and to read legacy saved ids. */
export const CORE_PANE_MODES = ['study', 'commentary', 'topics', 'timeline', 'quiz', 'dictionary', 'wordStudy', 'similar'] as const;

const title = (id: string, fallback: string) => ({ key: `rightPane.${id}`, fallback });

export const hostPanesManifest: FeatureModuleManifest = {
  id: 'host-panes',
  contributes: {
    paneModes: [
      { id: 'study', title: title('study', 'Study'), order: 10, phoneView: true },
      { id: 'commentary', title: title('commentary', 'Commentary'), order: 20, phoneView: true },
      { id: 'topics', title: title('topics', 'Topics'), order: 30 },
      { id: 'dictionary', title: title('dictionary', 'Dictionary'), order: 60 },
      { id: 'wordStudy', title: title('wordStudy', 'Word study'), order: 70, phoneView: true },
      { id: 'similar', title: title('similar', 'Similar'), order: 80 },
    ],
  },
};

export const timelinePaneManifest: FeatureModuleManifest = {
  id: 'timeline-pane',
  flag: 'timeline',
  contributes: { paneModes: [{ id: 'timeline', title: title('timeline', 'Timeline'), order: 40 }] },
};

export const quizPaneManifest: FeatureModuleManifest = {
  id: 'quiz-pane',
  flag: 'quiz',
  contributes: { paneModes: [{ id: 'quiz', title: title('quiz', 'Quiz'), order: 50 }] },
};

type P = PaneViewProps;
const h = createElement as unknown as (c: unknown, p: unknown) => unknown;

export const hostPanesBinding: FeatureModuleBinding = {
  id: 'host-panes',
  views: {
    'pane:study': () =>
      import('../../components/StudyPane/StudyPane').then((m) => ({
        default: (p: P) => h(m.StudyPane, { onStrongsClick: p.onStrongsClick, onStrongsHover: p.onStrongsHover, onStrongsLeave: p.onStrongsLeave, bibleProvider: p.providers.bible, genealogyProvider: p.providers.genealogy, onOpenSettings: p.onOpenSettings }),
      })),
    'pane:commentary': () =>
      import('../../components/CommentaryPane/CommentaryPane').then((m) => ({
        default: (p: P) => h(m.CommentaryPane, { bibleProvider: p.providers.bible, onOpenSettings: p.onOpenSettings }),
      })),
    'pane:topics': () =>
      import('../../components/StudyPane/TopicsPane').then((m) => ({
        default: (p: P) => h(m.TopicsPane, { topicalProvider: p.providers.topical, tagGraphProvider: p.showTagGraph ? p.providers.tagGraph : undefined, bibleProvider: p.providers.bible }),
      })),
    'pane:dictionary': () =>
      import('../../components/DictionaryPane/DictionaryPane').then((m) => ({
        default: (p: P) => h(m.DictionaryPane, { bibleProvider: p.providers.bible }),
      })),
    'pane:wordStudy': () =>
      import('../../components/WordStudy/WordStudyPane').then((m) => ({
        default: (p: P) => h(m.WordStudyPane, { onOpenStrongsEntry: p.onStrongsClick }),
      })),
    'pane:similar': () =>
      import('../../components/SimilarPane/SimilarPane').then((m) => ({
        default: (p: P) => h(m.SimilarPane, { providers: p.providers }),
      })),
  },
};

export const timelinePaneBinding: FeatureModuleBinding = {
  id: 'timeline-pane',
  views: {
    'pane:timeline': () =>
      import('../../components/TimelinePane/TimelinePane').then((m) => ({
        default: (_p: P) => h(m.TimelinePane, { allowFullscreen: true }),
      })),
  },
};

export const quizPaneBinding: FeatureModuleBinding = {
  id: 'quiz-pane',
  views: {
    'pane:quiz': () =>
      import('../../components/QuizPane/QuizPane').then((m) => ({
        default: (_p: P) => h(m.QuizPane, {}),
      })),
  },
};

/** The entries to add to BUILTIN_MODULES, in order. */
export const hostPanesModules: ReadonlyArray<readonly [FeatureModuleManifest, FeatureModuleBinding]> = [
  [hostPanesManifest, hostPanesBinding],
  [timelinePaneManifest, timelinePaneBinding],
  [quizPaneManifest, quizPaneBinding],
];
