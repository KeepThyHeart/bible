/** The end of a quiz: score, the questions to review, and what to do next. */
import { useId } from 'react';
import { expectedAnswer } from '@bible/core/browser';
import type { Quiz, QuizSessionSummary } from '@bible/core/browser';
import { defaultQuizReference, fillLabel, mergeQuizLabels } from './labels';
import type { QuizLabels } from './types';

export interface QuizSummaryProps {
  quiz: Quiz;
  summary: QuizSessionSummary;
  /** Retry the missed questions (shown only when something was missed). */
  onRetryMissed: () => void;
  /** Another quiz over the same scope. */
  onSameAgain: () => void;
  onNewQuiz: () => void;
  formatReference?: (start: number, end?: number) => string;
  onOpenPassage?: (start: number, end: number) => void;
  labels?: Partial<QuizLabels>;
  className?: string;
}

export function QuizSummary({
  quiz,
  summary,
  onRetryMissed,
  onSameAgain,
  onNewQuiz,
  formatReference,
  onOpenPassage,
  labels,
  className,
}: QuizSummaryProps) {
  const l = mergeQuizLabels(labels);
  const fmt = formatReference ?? defaultQuizReference();
  const missed = quiz.items.filter((it) => summary.missedKeys.includes(it.question.key));
  const label = quiz.label ?? '';
  const titleId = useId();
  return (
    <section className={className ? `kth-quiz__summary ${className}` : 'kth-quiz__summary'} aria-labelledby={titleId}>
      <h2 id={titleId} className="kth-quiz__title">
        {l.summaryTitle}
      </h2>
      <p className="kth-quiz__score">
        {summary.graded > 0 ? (
          <>
            <strong>
              {fillLabel(l.score, { correct: summary.correct, graded: summary.graded }) +
                (summary.partly > 0 ? ` · ${fillLabel(l.scorePartly, { partly: summary.partly })}` : '')}
            </strong>
          </>
        ) : (
          l.noneGraded
        )}
      </p>

      {missed.length > 0 ? (
        <div className="kth-quiz__missed">
          <h3 className="kth-quiz__subtitle">{l.missedHeading}</h3>
          <ul className="kth-quiz__missed-list">
            {missed.map((it) => {
              const p = it.question.passages[0];
              const answer = expectedAnswer(it.question, it.choices);
              return (
                <li key={it.question.key} className="kth-quiz__missed-item">
                  <div className="kth-quiz__missed-prompt">{it.question.prompt}</div>
                  {answer ? <div className="kth-quiz__small">{fillLabel(l.correctAnswerIs, { answer })}</div> : null}
                  {p && onOpenPassage ? (
                    <button type="button" className="kth-btn kth-btn--ghost kth-btn--sm kth-quiz__passage-link" onClick={() => onOpenPassage(p.start, p.end)}>
                      {fillLabel(l.openPassage, { reference: fmt(p.start, p.end) })}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="kth-quiz__actions">
        {summary.missedKeys.length > 0 ? (
          <button type="button" className="kth-btn kth-btn--primary" onClick={onRetryMissed}>
            {l.retryMissed}
          </button>
        ) : null}
        <button type="button" className="kth-btn" onClick={onSameAgain}>
          {fillLabel(l.sameAgain, { label })}
        </button>
        <button type="button" className="kth-btn kth-btn--ghost" onClick={onNewQuiz}>
          {l.newQuiz}
        </button>
      </div>
    </section>
  );
}
