/**
 * The `host` feature module (desktop): the dockview panel types the app ships
 * today, declared as data so `PanelContentRenderer` looks them up in the
 * registry instead of a closed union and a component table (task 0113, phase 1).
 *
 * Phase 2 splits these entries into per-feature modules (genealogy and timeline have
 * moved: `../genealogy`, `../timeline`): one array entry per panel type, ids exactly as
 * persisted in layouts.
 *
 * Component code is bound only through `views` loaders. Four panes stay eager
 * (Bible, Commentary, Book/Dictionary, NewTab) because the default layout
 * mounts them on first paint; their loaders resolve instantly and
 * `eagerPanelComponent` hands the renderer the component synchronously. Every
 * other pane is a dynamic import, loaded on first use.
 */
import type { ComponentType } from 'react';
import type { FeatureModuleBinding, FeatureModuleManifest, PanelTypeContribution } from '@bible/core/browser';
import BiblePane from '../../components/BiblePane';
import CommentaryPane from '../../components/CommentaryPane';
import BookPane from '../../components/BookPane';
import NewTabPage from '../../components/NewTabPage';
import type { CorePanelType } from '../../stores/useLayoutStore';

const t = (key: string, fallback: string) => ({ key, fallback });

const panelTypes: PanelTypeContribution[] = [
  { id: 'bible', title: t('paneName.bible', 'Bible'), order: 10 },
  { id: 'commentary', title: t('paneName.commentary', 'Commentary'), order: 20, keyed: true },
  { id: 'book', title: t('paneName.book', 'Book'), order: 30, keyed: true },
  { id: 'dictionary', title: t('paneName.dictionary', 'Dictionary'), order: 31, keyed: true },
  { id: 'notes', title: t('paneName.notes', 'Notes'), order: 40 },
  { id: 'prayer', title: t('paneName.prayer', 'Prayer'), order: 41 },
  { id: 'search', title: t('paneName.search', 'Search'), order: 50 },
  { id: 'study', title: t('paneName.study', 'Study'), order: 51 },
  { id: 'topics', title: t('paneName.topics', 'Topics'), order: 52 },
  { id: 'wordStudy', title: t('paneName.wordStudy', 'Word Study'), order: 53 },
  { id: 'reading-plans', title: t('paneName.readingPlans', 'Reading plans'), order: 62 },
  { id: 'quiz', title: t('paneName.quiz', 'Quiz'), order: 63 },
  { id: 'similar', title: t('paneName.similar', 'Similar'), order: 64 },
  { id: 'newtab', title: t('paneName.newTab', 'New Tab'), order: 90 },
];

export const hostPanelsManifest: FeatureModuleManifest = {
  id: 'host',
  platforms: ['desktop'],
  contributes: { panelTypes },
};

type PaneModule = { default: ComponentType<any> };

/** Panes the default layout mounts on first paint: imported statically, resolved synchronously. */
const EAGER: Partial<Record<CorePanelType, ComponentType<any>>> = {
  bible: BiblePane,
  commentary: CommentaryPane,
  book: BookPane,
  dictionary: BookPane,
  newtab: NewTabPage,
};

/** The statically imported component of an eager panel type (the caller checks the type is registered). */
export function eagerPanelComponent(type: string): ComponentType<any> | undefined {
  return (EAGER as Record<string, ComponentType<any> | undefined>)[type];
}

const eager = (type: CorePanelType) => (): Promise<PaneModule> => Promise.resolve({ default: EAGER[type]! });

export const hostPanelsBinding: FeatureModuleBinding = {
  id: 'host',
  views: {
    'panel:bible': eager('bible'),
    'panel:commentary': eager('commentary'),
    'panel:book': eager('book'),
    'panel:dictionary': eager('dictionary'),
    'panel:newtab': eager('newtab'),
    'panel:notes': () => import('../../components/notes/UserNotesPane'),
    'panel:prayer': () => import('../../components/notes/tabs/PrayerTab'),
    'panel:search': () => import('../../components/SearchResultsPane'),
    'panel:study': () => import('../../components/StudyPane'),
    'panel:topics': () => import('../../components/TopicsPane'),
    'panel:wordStudy': () => import('../../components/wordStudy/WordStudyPane'),
    'panel:reading-plans': () => import('../../components/ReadingPlans/ReadingPlansPane'),
    'panel:quiz': () => import('../../components/QuizPane'),
    'panel:similar': () => import('../../components/SimilarPane'),
  },
};
