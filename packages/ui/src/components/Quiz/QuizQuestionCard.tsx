/** One quiz question: renders by answer mode, grades through the engine, reports the grade upward. */
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { effectiveAnswerMode, expectedAnswer } from '@bible/core/browser';
import type { QuizEngine, QuizGrade, QuizItem } from '@bible/core/browser';
import { cx, defaultQuizReference, fillLabel, mergeQuizLabels } from './labels';
import type { QuizLabels } from './types';

export interface QuizQuestionCardProps {
  item: QuizItem;
  engine: QuizEngine;
  /** The last card shows "See results" instead of "Next". */
  isLast?: boolean;
  /** The current grade, including a corrected one ("I was right") and skips. Recording (once, on leaving the card) is the caller's job. */
  onGrade: (grade: QuizGrade) => void;
  /** Move on: after "Next" and after "Skip". */
  onNext: () => void;
  formatReference?: (start: number, end?: number) => string;
  onOpenPassage?: (start: number, end: number) => void;
  /** The text basis of the question's module; a different `metadata.textBasis` on the question is shown as a note. */
  moduleTextBasis?: string;
  labels?: Partial<QuizLabels>;
  className?: string;
}

const RESULT_LABEL = { correct: 'correct', partly: 'partly', incorrect: 'incorrect' } as const;

