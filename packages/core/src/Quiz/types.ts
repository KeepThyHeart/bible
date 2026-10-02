/**
 * Quiz DTOs. Plain JSON, no platform imports: the same shapes cross the
 * Electron IPC boundary, the web `/api/quiz` routes and the shared UI.
 *
 * See `docs/features/quiz.md` for the model, and `sql/schemas/initial/Quiz.sql`
 * for the module format these are read from.
 */

/** Known question kinds. Open set: a module may use others; readers must cope. */
export const QUIZ_KINDS = ['recall', 'comprehension', 'application'] as const;
export type KnownQuizKind = (typeof QUIZ_KINDS)[number];
/** A kind name; the known ones autocomplete, any string is accepted. */
export type QuizKind = KnownQuizKind | (string & {});

/**
 * Known answer modes. Open set: an unknown mode falls back to
 * `free_response` behaviour when the question has an answer, else to
 * `reflection` (see {@link effectiveAnswerMode}).
 */
export const QUIZ_ANSWER_MODES = ['multiple_choice', 'short_answer', 'free_response', 'reflection'] as const;
export type KnownQuizAnswerMode = (typeof QUIZ_ANSWER_MODES)[number];
export type QuizAnswerMode = KnownQuizAnswerMode | (string & {});

/** 1 easy, 2 medium, 3 hard. Unrated questions count as 2 when levels are mixed. */
export type QuizDifficulty = 1 | 2 | 3;
export const QUIZ_DIFFICULTIES: readonly QuizDifficulty[] = [1, 2, 3];

/** An inclusive verse-id range (book*1_000_000 + chapter*1_000 + verse). */
export interface QuizPassage {
  start: number;
  end: number;
}

/** A question's passage as stored: `primary` marks the verses it is chiefly about. */
export interface QuizQuestionPassage extends QuizPassage {
  primary: boolean;
}

export interface QuizChoice {
  text: string;
  correct: boolean;
}

/**
 * One question. `key` is its identity everywhere (progress, retries, sync);
 * never use a database row id.
 */
export interface QuizQuestion {
  /** Stable across module releases, e.g. 'kth:MRK:1:03', 'tq:MRK:a4zc'. */
  key: string;
  /**
   * Where the question came from: the quiz module's uuid, or
   * `generator:<id>` for a question built at run time (see docs: dynamic
   * question types). Optional for hand-built questions in tests.
   */
  origin?: string;
  /** Primary passage first. Never empty. */
  passages: QuizQuestionPassage[];
  kind: QuizKind;
  mode: QuizAnswerMode;
  difficulty?: QuizDifficulty;
  prompt: string;
  /** The correct choice text, the expected short answer, or the model answer. */
  answer?: string;
  /** multiple_choice only, in stored order (a quiz shuffles a copy). */
  choices?: QuizChoice[];
  /** short_answer: every answer that counts as correct. */
  accepted?: string[];
  explanation?: string;
  tags?: string[];
  /** `data_source.id` of the dataset it came from (for attribution). */
  sourceId?: string;
  /** 'unreviewed' | 'approved' | 'edited' (open set). */
  reviewStatus?: string;
  /** Anything a question type needs that has no field here. Always an object. */
  metadata?: Record<string, unknown>;
}

/** Licence and credit for one source dataset of a quiz module (`data_source`). */
export interface QuizDataSource {
  id: string;
  name: string;
  licence: string;
  url?: string;
  attribution?: string;
}

/** One installed quiz module. */
export interface QuizModuleInfo {
  uuid: string;
  name: string;
  abbreviation?: string;
  version?: string;
  license?: string;
  licenseUrl?: string;
  description?: string;
  languageCode?: string;
  /**
   * The translation whose wording the questions follow (module_info.metadata.textBasis).
   * A question may override it in `metadata.textBasis` (e.g. imported questions in ULT wording).
   */
  textBasis?: string;
  /** module_info.metadata.draft: the questions have not been reviewed yet. */
  draft?: boolean;
  sources: QuizDataSource[];
}

