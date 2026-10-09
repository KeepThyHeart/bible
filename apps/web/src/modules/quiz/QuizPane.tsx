import { useState, useEffect, useMemo, useCallback } from 'preact/hooks';
import './quiz.scss';
import { useTranslation } from 'react-i18next';
import { QuizPanel } from '@bible/ui';
import type { QuizLabels } from '@bible/ui';
import { chapterPassage } from '@bible/core/browser';
import type { IQuizCatalogSource, QuizCatalog, QuizEngine, QuizRequest } from '@bible/core/browser';
import { bibleStore } from '../../stores/bibleStore';
import { useStore } from '../../hooks/useStore';
import { parseVerseId, formatVerseRange } from '../../utils/verseId';
import { getLocalizedBookName } from '../../utils/bookNames';
import { getQuizEngine, getQuizProvider } from './QuizDataProvider';

interface QuizPaneProps {
  /** Defaults to the app-wide catalog source; tests inject their own. */
  provider?: IQuizCatalogSource;
  /** Defaults to the app-wide engine (HTTP questions, in-memory progress). */
  engine?: QuizEngine;
  /** Start a quiz on the reader's current chapter as soon as the pane opens (phone "Quiz me on this chapter"). */
  startOnCurrentChapter?: boolean;
  /** Called when a passage link is used (the phone sheet closes itself so the reader shows). */
  onPassageOpened?: () => void;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; catalog: QuizCatalog }
  | { status: 'error' };

/**
 * Quiz pane (desktop right-pane tab and the phone full-screen sheet). The
 * catalog is fetched on first mount and kept by the provider. Web policy: no
 * history prop and nothing saved in the browser; progress lives in memory for
 * the page session only.
 */
export function QuizPane({ provider, engine, startOnCurrentChapter, onPassageOpened }: QuizPaneProps) {
  const { t } = useTranslation();
  const book = useStore(bibleStore, () => bibleStore.getActiveTab()?.book ?? null);
  const chapter = useStore(bibleStore, () => bibleStore.getActiveTab()?.chapter ?? null);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    (provider ?? getQuizProvider()).getCatalog().then(
      (catalog) => { if (!cancelled) setState({ status: 'ready', catalog }); },
      () => { if (!cancelled) setState({ status: 'error' }); },
    );
    return () => { cancelled = true; };
  }, [provider, attempt]);

  const labels = useMemo<Partial<QuizLabels>>(() => {
    // The shared component fills `{name}` placeholders itself, so each template
    // is passed through unchanged (i18next only interpolates `{{name}}`).
    const keys = [
      'title', 'intro', 'scopeHeading', 'scopeToday', 'scopeChapter', 'scopePassage', 'book', 'fromChapter',
      'toChapter', 'countHeading', 'difficultyHeading', 'difficultyMixed', 'difficultyEasy', 'difficultyMedium',
      'difficultyHard', 'start', 'noQuestionsHere', 'questionsAvailable', 'loading', 'progress', 'check', 'next',
      'finish', 'skip', 'quit', 'showAnswer', 'yourAnswer', 'answerPlaceholder', 'modelAnswer', 'selfGradePrompt',
      'gotIt', 'partly', 'missed', 'correct', 'incorrect', 'correctAnswerIs', 'countAsCorrect', 'reflectionHint',
      'reflectionPlaceholder', 'continue', 'openPassage', 'summaryTitle', 'score', 'scorePartly', 'noneGraded',
      'missedHeading', 'retryMissed', 'newQuiz', 'sameAgain', 'historyHeading', 'historyEntry', 'sourcesHeading',
      'unreviewed', 'textBasis', 'error', 'retry', 'noModule',
    ] as const;
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = t(`quiz.${k}`);
    out.kinds = {
      recall: t('quiz.kinds.recall'),
      comprehension: t('quiz.kinds.comprehension'),
      application: t('quiz.kinds.application'),
    };
    out.difficultyBadge = {
      '1': t('quiz.difficultyBadge.1'),
      '2': t('quiz.difficultyBadge.2'),
      '3': t('quiz.difficultyBadge.3'),
    };
    return out as Partial<QuizLabels>;
  }, [t]);

  const currentChapter = useMemo(
    () => (book && chapter ? { book, chapter } : null),
    [book, chapter],
  );

  // Fixed when the pane opens, so paging the reader afterwards does not restart the quiz.
  const [startRequest] = useState<QuizRequest | null>(() => {
    if (!startOnCurrentChapter) return null;
    const tab = bibleStore.getActiveTab();
    if (!tab?.book || !tab.chapter) return null;
    const p = chapterPassage(tab.book, tab.chapter);
    return { passages: [p], label: formatVerseRange(p.start, p.end) };
  });

  // Same navigation as a study-pane verse link: read the passage in the main reader.
  const openPassage = useCallback((start: number, end: number) => {
    const s = parseVerseId(start);
    void bibleStore.navigateToPreview(s.bookNumber, s.chapter, s.verse, end !== start ? end : undefined);
    onPassageOpened?.();
  }, [onPassageOpened]);

  if (state.status === 'loading') {
    return <div class="quiz-pane quiz-pane--message" role="status">{t('quiz.loading')}</div>;
  }
  if (state.status === 'error') {
    return (
      <div class="quiz-pane quiz-pane--message quiz-pane--error" role="alert">
        <p>{t('quiz.loadError')}</p>
        <button type="button" onClick={() => setAttempt(n => n + 1)}>{t('quiz.retry')}</button>
      </div>
    );
  }
  return (
    <div class="quiz-pane">
      <QuizPanel
        catalog={state.catalog}
        engine={engine ?? getQuizEngine()}
        currentChapter={currentChapter}
        // Reading plans will supply today's reading through IReadingScopeProvider.
        todaysReading={null}
        startRequest={startRequest}
        bookName={getLocalizedBookName}
        formatReference={formatVerseRange}
        onOpenPassage={openPassage}
        labels={labels}
      />
    </div>
  );
}