export function QuizQuestionCard({
  item,
  engine,
  isLast,
  onGrade,
  onNext,
  formatReference,
  onOpenPassage,
  moduleTextBasis,
  labels,
  className,
}: QuizQuestionCardProps) {
  const l = mergeQuizLabels(labels);
  const fmt = formatReference ?? defaultQuizReference();
  const q = item.question;
  const mode = effectiveAnswerMode(q);
  const [grade, setGrade] = useState<QuizGrade | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [overridden, setOverridden] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const cardRef = useRef<HTMLElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const gotItRef = useRef<HTMLButtonElement>(null);
  const groupName = useId();

  // Move focus to the new question, unless the user has already focused something inside the card.
  useEffect(() => {
    if (cardRef.current?.contains(document.activeElement)) return;
    headingRef.current?.focus();
  }, []);

  // After Check / self-grade focus the Next button; after Show answer the self-grade buttons.
  useEffect(() => {
    if (grade) nextRef.current?.focus();
    else if (revealed) gotItRef.current?.focus();
  }, [grade, revealed, overridden]);

  const primary = q.passages[0];
  const metaBasis = typeof q.metadata?.textBasis === 'string' ? q.metadata.textBasis : undefined;
  const basisNote = metaBasis && metaBasis !== moduleTextBasis ? metaBasis : undefined;
  const kindText = l.kinds[q.kind] ?? q.kind.charAt(0).toUpperCase() + q.kind.slice(1);
  const answered = grade !== null;
  const expected = grade?.expected ?? expectedAnswer(q, item.choices);

  const commit = (g: QuizGrade) => {
    setGrade(g);
    onGrade(g);
  };

  const checkChoice = () => {
    if (choice === null) return;
    commit(engine.grade(q, { type: 'choice', index: choice }, item.choices));
  };
  const checkText = (e?: FormEvent) => {
    e?.preventDefault();
    if (answered || !text.trim()) return;
    commit(engine.grade(q, { type: 'text', text }, item.choices));
  };
  const selfGrade = (result: 'correct' | 'partly' | 'incorrect') => {
    commit(engine.grade(q, { type: 'self', result }, item.choices));
  };
  const skip = () => {
    onGrade(engine.grade(q, { type: 'skip' }, item.choices));
    onNext();
  };

  const feedback =
    grade && (grade.result === 'correct' || grade.result === 'partly' || grade.result === 'incorrect')
      ? grade.result
      : null;
  const feedbackText = feedback === 'correct' ? l.correct : feedback === 'partly' ? l.partly : feedback === 'incorrect' ? l.incorrect : '';

  return (
    <article className={cx('kth-quiz__card', className)} ref={cardRef}>
      <div className="kth-quiz__badges">
        <span className="kth-quiz__badge">{kindText}</span>
        {q.difficulty ? (
          <span className="kth-quiz__badge kth-quiz__badge--muted">{l.difficultyBadge[String(q.difficulty) as '1' | '2' | '3']}</span>
        ) : null}
        {primary && onOpenPassage ? (
          <button
            type="button"
            className="kth-btn kth-btn--ghost kth-btn--sm kth-quiz__passage-link"
            onClick={() => onOpenPassage(primary.start, primary.end)}
          >
            {fillLabel(l.openPassage, { reference: fmt(primary.start, primary.end) })}
          </button>
        ) : null}
      </div>

      {basisNote ? <p className="kth-quiz__small">{fillLabel(l.textBasis, { translation: basisNote })}</p> : null}

      <h3 className="kth-quiz__prompt" dir="auto" tabIndex={-1} ref={headingRef}>
        {q.prompt}
      </h3>

      {mode === 'multiple_choice' ? (
        <div className="kth-quiz__choices" role="radiogroup" aria-label={q.prompt}>
          {(item.choices ?? q.choices ?? []).map((c, i) => {
            const chosen = choice === i;
            const state = answered ? (c.correct ? 'correct' : chosen ? 'incorrect' : null) : null;
            return (
              <label
                key={i}
                className={cx(
                  'kth-quiz__choice',
                  chosen && !answered && 'kth-quiz__choice--selected',
                  state === 'correct' && 'kth-quiz__choice--correct',
                  state === 'incorrect' && 'kth-quiz__choice--incorrect',
                )}
              >
                <input
                  type="radio"
                  className="kth-quiz__choice-input"
                  name={groupName}
                  checked={chosen}
                  disabled={answered}
                  onChange={() => setChoice(i)}
                />
                <span className="kth-quiz__choice-text" dir="auto">{c.text}</span>
                {state ? (
                  <span className="kth-quiz__choice-mark" aria-hidden="true">
                    {state === 'correct' ? '✓' : '✗'}
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      ) : null}

      {mode === 'short_answer' ? (
        <form className="kth-quiz__answer" onSubmit={checkText}>
          <label className="kth-field">
            <span>{l.yourAnswer}</span>
            <input
              type="text"
              className="kth-input"
              // Empty: follow the UI (placeholder at the start); typed: the answer's own direction.
              dir={text ? 'auto' : undefined}
              value={text}
              placeholder={l.answerPlaceholder}
              disabled={answered}
              autoComplete="off"
              onChange={(e) => setText(e.currentTarget.value)}
            />
          </label>
        </form>
      ) : null}

      {mode === 'free_response' || mode === 'reflection' ? (
        <label className="kth-field kth-quiz__answer">
          <span>{mode === 'reflection' ? l.reflectionHint : l.yourAnswer}</span>
          <textarea
            className="kth-input kth-quiz__textarea"
            dir={text ? 'auto' : undefined}
            rows={3}
            value={text}
            placeholder={mode === 'reflection' ? l.reflectionPlaceholder : l.answerPlaceholder}
            disabled={answered}
            onChange={(e) => setText(e.currentTarget.value)}
          />
        </label>
      ) : null}

      <div
        role="status"
        aria-live="polite"
        className={cx('kth-quiz__feedback', feedback && `kth-quiz__feedback--${RESULT_LABEL[feedback]}`)}
      >
        {feedback ? <strong>{feedbackText}</strong> : null}
        {(mode === 'short_answer' || mode === 'multiple_choice') && feedback === 'incorrect' && expected ? (
          <span className="kth-quiz__expected" dir="auto"> {fillLabel(l.correctAnswerIs, { answer: expected })}</span>
        ) : null}
      </div>

      {mode === 'free_response' && revealed ? (
        <div className="kth-quiz__model">
          <div className="kth-quiz__model-label">{l.modelAnswer}</div>
          <p className="kth-quiz__model-text" dir="auto">{q.answer}</p>
        </div>
      ) : null}

      {(answered || (mode === 'free_response' && revealed)) && q.explanation ? (
        <p className="kth-quiz__explanation" dir="auto">{q.explanation}</p>
      ) : null}

      {mode === 'free_response' && revealed && !answered ? (
        <div className="kth-quiz__selfgrade" role="group" aria-label={l.selfGradePrompt}>
          <span className="kth-quiz__selfgrade-prompt">{l.selfGradePrompt}</span>
          <button type="button" className="kth-btn kth-btn--sm" ref={gotItRef} onClick={() => selfGrade('correct')}>
            {l.gotIt}
          </button>
          <button type="button" className="kth-btn kth-btn--sm" onClick={() => selfGrade('partly')}>
            {l.partly}
          </button>
          <button type="button" className="kth-btn kth-btn--sm" onClick={() => selfGrade('incorrect')}>
            {l.missed}
          </button>
        </div>
      ) : null}

      <div className="kth-quiz__actions">
        {!answered && mode === 'multiple_choice' ? (
          <button type="button" className="kth-btn kth-btn--primary" disabled={choice === null} onClick={checkChoice}>
            {l.check}
          </button>
        ) : null}
        {!answered && mode === 'short_answer' ? (
          <button type="button" className="kth-btn kth-btn--primary" disabled={!text.trim()} onClick={() => checkText()}>
            {l.check}
          </button>
        ) : null}
        {!answered && mode === 'free_response' && !revealed ? (
          <button type="button" className="kth-btn kth-btn--primary" onClick={() => setRevealed(true)}>
            {l.showAnswer}
          </button>
        ) : null}
        {!answered && mode === 'reflection' ? (
          <button
            type="button"
            className="kth-btn kth-btn--primary"
            onClick={() => {
              onGrade(engine.grade(q, { type: 'reflection', text: text || undefined }, item.choices));
              onNext();
            }}
          >
            {isLast ? l.finish : l.continue}
          </button>
        ) : null}
        {mode === 'short_answer' && feedback === 'incorrect' && !overridden ? (
          <button
            type="button"
            className="kth-btn"
            onClick={() => {
              setOverridden(true);
              selfGrade('correct');
            }}
          >
            {l.countAsCorrect}
          </button>
        ) : null}
        {answered ? (
          <button type="button" className="kth-btn kth-btn--primary" ref={nextRef} onClick={onNext}>
            {isLast ? l.finish : l.next}
          </button>
        ) : null}
        {!answered ? (
          <button type="button" className="kth-btn kth-btn--ghost" onClick={skip}>
            {l.skip}
          </button>
        ) : null}
      </div>
    </article>
  );
}