/** How many questions a chapter has (counted by each question's primary passage). */
export interface QuizChapterCoverage {
  book: number;
  chapter: number;
  count: number;
}

/** Everything the launcher needs: the installed modules and where they have questions. */
export interface QuizCatalog {
  modules: QuizModuleInfo[];
  /** Merged over every module, sorted by book then chapter. */
  coverage: QuizChapterCoverage[];
}

/** Narrows the questions a source returns. All fields optional; empty = no filter. */
export interface QuizFilter {
  kinds?: string[];
  modes?: string[];
  /** Only these quiz modules (by uuid). */
  moduleUuids?: string[];
}

/** What the user asked for. */
export interface QuizRequest {
  /** The scope: today's reading, a chapter, or a chosen passage. Non-empty. */
  passages: QuizPassage[];
  /** Shown as the quiz title, e.g. "Mark 4" or "Today's reading". */
  label?: string;
  /** Number of questions, reflection included. Default 5. */
  count?: number;
  /** A level, or 'mixed' (default) for a 2:2:1 spread of easy, medium, hard. */
  difficulty?: QuizDifficulty | 'mixed';
  kinds?: string[];
  modes?: string[];
  /** At most one ungraded reflection, placed last. Default true. */
  includeReflection?: boolean;
  /** Deterministic selection and shuffling. Default: derived from the clock. */
  seed?: number;
  /** Only these keys (e.g. "retry the ones I missed"); selection rules still apply to order. */
  onlyKeys?: string[];
}

/** One question as it appears in a built quiz. */
export interface QuizItem {
  question: QuizQuestion;
  /** multiple_choice: the choices in display order (shuffled per quiz). */
  choices?: QuizChoice[];
}

export interface Quiz {
  id: string;
  label?: string;
  passages: QuizPassage[];
  /** ISO timestamp. */
  createdAt: string;
  seed: number;
  items: QuizItem[];
}

/** The outcome of one answer. */
export type QuizResult = 'correct' | 'partly' | 'incorrect' | 'ungraded' | 'skipped';

/** What the user did. */
export type QuizResponse =
  | { type: 'choice'; index: number }
  | { type: 'text'; text: string }
  | { type: 'self'; result: 'correct' | 'partly' | 'incorrect' }
  | { type: 'reflection'; text?: string }
  /** The verdict of an IQuizAdjudicator on a free-text answer (seam; nothing produces it yet). */
  | { type: 'adjudicated'; result: 'correct' | 'partly' | 'incorrect'; score: number; adjudicator: string }
  | { type: 'skip' };

export interface QuizGrade {
  key: string;
  result: QuizResult;
  /** 1 correct, 0.5 partly, 0 otherwise. */
  score: number;
  /** What would have been right (choice text, expected answer, model answer). */
  expected?: string;
  /** short_answer: the accepted answer the response matched. */
  matched?: string;
  /** The answer cannot be machine-checked: show `expected` and let the user grade. */
  needsSelfGrade?: boolean;
}

/** Per-question history (one row per key in the progress store). */
export interface QuizItemStat {
  key: string;
  seen: number;
  correct: number;
  partly: number;
  missed: number;
  /** ISO timestamp of the last attempt. */
  lastSeen?: string;
  lastResult?: QuizResult;
  /** ISO timestamp of the last fully correct answer. */
  lastCorrect?: string;
}

export interface QuizAttempt {
  key: string;
  result: QuizResult;
  /** ISO timestamp. */
  at: string;
  quizId?: string;
}

export interface QuizSessionSummary {
  /** The quiz id. */
  id: string;
  /** ISO timestamp the quiz was finished. */
  date: string;
  label?: string;
  passages: QuizPassage[];
  /** Questions shown. */
  total: number;
  /** Questions that were graded (not reflection, not skipped). */
  graded: number;
  correct: number;
  partly: number;
  /** Sum of grade scores / graded, 0..1 (0 when nothing was graded). */
  score: number;
  /** Keys answered incorrectly or partly. */
  missedKeys: string[];
}
