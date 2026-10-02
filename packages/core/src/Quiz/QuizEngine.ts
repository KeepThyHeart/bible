/**
 * Builds quizzes and records results. Pure TypeScript over injected ports, so
 * the same engine runs in the Electron renderer, the web client and tests.
 */
import type {
  IQuizAdjudicator,
  IQuizProgressStore,
  IQuizQuestionSource,
  QuizAdjudication,
  QuizAdjudicationRequest,
} from './ports';
import type {
  Quiz,
  QuizChoice,
  QuizFilter,
  QuizGrade,
  QuizQuestion,
  QuizRequest,
  QuizResponse,
  QuizSessionSummary,
} from './types';
import { effectiveAnswerMode, expectedAnswer, gradeResponse, isGradedResult } from './grading';
import { seededRandom, selectQuestions, shuffleChoices } from './selection';

export interface QuizEngineOptions {
  /** Defaults to `() => new Date()`. */
  now?: () => Date;
  /** Optional free-text judge (a seam; nothing implements it yet). */
  adjudicator?: IQuizAdjudicator;
}

export class QuizEngine {
  private readonly sources: IQuizQuestionSource[];
  private readonly now: () => Date;
  private readonly adjudicator?: IQuizAdjudicator;

  constructor(
    sources: IQuizQuestionSource | IQuizQuestionSource[],
    private readonly store: IQuizProgressStore,
    options: QuizEngineOptions = {},
  ) {
    this.sources = Array.isArray(sources) ? sources : [sources];
    this.now = options.now ?? (() => new Date());
    this.adjudicator = options.adjudicator;
  }

  /** Every candidate for the request, merged over the sources (first source wins a key). */
  async candidates(request: QuizRequest): Promise<QuizQuestion[]> {
    const filter: QuizFilter = {};
    if (request.kinds?.length) filter.kinds = request.kinds;
    if (request.modes?.length) filter.modes = request.modes;
    const lists = await Promise.all(this.sources.map((s) => s.getQuestions(request.passages, filter)));
    const byKey = new Map<string, QuizQuestion>();
    for (const list of lists) for (const q of list) if (!byKey.has(q.key)) byKey.set(q.key, q);
    return [...byKey.values()];
  }

  /**
   * Selects, orders and shuffles a quiz. A quiz with no items means the scope
   * has no questions (the UI says so).
   */
  async buildQuiz(request: QuizRequest): Promise<Quiz> {
    const now = this.now();
    const seed = request.seed ?? (now.getTime() % 2147483647);
    const candidates = await this.candidates(request);
    const stats = await this.store.getStats(candidates.map((q) => q.key));
    const rand = seededRandom(seed);
    const questions = selectQuestions({ candidates, stats, request, rand, now });
    return {
      id: `quiz-${now.getTime().toString(36)}-${(seed >>> 0).toString(36)}`,
      label: request.label,
      passages: request.passages,
      createdAt: now.toISOString(),
      seed,
      items: questions.map((question) => {
        const choices = effectiveAnswerMode(question) === 'multiple_choice' ? shuffleChoices(question, rand) : undefined;
        return choices ? { question, choices } : { question };
      }),
    };
  }

  /** A new quiz of just the given questions (e.g. the ones missed), re-shuffled. */
  retry(quiz: Quiz, keys: string[], seed?: number): Quiz {
    const now = this.now();
    const s = seed ?? ((quiz.seed + 1) >>> 0);
    const rand = seededRandom(s);
    const wanted = new Set(keys);
    return {
      id: `quiz-${now.getTime().toString(36)}-${s.toString(36)}`,
      label: quiz.label,
      passages: quiz.passages,
      createdAt: now.toISOString(),
      seed: s,
      items: quiz.items
        .filter((it) => wanted.has(it.question.key))
        .map((it) => (it.choices ? { question: it.question, choices: shuffleChoices(it.question, rand) } : { question: it.question })),
    };
  }

  /** Pure grading of one response (see grading.ts). */
  grade(question: QuizQuestion, response: QuizResponse, choices?: QuizChoice[]): QuizGrade {
    return gradeResponse(question, response, choices);
  }

  /** Records one graded answer in the progress store. Ungraded and skipped answers are not recorded. */
  async recordGrade(grade: QuizGrade, quizId?: string): Promise<void> {
    if (!isGradedResult(grade.result)) return;
    await this.store.recordAttempt({ key: grade.key, result: grade.result, at: this.now().toISOString(), quizId });
  }

  /** Summarises a finished quiz and records it. `grades` may omit unanswered items. */
  async finish(quiz: Quiz, grades: QuizGrade[]): Promise<QuizSessionSummary> {
    const summary = summarizeQuiz(quiz, grades, this.now());
    await this.store.recordSession(summary);
    return summary;
  }

  /** True when an adjudicator is configured and the question takes free text. */
  canAdjudicate(question: QuizQuestion): boolean {
    if (!this.adjudicator) return false;
    const mode = effectiveAnswerMode(question);
    return mode === 'free_response' || mode === 'short_answer';
  }

  /**
   * Asks the configured adjudicator to judge a free-text answer. Throws when
   * none is configured; call {@link canAdjudicate} first.
   */
  async adjudicate(
    question: QuizQuestion,
    response: string,
    context?: QuizAdjudicationRequest['context'],
    signal?: AbortSignal,
  ): Promise<QuizAdjudication> {
    if (!this.adjudicator) throw new Error('No quiz adjudicator is configured');
    return this.adjudicator.adjudicate({ question, response, expected: expectedAnswer(question), context }, signal);
  }
}

/** Score and missed list of a quiz. Pure. */
export function summarizeQuiz(quiz: Quiz, grades: QuizGrade[], now: Date): QuizSessionSummary {
  const byKey = new Map(grades.map((g) => [g.key, g]));
  let graded = 0;
  let correct = 0;
  let partly = 0;
  let points = 0;
  const missedKeys: string[] = [];
  for (const item of quiz.items) {
    const g = byKey.get(item.question.key);
    if (!g || !isGradedResult(g.result)) continue;
    graded++;
    points += g.score;
    if (g.result === 'correct') correct++;
    else {
      if (g.result === 'partly') partly++;
      missedKeys.push(g.key);
    }
  }
  return {
    id: quiz.id,
    date: now.toISOString(),
    label: quiz.label,
    passages: quiz.passages,
    total: quiz.items.length,
    graded,
    correct,
    partly,
    score: graded > 0 ? points / graded : 0,
    missedKeys,
  };
}
