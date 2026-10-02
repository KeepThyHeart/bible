import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QuizPanel } from '@bible/ui';
import type { QuizLabels } from '@bible/ui';
import { QuizEngine, ReadingPlans, formatVerseIdRange, getBookName } from '@bible/core/browser';
import type { QuizCatalog, QuizRequest, QuizScope, QuizSessionSummary } from '@bible/core/browser';
import { useI18n } from '../contexts/useI18n';
import { useBibleStore, DEFAULT_PANEL_ID } from '../stores/useBibleStore';
import { useQuizLaunchStore } from '../stores/useQuizLaunchStore';
import { useModuleStore } from '../stores/useModuleStore';
import { navigateToVerseInPrimary } from '../stores/crossStoreBridge';
import { openModuleManager } from '../utils/openModuleManager';
import { bibleAPI } from '../services/electronAPI';
import { IpcQuizSource, IpcQuizProgressStore } from '../services/quizAPI';
import { getReadingPlanService } from '../services/readingPlansAPI';
import { loadBookNamesCache, getBookNameFromCache } from '../utils/verseReference';

type PrimaryPanel = { currentBook: number; currentChapter: number };
type PanelsState = { panels: Map<string, PrimaryPanel> };

function primaryPanel(state: PanelsState): PrimaryPanel | undefined {
  return state.panels.get(DEFAULT_PANEL_ID) ?? state.panels.values().next().value;
}

/** Plain numbers, so the selectors are referentially stable. */
const selectBook = (state: PanelsState): number => primaryPanel(state)?.currentBook ?? 0;
const selectChapter = (state: PanelsState): number => primaryPanel(state)?.currentChapter ?? 0;

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; catalog: QuizCatalog };

/** Every plain label key (templated ones are passed their own `{placeholders}` back). */
const TEMPLATED: Record<string, string[]> = {
  scopeToday: ['label'],
  scopeChapter: ['label'],
  noQuestionsHere: ['label'],
  questionsAvailable: ['count'],
  progress: ['n', 'total'],
  correctAnswerIs: ['answer'],
  openPassage: ['reference'],
  score: ['correct', 'graded'],
  scorePartly: ['partly'],
  sameAgain: ['label'],
  historyEntry: ['label', 'correct', 'graded', 'date'],
  textBasis: ['translation'],
};

const PLAIN_KEYS = [
  'title', 'intro', 'scopeHeading', 'scopePassage', 'book', 'fromChapter', 'toChapter', 'countHeading',
  'difficultyHeading', 'difficultyMixed', 'difficultyEasy', 'difficultyMedium', 'difficultyHard', 'start',
  'loading', 'check', 'next', 'finish', 'skip', 'quit', 'showAnswer', 'yourAnswer', 'answerPlaceholder',
  'modelAnswer', 'selfGradePrompt', 'gotIt', 'partly', 'missed', 'correct', 'incorrect', 'countAsCorrect',
  'reflectionHint', 'reflectionPlaceholder', 'continue', 'summaryTitle', 'noneGraded', 'missedHeading',
  'retryMissed', 'newQuiz', 'historyHeading', 'sourcesHeading', 'unreviewed', 'error', 'retry', 'noModule',
] as const;

const KIND_KEYS = ['recall', 'comprehension', 'application'] as const;

/**
 * Quiz pane: questions on a passage, from the installed quiz modules, with
 * progress kept in the user database. Renders the shared `QuizPanel` from
 * `@bible/ui` over a core `QuizEngine` that talks to the `quiz:*` IPC channels.
 */
