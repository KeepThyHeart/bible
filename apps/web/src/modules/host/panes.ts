/**
 * The web right-pane modes as feature-module data (task 0113, phase 1).
 *
 * `hostPanesManifest` declares the panes that exist for everybody; the flagged
 * ones (quiz) are separate small manifests so their flag keeps gating
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

/** Phone views that are not pane modes: always there. */
export const CORE_PHONE_VIEWS = ['home', 'bible', 'search'] as const;

/**
 * The phone view to show for a wanted one: itself when it is a core view or a
 * still-enabled pane mode that opts in with `phoneView`, otherwise the reader.
 * A disabled module's view must
 * never leave the phone with a blank screen.
 */
export function resolvePhoneView(wanted: string, phoneViews: ReadonlySet<string>): string {
  if ((CORE_PHONE_VIEWS as readonly string[]).includes(wanted) || phoneViews.has(wanted)) return wanted;
  return 'bible';
}

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

export const quizPaneManifest: FeatureModuleManifest = {
  id: 'quiz-pane',
  flag: 'quiz',
  contributes: { paneModes: [{ id: 'quiz', title: title('quiz', 'Quiz'), order: 50 }] },
};

type P = PaneViewProps;
const h = createElement as unknown as (c: unknown, p: unknown) => unknown;

/**
 * The always-there panes have no lazy view: the Study app renders them
 * directly (`EAGER_PANES` in DesktopApp), so they are part of the Study chunk.
 * Binding them here as `import()` too made Rollup split each one (and its
 * shared deps) into its own chunk, all still fetched at boot: the Phase 1
 * startup regression (task 0123). A pane moved into its own module later gets
 * a lazy view and leaves `EAGER_PANES`.
 */
export const hostPanesBinding: FeatureModuleBinding = { id: 'host-panes' };

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
  [quizPaneManifest, quizPaneBinding],
];
