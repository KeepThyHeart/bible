/**
 * Pure grading. No I/O: the UI calls `gradeResponse` the moment the user
 * answers.
 */
import type { KnownQuizAnswerMode, QuizChoice, QuizGrade, QuizQuestion, QuizResponse, QuizResult } from './types';
import { QUIZ_ANSWER_MODES } from './types';

const SCORE: Record<QuizResult, number> = { correct: 1, partly: 0.5, incorrect: 0, ungraded: 0, skipped: 0 };

export function scoreOf(result: QuizResult): number {
  return SCORE[result];
}

/** True for results that count toward the score (not reflection, not skipped). */
export function isGradedResult(result: QuizResult): boolean {
  return result === 'correct' || result === 'partly' || result === 'incorrect';
}

/**
 * The mode the UI should use. Known modes are kept when the question has
 * what they need; anything else degrades to free_response (reveal the answer,
 * grade yourself) or, without an answer, to an ungraded reflection.
 */
export function effectiveAnswerMode(q: QuizQuestion): KnownQuizAnswerMode {
  const known = (QUIZ_ANSWER_MODES as readonly string[]).includes(q.mode) ? (q.mode as KnownQuizAnswerMode) : null;
  if (known === 'reflection') return 'reflection';
  if (known === 'multiple_choice' && q.choices && q.choices.length >= 2 && q.choices.some((c) => c.correct)) {
    return 'multiple_choice';
  }
  if (known === 'short_answer' && ((q.accepted && q.accepted.length > 0) || q.answer)) return 'short_answer';
  return q.answer ? 'free_response' : 'reflection';
}

/** The text that would have been right. */
export function expectedAnswer(q: QuizQuestion, choices?: QuizChoice[]): string | undefined {
  const correct = (choices ?? q.choices)?.find((c) => c.correct);
  return correct?.text ?? q.answer ?? q.accepted?.[0];
}

const LEADING_ARTICLES = /^(?:the|a|an)\s+/u;

/**
 * Normalises a short answer for comparison: Unicode NFKC, diacritics removed,
 * lower case, punctuation dropped, whitespace collapsed, a leading English
 * article removed ("the Jordan" = "Jordan").
 */
export function normalizeAnswer(text: string): string {
  let s = text.normalize('NFKD').replace(/\p{M}+/gu, '').normalize('NFKC').toLowerCase();
  s = s.replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  s = s.replace(LEADING_ARTICLES, '');
  return s;
}

/** Optimal string alignment (Damerau-Levenshtein with adjacent transpositions). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array<number>(n + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/** Number words a typed answer may use in place of digits, and back. */
const NUMBER_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17',
  eighteen: '18', nineteen: '19', twenty: '20', thirty: '30', forty: '40', fifty: '50', hundred: '100', thousand: '1000',
};

function numeric(s: string): string {
  return NUMBER_WORDS[s] ?? s;
}

/**
 * Checks a typed answer against the accepted answers. Exact after
 * {@link normalizeAnswer}, or one edit away when the accepted answer is longer
 * than five characters. A number may be typed as digits or as a word.
 * Returns the accepted answer that matched.
 */
export function matchShortAnswer(response: string, accepted: string[]): string | undefined {
  const r = numeric(normalizeAnswer(response));
  if (!r) return undefined;
  for (const a of accepted) {
    if (numeric(normalizeAnswer(a)) === r) return a;
  }
  for (const a of accepted) {
    const n = normalizeAnswer(a);
    if (n.length > 5 && editDistance(n, r) <= 1) return a;
  }
  return undefined;
}

/**
 * Grades one response. `choices` are the choices in the order the user saw
 * them (a quiz shuffles them); defaults to the question's own order.
 */
export function gradeResponse(q: QuizQuestion, response: QuizResponse, choices?: QuizChoice[]): QuizGrade {
  const mode = effectiveAnswerMode(q);
  const shown = choices ?? q.choices;
  const expected = expectedAnswer(q, shown);
  const grade = (result: QuizResult, extra: Partial<QuizGrade> = {}): QuizGrade => ({
    key: q.key,
    result,
    score: SCORE[result],
    ...(expected !== undefined ? { expected } : {}),
    ...extra,
  });

  if (response.type === 'skip') return grade('skipped');
  if (mode === 'reflection') return grade('ungraded');

  switch (response.type) {
    case 'self':
      return grade(response.result);
    case 'choice': {
      if (mode !== 'multiple_choice' || !shown) return grade('ungraded', { needsSelfGrade: true });
      const picked = shown[response.index];
      return grade(picked?.correct ? 'correct' : 'incorrect');
    }
    case 'text': {
      if (mode === 'short_answer') {
        const accepted = q.accepted && q.accepted.length > 0 ? q.accepted : q.answer ? [q.answer] : [];
        const matched = matchShortAnswer(response.text, accepted);
        return matched !== undefined ? grade('correct', { matched }) : grade('incorrect');
      }
      // free_response (or a multiple-choice question answered in words): the
      // user compares with the model answer.
      return grade('ungraded', { needsSelfGrade: true });
    }
    case 'adjudicated': {
      const score = Math.min(1, Math.max(0, Number.isFinite(response.score) ? response.score : SCORE[response.result]));
      return { ...grade(response.result), score };
    }
    case 'reflection':
      return grade('ungraded');
  }
}
