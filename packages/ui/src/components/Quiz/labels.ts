/** English defaults for the quiz components, and the placeholder helper they share. */
import { formatVerseIdRange, getBookName } from '@bible/core/browser';
import type { QuizLabels } from './types';

export const DEFAULT_QUIZ_LABELS: QuizLabels = {
  title: 'Quiz',
  intro: 'Test what you remember and understand from a passage.',
  scopeHeading: 'What to quiz',
  scopeToday: "Today's reading ({label})",
  scopeChapter: 'This chapter ({label})',
  scopePassage: 'Choose a passage',
  book: 'Book',
  fromChapter: 'From chapter',
  toChapter: 'To chapter',
  countHeading: 'Questions',
  difficultyHeading: 'Difficulty',
  difficultyMixed: 'Mixed',
  difficultyEasy: 'Easy',
  difficultyMedium: 'Medium',
  difficultyHard: 'Hard',
  start: 'Start quiz',
  noQuestionsHere: 'No questions for {label} yet.',
  questionsAvailable: '{count} questions',
  loading: 'Loading quiz questions...',
  progress: 'Question {n} of {total}',
  check: 'Check',
  next: 'Next',
  finish: 'See results',
  skip: 'Skip',
  quit: 'End quiz',
  showAnswer: 'Show answer',
  yourAnswer: 'Your answer',
  answerPlaceholder: 'Type your answer',
  modelAnswer: 'Answer',
  selfGradePrompt: 'How did you do?',
  gotIt: 'Got it',
  partly: 'Partly',
  missed: 'Missed it',
  correct: 'Correct',
  incorrect: 'Not quite',
  correctAnswerIs: 'The answer: {answer}',
  countAsCorrect: 'I was right',
  reflectionHint: 'No right or wrong answer: think it over, or write a few words.',
  reflectionPlaceholder: 'Write a few words (optional)',
  continue: 'Continue',
  openPassage: 'Read {reference}',
  kinds: { recall: 'Recall', comprehension: 'Understanding', application: 'Application' },
  difficultyBadge: { '1': 'Easy', '2': 'Medium', '3': 'Hard' },
  summaryTitle: 'Results',
  score: '{correct} of {graded} correct',
  scorePartly: '{partly} partly',
  noneGraded: 'Nothing was graded in this quiz.',
  missedHeading: 'To review',
  retryMissed: 'Retry the ones I missed',
  newQuiz: 'New quiz',
  sameAgain: 'Another quiz on {label}',
  historyHeading: 'Recent quizzes',
  historyEntry: '{label}: {correct}/{graded} ({date})',
  sourcesHeading: 'Question sources',
  unreviewed: 'Draft: not yet reviewed',
  textBasis: 'Worded after the {translation}',
  error: 'The quiz could not be loaded.',
  retry: 'Try again',
  noModule: 'No quiz questions are installed.',
};

/** Replaces each `{name}` in `template` with `values[name]`; unknown placeholders are left as they are. */
export function fillLabel(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

/** The default reference formatter: English book names unless `bookName` is given. */
export function defaultQuizReference(bookName?: (book: number) => string) {
  return (start: number, end?: number): string => formatVerseIdRange(start, end, bookName ?? getBookName);
}

/** Merges app labels over the defaults (`kinds` and `difficultyBadge` merge key by key). */
export function mergeQuizLabels(labels?: Partial<QuizLabels>): QuizLabels {
  if (!labels) return DEFAULT_QUIZ_LABELS;
  return {
    ...DEFAULT_QUIZ_LABELS,
    ...labels,
    kinds: { ...DEFAULT_QUIZ_LABELS.kinds, ...labels.kinds },
    difficultyBadge: { ...DEFAULT_QUIZ_LABELS.difficultyBadge, ...labels.difficultyBadge },
  };
}

/** Joins class names, skipping falsy ones. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}