const QuizPane: React.FC = () => {
  const { t } = useI18n();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [bookNamesReady, setBookNamesReady] = useState(false);
  const [history, setHistory] = useState<QuizSessionSummary[]>([]);
  const [startRequest, setStartRequest] = useState<QuizRequest | null>(null);
  const book = useBibleStore(selectBook);
  const chapter = useBibleStore(selectChapter);
  const pending = useQuizLaunchStore((s) => s.pending);

  const [source] = useState(() => new IpcQuizSource());
  const [store] = useState(() => new IpcQuizProgressStore());
  const [engine] = useState(() => new QuizEngine(source, store));

  // The "Quiz me on this chapter" command leaves a request; take it once.
  useEffect(() => {
    if (!pending) return;
    const request = useQuizLaunchStore.getState().take(); // allow-getstate: one-shot hand-off
    if (request) setStartRequest(request);
  }, [pending]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    source.getCatalog()
      .then((catalog) => {
        if (cancelled) return;
        lastCatalogJson.current = JSON.stringify(catalog);
        setState({ status: 'ready', catalog });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, [source, attempt]);

  // Look again (quietly, without the loading state) when the installed modules change
  // (Module Manager) or the window regains focus. Only a changed catalog re-renders.
  const installedModules = useModuleStore((s) => s.installedModules);
  const lastCatalogJson = useRef<string>('');
  const refetchCatalog = useCallback((isCancelled: () => boolean) => {
    if (document.visibilityState === 'hidden') return;
    source.getCatalog()
      .then((catalog) => {
        if (isCancelled()) return;
        const json = JSON.stringify(catalog);
        if (json === lastCatalogJson.current) return;
        lastCatalogJson.current = json;
        setState((prev) => (prev.status === 'error' ? prev : { status: 'ready', catalog }));
      })
      .catch(() => { /* keep what is showing */ });
  }, [source]);
  const seenModules = useRef(installedModules);
  useEffect(() => {
    if (seenModules.current === installedModules) return; // the mount load covers the first render
    seenModules.current = installedModules;
    let cancelled = false;
    refetchCatalog(() => cancelled);
    return () => { cancelled = true; };
  }, [refetchCatalog, installedModules]);
  useEffect(() => {
    let cancelled = false;
    const onFocus = () => refetchCatalog(() => cancelled);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refetchCatalog]);

  const refreshHistory = useCallback(() => {
    store.listSessions(5).then(setHistory).catch(() => { /* history is a convenience */ });
  }, [store]);
  useEffect(() => { refreshHistory(); }, [refreshHistory]);

  // Localized book names come from the installed Bible module.
  useEffect(() => {
    let cancelled = false;
    loadBookNamesCache(bibleAPI)
      .catch(() => {})
      .finally(() => { if (!cancelled) setBookNamesReady(true); });
    return () => { cancelled = true; };
  }, []);

  const bookName = useCallback((bookNumber: number): string => {
    const cached = getBookNameFromCache(bookNumber);
    return cached && cached !== 'Unknown' ? cached : getBookName(bookNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookNamesReady]);

  // Today's reading comes from the reading-plan service: every reading due today in any active
  // plan, labelled with its references. null when no plan is active, nothing is due, or it fails.
  const [todaysReading, setTodaysReading] = useState<QuizScope | null>(null);
  const refreshTodaysReading = useCallback((isCancelled: () => boolean) => {
    let scopes: Promise<ReadingPlans.ReadingScope[]>;
    try {
      scopes = getReadingPlanService().getTodayScope();
    } catch {
      if (!isCancelled()) setTodaysReading(null);
      return;
    }
    scopes
      .then((list) => {
        if (isCancelled()) return;
        const readings = list.flatMap((s) => s.readings);
        const label = readings.map((r) => ReadingPlans.formatReading(r, bookName)).join('; ');
        setTodaysReading(
          readings.length === 0
            ? null
            : { label, passages: readings.map((r) => ({ start: r.start, end: r.end })) },
        );
      })
      .catch(() => { if (!isCancelled()) setTodaysReading(null); });
  }, [bookName]);
  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    refreshTodaysReading(isCancelled);
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = getReadingPlanService().subscribe(() => refreshTodaysReading(isCancelled));
    } catch { /* no service: the option stays hidden */ }
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') refreshTodaysReading(isCancelled);
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      unsubscribe?.();
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshTodaysReading]);

  const formatReference = useCallback(
    (start: number, end?: number): string => formatVerseIdRange(start, end, bookName),
    [bookName],
  );

  const labels = useMemo<Partial<QuizLabels>>(() => {
    const out: Record<string, string> = {};
    for (const key of PLAIN_KEYS) out[key] = t(`quizPane.${key}`);
    for (const [key, names] of Object.entries(TEMPLATED)) {
      out[key] = t(`quizPane.${key}`, Object.fromEntries(names.map((n) => [n, `{${n}}`])));
    }
    return {
      ...out,
      kinds: Object.fromEntries(KIND_KEYS.map((k) => [k, t(`quizPane.kind.${k}`)])),
      difficultyBadge: { '1': t('quizPane.difficultyBadge.1'), '2': t('quizPane.difficultyBadge.2'), '3': t('quizPane.difficultyBadge.3') },
    } as Partial<QuizLabels>;
  }, [t]);

  const handleOpenPassage = useCallback((start: number) => {
    navigateToVerseInPrimary(start);
  }, []);

  const emptyAction = useMemo(
    () => ({ label: t('quizPane.openModuleManager'), onClick: () => openModuleManager('quiz') }),
    [t],
  );

  const currentChapter = book > 0 && chapter > 0 ? { book, chapter } : null;
  const shell = { backgroundColor: 'var(--theme-bg-primary)', color: 'var(--theme-text-primary)' } as const;

  if (state.status === 'error') {
    return (
      <div className="h-full w-full flex items-center justify-center p-lg" data-testid="quiz-pane-error" style={shell} role="alert">
        <div className="text-center max-w-md">
          <p style={{ color: 'var(--theme-text-secondary)', marginBottom: '12px' }}>{t('quizPane.loadError', { message: state.message })}</p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="px-md py-sm rounded border border-border bg-transparent hover:bg-background-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {t('quizPane.retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-auto" data-testid="quiz-pane" style={shell}>
      <QuizPanel
        catalog={state.status === 'ready' ? state.catalog : null}
        engine={engine}
        currentChapter={currentChapter}
        todaysReading={todaysReading}
        startRequest={startRequest}
        bookName={bookName}
        formatReference={formatReference}
        onOpenPassage={handleOpenPassage}
        history={history}
        onFinished={refreshHistory}
        emptyAction={emptyAction}
        labels={labels}
      />
    </div>
  );
};

export default QuizPane;
