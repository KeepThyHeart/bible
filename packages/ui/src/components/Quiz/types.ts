/**
 * Props and labels of the shared quiz components (task 0074). The apps wrap
 * `QuizPanel` in their own pane; everything else is exported for reuse.
 *
 * The panel drives a core `QuizEngine` (from `@bible/core/browser`), which the
 * app builds with its own question source and progress store:
 *   desktop: IPC source + IPC progress store (saved in the user database);
 *   web:     HTTP source + MemoryQuizProgressStore (nothing saved in the browser).
 */
import type {
  QuizCatalog,
  QuizEngine,
  QuizRequest,
  QuizScope,
  QuizSessionSummary,
} from '@bible/core/browser';

/** Every user-visible string. `{name}` placeholders are replaced by the component. */
export interface QuizLabels {
  // Launcher
  title: string;                  // "Quiz"
  intro: string;                  // one line under the title
  scopeHeading: string;           // "What to quiz"
  scopeToday: string;             // "Today's reading ({label})"  {label}
  scopeChapter: string;           // "This chapter ({label})"     {label}
  scopePassage: string;           // "Choose a passage"
  book: string;                   // "Book"
  fromChapter: string;            // "From chapter"
  toChapter: string;              // "To chapter"
  countHeading: string;           // "Questions"
  difficultyHeading: string;      // "Difficulty"
  difficultyMixed: string;
  difficultyEasy: string;
  difficultyMedium: string;
  difficultyHard: string;
  start: string;                  // "Start quiz"
  noQuestionsHere: string;        // "No questions for {label} yet." {label}
  questionsAvailable: string;     // "{count} questions" {count}
  loading: string;
  // Runner
  progress: string;               // "Question {n} of {total}" {n} {total}
  check: string;                  // "Check"
  next: string;                   // "Next"
  finish: string;                 // "See results"
  skip: string;                   // "Skip"
  quit: string;                   // "End quiz"
  showAnswer: string;             // "Show answer"
  yourAnswer: string;             // "Your answer"
  answerPlaceholder: string;      // "Type your answer"
  modelAnswer: string;            // "Answer"
  selfGradePrompt: string;        // "How did you do?"
  gotIt: string;                  // "Got it"
  partly: string;                 // "Partly"
  missed: string;                 // "Missed it"
  correct: string;                // "Correct"
  incorrect: string;              // "Not quite"
  correctAnswerIs: string;        // "The answer: {answer}" {answer}
  countAsCorrect: string;         // "I was right" (override a short-answer miss)
  reflectionHint: string;         // "No right or wrong answer: think it over, or write a few words."
  reflectionPlaceholder: string;
  continue: string;               // "Continue"
  openPassage: string;            // "Read {reference}" {reference}
  kinds: Record<string, string>;  // recall/comprehension/application
  difficultyBadge: Record<'1' | '2' | '3', string>;
  // Summary
  summaryTitle: string;           // "Results"
  score: string;                  // "{correct} of {graded} correct" {correct} {graded}
  scorePartly: string;            // "{partly} partly" {partly}
  noneGraded: string;             // "Nothing was graded in this quiz."
  missedHeading: string;          // "To review"
  retryMissed: string;            // "Retry the ones I missed"
  newQuiz: string;                // "New quiz"
  sameAgain: string;              // "Another quiz on {label}" {label}
  // History (only when the app passes `history`)
  historyHeading: string;         // "Recent quizzes"
  historyEntry: string;           // "{label}: {correct}/{graded}" {label} {correct} {graded} {date}
  // Attribution / info
  sourcesHeading: string;         // "Question sources"
  unreviewed: string;             // "Draft: not yet reviewed"
  textBasis: string;              // "Worded after the {translation}" {translation}
  error: string;                  // "The quiz could not be loaded."
  retry: string;                  // "Try again"
  noModule: string;               // "No quiz questions are installed."
}

export interface QuizPanelProps {
  /** Installed quiz modules and their chapter coverage; null while loading. */
  catalog: QuizCatalog | null;
  /** Builds, grades and records. */
  engine: QuizEngine;
  /** Offered as "This chapter" when it has questions. */
  currentChapter?: { book: number; chapter: number } | null;
  /** Offered as "Today's reading" when present (reading plans). */
  todaysReading?: QuizScope | null;
  /** Start a quiz at once (e.g. the "Quiz me on this chapter" command). Changing it starts a new one. */
  startRequest?: QuizRequest | null;
  /** Localised book name, e.g. 41 -> "Mark". */
  bookName?: (book: number) => string;
  /** "Mark 4:5-6" from verse ids; defaults to English book names. */
  formatReference?: (start: number, end?: number) => string;
  /** Opens a passage in the reader. Without it no passage links are shown. */
  onOpenPassage?: (start: number, end: number) => void;
  /** Recent finished quizzes (desktop only; the web saves none). Absent = no history section. */
  history?: QuizSessionSummary[];
  /** Called after a quiz is finished and recorded (e.g. to refresh `history`). */
  onFinished?: (summary: QuizSessionSummary) => void;
  /** Shown instead of the launcher when there is no catalog (e.g. an install button). */
  emptyAction?: { label: string; onClick: () => void };
  labels?: Partial<QuizLabels>;
  /** Question counts offered. Default [5, 10, 20]. */
  counts?: number[];
  className?: string;
}
