/**
 * The quiz engine's ports. The engine is pure; each app injects these.
 *
 * | Port | Desktop | Web |
 * |---|---|---|
 * | IQuizQuestionSource | IPC -> QuizRepository (every installed quiz module) | `/api/quiz/questions` |
 * | IQuizProgressStore | IPC -> UserDataQuizProgressStore (`user_data_item`, owner `app:quiz`) | MemoryQuizProgressStore (nothing saved in the browser until web accounts) |
 * | IReadingScopeProvider | NO_READING_PLAN until reading plans ship | same |
 * | IQuizAdjudicator | none (seam only) | none (seam only) |
 */
import type {
  QuizAttempt,
  QuizCatalog,
  QuizFilter,
  QuizItemStat,
  QuizPassage,
  QuizQuestion,
  QuizSessionSummary,
} from './types';

/**
 * Where questions come from: a quiz module, a server, or a generator that
 * builds questions at run time from the text (a future "missing word" quiz
 * is one of these; see docs). The engine takes several and merges them by key.
 */
export interface IQuizQuestionSource {
  /** Every question with a passage overlapping any of `passages`. */
  getQuestions(passages: QuizPassage[], filter?: QuizFilter): Promise<QuizQuestion[]>;
}

/** A source that can also describe what it has (installed modules plus coverage). */
export interface IQuizCatalogSource extends IQuizQuestionSource {
  getCatalog(): Promise<QuizCatalog>;
}

/** Per-user history. */
export interface IQuizProgressStore {
  /** Stats for these keys; keys never seen are absent from the map. */
  getStats(keys: string[]): Promise<Map<string, QuizItemStat>>;
  recordAttempt(attempt: QuizAttempt): Promise<void>;
  recordSession(summary: QuizSessionSummary): Promise<void>;
  /** Finished quizzes, newest first. */
  listSessions(limit?: number): Promise<QuizSessionSummary[]>;
}

/** A scope with a label, e.g. a reading-plan day. */
export interface QuizScope {
  label: string;
  passages: QuizPassage[];
}

/**
 * What "today's reading" means. Reading plans (task 0073) supply the real one;
 * until then {@link NO_READING_PLAN} answers null and the UI hides the option.
 */
export interface IReadingScopeProvider {
  /** `date` is a local calendar date, 'YYYY-MM-DD'. */
  getTodaysReading(date: string): Promise<QuizScope | null>;
}

export const NO_READING_PLAN: IReadingScopeProvider = {
  getTodaysReading: async () => null,
};

// ---------------------------------------------------------------------------
// LLM adjudication: a seam only. Nothing in the app implements it yet.
// ---------------------------------------------------------------------------

/** What an adjudicator is asked. Everything it needs travels in the request. */
export interface QuizAdjudicationRequest {
  question: QuizQuestion;
  /** The user's own words. */
  response: string;
  /** The model or expected answer, when the question has one. */
  expected?: string;
  /** Optional context for a better judgement. */
  context?: {
    /** e.g. "Mark 4:5-6". */
    reference?: string;
    /** The passage text in `translation`. */
    passageText?: string;
    translation?: string;
    /** UI language of the response, e.g. 'en'. */
    locale?: string;
  };
}

export interface QuizAdjudication {
  result: 'correct' | 'partly' | 'incorrect';
  /** 0..1 correctness score. */
  score: number;
  /** One or two sentences the UI may show. */
  rationale?: string;
  /** Which adjudicator answered (for display and audit), e.g. 'llm:claude'. */
  adjudicator: string;
}

/**
 * Judges a free-text answer, e.g. by sending question, response, expected
 * answer and passage to an LLM. Optional and off by default; an app that
 * implements it passes it to `QuizEngine` and the shared UI offers a
 * "Check my answer" action on free-response and short-answer questions.
 * Implementations must respect `signal` and must never be called without the
 * user's consent to send their answer off the device.
 */
export interface IQuizAdjudicator {
  readonly id: string;
  adjudicate(request: QuizAdjudicationRequest, signal?: AbortSignal): Promise<QuizAdjudication>;
}
