/** QuizPanel: launcher, runner and summary of a quiz over a core QuizEngine. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { summarizeQuiz } from '@bible/core/browser';
import type { Quiz, QuizGrade, QuizRequest, QuizSessionSummary } from '@bible/core/browser';
import { cx, defaultQuizReference, fillLabel, mergeQuizLabels } from './labels';
import { QuizLauncher } from './QuizLauncher';
import { QuizQuestionCard } from './QuizQuestionCard';
import { QuizSummary } from './QuizSummary';
import type { QuizPanelProps } from './types';

type Phase = 'launcher' | 'running' | 'summary';

export function QuizPanel({
  catalog,
  engine,
  currentChapter,
  todaysReading,
  startRequest,
  bookName,
  formatReference,
  onOpenPassage,
  history,
  onFinished,
  emptyAction,
  labels,
  counts,
  className,
}: QuizPanelProps) {
  const l = mergeQuizLabels(labels);
  const fmt = formatReference ?? defaultQuizReference(bookName);
  const [phase, setPhase] = useState<Phase>('launcher');
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [index, setIndex] = useState(0);
  const [grades, setGrades] = useState<Record<string, QuizGrade>>({});
  const [summary, setSummary] = useState<QuizSessionSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<(() => void) | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lastRequest = useRef<QuizRequest | null>(null);
  const handledStart = useRef<QuizRequest | null>(null);
  // A token so a slow build that was superseded cannot overwrite a newer one.
  const buildToken = useRef(0);

  const begin = useCallback((q: Quiz) => {
    setQuiz(q);
    setIndex(0);
    setGrades({});
    setSummary(null);
    setNotice(null);
    setError(null);
    setPhase('running');
  }, []);

  const build = useCallback(
    async (request: QuizRequest) => {
      lastRequest.current = request;
      const token = ++buildToken.current;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const q = await engine.buildQuiz(request);
        if (token !== buildToken.current) return;
        if (q.items.length === 0) {
          setNotice(fillLabel(l.noQuestionsHere, { label: request.label ?? '' }));
          setPhase('launcher');
        } else {
          begin(q);
        }
      } catch {
        if (token === buildToken.current) setError(() => () => void build(request));
      } finally {
        if (token === buildToken.current) setBusy(false);
      }
    },
    [engine, begin, l.noQuestionsHere],
  );

  useEffect(() => {
    if (startRequest && startRequest !== handledStart.current && catalog) {
      handledStart.current = startRequest;
      void build(startRequest);
    }
  }, [startRequest, catalog, build]);

  const onGrade = (grade: QuizGrade) => {
    setGrades((g) => ({ ...g, [grade.key]: grade }));
    if (grade.result === 'correct' || grade.result === 'partly' || grade.result === 'incorrect') {
      void engine.recordGrade(grade, quiz?.id).catch(() => undefined);
    }
  };

  const finish = async (current: Quiz, all: Record<string, QuizGrade>) => {
    const list = Object.values(all);
    let result: QuizSessionSummary;
    try {
      result = await engine.finish(current, list);
    } catch {
      result = summarizeQuiz(current, list, new Date());
    }
    setSummary(result);
    setPhase('summary');
    onFinished?.(result);
  };

  const next = () => {
    if (!quiz) return;
    if (index + 1 >= quiz.items.length) void finish(quiz, grades);
    else setIndex(index + 1);
  };

  const root = cx('kth-quiz', className);

  if (error) {
    return (
      <div className={root}>
        <p className="kth-quiz__notice" role="alert">{l.error}</p>
        <div className="kth-quiz__actions">
          <button type="button" className="kth-btn kth-btn--primary" onClick={error}>
            {l.retry}
          </button>
        </div>
      </div>
    );
  }

  if (catalog === null) {
    return (
      <div className={root}>
        <p className="kth-quiz__small" role="status">{l.loading}</p>
      </div>
    );
  }

  if (phase === 'running' && quiz) {
    const item = quiz.items[index];
    const total = quiz.items.length;
    return (
      <div className={root}>
        <header className="kth-quiz__header">
          <div className="kth-quiz__header-text">
            <div className="kth-quiz__count">{fillLabel(l.progress, { n: index + 1, total })}</div>
            {quiz.label ? <div className="kth-quiz__label">{quiz.label}</div> : null}
          </div>
          <button type="button" className="kth-btn kth-btn--ghost kth-btn--sm" onClick={() => void finish(quiz, grades)}>
            {l.quit}
          </button>
        </header>
        <div
          className="kth-quiz__progress"
          role="progressbar"
          aria-label={fillLabel(l.progress, { n: index + 1, total })}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={index}
        >
          <div
            className="kth-quiz__progress-fill"
            style={{ '--_kth-quiz-pct': `${Math.round((index / total) * 100)}%` } as Record<string, string>}
          />
        </div>
        <QuizQuestionCard
          key={`${quiz.id}:${item.question.key}`}
          item={item}
          engine={engine}
          isLast={index + 1 >= total}
          onGrade={onGrade}
          onNext={next}
          formatReference={fmt}
          onOpenPassage={onOpenPassage}
          labels={labels}
        />
      </div>
    );
  }

  if (phase === 'summary' && quiz && summary) {
    return (
      <div className={root}>
        <QuizSummary
          quiz={quiz}
          summary={summary}
          formatReference={fmt}
          onOpenPassage={onOpenPassage}
          labels={labels}
          onRetryMissed={() => begin(engine.retry(quiz, summary.missedKeys))}
          onSameAgain={() => {
            const req = lastRequest.current ?? { passages: quiz.passages, label: quiz.label };
            void build({ ...req, seed: undefined });
          }}
          onNewQuiz={() => setPhase('launcher')}
        />
      </div>
    );
  }

  if (catalog.modules.length === 0 || catalog.coverage.every((c) => c.count <= 0)) {
    return (
      <div className={root}>
        <p className="kth-quiz__intro">{l.noModule}</p>
        {emptyAction ? (
          <div className="kth-quiz__actions">
            <button type="button" className="kth-btn kth-btn--primary" onClick={emptyAction.onClick}>
              {emptyAction.label}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={root}>
      <QuizLauncher
        catalog={catalog}
        onStart={(r) => void build(r)}
        currentChapter={currentChapter}
        todaysReading={todaysReading}
        bookName={bookName}
        formatReference={formatReference}
        history={history}
        counts={counts}
        busy={busy}
        notice={notice}
        labels={labels}
      />
    </div>
  );
}
